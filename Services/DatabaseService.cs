using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Microsoft.Data.Sqlite;
using DualClip.Models;

namespace DualClip.Services;

public partial class DatabaseService
{
    private readonly string _connectionString;
    private readonly string _dbFilePath;
    private readonly object _gate = new();
    private long _dataGeneration = 1;

    public long DataGeneration => Interlocked.Read(ref _dataGeneration);

    public long BumpDataGeneration() => Interlocked.Increment(ref _dataGeneration);

    public static string DefaultPath()
    {
        return PathHelper.GetDatabasePath();
    }

    public DatabaseService(string? dbPath = null)
    {
        var path = dbPath ?? DefaultPath();
        _dbFilePath = path;
        var csb = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            DefaultTimeout = 5,
            ForeignKeys = true,
            Mode = SqliteOpenMode.ReadWriteCreate
        };
        _connectionString = csb.ToString();
        EnsureCleanStartupDatabase();
        InitializeDatabaseWithRecovery();
        // Backfill runs on a background task, never holding _gate (see DatabaseService.Fts.cs).
        MaybeStartFtsBackfill();
        // Trigger non-blocking startup safety backup in background
        TriggerStartupSafetyBackupAsync();
    }

    /// <summary>
    /// Synchronous startup pre-flight: a corrupt <c>clips.db</c> is rotated to
    /// <c>clips_corrupt_&lt;timestamp&gt;.db</c> before any schema work so the
    /// app always launches. Transient busy/locked opens are NOT corruption and
    /// are left alone; non-corruption errors are left for init to surface.
    /// </summary>
    private void EnsureCleanStartupDatabase()
    {
        try
        {
            if (!File.Exists(_dbFilePath)) return;
            if (!IsDatabaseCorruptAtStartup()) return;
            RotateCorruptDatabase();
        }
        catch { }
    }

    private bool IsDatabaseCorruptAtStartup()
    {
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var quick = conn.CreateCommand();
            quick.CommandText = "PRAGMA quick_check;";
            quick.CommandTimeout = 120;
            var res = quick.ExecuteScalar()?.ToString();
            return !string.Equals(res, "ok", StringComparison.OrdinalIgnoreCase);
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 5 /* SQLITE_BUSY */ || ex.SqliteErrorCode == 6 /* SQLITE_LOCKED */)
        {
            return false;
        }
        catch (SqliteException ex)
        {
            return IsCorruptionError(ex);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Init with single corruption retry: a DB that passes pre-flight but
    /// fails schema work with SQLITE_CORRUPT/NOTADB is rotated once and init
    /// is retried clean. Genuine disk/env failures still throw.
    /// </summary>
    private void InitializeDatabaseWithRecovery()
    {
        try
        {
            InitializeDatabase();
            return;
        }
        catch (SqliteException ex) when (IsCorruptionError(ex))
        {
            RotateCorruptDatabase();
            InitializeDatabase();
        }
    }

    private SqliteConnection OpenConnection()
    {
        const int maxAttempts = 5;
        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                var conn = new SqliteConnection(_connectionString);
                conn.Open();
                using var pragma = conn.CreateCommand();
                pragma.CommandText = "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";
                pragma.ExecuteNonQuery();
                return conn;
            }
            catch (SqliteException ex) when (attempt < maxAttempts && (ex.SqliteErrorCode == 5 /* SQLITE_BUSY */ || ex.SqliteErrorCode == 6 /* SQLITE_LOCKED */))
            {
                Thread.Sleep(attempt * 50);
            }
        }

        var finalConn = new SqliteConnection(_connectionString);
        finalConn.Open();
        using var finalPragma = finalConn.CreateCommand();
        finalPragma.CommandText = "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";
        finalPragma.ExecuteNonQuery();
        return finalConn;
    }

    private void InitializeDatabase()
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();

            using var pragma = conn.CreateCommand();
            pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA auto_vacuum=INCREMENTAL;";
            pragma.ExecuteNonQuery();

            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE IF NOT EXISTS clips (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    text_content TEXT NOT NULL,
                    preview TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    track TEXT NOT NULL DEFAULT 'manual',
                    collection TEXT NOT NULL DEFAULT 'all',
                    is_image INTEGER NOT NULL DEFAULT 0,
                    image_path TEXT,
                    thumbnail_data TEXT,
                    img_dims TEXT,
                    img_size TEXT,
                    src_process TEXT,
                    src_title TEXT,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    nickname TEXT,
                    created_at INTEGER NOT NULL,
                    last_used_at INTEGER NOT NULL,
                    sort_rank INTEGER NOT NULL DEFAULT 0,
                    use_count INTEGER NOT NULL DEFAULT 0,
                    custom_title TEXT,
                    rich_text TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash);
                CREATE INDEX IF NOT EXISTS idx_clips_mru ON clips(pinned DESC, sort_rank DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_clips_track ON clips(track, last_used_at DESC);
                CREATE INDEX IF NOT EXISTS idx_clips_nickname_nocase ON clips(nickname COLLATE NOCASE);
                """;
            cmd.ExecuteNonQuery();

            EnsureColumn(conn, "is_image", "INTEGER NOT NULL DEFAULT 0");
            EnsureColumn(conn, "image_path", "TEXT");
            EnsureColumn(conn, "thumbnail_data", "TEXT");
            EnsureColumn(conn, "img_dims", "TEXT");
            EnsureColumn(conn, "img_size", "TEXT");
            EnsureColumn(conn, "favorite", "INTEGER NOT NULL DEFAULT 0");
            EnsureColumn(conn, "nickname", "TEXT");
            EnsureColumn(conn, "sort_rank", "INTEGER NOT NULL DEFAULT 0");
            EnsureColumn(conn, "use_count", "INTEGER NOT NULL DEFAULT 0");
            EnsureColumn(conn, "custom_title", "TEXT");
            EnsureColumn(conn, "rich_text", "TEXT");

            // Phase 1 search upgrade: FTS5 index + triggers. Retrieval untouched.
            EnsureFtsSchema(conn);

            // Phase 1 tagging architecture: normalized tags & clip_tags schema
            EnsureTagSchema(conn);

            // Collection definitions mirror (D3): durable source for localStorage cache
            using var colCmd = conn.CreateCommand();
            colCmd.CommandText = """
                CREATE TABLE IF NOT EXISTS collections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    parent_id TEXT NULL
                );
                """;
            colCmd.ExecuteNonQuery();

            // Migration: ensure parent_id column exists if table was already created.
            // The collections table is created above, so this only ever runs against a database
            // that predates nested collections. EnsureColumn checks before altering, so the
            // duplicate-column case never throws — and a real failure (locked, corrupt or full
            // database) surfaces instead of leaving folder nesting silently broken.
            EnsureColumn(conn, "parent_id", "TEXT NULL", "collections");

            // Durable key-value config table (for supporter status, preferences, etc.)
            using var cfgCmd = conn.CreateCommand();
            cfgCmd.CommandText = """
                CREATE TABLE IF NOT EXISTS app_config (
                    key TEXT PRIMARY KEY,
                    val TEXT NOT NULL
                );
                """;
            cfgCmd.ExecuteNonQuery();

            // Clean up any orphaned junction rows on startup
            try
            {
                using var sweepCmd = conn.CreateCommand();
                sweepCmd.CommandText = "DELETE FROM clip_tags WHERE clip_id NOT IN (SELECT id FROM clips); DELETE FROM clip_tags WHERE tag_id NOT IN (SELECT id FROM tags);";
                sweepCmd.ExecuteNonQuery();
            }
            catch { }

            // Reclaim orphan image files older than the Undo grace period.
            // TryDeleteOrphanImageFile preserves files < 24h for Undo/Restore, and with
            // AutoExpireDays defaulting to 0 (never) nothing else reclaims stale PNGs.
            SweepOrphanImagesOlderThanGracePeriod();
        }
    }

    /// <summary>
    /// Adds a column if the table does not already have it. Checking first means the
    /// already-exists case never raises, so a genuine failure (locked, corrupt, or full
    /// database) propagates instead of being swallowed by a blanket catch.
    /// </summary>
    /// <param name="table">Table to inspect and alter. Defaults to <c>clips</c>, which is every
    /// historical caller; pass the table name explicitly for anything else.</param>
    private static void EnsureColumn(SqliteConnection conn, string colName, string colDef, string table = "clips")
    {
        using var checkCmd = conn.CreateCommand();
        checkCmd.CommandText = $"PRAGMA table_info({table})";
        bool exists = false;
        using (var r = checkCmd.ExecuteReader())
        {
            while (r.Read())
            {
                if (string.Equals(r.GetString(1), colName, StringComparison.OrdinalIgnoreCase))
                {
                    exists = true;
                    break;
                }
            }
        }
        if (!exists)
        {
            using var alterCmd = conn.CreateCommand();
            alterCmd.CommandText = $"ALTER TABLE {table} ADD COLUMN {colName} {colDef}";
            alterCmd.ExecuteNonQuery();
        }
    }

    /// <summary>
    /// Startup/idle reclaim of unreferenced image files older than the Undo grace period.
    /// Reuses TryDeleteOrphanImageFile so files under 24h and still-referenced files are preserved.
    /// </summary>
    private void SweepOrphanImagesOlderThanGracePeriod()
    {
        try
        {
            var imagesDir = PathHelper.GetImagesFolder();
            if (!Directory.Exists(imagesDir)) return;
            foreach (var file in Directory.GetFiles(imagesDir, "*.png"))
            {
                TryDeleteOrphanImageFile(file);
            }
        }
        catch { }
    }

    /// <summary>
    /// Deletes an image file once no clip row references it.
    /// <paramref name="force"/> skips the 24-hour Undo grace period. It MUST only be used by
    /// user-initiated bulk operations that expose no Undo affordance (Clear History, collection
    /// deletion); single-clip deletion keeps the grace period because the UI offers Undo there and
    /// <see cref="RestoreClip"/> needs the file to still exist.
    /// The reference check always runs, so an image still used by another clip is never removed.
    /// </summary>
    private void TryDeleteOrphanImageFile(string? imagePath, bool force = false)
    {
        if (string.IsNullOrWhiteSpace(imagePath)) return;
        try
        {
            var path = imagePath.Trim();
            if (!File.Exists(path)) return;

            if (!force)
            {
                // Only delete orphan image files older than 24 hours to preserve Undo / Restore functionality
                var creationTime = File.GetCreationTimeUtc(path);
                if ((DateTime.UtcNow - creationTime).TotalHours < 24)
                {
                    return;
                }
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM clips WHERE image_path = $p";
            cmd.Parameters.AddWithValue("$p", path);
            var refs = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);
            if (refs == 0)
            {
                try { File.Delete(path); } catch { }
            }
        }
        catch
        {
        }
    }

    public (long Id, bool IsNew) AddOrBump(string text, string track, string? process, string? title, string collection = "all", string? previewOverride = null, string? richText = null)
    {
        text = text.Trim();
        if (string.IsNullOrEmpty(text)) return (0, false);

        var flat = text.Replace("\r", " ").Replace("\n", " ");
        int cut = Math.Min(flat.Length, 120);
        if (cut > 0 && cut < flat.Length && char.IsHighSurrogate(flat[cut - 1])) cut -= 1;
        var preview = !string.IsNullOrWhiteSpace(previewOverride) ? previewOverride : (flat.Length <= cut ? flat : string.Concat(flat.AsSpan(0, cut), "…"));
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            using var findCmd = conn.CreateCommand();
            findCmd.Transaction = tx;
            findCmd.CommandText = "SELECT id FROM clips WHERE content_hash = $h LIMIT 1";
            findCmd.Parameters.AddWithValue("$h", hash);
            var existing = findCmd.ExecuteScalar();

            var validProc = string.Equals(process, "unknown", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(process) ? null : process.Trim();

            if (existing is not null)
            {
                var id = Convert.ToInt64(existing);
                using var bumpCmd = conn.CreateCommand();
                bumpCmd.Transaction = tx;
                bumpCmd.CommandText = """
                    UPDATE clips
                    SET last_used_at = $t,
                        sort_rank = COALESCE((SELECT MAX(sort_rank) FROM clips), 0) + 1,
                        src_process = CASE WHEN $proc IS NOT NULL AND $proc != '' AND $proc != 'unknown' THEN $proc ELSE src_process END,
                        src_title = CASE WHEN $title IS NOT NULL AND $title != '' THEN $title ELSE src_title END,
                        use_count = CASE WHEN $tr = 'voice' THEN 0 ELSE use_count END,
                        rich_text = CASE WHEN $rich IS NOT NULL AND $rich != '' THEN $rich ELSE rich_text END
                    WHERE id = $id
                    """;
                bumpCmd.Parameters.AddWithValue("$t", now);
                bumpCmd.Parameters.AddWithValue("$id", id);
                bumpCmd.Parameters.AddWithValue("$tr", track);
                bumpCmd.Parameters.AddWithValue("$proc", (object?)validProc ?? DBNull.Value);
                bumpCmd.Parameters.AddWithValue("$title", (object?)title ?? DBNull.Value);
                bumpCmd.Parameters.AddWithValue("$rich", (object?)richText ?? DBNull.Value);
                bumpCmd.ExecuteNonQuery();
                tx.Commit();
                return (id, false);
            }

            using var insCmd = conn.CreateCommand();
            insCmd.Transaction = tx;
            insCmd.CommandText = """
                INSERT INTO clips (text_content, preview, content_hash, track, collection, src_process, src_title, created_at, last_used_at, sort_rank, use_count, rich_text)
                VALUES ($t, $p, $h, $tr, $col, $proc, $title, $now, $now, COALESCE((SELECT MAX(sort_rank) FROM clips), 0) + 1, 0, $rich);
                SELECT last_insert_rowid();
                """;
            insCmd.Parameters.AddWithValue("$t", text);
            insCmd.Parameters.AddWithValue("$p", preview);
            insCmd.Parameters.AddWithValue("$h", hash);
            insCmd.Parameters.AddWithValue("$tr", track);
            insCmd.Parameters.AddWithValue("$col", string.IsNullOrWhiteSpace(collection) ? "all" : collection.Trim());
            insCmd.Parameters.AddWithValue("$proc", (object?)validProc ?? DBNull.Value);
            insCmd.Parameters.AddWithValue("$title", (object?)title ?? DBNull.Value);
            insCmd.Parameters.AddWithValue("$now", now);
            insCmd.Parameters.AddWithValue("$rich", (object?)richText ?? DBNull.Value);

            var newId = Convert.ToInt64(insCmd.ExecuteScalar());
            tx.Commit();
            return (newId, true);
        }
    }

    public (long Id, bool IsNew) AddOrBumpToCollection(string text, string targetCollection, bool setFavorite, string? process = "drop", string? title = "Drag & Drop", string? previewOverride = null)
    {
        string normCol = string.IsNullOrWhiteSpace(targetCollection) ? "all" : targetCollection.Trim();
        var (id, isNew) = AddOrBump(text, "manual", process, title, normCol, previewOverride);
        if (id <= 0) return (0, false);

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();

            if (setFavorite)
            {
                using var favCmd = conn.CreateCommand();
                favCmd.CommandText = "UPDATE clips SET favorite = 1 WHERE id = $id";
                favCmd.Parameters.AddWithValue("$id", id);
                favCmd.ExecuteNonQuery();
            }

            if (!string.Equals(normCol, "all", StringComparison.OrdinalIgnoreCase))
            {
                using var moveCmd = conn.CreateCommand();
                moveCmd.CommandText = "UPDATE clips SET collection = $col WHERE id = $id AND (collection IS NULL OR collection = '' OR collection = 'all')";
                moveCmd.Parameters.AddWithValue("$col", normCol);
                moveCmd.Parameters.AddWithValue("$id", id);
                moveCmd.ExecuteNonQuery();
            }
        }
        BumpDataGeneration();
        return (id, isNew);
    }

    public (long Id, bool IsNew) AddOrBumpImage(
        string contentHash,
        string imagePath,
        string thumbnailData,
        string imgDims,
        string imgSize,
        string track,
        string? process,
        string? title,
        string collection = "all",
        string textContent = "[Image]",
        string preview = "[Image]")
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            using var findCmd = conn.CreateCommand();
            findCmd.Transaction = tx;
            findCmd.CommandText = "SELECT id FROM clips WHERE content_hash = $h LIMIT 1";
            findCmd.Parameters.AddWithValue("$h", contentHash);
            var existing = findCmd.ExecuteScalar();

            var validProc = string.Equals(process, "unknown", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(process) ? null : process.Trim();

            if (existing is not null)
            {
                var id = Convert.ToInt64(existing);
                using var bumpCmd = conn.CreateCommand();
                bumpCmd.Transaction = tx;
                bumpCmd.CommandText = """
                    UPDATE clips
                    SET last_used_at = $t,
                        sort_rank = COALESCE((SELECT MAX(sort_rank) FROM clips), 0) + 1,
                        src_process = CASE WHEN $proc IS NOT NULL AND $proc != '' AND $proc != 'unknown' THEN $proc ELSE src_process END,
                        src_title = CASE WHEN $title IS NOT NULL AND $title != '' THEN $title ELSE src_title END
                    WHERE id = $id
                    """;
                bumpCmd.Parameters.AddWithValue("$t", now);
                bumpCmd.Parameters.AddWithValue("$id", id);
                bumpCmd.Parameters.AddWithValue("$proc", (object?)validProc ?? DBNull.Value);
                bumpCmd.Parameters.AddWithValue("$title", (object?)title ?? DBNull.Value);
                bumpCmd.ExecuteNonQuery();
                tx.Commit();
                return (id, false);
            }

            using var insCmd = conn.CreateCommand();
            insCmd.Transaction = tx;
            insCmd.CommandText = """
                INSERT INTO clips (
                    text_content, preview, content_hash, track, collection, is_image,
                    image_path, thumbnail_data, img_dims, img_size,
                    src_process, src_title, created_at, last_used_at, sort_rank, use_count
                )
                VALUES (
                    $text, $prev, $h, $tr, $col, 1,
                    $path, $thumb, $dims, $size,
                    $proc, $title, $now, $now, COALESCE((SELECT MAX(sort_rank) FROM clips), 0) + 1, 0
                );
                SELECT last_insert_rowid();
                """;
            insCmd.Parameters.AddWithValue("$text", textContent);
            insCmd.Parameters.AddWithValue("$prev", preview);
            insCmd.Parameters.AddWithValue("$h", contentHash);
            insCmd.Parameters.AddWithValue("$tr", track);
            insCmd.Parameters.AddWithValue("$col", string.IsNullOrWhiteSpace(collection) ? "all" : collection.Trim());
            insCmd.Parameters.AddWithValue("$path", imagePath);
            insCmd.Parameters.AddWithValue("$thumb", thumbnailData);
            insCmd.Parameters.AddWithValue("$dims", imgDims);
            insCmd.Parameters.AddWithValue("$size", imgSize);
            insCmd.Parameters.AddWithValue("$proc", (object?)validProc ?? DBNull.Value);
            insCmd.Parameters.AddWithValue("$title", (object?)title ?? DBNull.Value);
            insCmd.Parameters.AddWithValue("$now", now);

            var newId = Convert.ToInt64(insCmd.ExecuteScalar());
            tx.Commit();
            return (newId, true);
        }
    }

    public (long Id, bool IsNew) AddOrBumpSvg(
        string contentHash,
        string svgText,
        string imagePath,
        string thumbnailData,
        string imgDims,
        string imgSize,
        string track,
        string? process,
        string? title,
        string collection = "all")
    {
        return AddOrBumpImage(contentHash, imagePath, thumbnailData, imgDims, imgSize, track, process, title, collection, svgText, "[SVG Image]");
    }

    public ClipItem? GetClipById(long id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT id, text_content, preview, pinned, track, src_process, src_title, created_at, last_used_at, use_count, collection, is_image, image_path, thumbnail_data, img_dims, img_size, favorite, nickname, sort_rank, (SELECT GROUP_CONCAT(t.name, ',') FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = clips.id), custom_title, rich_text
            FROM clips WHERE id = $id LIMIT 1
            """;
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        if (r.Read()) return ReadClip(r);
        return null;
    }

    public long RestoreClip(ClipItem item)
    {
        if (item == null) return 0;
        var text = item.Text ?? string.Empty;
        if (text.Length > ClipboardListener.MaxTextChars) return 0;

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        var flat = text.Replace("\r", " ").Replace("\n", " ");
        var preview = !string.IsNullOrEmpty(item.Preview) 
            ? (item.Preview.Length <= 120 ? item.Preview : string.Concat(item.Preview.AsSpan(0, 120), "…"))
            : (flat.Length <= 120 ? flat : string.Concat(flat.AsSpan(0, 120), "…"));

        string? validImagePath = null;
        if (item.IsImage && !string.IsNullOrWhiteSpace(item.ImagePath))
        {
            var imagesDir = PathHelper.GetImagesFolder();
            var fullPath = Path.GetFullPath(item.ImagePath);
            if (fullPath.StartsWith(imagesDir, StringComparison.OrdinalIgnoreCase) && File.Exists(fullPath))
            {
                validImagePath = fullPath;
            }
        }

        lock (_gate)
        {
            using var conn = OpenConnection();
            using var tx = conn.BeginTransaction();

            string targetCol = string.IsNullOrWhiteSpace(item.Collection) ? "all" : item.Collection.Trim();
            if (!IsValidCollectionTarget(conn, targetCol))
            {
                targetCol = "all";
            }

            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO clips (
                    id, text_content, preview, content_hash, track, collection,
                    is_image, image_path, thumbnail_data, img_dims, img_size,
                    src_process, src_title, pinned, favorite, nickname,
                    created_at, last_used_at, sort_rank, use_count, custom_title, rich_text
                )
                VALUES (
                    $id, $text, $prev, $hash, $track, $col,
                    $is_img, $img_path, $thumb, $dims, $size,
                    $proc, $title, $pinned, $fav, $nick,
                    $created, $used, $rank, $count, $custom_title, $rich
                )
                ON CONFLICT(id) DO UPDATE SET
                    text_content = excluded.text_content,
                    preview = excluded.preview,
                    content_hash = excluded.content_hash,
                    track = excluded.track,
                    is_image = excluded.is_image,
                    image_path = excluded.image_path,
                    thumbnail_data = excluded.thumbnail_data,
                    img_dims = excluded.img_dims,
                    img_size = excluded.img_size,
                    src_process = excluded.src_process,
                    src_title = excluded.src_title,
                    nickname = excluded.nickname,
                    created_at = excluded.created_at,
                    last_used_at = excluded.last_used_at,
                    sort_rank = excluded.sort_rank,
                    use_count = excluded.use_count,
                    custom_title = excluded.custom_title,
                    rich_text = excluded.rich_text;
                SELECT last_insert_rowid();
                """;
            cmd.Parameters.AddWithValue("$id", item.Id > 0 ? item.Id : DBNull.Value);
            cmd.Parameters.AddWithValue("$text", text);
            cmd.Parameters.AddWithValue("$prev", preview);
            cmd.Parameters.AddWithValue("$hash", hash);
            cmd.Parameters.AddWithValue("$track", item.Track ?? "manual");
            cmd.Parameters.AddWithValue("$col", targetCol);
            cmd.Parameters.AddWithValue("$is_img", item.IsImage ? 1 : 0);
            cmd.Parameters.AddWithValue("$img_path", (object?)validImagePath ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$thumb", (object?)item.ThumbnailData ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$dims", (object?)item.ImgDims ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$size", (object?)item.ImgSize ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$proc", (object?)item.Process ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$title", (object?)item.Title ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$pinned", item.Pinned ? 1 : 0);
            cmd.Parameters.AddWithValue("$fav", item.Favorite ? 1 : 0);
            cmd.Parameters.AddWithValue("$nick", (object?)item.Nickname ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$created", new DateTimeOffset(item.CreatedAt != default ? item.CreatedAt : DateTime.UtcNow).ToUnixTimeSeconds());
            cmd.Parameters.AddWithValue("$used", new DateTimeOffset(item.LastUsedAt != default ? item.LastUsedAt : DateTime.UtcNow).ToUnixTimeSeconds());
            cmd.Parameters.AddWithValue("$rank", item.SortRank > 0 ? item.SortRank : 0);
            cmd.Parameters.AddWithValue("$count", item.UseCount);
            cmd.Parameters.AddWithValue("$custom_title", (object?)item.CustomTitle ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$rich", (object?)item.RichText ?? DBNull.Value);

            var res = cmd.ExecuteScalar();
            var rowId = item.Id > 0 ? item.Id : Convert.ToInt64(res ?? 0);

            if (rowId > 0 && !string.IsNullOrWhiteSpace(item.Nickname))
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                var rawTags = item.Nickname.Split(new[] { ',', '，' }, StringSplitOptions.RemoveEmptyEntries);
                foreach (var raw in rawTags)
                {
                    var clean = NormalizeTagName(raw);
                    if (!string.IsNullOrEmpty(clean))
                    {
                        var tagId = GetOrCreateTagIdInternal(conn, tx, clean, now);
                        if (tagId > 0)
                        {
                            using var insLink = conn.CreateCommand();
                            insLink.Transaction = tx;
                            insLink.CommandText = "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, assigned_at) VALUES ($cid, $tid, $assigned)";
                            insLink.Parameters.AddWithValue("$cid", rowId);
                            insLink.Parameters.AddWithValue("$tid", tagId);
                            insLink.Parameters.AddWithValue("$assigned", now);
                            insLink.ExecuteNonQuery();
                        }
                    }
                }
            }

            tx.Commit();
            BumpDataGeneration();
            return rowId;
        }
    }

    public bool DeleteClip(long id)
    {
        string? imagePath = null;
        lock (_gate)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            // Capture the image path before the row disappears (MA-004).
            cmd.CommandText = "SELECT image_path FROM clips WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            imagePath = cmd.ExecuteScalar() as string;

            cmd.Parameters.Clear();
            cmd.CommandText = "DELETE FROM clips WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            var ok = cmd.ExecuteNonQuery() > 0;
            if (ok)
            {
                BumpDataGeneration();
                // MA-004: single-deletes used to leak the PNG until a future
                // bulk sweep. TryDeleteOrphanImageFile respects the 24-hour
                // Undo guard and ref-count check, so it is safe unconditionally.
                TryDeleteOrphanImageFile(imagePath);
            }
            return ok;
        }
    }

    public bool TogglePin(long id)
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE clips SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            var ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool ToggleFavorite(long id)
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE clips SET favorite = CASE WHEN favorite = 1 THEN 0 ELSE 1 END WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            var ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool SetFavorite(long id, bool favorite = true)
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE clips SET favorite = $fav WHERE id = $id";
            cmd.Parameters.AddWithValue("$fav", favorite ? 1 : 0);
            cmd.Parameters.AddWithValue("$id", id);
            var ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool SetCustomTitle(long id, string? title)
    {
        string? clean = string.IsNullOrWhiteSpace(title) ? null : title.Trim();
        if (clean != null && clean.Length > 120)
        {
            clean = clean.Substring(0, 120);
        }

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE clips SET custom_title = $title WHERE id = $id";
            cmd.Parameters.AddWithValue("$title", (object?)clean ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$id", id);
            var ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool MarkUsed(long id, bool? trackStats = null)
    {
        bool shouldTrack = trackStats ?? AppSettings.Load().TrackStats;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = shouldTrack
                ? """
                  UPDATE clips
                  SET last_used_at = $t,
                      sort_rank = COALESCE((SELECT MAX(sort_rank) FROM clips), 0) + 1,
                      use_count = use_count + 1
                  WHERE id = $id
                  """
                : """
                  UPDATE clips
                  SET last_used_at = $t,
                      sort_rank = COALESCE((SELECT MAX(sort_rank) FROM clips), 0) + 1
                  WHERE id = $id
                  """;
            cmd.Parameters.AddWithValue("$t", now);
            cmd.Parameters.AddWithValue("$id", id);
            var ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool ClearHistoryAdvanced(int? olderThanDays = null, bool keepPinned = true, bool keepStarred = false, bool keepCustomCollections = false, bool onlyImages = false)
    {
        LastBackupError = null;
        lock (_gate)
        {
            var backup = CreateBackup("pre_clear");
            if (backup == null)
            {
                if (string.IsNullOrEmpty(LastBackupError))
                    LastBackupError = "Pre-clear safety backup failed; clear operation aborted to prevent data loss.";
                return false;
            }
            var where = new List<string>();
            var p = new List<SqliteParameter>();

            if (onlyImages)
            {
                where.Add("is_image = 1");
            }

            if (keepPinned)
            {
                where.Add("pinned = 0");
            }

            if (keepStarred)
            {
                where.Add("favorite = 0");
            }

            if (keepCustomCollections)
            {
                where.Add("(collection = 'all' OR collection = '' OR collection IS NULL)");
            }

            if (olderThanDays.HasValue && olderThanDays.Value > 0)
            {
                var cutoff = DateTimeOffset.UtcNow.AddDays(-olderThanDays.Value).ToUnixTimeSeconds();
                where.Add("created_at < $cutoff");
                p.Add(new SqliteParameter("$cutoff", cutoff));
            }

            var whereSql = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";

            var toGc = new List<string>();
            try
            {
                using var preConn = new SqliteConnection(_connectionString);
                preConn.Open();
                using var q = preConn.CreateCommand();
                var preWhereSql = string.IsNullOrEmpty(whereSql)
                    ? "WHERE image_path IS NOT NULL AND TRIM(image_path) != ''"
                    : whereSql + " AND image_path IS NOT NULL AND TRIM(image_path) != ''";
                q.CommandText = $"SELECT DISTINCT image_path FROM clips {preWhereSql}";
                foreach (var param in p)
                {
                    q.Parameters.Add(new SqliteParameter(param.ParameterName, param.Value));
                }
                using var r = q.ExecuteReader();
                while (r.Read())
                {
                    var path = r.IsDBNull(0) ? null : r.GetString(0);
                    if (!string.IsNullOrWhiteSpace(path)) toGc.Add(path);
                }
            }
            catch { }

            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM clips {whereSql}";
            foreach (var param in p)
            {
                cmd.Parameters.Add(new SqliteParameter(param.ParameterName, param.Value));
            }
            cmd.ExecuteNonQuery();

            foreach (var path in toGc)
            {
                TryDeleteOrphanImageFile(path, force: true);
            }
            BumpDataGeneration();
            return true;
        }
    }

    public bool ClearHistory(bool includePinned = false, List<string>? excludedCollections = null, bool keepStarred = true, bool deleteUnpinned = true, bool deleteImages = true, List<string>? colPinned = null, List<string>? colStarred = null, List<string>? deleteCollections = null)
    {
        LastBackupError = null;
        lock (_gate)
        {
            // Each checkbox is an independent deletion scope. A clip is deleted when it
            // matches ANY selected scope, and it is protected ONLY by the scopes the user did
            // NOT select. No guard is ever applied globally.
            //
            // The previous implementation applied `favorite = 0` across every branch and only
            // emitted the Favorites branch when BOTH deleteUnpinned and deleteImages were
            // false. Because both default to true, ticking "Favorites" on its own produced no
            // matching predicate at all, and pinned favorites survived in several combinations.
            //
            // Selection semantics: Pinned and Favorites are explicit, unconditional scopes.
            // Ticking Pinned deletes pinned clips even when they are also favorited, because
            // Favorites was not what the user chose. Main History and Images are the broad
            // scopes, so they skip anything the user protected by leaving Pinned or Favorites
            // unticked.
            var typeConditions = new List<string>();

            // Main History scope: plain (non-image) clips that nothing else protects.
            if (deleteUnpinned)
            {
                var mainGuard = new List<string> { "is_image = 0" };
                if (!includePinned) mainGuard.Add("pinned = 0");
                if (keepStarred) mainGuard.Add("favorite = 0");
                typeConditions.Add("(" + string.Join(" AND ", mainGuard) + ")");
            }

            // Images scope: image clips that nothing else protects.
            if (deleteImages)
            {
                var imgGuard = new List<string> { "is_image = 1" };
                if (!includePinned) imgGuard.Add("pinned = 0");
                if (keepStarred) imgGuard.Add("favorite = 0");
                typeConditions.Add("(" + string.Join(" AND ", imgGuard) + ")");
            }

            // Pinned scope: every pinned clip, whatever else it is. Unconditional by design.
            if (includePinned)
            {
                typeConditions.Add("pinned = 1");
            }

            // Favorites scope: every favorited clip, pinned or not. Unconditional by design.
            if (!keepStarred)
            {
                typeConditions.Add("favorite = 1");
            }

            // Per-collection sub-scopes: delete strictly the pinned / favorited clips
            // of the given collections without wiping the rest of each collection.
            // IDs and Names are resolved via ResolveCollectionKeys like the main scope.
            var pinnedSubKeys = ResolveSubScopeKeys(colPinned);
            var starredSubKeys = ResolveSubScopeKeys(colStarred);
            var delColKeys = ResolveSubScopeKeys(deleteCollections);

            if (typeConditions.Count == 0 && pinnedSubKeys.Count == 0 && starredSubKeys.Count == 0 && delColKeys.Count == 0)
            {
                return true;
            }

            var backup = CreateBackup("pre_clear");
            if (backup == null)
            {
                if (string.IsNullOrEmpty(LastBackupError))
                    LastBackupError = "Pre-clear safety backup failed; clear operation aborted to prevent data loss.";
                return false;
            }
            var resolvedExclusions = (excludedCollections != null && excludedCollections.Count > 0)
                ? ResolveCollectionKeys(excludedCollections)
                : new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Sub-scope branches target their collections explicitly, so they stay
            // effective even though those collections remain in the exclusion set
            // (which only shields them from the broad main-scope branches).
            var subBranches = new List<string>();
            var subParams = new List<KeyValuePair<string, string>>();
            if (delColKeys.Count > 0)
            {
                var names = new List<string>();
                int i = 0;
                foreach (var key in delColKeys)
                {
                    string p = "$dc" + i++;
                    names.Add(p);
                    subParams.Add(new KeyValuePair<string, string>(p, key));
                }
                string favGuard = keepStarred ? " AND favorite = 0" : "";
                string pinGuard = includePinned ? "" : " AND pinned = 0";
                subBranches.Add("(collection IN (" + string.Join(", ", names) + ")" + favGuard + pinGuard + ")");
            }
            if (pinnedSubKeys.Count > 0)
            {
                var names = new List<string>();
                int i = 0;
                foreach (var key in pinnedSubKeys)
                {
                    string p = "$sp" + i++;
                    names.Add(p);
                    subParams.Add(new KeyValuePair<string, string>(p, key));
                }
                // Mirrors the global keepStarred guard so starred clips stay protected
                // unless Favorites deletion was requested globally or via sub-scope.
                string favGuard = keepStarred ? " AND favorite = 0" : "";
                subBranches.Add("(collection IN (" + string.Join(", ", names) + ") AND pinned = 1" + favGuard + ")");
            }
            if (starredSubKeys.Count > 0)
            {
                var names = new List<string>();
                int i = 0;
                foreach (var key in starredSubKeys)
                {
                    string p = "$ss" + i++;
                    names.Add(p);
                    subParams.Add(new KeyValuePair<string, string>(p, key));
                }
                string pinGuard = includePinned ? "" : " AND pinned = 0";
                subBranches.Add("(collection IN (" + string.Join(", ", names) + ") AND favorite = 1" + pinGuard + ")");
            }

            var toGc = new List<string>();
            using (var preConn = new SqliteConnection(_connectionString))
            {
                preConn.Open();
                using var q = preConn.CreateCommand();
                var preWhere = new List<string>();
                if (typeConditions.Count > 0)
                {
                    var mainPre = new List<string>();
                    mainPre.Add("(" + string.Join(" OR ", typeConditions) + ")");
                    if (resolvedExclusions.Count > 0)
                    {
                        var notInParams = new List<string>();
                        int i = 0;
                        foreach (var ex in resolvedExclusions)
                        {
                            string p = $"$ex{i++}";
                            notInParams.Add(p);
                            q.Parameters.AddWithValue(p, ex);
                        }
                        mainPre.Add($"(collection IS NULL OR collection NOT IN ({string.Join(", ", notInParams)}))");
                    }
                    preWhere.Add("(" + string.Join(" AND ", mainPre) + ")");
                }
                foreach (var b in subBranches) preWhere.Add(b);
                foreach (var kv in subParams) q.Parameters.AddWithValue(kv.Key, kv.Value);
                var preWhereSql = "WHERE image_path IS NOT NULL AND TRIM(image_path) != '' AND (" + string.Join(" OR ", preWhere) + ")";
                q.CommandText = $"SELECT DISTINCT image_path FROM clips {preWhereSql}";
                using var r = q.ExecuteReader();
                while (r.Read())
                {
                    var p = r.IsDBNull(0) ? null : r.GetString(0);
                    if (!string.IsNullOrWhiteSpace(p)) toGc.Add(p);
                }
            }

            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();

            var where = new List<string>();
            if (typeConditions.Count > 0)
            {
                var mainWhere = new List<string>();
                mainWhere.Add("(" + string.Join(" OR ", typeConditions) + ")");
                if (resolvedExclusions.Count > 0)
                {
                    var notInParams = new List<string>();
                    int i = 0;
                    foreach (var ex in resolvedExclusions)
                    {
                        string p = $"$ex{i++}";
                        notInParams.Add(p);
                        cmd.Parameters.AddWithValue(p, ex);
                    }
                    mainWhere.Add($"(collection IS NULL OR collection NOT IN ({string.Join(", ", notInParams)}))");
                }
                where.Add("(" + string.Join(" AND ", mainWhere) + ")");
            }
            foreach (var b in subBranches) where.Add(b);
            foreach (var kv in subParams) cmd.Parameters.AddWithValue(kv.Key, kv.Value);

            var whereSql = "WHERE " + string.Join(" OR ", where);
            cmd.CommandText = $"DELETE FROM clips {whereSql}";
            cmd.ExecuteNonQuery();

            foreach (var p in toGc)
            {
                TryDeleteOrphanImageFile(p, force: true);
            }
            BumpDataGeneration();
            return true;
        }
    }

    private HashSet<string> ResolveSubScopeKeys(List<string>? tokens)
    {
        var clean = (tokens ?? new List<string>())
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (clean.Count == 0) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        return ResolveCollectionKeys(clean);
    }

    public void ResetUsageStats()
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE clips SET use_count = 0";
            cmd.ExecuteNonQuery();
        }
    }

    public (int unpinned, int images, int pinned, int starred, Dictionary<string, int> collections) GetClearStats()
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT 
                    COALESCE(SUM(CASE WHEN is_image = 0 AND pinned = 0 AND (collection IS NULL OR collection = '' OR collection = 'all') THEN 1 ELSE 0 END), 0) as unpinned_other,
                    COALESCE(SUM(CASE WHEN is_image = 1 AND (collection IS NULL OR collection = '' OR collection = 'all') THEN 1 ELSE 0 END), 0) as images,
                    COALESCE(SUM(CASE WHEN pinned = 1 AND (collection IS NULL OR collection = '' OR collection = 'all') THEN 1 ELSE 0 END), 0) as pinned,
                    COALESCE(SUM(CASE WHEN favorite = 1 AND (collection IS NULL OR collection = '' OR collection = 'all') THEN 1 ELSE 0 END), 0) as starred
                FROM clips";
            int unpinned = 0, images = 0, pinned = 0, starred = 0;
            using (var r = cmd.ExecuteReader())
            {
                if (r.Read())
                {
                    unpinned = r.IsDBNull(0) ? 0 : Convert.ToInt32(r.GetValue(0));
                    images = r.IsDBNull(1) ? 0 : Convert.ToInt32(r.GetValue(1));
                    pinned = r.IsDBNull(2) ? 0 : Convert.ToInt32(r.GetValue(2));
                    starred = r.IsDBNull(3) ? 0 : Convert.ToInt32(r.GetValue(3));
                }
            }
            var collections = GetCollectionsWithCounts();
            return (unpinned, images, pinned, starred, collections);
        }
    }

    /// <summary>
    /// Trims history to <paramref name="maxClips"/> when it has grown past the cap.
    ///
    /// <see cref="EnforceMaxClips"/> runs a delete plus an image-file sweep, so calling it
    /// on every capture would put real work on the clipboard hot path. This cheap check
    /// runs first and only escalates once the cap is actually exceeded, and escalates at
    /// most once per <paramref name="recheckAfter"/> clips so a runaway capture rate cannot
    /// turn the counter into its own bottleneck.
    /// </summary>
    public void EnforceMaxClipsIfNeeded(int maxClips)
    {
        if (maxClips <= 0) return;

        // Cheap gate: only escalate to a COUNT once per interval new clips. The counter
        // is reset by EnforceMaxClips so a trimmed store starts counting fresh.
        if (Interlocked.Increment(ref _clipsSinceLastTrim) < TrimCheckInterval) return;

        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM clips";
            var total = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);
            if (total <= maxClips)
            {
                // Under the cap: consume this interval so we don't re-check every capture.
                Interlocked.Exchange(ref _clipsSinceLastTrim, 0);
                return;
            }
        }
        catch
        {
            Interlocked.Exchange(ref _clipsSinceLastTrim, 0);
            return;
        }

        EnforceMaxClips(maxClips);
    }

    /// <summary>
    /// Number of new clips between cheap cap checks. Keeps COUNT(*) off the clipboard hot
    /// path; the trade-off is that the store may hold up to
    /// <c>MaxClips + TrimCheckInterval</c> clips before a trim fires. Growth is bounded,
    /// which is what matters; it is no longer unbounded between setting changes.
    /// </summary>
    public const long TrimCheckInterval = 25;

    private long _clipsSinceLastTrim;

    public void EnforceMaxClips(int maxClips)
    {
        if (maxClips <= 0) return;
        Interlocked.Exchange(ref _clipsSinceLastTrim, 0);
        lock (_gate)
        {
            var victims = new List<string>();
            using (var conn = new SqliteConnection(_connectionString))
            {
                conn.Open();
                // Capture the image paths of exactly the rows about to be trimmed, BEFORE the
                // delete. The previous implementation swept the whole images directory and
                // skipped anything younger than 60s, which leaked PNGs for trimmed clips.
                using (var pre = conn.CreateCommand())
                {
                    pre.CommandText = """
                        SELECT DISTINCT image_path FROM clips
                        WHERE image_path IS NOT NULL AND TRIM(image_path) != ''
                          AND id IN (
                            SELECT id FROM clips
                            WHERE pinned = 0
                              AND favorite = 0
                              AND (collection = 'all' OR collection = '' OR collection IS NULL)
                            ORDER BY sort_rank DESC, id DESC
                            LIMIT -1 OFFSET $max
                        )
                        """;
                    pre.Parameters.AddWithValue("$max", maxClips);
                    using var r = pre.ExecuteReader();
                    while (r.Read())
                    {
                        var p = r.IsDBNull(0) ? null : r.GetString(0);
                        if (!string.IsNullOrWhiteSpace(p)) victims.Add(p);
                    }
                }

                using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    DELETE FROM clips
                    WHERE id IN (
                        SELECT id FROM clips
                        WHERE pinned = 0
                          AND favorite = 0
                          AND (collection = 'all' OR collection = '' OR collection IS NULL)
                        ORDER BY sort_rank DESC, id DESC
                        LIMIT -1 OFFSET $max
                    )
                    """;
                cmd.Parameters.AddWithValue("$max", maxClips);
                cmd.ExecuteNonQuery();
            }

            foreach (var p in victims.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                TryDeleteOrphanImageFile(p, force: true);
            }
            BumpDataGeneration();
            return;
        }
    }

    public int PurgeExpiredClips(int expireDays)
    {
        if (expireDays <= 0) return 0;
        int deletedCount = 0;
        lock (_gate)
        {
            var victims = new List<string>();
            try
            {
                long cutoffEpoch = DateTimeOffset.UtcNow.AddDays(-expireDays).ToUnixTimeSeconds();
                using var conn = new SqliteConnection(_connectionString);
                conn.Open();

                // Collect the expiring rows' image paths before deleting them, then delete
                // exactly those files. The previous implementation swept the whole images
                // directory while skipping anything under 24h old, which left PNGs behind
                // for every clip auto-expiry removed.
                using (var pre = conn.CreateCommand())
                {
                    pre.CommandText = """
                        SELECT DISTINCT image_path FROM clips
                        WHERE pinned = 0
                          AND favorite = 0
                          AND (collection = 'all' OR collection = '' OR collection IS NULL)
                          AND created_at < $cutoff
                          AND image_path IS NOT NULL AND TRIM(image_path) != ''
                        """;
                    pre.Parameters.AddWithValue("$cutoff", cutoffEpoch);
                    using var r = pre.ExecuteReader();
                    while (r.Read())
                    {
                        var p = r.IsDBNull(0) ? null : r.GetString(0);
                        if (!string.IsNullOrWhiteSpace(p)) victims.Add(p);
                    }
                }

                using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    DELETE FROM clips
                    WHERE pinned = 0
                      AND favorite = 0
                      AND (collection = 'all' OR collection = '' OR collection IS NULL)
                      AND created_at < $cutoff;
                    """;
                cmd.Parameters.AddWithValue("$cutoff", cutoffEpoch);
                deletedCount = cmd.ExecuteNonQuery();

                if (deletedCount > 0)
                {
                    BumpDataGeneration();
                    foreach (var p in victims.Distinct(StringComparer.OrdinalIgnoreCase))
                    {
                        TryDeleteOrphanImageFile(p, force: true);
                    }
                }
            }
            catch
            {
            }
        }
        return deletedCount;
    }

    public bool RenameCollection(string id, string newName)
    {
        // D1: rename relabels the definition only; clip rows always key by id.
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(newName)) return false;
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE collections SET name = $new WHERE id = $id";
            cmd.Parameters.AddWithValue("$new", newName.Trim());
            cmd.Parameters.AddWithValue("$id", id.Trim());
            bool ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public List<CollectionDef> GetCollections()
    {
        lock (_gate)
        {
            var list = new List<CollectionDef>();
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT id, name, pinned, sort_order, parent_id FROM collections ORDER BY sort_order, id";
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                list.Add(new CollectionDef
                {
                    Id = r.IsDBNull(0) ? string.Empty : r.GetString(0),
                    Name = r.IsDBNull(1) ? string.Empty : r.GetString(1),
                    Pinned = !r.IsDBNull(2) && r.GetInt32(2) != 0,
                    SortOrder = r.IsDBNull(3) ? 0 : r.GetInt32(3),
                    ParentId = r.IsDBNull(4) ? null : r.GetString(4)
                });
            }
            return list;
        }
    }

    public static bool IsReservedSystemCollectionId(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        var trimmed = id.Trim();
        return string.Equals(trimmed, "all", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "all_total", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "all_unorganized", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "pins", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "favorites", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "most_used", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "transcriptions", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "voice", StringComparison.OrdinalIgnoreCase);
    }

    public bool SaveCollection(string id, string name, bool pinned, int sortOrder, string? parentId = null)
    {
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) return false;
        if (IsReservedSystemCollectionId(id)) return false;
        if (!string.IsNullOrWhiteSpace(parentId))
        {
            if (IsReservedSystemCollectionId(parentId))
                return false;
            if (string.Equals(id.Trim(), parentId.Trim(), StringComparison.OrdinalIgnoreCase))
                return false;
            if (IsDescendantOf(parentId.Trim(), id.Trim()))
                return false;
        }

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO collections (id, name, pinned, sort_order, created_at, parent_id)
                VALUES ($id, $name, $pinned, $order, $now, $parentId)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, pinned = excluded.pinned, sort_order = excluded.sort_order, parent_id = excluded.parent_id
                """;
            cmd.Parameters.AddWithValue("$id", id.Trim());
            cmd.Parameters.AddWithValue("$name", name.Trim());
            cmd.Parameters.AddWithValue("$pinned", pinned ? 1 : 0);
            cmd.Parameters.AddWithValue("$order", sortOrder);
            cmd.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            cmd.Parameters.AddWithValue("$parentId", string.IsNullOrWhiteSpace(parentId) ? DBNull.Value : parentId.Trim());
            bool ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool SetCollectionParent(string id, string? parentId)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        if (IsReservedSystemCollectionId(id)) return false;
        if (!string.IsNullOrWhiteSpace(parentId))
        {
            if (IsReservedSystemCollectionId(parentId))
                return false;
            if (string.Equals(id.Trim(), parentId.Trim(), StringComparison.OrdinalIgnoreCase))
                return false;
            if (IsDescendantOf(parentId.Trim(), id.Trim()))
                return false;
        }

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE collections SET parent_id = $parentId WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id.Trim());
            cmd.Parameters.AddWithValue("$parentId", string.IsNullOrWhiteSpace(parentId) ? DBNull.Value : parentId.Trim());
            bool ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool IsDescendantOf(string checkColId, string ancestorColId)
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            string? cur = checkColId;
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            while (!string.IsNullOrWhiteSpace(cur) && visited.Add(cur))
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT parent_id FROM collections WHERE id = $id";
                cmd.Parameters.AddWithValue("$id", cur);
                var res = cmd.ExecuteScalar();
                if (res == null || res is DBNull) break;
                cur = res.ToString();
                if (string.Equals(cur, ancestorColId, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }
    }

    public bool DeleteCollectionDef(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        var trimmed = id.Trim();
        lock (_gate)
        {
            using var conn = OpenConnection();
            using var tx = conn.BeginTransaction();

            using var reassignCmd = conn.CreateCommand();
            reassignCmd.Transaction = tx;
            reassignCmd.CommandText = "UPDATE clips SET collection = 'all' WHERE collection = $id";
            reassignCmd.Parameters.AddWithValue("$id", trimmed);
            reassignCmd.ExecuteNonQuery();

            using var reParentCmd1 = conn.CreateCommand();
            reParentCmd1.Transaction = tx;
            reParentCmd1.CommandText = "UPDATE collections SET parent_id = NULL WHERE parent_id = $id";
            reParentCmd1.Parameters.AddWithValue("$id", trimmed);
            reParentCmd1.ExecuteNonQuery();

            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM collections WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", trimmed);
            bool ok = cmd.ExecuteNonQuery() > 0;

            tx.Commit();
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool DeleteCollectionWithClips(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        var trimmed = id.Trim();
        LastBackupError = null;
        lock (_gate)
        {
            var backup = CreateBackup("pre_clear");
            if (backup == null)
            {
                if (string.IsNullOrEmpty(LastBackupError))
                    LastBackupError = "Pre-clear safety backup failed; delete operation aborted to prevent data loss.";
                return false;
            }
            var victimPaths = new List<string>();
            try
            {
                using var pre = OpenConnection();
                using var q = pre.CreateCommand();
                q.CommandText = "SELECT image_path FROM clips WHERE collection = $id AND image_path IS NOT NULL";
                q.Parameters.AddWithValue("$id", trimmed);
                using var r = q.ExecuteReader();
                while (r.Read())
                {
                    var p = r.IsDBNull(0) ? null : r.GetString(0);
                    if (!string.IsNullOrWhiteSpace(p)) victimPaths.Add(p);
                }
            }
            catch { }

            using var conn = OpenConnection();
            using var tx = conn.BeginTransaction();

            using var delClips = conn.CreateCommand();
            delClips.Transaction = tx;
            delClips.CommandText = "DELETE FROM clips WHERE collection = $id";
            delClips.Parameters.AddWithValue("$id", trimmed);
            delClips.ExecuteNonQuery();

            using var reParentCmd2 = conn.CreateCommand();
            reParentCmd2.Transaction = tx;
            reParentCmd2.CommandText = "UPDATE collections SET parent_id = NULL WHERE parent_id = $id";
            reParentCmd2.Parameters.AddWithValue("$id", trimmed);
            reParentCmd2.ExecuteNonQuery();

            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM collections WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", trimmed);
            bool ok = cmd.ExecuteNonQuery() > 0;

            tx.Commit();

            foreach (var p in victimPaths.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                TryDeleteOrphanImageFile(p, force: true);
            }
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    internal bool IsValidCollectionTarget(SqliteConnection conn, string target)
    {
        if (string.IsNullOrWhiteSpace(target)) return false;
        var trimmed = target.Trim();
        if (string.Equals(trimmed, "all", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "pins", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "favorites", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "most_used", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "transcriptions", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "voice", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM collections WHERE id = $id OR name = $id LIMIT 1";
        cmd.Parameters.AddWithValue("$id", trimmed);
        var res = cmd.ExecuteScalar();
        return res != null && res != DBNull.Value;
    }

    public bool ReassignCollection(string fromId, string toId)
    {
        // D2: database-wide reassignment — covers out-of-page and pinned/favorite rows.
        if (string.IsNullOrWhiteSpace(fromId) || string.IsNullOrWhiteSpace(toId)) return false;
        var fromTrim = fromId.Trim();
        var toTrim = toId.Trim();

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();

            if (!IsValidCollectionTarget(conn, toTrim))
            {
                return false;
            }

            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE clips SET collection = $to WHERE collection = $from";
            cmd.Parameters.AddWithValue("$to", toTrim);
            cmd.Parameters.AddWithValue("$from", fromTrim);
            cmd.ExecuteNonQuery();
            BumpDataGeneration();
            return true;
        }
    }

    public int MigrateCollectionKeys(IEnumerable<(string id, string name)> pairs)
    {
        // One-time name→id sweep for pre-D1 profiles (Step 9). No-op when nothing matches.
        int total = 0;
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            foreach (var (id, name) in pairs)
            {
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;
                if (string.Equals(id.Trim(), name.Trim(), StringComparison.OrdinalIgnoreCase)) continue;
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "UPDATE clips SET collection = $id WHERE collection = $name";
                cmd.Parameters.AddWithValue("$id", id.Trim());
                cmd.Parameters.AddWithValue("$name", name.Trim());
                try { total += cmd.ExecuteNonQuery(); } catch { }
            }
            if (total > 0) BumpDataGeneration();
        }
        return total;
    }

    /// <summary>
    /// Resolve collection identifiers and display names so clips stored with either the ID or the
    /// pre-migration name are still matched by ID-based operations (and vice versa).
    /// </summary>
    private HashSet<string> ResolveCollectionKeys(IEnumerable<string> tokens)
    {
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var tokenSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var token in tokens)
        {
            if (!string.IsNullOrWhiteSpace(token))
            {
                var clean = token.Trim();
                keys.Add(clean);
                tokenSet.Add(clean);
            }
        }
        if (tokenSet.Count == 0) return keys;

        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, name FROM collections";
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            var id = r.IsDBNull(0) ? null : r.GetString(0).Trim();
            var name = r.IsDBNull(1) ? null : r.GetString(1).Trim();
            if (id != null && tokenSet.Contains(id))
            {
                if (name != null) keys.Add(name);
            }
            if (name != null && tokenSet.Contains(name))
            {
                if (id != null) keys.Add(id);
            }
        }
        return keys;
    }

    public bool DeleteClipsInCollection(string id, bool keepPinnedFavorite)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        LastBackupError = null;
        lock (_gate)
        {
            var backup = CreateBackup("pre_clear");
            if (backup == null)
            {
                if (string.IsNullOrEmpty(LastBackupError))
                    LastBackupError = "Pre-clear safety backup failed; clear operation aborted to prevent data loss.";
                return false;
            }
            var colKeys = ResolveCollectionKeys(new[] { id });
            var victimPaths = new List<string>();
            try
            {
                using var pre = new SqliteConnection(_connectionString);
                pre.Open();
                using var q = pre.CreateCommand();
                var keyParams = new List<string>();
                int ki = 0;
                foreach (var k in colKeys) { string p = "$k" + ki++; keyParams.Add(p); q.Parameters.AddWithValue(p, k); }
                var keyIn = "collection IN (" + string.Join(", ", keyParams) + ")";
                q.CommandText = keepPinnedFavorite
                    ? $"SELECT image_path FROM clips WHERE {keyIn} AND pinned = 0 AND favorite = 0 AND image_path IS NOT NULL"
                    : $"SELECT image_path FROM clips WHERE {keyIn} AND image_path IS NOT NULL";
                using var r = q.ExecuteReader();
                while (r.Read())
                {
                    var p = r.IsDBNull(0) ? null : r.GetString(0);
                    if (!string.IsNullOrWhiteSpace(p)) victimPaths.Add(p);
                }
            }
            catch { }

            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            var delParams = new List<string>();
            int di = 0;
            foreach (var k in colKeys) { string p = "$d" + di++; delParams.Add(p); cmd.Parameters.AddWithValue(p, k); }
            var delIn = "collection IN (" + string.Join(", ", delParams) + ")";
            cmd.CommandText = keepPinnedFavorite
                ? $"DELETE FROM clips WHERE {delIn} AND pinned = 0 AND favorite = 0"
                : $"DELETE FROM clips WHERE {delIn}";
            cmd.ExecuteNonQuery();

            foreach (var p in victimPaths.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                TryDeleteOrphanImageFile(p, force: true);
            }
            BumpDataGeneration();
            return true;
        }
    }

    public bool MergeCollection(string sourceId, string targetId)
    {
        if (string.IsNullOrWhiteSpace(sourceId) || string.IsNullOrWhiteSpace(targetId)) return false;
        ReassignCollection(sourceId, targetId);
        DeleteCollectionDef(sourceId);
        return true;
    }

    public List<ClipItem> GetClipsForExport(bool all, List<string>? collections, bool pinnedOnly, bool starredOnly)
    {
        return GetClipsForExport(all, false, collections, pinnedOnly, starredOnly, includeText: true, includeImages: true);
    }

    public List<ClipItem> GetClipsForExport(bool all, bool unorganized, List<string>? collections, bool pinnedOnly, bool starredOnly, bool includeText = true, bool includeImages = true, List<string>? colPinned = null, List<string>? colStarred = null)
    {
        if (!includeText && !includeImages) return new List<ClipItem>();

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            const string cols = """
                SELECT id, text_content, preview, pinned, track, src_process, src_title,
                       created_at, last_used_at, use_count, collection, is_image, image_path,
                       '' AS thumbnail_data, img_dims, img_size, favorite, nickname, sort_rank,
                       '' AS tags_placeholder, custom_title, rich_text
                FROM clips 
                """;

            var whereClauses = new List<string>();

            // Images toggle is Main History only. Collection scopes always include both text and images.
            string? mainContentFilter = null;
            if (includeText && !includeImages)
            {
                mainContentFilter = "is_image = 0";
            }
            else if (!includeText && includeImages)
            {
                mainContentFilter = "is_image = 1";
            }

            // Scope filter
            if (all)
            {
                const string mainAll = "(collection IS NULL OR collection = '' OR collection = 'all')";
                const string customAll = "(collection IS NOT NULL AND collection != '' AND collection != 'all')";
                if (mainContentFilter != null)
                {
                    whereClauses.Add("(( " + mainAll + " AND " + mainContentFilter + ") OR " + customAll + ")");
                }
            }
            else
            {
                var mainScopes = new List<string>();
                if (unorganized)
                {
                    mainScopes.Add("(collection IS NULL OR collection = '' OR collection = 'all')");
                }

                if (pinnedOnly) mainScopes.Add("(pinned = 1 AND (collection IS NULL OR collection = '' OR collection = 'all'))");
                if (starredOnly) mainScopes.Add("(favorite = 1 AND (collection IS NULL OR collection = '' OR collection = 'all'))");

                var collectionScopes = new List<string>();

                var cleanCols = (collections ?? new List<string>())
                    .Where(c => !string.IsNullOrWhiteSpace(c))
                    .Select(c => c.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (cleanCols.Count > 0)
                {
                    var matchedKeys = ResolveCollectionKeys(cleanCols);
                    var names = new List<string>();
                    int i = 0;
                    foreach (var key in matchedKeys)
                    {
                        string p = "$col" + i++;
                        names.Add(p);
                        cmd.Parameters.AddWithValue(p, key);
                    }
                    collectionScopes.Add("collection IN (" + string.Join(", ", names) + ")");
                }

                // Per-collection sub-scopes: export only pinned / favorited clips
                // of the given collections (IDs or Names resolved via ResolveCollectionKeys).
                var cleanPinned = (colPinned ?? new List<string>())
                    .Where(c => !string.IsNullOrWhiteSpace(c))
                    .Select(c => c.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                if (cleanPinned.Count > 0)
                {
                    var matchedKeys = ResolveCollectionKeys(cleanPinned);
                    var names = new List<string>();
                    int i = 0;
                    foreach (var key in matchedKeys)
                    {
                        string p = "$colp" + i++;
                        names.Add(p);
                        cmd.Parameters.AddWithValue(p, key);
                    }
                    if (names.Count > 0)
                        collectionScopes.Add("(collection IN (" + string.Join(", ", names) + ") AND pinned = 1)");
                }

                var cleanStarred = (colStarred ?? new List<string>())
                    .Where(c => !string.IsNullOrWhiteSpace(c))
                    .Select(c => c.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                if (cleanStarred.Count > 0)
                {
                    var matchedKeys = ResolveCollectionKeys(cleanStarred);
                    var names = new List<string>();
                    int i = 0;
                    foreach (var key in matchedKeys)
                    {
                        string p = "$cols" + i++;
                        names.Add(p);
                        cmd.Parameters.AddWithValue(p, key);
                    }
                    if (names.Count > 0)
                        collectionScopes.Add("(collection IN (" + string.Join(", ", names) + ") AND favorite = 1)");
                }

                var branches = new List<string>();
                if (mainScopes.Count > 0)
                {
                    string mainOr = "(" + string.Join(" OR ", mainScopes) + ")";
                    if (mainContentFilter != null)
                        branches.Add("(" + mainContentFilter + " AND " + mainOr + ")");
                    else
                        branches.Add(mainOr);
                }
                if (collectionScopes.Count > 0)
                {
                    branches.Add("(" + string.Join(" OR ", collectionScopes) + ")");
                }

                if (branches.Count == 0)
                {
                    return new List<ClipItem>();
                }
                whereClauses.Add("(" + string.Join(" OR ", branches) + ")");
            }

            if (whereClauses.Count > 0)
            {
                cmd.CommandText = cols + "WHERE " + string.Join(" AND ", whereClauses) + " ORDER BY sort_rank DESC, id DESC";
            }
            else
            {
                cmd.CommandText = cols + "ORDER BY sort_rank DESC, id DESC";
            }

            var list = new List<ClipItem>();
            using (var r = cmd.ExecuteReader())
            {
                while (r.Read())
                {
                    list.Add(ReadClip(r));
                }
            }

            if (list.Count > 0)
            {
                var clipIds = list.Select(c => c.Id).ToHashSet();
                using var tagCmd = conn.CreateCommand();
                tagCmd.CommandText = "SELECT ct.clip_id, t.name FROM clip_tags ct JOIN tags t ON ct.tag_id = t.id";
                using var tr = tagCmd.ExecuteReader();
                var tagsByClip = new Dictionary<long, List<string>>();
                while (tr.Read())
                {
                    long cid = tr.GetInt64(0);
                    if (clipIds.Contains(cid))
                    {
                        string tname = tr.GetString(1);
                        if (!tagsByClip.TryGetValue(cid, out var tlist))
                        {
                            tlist = new List<string>();
                            tagsByClip[cid] = tlist;
                        }
                        tlist.Add(tname);
                    }
                }
                foreach (var clip in list)
                {
                    if (tagsByClip.TryGetValue(clip.Id, out var tlist))
                    {
                        clip.Tags = tlist;
                    }
                }
            }

            return list;
        }
    }

    public (int imported, int deduped, int skipped, int skippedImages) ImportClipsBatch(IEnumerable<ClipItem> items, string? forceCollection)
    {
        return ImportPackageBatch(items, forceCollection);
    }

    public (int imported, int deduped, int skipped, int skippedImages) ImportPackageBatch(IEnumerable<ClipItem> items, string? forceCollection)
    {
        int imported = 0;
        int deduped = 0;
        int skipped = 0;
        int skippedImages = 0;

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            using var maxRankCmd = conn.CreateCommand();
            maxRankCmd.Transaction = tx;
            maxRankCmd.CommandText = "SELECT COALESCE(MAX(sort_rank), 0) FROM clips";
            long currentMaxRank = Convert.ToInt64(maxRankCmd.ExecuteScalar() ?? 0);

            using var checkHashCmd = conn.CreateCommand();
            checkHashCmd.Transaction = tx;
            checkHashCmd.CommandText = "SELECT id FROM clips WHERE content_hash = $h LIMIT 1";
            var hashParam = checkHashCmd.CreateParameter();
            hashParam.ParameterName = "$h";
            checkHashCmd.Parameters.Add(hashParam);

            using var updateDedupCmd = conn.CreateCommand();
            updateDedupCmd.Transaction = tx;
            updateDedupCmd.CommandText = """
                UPDATE clips SET
                    pinned = pinned | $pinned,
                    favorite = favorite | $fav,
                    created_at = MIN(created_at, $created),
                    last_used_at = MAX(last_used_at, $used),
                    use_count = MAX(use_count, $use_count),
                    custom_title = CASE WHEN (custom_title IS NULL OR custom_title = '') AND $custom_title IS NOT NULL THEN $custom_title ELSE custom_title END,
                    rich_text = CASE WHEN (rich_text IS NULL OR rich_text = '') AND $rich_text IS NOT NULL THEN $rich_text ELSE rich_text END
                WHERE id = $id
                """;
            var uId = updateDedupCmd.CreateParameter(); uId.ParameterName = "$id"; updateDedupCmd.Parameters.Add(uId);
            var uPinned = updateDedupCmd.CreateParameter(); uPinned.ParameterName = "$pinned"; updateDedupCmd.Parameters.Add(uPinned);
            var uFav = updateDedupCmd.CreateParameter(); uFav.ParameterName = "$fav"; updateDedupCmd.Parameters.Add(uFav);
            var uCreated = updateDedupCmd.CreateParameter(); uCreated.ParameterName = "$created"; updateDedupCmd.Parameters.Add(uCreated);
            var uUsed = updateDedupCmd.CreateParameter(); uUsed.ParameterName = "$used"; updateDedupCmd.Parameters.Add(uUsed);
            var uUseCount = updateDedupCmd.CreateParameter(); uUseCount.ParameterName = "$use_count"; updateDedupCmd.Parameters.Add(uUseCount);
        var uCustomTitle = updateDedupCmd.CreateParameter(); uCustomTitle.ParameterName = "$custom_title"; updateDedupCmd.Parameters.Add(uCustomTitle);
        var uRichText = updateDedupCmd.CreateParameter(); uRichText.ParameterName = "$rich_text"; updateDedupCmd.Parameters.Add(uRichText);

            // Plain INSERT for new clips — CRITICAL: must remain standard INSERT so AFTER INSERT FTS trigger fires
            using var insertCmd = conn.CreateCommand();
            insertCmd.Transaction = tx;
            insertCmd.CommandText = """
                INSERT INTO clips (
                    text_content, preview, content_hash, track, collection,
                    src_process, src_title, pinned, favorite, nickname,
                    created_at, last_used_at, sort_rank, use_count,
                    is_image, image_path, thumbnail_data, img_dims, img_size,
                    custom_title, rich_text
                ) VALUES (
                    $text, $preview, $hash, $track, $col,
                    $proc, $title, $pinned, $favorite, $nickname,
                    $created, $used, $rank, $use_count,
                    $is_img, $img_path, $thumb, $dims, $size,
                    $custom_title, $rich_text
                );
                SELECT last_insert_rowid();
                """;

            var pText = insertCmd.CreateParameter(); pText.ParameterName = "$text"; insertCmd.Parameters.Add(pText);
            var pPrev = insertCmd.CreateParameter(); pPrev.ParameterName = "$preview"; insertCmd.Parameters.Add(pPrev);
            var pHash = insertCmd.CreateParameter(); pHash.ParameterName = "$hash"; insertCmd.Parameters.Add(pHash);
            var pTrack = insertCmd.CreateParameter(); pTrack.ParameterName = "$track"; insertCmd.Parameters.Add(pTrack);
            var pCol = insertCmd.CreateParameter(); pCol.ParameterName = "$col"; insertCmd.Parameters.Add(pCol);
            var pProc = insertCmd.CreateParameter(); pProc.ParameterName = "$proc"; insertCmd.Parameters.Add(pProc);
            var pTitle = insertCmd.CreateParameter(); pTitle.ParameterName = "$title"; insertCmd.Parameters.Add(pTitle);
            var pPinned = insertCmd.CreateParameter(); pPinned.ParameterName = "$pinned"; insertCmd.Parameters.Add(pPinned);
            var pFav = insertCmd.CreateParameter(); pFav.ParameterName = "$favorite"; insertCmd.Parameters.Add(pFav);
            var pNick = insertCmd.CreateParameter(); pNick.ParameterName = "$nickname"; insertCmd.Parameters.Add(pNick);
            var pCreated = insertCmd.CreateParameter(); pCreated.ParameterName = "$created"; insertCmd.Parameters.Add(pCreated);
            var pUsed = insertCmd.CreateParameter(); pUsed.ParameterName = "$used"; insertCmd.Parameters.Add(pUsed);
            var pRank = insertCmd.CreateParameter(); pRank.ParameterName = "$rank"; insertCmd.Parameters.Add(pRank);
            var pUseCount = insertCmd.CreateParameter(); pUseCount.ParameterName = "$use_count"; insertCmd.Parameters.Add(pUseCount);
            var pIsImg = insertCmd.CreateParameter(); pIsImg.ParameterName = "$is_img"; insertCmd.Parameters.Add(pIsImg);
            var pImgPath = insertCmd.CreateParameter(); pImgPath.ParameterName = "$img_path"; insertCmd.Parameters.Add(pImgPath);
            var pThumb = insertCmd.CreateParameter(); pThumb.ParameterName = "$thumb"; insertCmd.Parameters.Add(pThumb);
            var pDims = insertCmd.CreateParameter(); pDims.ParameterName = "$dims"; insertCmd.Parameters.Add(pDims);
            var pSize = insertCmd.CreateParameter(); pSize.ParameterName = "$size"; insertCmd.Parameters.Add(pSize);
            var pCustomTitle = insertCmd.CreateParameter(); pCustomTitle.ParameterName = "$custom_title"; insertCmd.Parameters.Add(pCustomTitle);
            var pRichText = insertCmd.CreateParameter(); pRichText.ParameterName = "$rich_text"; insertCmd.Parameters.Add(pRichText);

            using var insTagLinkCmd = conn.CreateCommand();
            insTagLinkCmd.Transaction = tx;
            insTagLinkCmd.CommandText = "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, assigned_at) VALUES ($cid, $tid, $assigned)";
            var pLinkCid = insTagLinkCmd.CreateParameter(); pLinkCid.ParameterName = "$cid"; insTagLinkCmd.Parameters.Add(pLinkCid);
            var pLinkTid = insTagLinkCmd.CreateParameter(); pLinkTid.ParameterName = "$tid"; insTagLinkCmd.Parameters.Add(pLinkTid);
            var pLinkAssigned = insTagLinkCmd.CreateParameter(); pLinkAssigned.ParameterName = "$assigned"; insTagLinkCmd.Parameters.Add(pLinkAssigned);

            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

            var sortedItems = items
                .OrderBy(i => i.SortRank > 0 ? i.SortRank : (i.CreatedAt != default ? new DateTimeOffset(i.CreatedAt).ToUnixTimeSeconds() : 0))
                .ToList();

            foreach (var item in sortedItems)
            {
                try
                {
                    string hash = "";
                    string text = item.Text?.Trim() ?? "";
                    string preview = item.Preview?.Trim() ?? "";

                    if (item.IsImage)
                    {
                        if (string.IsNullOrWhiteSpace(item.ImagePath))
                        {
                            skippedImages++;
                            continue;
                        }
                        hash = !string.IsNullOrWhiteSpace(item.Text) && item.Text.Length == 64 && !item.Text.Contains(' ')
                            ? item.Text.ToUpperInvariant()
                            : Path.GetFileNameWithoutExtension(item.ImagePath).ToUpperInvariant();

                        if (string.IsNullOrWhiteSpace(preview))
                        {
                            preview = "[Image]";
                        }
                        text = "[Image]";
                    }
                    else
                    {
                        if (string.IsNullOrEmpty(text) || text.Length > ClipboardListener.MaxTextChars)
                        {
                            skipped++;
                            continue;
                        }
                        hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
                        if (string.IsNullOrWhiteSpace(preview))
                        {
                            var flat = text.Replace("\r", " ").Replace("\n", " ");
                            preview = flat.Length <= 120 ? flat : string.Concat(flat.AsSpan(0, 120), "…");
                        }
                    }

                    long createdTs = item.CreatedAt != default ? new DateTimeOffset(item.CreatedAt).ToUnixTimeSeconds() : now;
                    long usedTs = item.LastUsedAt != default ? new DateTimeOffset(item.LastUsedAt).ToUnixTimeSeconds() : createdTs;

                    hashParam.Value = hash;
                    var existingObj = checkHashCmd.ExecuteScalar();
                    if (existingObj != null && existingObj != DBNull.Value)
                    {
                        long existingId = Convert.ToInt64(existingObj);

                        // Deduplication branch — targeted merge update (A1)
                        uId.Value = existingId;
                        uPinned.Value = item.Pinned ? 1 : 0;
                        uFav.Value = item.Favorite ? 1 : 0;
                        uCreated.Value = createdTs;
                        uUsed.Value = usedTs;
                        uUseCount.Value = item.UseCount;
                        uCustomTitle.Value = string.IsNullOrWhiteSpace(item.CustomTitle) ? DBNull.Value : item.CustomTitle;
                        uRichText.Value = string.IsNullOrWhiteSpace(item.RichText) ? DBNull.Value : item.RichText;
                        updateDedupCmd.ExecuteNonQuery();

                        // Merge tags
                        InsertTagsForClip(conn, tx, insTagLinkCmd, pLinkCid, pLinkTid, pLinkAssigned, existingId, item.Tags, item.Nickname, usedTs);

                        deduped++;
                        continue;
                    }

                    string targetCol = !string.IsNullOrWhiteSpace(forceCollection) && forceCollection != "all"
                        ? forceCollection.Trim()
                        : (!string.IsNullOrWhiteSpace(item.Collection) ? item.Collection.Trim() : "all");

                    if (!IsValidCollectionTarget(conn, targetCol))
                    {
                        if (!string.IsNullOrWhiteSpace(targetCol) && targetCol.Length <= 64 && !targetCol.Contains('\'') && !targetCol.Contains('"'))
                        {
                            using var insColCmd = conn.CreateCommand();
                            insColCmd.Transaction = tx;
                            insColCmd.CommandText = "INSERT OR IGNORE INTO collections (id, name, sort_order, pinned) VALUES ($id, $name, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collections), 0)";
                            insColCmd.Parameters.AddWithValue("$id", targetCol);
                            insColCmd.Parameters.AddWithValue("$name", targetCol);
                            insColCmd.ExecuteNonQuery();
                        }
                        else
                        {
                            targetCol = "all";
                        }
                    }

                    currentMaxRank++;

                    pText.Value = text;
                    pPrev.Value = preview;
                    pHash.Value = hash;
                    pTrack.Value = string.IsNullOrWhiteSpace(item.Track) ? "manual" : item.Track;
                    pCol.Value = targetCol;
                    pProc.Value = (object?)item.Process ?? "Imported";
                    pTitle.Value = (object?)item.Title ?? "Imported";
                    pPinned.Value = item.Pinned ? 1 : 0;
                    pFav.Value = item.Favorite ? 1 : 0;
                    pNick.Value = (object?)item.Nickname ?? DBNull.Value;
                    pCreated.Value = createdTs;
                    pUsed.Value = usedTs;
                    pRank.Value = currentMaxRank;
                    pUseCount.Value = item.UseCount;
                    pIsImg.Value = item.IsImage ? 1 : 0;
                    pImgPath.Value = item.IsImage ? (object)item.ImagePath : DBNull.Value;
                    pThumb.Value = item.IsImage ? (object?)item.ThumbnailData ?? DBNull.Value : DBNull.Value;
                    pDims.Value = item.IsImage ? (object?)item.ImgDims ?? DBNull.Value : DBNull.Value;
                    pSize.Value = item.IsImage ? (object?)item.ImgSize ?? DBNull.Value : DBNull.Value;
                    pCustomTitle.Value = string.IsNullOrWhiteSpace(item.CustomTitle) ? DBNull.Value : item.CustomTitle;
                    pRichText.Value = string.IsNullOrWhiteSpace(item.RichText) ? DBNull.Value : item.RichText;

                    var newRowIdObj = insertCmd.ExecuteScalar();
                    long newRowId = Convert.ToInt64(newRowIdObj ?? 0);

                    if (newRowId > 0)
                    {
                        InsertTagsForClip(conn, tx, insTagLinkCmd, pLinkCid, pLinkTid, pLinkAssigned, newRowId, item.Tags, item.Nickname, usedTs);
                    }

                    imported++;
                }
                catch
                {
                    if (item.IsImage) skippedImages++;
                    else skipped++;
                }
            }

            BumpDataGeneration(); // A3: generation bump before commit
            tx.Commit();
        }

        return (imported, deduped, skipped, skippedImages);
    }

    private static void InsertTagsForClip(
        SqliteConnection conn,
        SqliteTransaction tx,
        SqliteCommand insTagLinkCmd,
        SqliteParameter pLinkCid,
        SqliteParameter pLinkTid,
        SqliteParameter pLinkAssigned,
        long clipId,
        List<string>? tags,
        string? nickname,
        long timestamp)
    {
        var tagSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (tags != null)
        {
            foreach (var t in tags)
            {
                var clean = NormalizeTagName(t);
                if (!string.IsNullOrEmpty(clean)) tagSet.Add(clean);
            }
        }
        if (!string.IsNullOrWhiteSpace(nickname))
        {
            var rawTags = nickname.Split(new[] { ',', '，' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var raw in rawTags)
            {
                var clean = NormalizeTagName(raw);
                if (!string.IsNullOrEmpty(clean)) tagSet.Add(clean);
            }
        }

        foreach (var clean in tagSet)
        {
            var tagId = GetOrCreateTagIdInternal(conn, tx, clean, timestamp);
            if (tagId > 0)
            {
                pLinkCid.Value = clipId;
                pLinkTid.Value = tagId;
                pLinkAssigned.Value = timestamp;
                insTagLinkCmd.ExecuteNonQuery();
            }
        }
    }

    public object GetStorageStats()
    {
        lock (_gate)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();

            long totalClips = 0, textClips = 0, imageClips = 0, protectedClips = 0, pinnedClips = 0, favoriteClips = 0;

            cmd.CommandText = "SELECT COUNT(*) FROM clips";
            totalClips = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            cmd.CommandText = "SELECT COUNT(*) FROM clips WHERE is_image = 0";
            textClips = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            cmd.CommandText = "SELECT COUNT(*) FROM clips WHERE is_image = 1";
            imageClips = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            // Distinct protected clips: pinned OR favorited OR saved to a custom collection
            cmd.CommandText = "SELECT COUNT(*) FROM clips WHERE pinned = 1 OR favorite = 1 OR (collection IS NOT NULL AND TRIM(collection) != '' AND collection != 'all')";
            protectedClips = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            cmd.CommandText = "SELECT COUNT(*) FROM clips WHERE pinned = 1";
            pinnedClips = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            cmd.CommandText = "SELECT COUNT(*) FROM clips WHERE favorite = 1";
            favoriteClips = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            long dbSizeBytes = 0;
            var path = _dbFilePath ?? DefaultPath();
            if (File.Exists(path))
            {
                try { dbSizeBytes = new FileInfo(path).Length; } catch { }
            }
            if (File.Exists(path + "-wal"))
            {
                try { dbSizeBytes += new FileInfo(path + "-wal").Length; } catch { }
            }
            if (File.Exists(path + "-shm"))
            {
                try { dbSizeBytes += new FileInfo(path + "-shm").Length; } catch { }
            }

            long imagesSizeBytes = 0;
            try
            {
                var imagesDir = PathHelper.GetImagesFolder();
                if (Directory.Exists(imagesDir))
                {
                    var di = new DirectoryInfo(imagesDir);
                    foreach (var fi in di.EnumerateFiles())
                    {
                        imagesSizeBytes += fi.Length;
                    }
                }
            }
            catch { }

            long totalSizeBytes = dbSizeBytes + imagesSizeBytes;

            return new
            {
                ok = true,
                totalSizeBytes = totalSizeBytes,
                totalClips = totalClips,
                dbSizeBytes = dbSizeBytes,
                textClips = textClips,
                imagesSizeBytes = imagesSizeBytes,
                imageClips = imageClips,
                protectedClips = protectedClips,
                pinnedClips = pinnedClips,
                favoriteClips = favoriteClips
            };
        }
    }

    public object GetUsageStats()
    {
        lock (_gate)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();

            long allTimeCopies = 0, weeklyCopies = 0, totalPastes = 0, weeklyPastes = 0;
            long weekAgo = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - (7 * 86400);

            cmd.CommandText = "SELECT COUNT(*) FROM clips";
            allTimeCopies = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            cmd.CommandText = "SELECT COUNT(*) FROM clips WHERE created_at >= $w";
            cmd.Parameters.AddWithValue("$w", weekAgo);
            weeklyCopies = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            cmd.Parameters.Clear();
            cmd.CommandText = "SELECT COALESCE(SUM(use_count), 0) FROM clips";
            totalPastes = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            cmd.CommandText = "SELECT COALESCE(SUM(use_count), 0) FROM clips WHERE last_used_at >= $w";
            cmd.Parameters.AddWithValue("$w", weekAgo);
            weeklyPastes = Convert.ToInt64(cmd.ExecuteScalar() ?? 0);

            cmd.Parameters.Clear();
            cmd.CommandText = """
                SELECT src_process, COUNT(*) as cnt
                FROM clips
                WHERE src_process IS NOT NULL AND TRIM(src_process) != ''
                GROUP BY src_process
                ORDER BY cnt DESC
                LIMIT 5
                """;
            var topApps = new List<object>();
            using (var r = cmd.ExecuteReader())
            {
                while (r.Read())
                {
                    var proc = r.GetString(0);
                    var cnt = r.GetInt64(1);
                    double pct = allTimeCopies > 0 ? Math.Round((double)cnt / allTimeCopies * 100, 1) : 0;
                    topApps.Add(new
                    {
                        process = proc,
                        name = AppDiscoveryService.GetFriendlyName(proc),
                        count = cnt,
                        percent = pct
                    });
                }
            }

            double timeSavedMinutes = Math.Round((double)totalPastes * 3.2 / 60.0, 1);

            return new
            {
                ok = true,
                weeklyCopies = weeklyCopies,
                allTimeCopies = allTimeCopies,
                timeSavedMinutes = timeSavedMinutes,
                weeklyPastes = weeklyPastes,
                totalPastes = totalPastes,
                topApps = topApps
            };
        }
    }

    public void SetConfig(string key, string value)
    {
        lock (_gate)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO app_config (key, val) VALUES ($k, $v)
                ON CONFLICT(key) DO UPDATE SET val = excluded.val;
                """;
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$v", value);
            cmd.ExecuteNonQuery();
        }
    }

    public string? GetConfig(string key)
    {
        lock (_gate)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT val FROM app_config WHERE key = $k LIMIT 1";
            cmd.Parameters.AddWithValue("$k", key);
            var res = cmd.ExecuteScalar();
            return res != null && res != DBNull.Value ? res.ToString() : null;
        }
    }

    private static ClipItem ReadClip(SqliteDataReader r)
    {
        return new ClipItem
        {
            Id = r.GetInt64(0),
            Text = r.GetString(1),
            Preview = r.GetString(2),
            Pinned = r.GetInt64(3) == 1,
            Track = r.GetString(4),
            Process = r.IsDBNull(5) ? "" : r.GetString(5),
            Title = r.IsDBNull(6) ? "" : r.GetString(6),
            CreatedAt = DateTimeOffset.FromUnixTimeSeconds(r.GetInt64(7)).UtcDateTime,
            LastUsedAt = DateTimeOffset.FromUnixTimeSeconds(r.GetInt64(8)).UtcDateTime,
            UseCount = r.GetInt32(9),
            Collection = r.IsDBNull(10) ? "all" : r.GetString(10),
            IsImage = !r.IsDBNull(11) && r.GetInt64(11) == 1,
            ImagePath = r.IsDBNull(12) ? "" : r.GetString(12),
            ThumbnailData = r.IsDBNull(13) ? "" : r.GetString(13),
            ImgDims = r.IsDBNull(14) ? "" : r.GetString(14),
            ImgSize = r.IsDBNull(15) ? "" : r.GetString(15),
            Favorite = !r.IsDBNull(16) && r.GetInt64(16) == 1,
            Nickname = r.IsDBNull(17) ? "" : r.GetString(17),
            SortRank = r.IsDBNull(18) ? 0 : r.GetInt64(18),
            // Optional column 19: GROUP_CONCAT of assigned tag names. Absent on
            // legacy call sites that select the original 19-column shape.
            Tags = r.FieldCount > 19 && !r.IsDBNull(19)
                ? new List<string>(r.GetString(19).Split(',', StringSplitOptions.RemoveEmptyEntries))
                : new List<string>(),
            // Optional column 20: custom_title.
            CustomTitle = r.FieldCount > 20 && !r.IsDBNull(20) ? r.GetString(20) : null,
            // Optional column 21: rich_text.
            RichText = r.FieldCount > 21 && !r.IsDBNull(21) ? r.GetString(21) : null
        };
    }
}
