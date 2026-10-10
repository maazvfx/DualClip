using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace DualClip.Services;

// Search subsystem: FTS5 index schema, triggers,
// resumable backfill (outside _gate), availability probe and legacy fallback.
public partial class DatabaseService
{
    private const int FtsSchemaVersion = 1;
    private const int FtsBackfillBatch = 2000;

    private static readonly object _ftsBackfillGate = new();
    private int _ftsBackfillKicked;

    /// <summary>Staging kill-switch. Default true. Set false to keep a database
    /// completely free of FTS objects (schema, triggers, backfill) — retrieval
    /// stays on legacy LIKE either way until Phase 3.</summary>
    public static bool FtsStagingEnabled { get; set; } = true;

    public bool FtsAvailable { get; private set; }

    private void EnsureFtsSchema(SqliteConnection conn)
    {
        if (!FtsStagingEnabled) { FtsAvailable = false; return; }
        try
        {
            using var probe = conn.CreateCommand();
            probe.CommandText = "SELECT sqlite_compileoption_used('ENABLE_FTS5');";
            var v = probe.ExecuteScalar();
            if (v is not long l || l == 0)
            {
                FtsAvailable = false;
                return;
            }

            using var ddl = conn.CreateCommand();
            ddl.CommandText = """
                CREATE VIRTUAL TABLE IF NOT EXISTS fts_clips USING fts5(
                    text_content, preview, content='clips', content_rowid='id',
                    tokenize='porter unicode61', prefix='2 3');
                CREATE TRIGGER IF NOT EXISTS trg_clips_ai AFTER INSERT ON clips BEGIN
                    INSERT INTO fts_clips(rowid, text_content, preview) VALUES (new.id, new.text_content, new.preview);
                END;
                CREATE TRIGGER IF NOT EXISTS trg_clips_ad AFTER DELETE ON clips BEGIN
                    INSERT INTO fts_clips(fts_clips, rowid, text_content, preview) VALUES('delete', old.id, old.text_content, old.preview);
                END;
                CREATE TRIGGER IF NOT EXISTS trg_clips_au AFTER UPDATE ON clips
                WHEN NEW.text_content != OLD.text_content OR NEW.preview != OLD.preview BEGIN
                    INSERT INTO fts_clips(fts_clips, rowid, text_content, preview) VALUES('delete', old.id, old.text_content, old.preview);
                    INSERT INTO fts_clips(rowid, text_content, preview) VALUES (new.id, new.text_content, new.preview);
                END;
                """;
            ddl.ExecuteNonQuery();
            FtsAvailable = true;
        }
        catch (SqliteException)
        {
            // No FTS5 in this SQLite build, or DDL failed: stay in permanent legacy mode.
            FtsAvailable = false;
        }
    }

    private void MaybeStartFtsBackfill()
    {
        if (!FtsStagingEnabled || !FtsAvailable) return;
        if (Interlocked.Exchange(ref _ftsBackfillKicked, 1) == 1) return;
        Task.Run(() =>
        {
            try { EnsureFtsBackfill(CancellationToken.None); } catch { }
        });
    }

    private long ReadUserVersion(SqliteConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        var v = cmd.ExecuteScalar();
        return v is null or DBNull ? 0 : Convert.ToInt64(v);
    }

    private volatile bool _isFtsReadyCached;

    /// <summary>True only when FTS5 is usable AND the backfill marker is complete.
    /// Phase 3 retrieval must consult this before touching fts_clips.</summary>
    public bool IsFtsReady()
    {
        if (_isFtsReadyCached) return true;
        if (!FtsStagingEnabled || !FtsAvailable) return false;
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var exists = conn.CreateCommand();
            exists.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='fts_clips';";
            if (Convert.ToInt64(exists.ExecuteScalar()) == 0)
            {
                DropOrphanFtsTriggers(conn);
                return false;
            }
            bool ready = ReadUserVersion(conn) >= FtsSchemaVersion;
            if (ready) _isFtsReadyCached = true;
            return ready;
        }
        catch (SqliteException)
        {
            return false;
        }
    }

    private static void DropOrphanFtsTriggers(SqliteConnection conn)
    {
        // Table gone but triggers remain: every write would throw. Remove them so
        // capture keeps working in legacy mode.
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DROP TRIGGER IF EXISTS trg_clips_ai; DROP TRIGGER IF EXISTS trg_clips_ad; DROP TRIGGER IF EXISTS trg_clips_au;";
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException) { }
    }

    /// <summary>Chunked, resumable backfill. Runs outside _gate (own connections),
    /// cancellable between batches. Safe to call concurrently; duplicates are skipped.</summary>
    public void EnsureFtsBackfill(CancellationToken ct = default)
    {
        if (!FtsStagingEnabled || !FtsAvailable) return;
        lock (_ftsBackfillGate)
        {
            try
            {
                using var conn = new SqliteConnection(_connectionString);
                conn.Open();
                if (ReadUserVersion(conn) >= FtsSchemaVersion) return;

                long last = 0;
                while (!ct.IsCancellationRequested)
                {
                    // Chunk boundary first, so advancement never depends on insert success
                    // (rows concurrently indexed by live triggers would otherwise stall us).
                    long chunkMax;
                    using (var bound = conn.CreateCommand())
                    {
                        bound.CommandText = "SELECT COALESCE(MAX(id), 0) FROM (SELECT id FROM clips WHERE id > $last ORDER BY id LIMIT $n);";
                        bound.Parameters.AddWithValue("$last", last);
                        bound.Parameters.AddWithValue("$n", FtsBackfillBatch);
                        chunkMax = Convert.ToInt64(bound.ExecuteScalar());
                    }
                    if (chunkMax <= last) break;

                    try
                    {
                        using var batch = conn.CreateCommand();
                        batch.CommandText = "INSERT INTO fts_clips(rowid, text_content, preview) SELECT id, text_content, preview FROM clips WHERE id > $last AND id <= $max;";
                        batch.Parameters.AddWithValue("$last", last);
                        batch.Parameters.AddWithValue("$max", chunkMax);
                        batch.ExecuteNonQuery();
                    }
                    catch (SqliteException)
                    {
                        // Already indexed by a racing trigger; chunk boundary still advances below.
                    }
                    last = chunkMax;
                }

                if (ct.IsCancellationRequested) return;
                if (!VerifyFtsIntegrity(conn)) return;

                using var set = conn.CreateCommand();
                set.CommandText = $"PRAGMA user_version = {FtsSchemaVersion};";
                set.ExecuteNonQuery();
            }
            catch (SqliteException) { }
        }
    }

    private static bool VerifyFtsIntegrity(SqliteConnection conn)
    {
        try
        {
            using (var count = conn.CreateCommand())
            {
                count.CommandText = "SELECT (SELECT COUNT(*) FROM clips), (SELECT COUNT(*) FROM fts_clips);";
                using (var r = count.ExecuteReader())
                {
                    if (!r.Read()) return false;
                    if (r.GetInt64(0) != r.GetInt64(1)) return false;
                }
            }

            // Sampled content check: 20 spread ids must match text verbatim.
            var ids = new System.Collections.Generic.List<(long, string)>();
            using (var sample = conn.CreateCommand())
            {
                sample.CommandText = "SELECT id, text_content FROM clips ORDER BY id LIMIT 20;";
                using (var rs = sample.ExecuteReader())
                {
                    while (rs.Read()) ids.Add((rs.GetInt64(0), rs.GetString(1)));
                }
            }

            foreach (var (id, text) in ids)
            {
                using var chk = conn.CreateCommand();
                chk.CommandText = "SELECT text_content FROM fts_clips WHERE rowid = $id;";
                chk.Parameters.AddWithValue("$id", id);
                var got = chk.ExecuteScalar() as string;
                if (!string.Equals(got, text, StringComparison.Ordinal)) return false;
            }
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
    }

    /// <summary>Integrity repair path: wipe + re-backfill (resumable). Legacy search unaffected.</summary>
    public void RebuildFtsIndex(CancellationToken ct = default)
    {
        _isFtsReadyCached = false;
        if (!FtsStagingEnabled || !FtsAvailable) return;
        lock (_ftsBackfillGate)
        {
            try
            {
                using var conn = new SqliteConnection(_connectionString);
                conn.Open();
                using var wipe = conn.CreateCommand();
                wipe.CommandText = "DELETE FROM fts_clips; PRAGMA user_version = 0;";
                wipe.ExecuteNonQuery();
            }
            catch (SqliteException) { return; }
        }
        EnsureFtsBackfill(ct);
    }

    /// <summary>Restore path: allow the one-shot backfill to run again against
    /// freshly restored data, then rebuild the FTS index in the background.</summary>
    public void ResetAndRestartFtsAfterRestore()
    {
        _isFtsReadyCached = false;
        Interlocked.Exchange(ref _ftsBackfillKicked, 0);
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            EnsureFtsSchema(conn);
        }
        catch { }
        Task.Run(() =>
        {
            try { RebuildFtsIndex(); } catch { }
        });
    }
}
