using System;
using System.IO;
using Microsoft.Data.Sqlite;

namespace DualClip.Services;

public static class DemoDataSeeder
{
    public static void SeedDemoData()
    {
        string dbPath = PathHelper.GetDatabasePath();
        if (string.IsNullOrWhiteSpace(dbPath))
        {
            Console.WriteLine("[DualClip Demo] Could not resolve database path.");
            return;
        }

        if (!File.Exists(dbPath))
        {
            Console.WriteLine("[DualClip Demo] Database does not exist yet. Initializing schema...");
            try
            {
                _ = new DatabaseService(dbPath);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DualClip Demo] Failed to initialize database: {ex.Message}");
                return;
            }
        }

        // 1. Snapshot backup if not already present
        string backupPath = dbPath + ".bak";
        if (!File.Exists(backupPath))
        {
            try
            {
                File.Copy(dbPath, backupPath, overwrite: false);
                Console.WriteLine($"[DualClip Demo] Created safety backup: {backupPath}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DualClip Demo] Note: Could not create backup: {ex.Message}");
            }
        }

        string connStr = $"Data Source={dbPath};Mode=ReadWrite;";
        using var conn = new SqliteConnection(connStr);
        conn.Open();

        using var tx = conn.BeginTransaction();

        // 2. Clean out any previous demo data first to ensure idempotency
        PurgeInternal(conn, tx);

        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        // 3. Insert hierarchical demo collections
        var collections = new[]
        {
            (Id: "col_demo_work", Name: "Work", Pinned: 1, Order: 1, ParentId: (string?)null),
            (Id: "col_demo_projects", Name: "Projects", Pinned: 0, Order: 2, ParentId: (string?)"col_demo_work"),
            (Id: "col_demo_notes", Name: "Meeting Notes", Pinned: 0, Order: 3, ParentId: (string?)"col_demo_work"),
            (Id: "col_demo_personal", Name: "Personal", Pinned: 0, Order: 4, ParentId: (string?)null),
            (Id: "col_demo_finances", Name: "Finances", Pinned: 0, Order: 5, ParentId: (string?)"col_demo_personal"),
            (Id: "col_demo_reading", Name: "Reading List", Pinned: 0, Order: 6, ParentId: (string?)"col_demo_personal")
        };

        foreach (var col in collections)
        {
            using var cmdCol = conn.CreateCommand();
            cmdCol.Transaction = tx;
            cmdCol.CommandText = """
                INSERT INTO collections (id, name, pinned, sort_order, created_at, parent_id)
                VALUES ($id, $name, $pinned, $order, $now, $parentId)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, pinned = excluded.pinned, sort_order = excluded.sort_order, parent_id = excluded.parent_id
                """;
            cmdCol.Parameters.AddWithValue("$id", col.Id);
            cmdCol.Parameters.AddWithValue("$name", col.Name);
            cmdCol.Parameters.AddWithValue("$pinned", col.Pinned);
            cmdCol.Parameters.AddWithValue("$order", col.Order);
            cmdCol.Parameters.AddWithValue("$now", now);
            cmdCol.Parameters.AddWithValue("$parentId", col.ParentId ?? (object)DBNull.Value);
            cmdCol.ExecuteNonQuery();
        }

        // 4. Insert rich demo clips across types
        var clips = new[]
        {
            // Code snippets in Projects
            (
                Text: "{\n  \"service\": \"DualClip\",\n  \"version\": \"2.4.0\",\n  \"features\": [\"sidebar\", \"nested_collections\", \"sqlite_fts5\"],\n  \"active\": true\n}",
                Col: "col_demo_projects",
                Title: "Service Config JSON",
                Tags: "dev, demo",
                Fav: 1
            ),
            (
                Text: "def calculate_checksum(data: str) -> str:\n    import hashlib\n    return hashlib.sha256(data.encode('utf-8')).hexdigest()",
                Col: "col_demo_projects",
                Title: "Python SHA256 Helper",
                Tags: "dev, python, demo",
                Fav: 0
            ),
            (
                Text: "SELECT c.id, c.text_content, COUNT(ct.tag_id) AS tag_count\nFROM clips c\nLEFT JOIN clip_tags ct ON ct.clip_id = c.id\nWHERE c.is_image = 0\nGROUP BY c.id\nORDER BY c.id DESC LIMIT 50;",
                Col: "col_demo_projects",
                Title: "SQLite Clips Query",
                Tags: "dev, sql, demo",
                Fav: 0
            ),

            // Meeting Notes
            (
                Text: "Sprint Planning Sync Notes:\n- Finalize sidebar nested collection hierarchy\n- Ensure SQLite PRAGMA foreign_keys is handled gracefully in code\n- Roll up badge counts for parent collections",
                Col: "col_demo_notes",
                Title: "Sprint Planning Notes",
                Tags: "urgent, demo",
                Fav: 1
            ),
            (
                Text: "#6366f1",
                Col: "col_demo_notes",
                Title: "Brand Accent Indigo",
                Tags: "design, demo",
                Fav: 0
            ),
            (
                Text: "#10b981",
                Col: "col_demo_notes",
                Title: "Brand Accent Emerald",
                Tags: "design, demo",
                Fav: 0
            ),

            // Reading List URLs
            (
                Text: "https://github.com/microsoft/webview2",
                Col: "col_demo_reading",
                Title: "Microsoft WebView2 Docs",
                Tags: "reading, demo",
                Fav: 0
            ),
            (
                Text: "https://news.ycombinator.com",
                Col: "col_demo_reading",
                Title: "Hacker News",
                Tags: "reading, demo",
                Fav: 0
            ),

            // Personal Finances
            (
                Text: "Quarterly Infrastructure Budget:\n- Cloud Hosting: $45.00/mo\n- Domain Renewals: $12.00/yr\n- Backup Storage: $5.00/mo",
                Col: "col_demo_finances",
                Title: "Q4 Infrastructure Budget",
                Tags: "finance, demo",
                Fav: 0
            )
        };

        var tagIdMap = new System.Collections.Generic.Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);

        // Ensure tags exist in tags table
        var tagNames = new[] { "demo", "dev", "python", "sql", "urgent", "design", "reading", "finance" };
        foreach (var tn in tagNames)
        {
            var norm = tn.ToLowerInvariant();
            using var cmdTag = conn.CreateCommand();
            cmdTag.Transaction = tx;
            cmdTag.CommandText = """
                INSERT OR IGNORE INTO tags (name, normalized_name, created_at, updated_at, last_used_at)
                VALUES ($name, $norm, $now, $now, $now);
                SELECT id FROM tags WHERE normalized_name = $norm;
                """;
            cmdTag.Parameters.AddWithValue("$name", tn);
            cmdTag.Parameters.AddWithValue("$norm", norm);
            cmdTag.Parameters.AddWithValue("$now", now);
            var res = cmdTag.ExecuteScalar();
            if (res != null && long.TryParse(res.ToString(), out var tid))
            {
                tagIdMap[tn] = tid;
            }
        }

        int rank = 1;
        foreach (var c in clips)
        {
            var flat = c.Text.Replace("\r", " ").Replace("\n", " ");
            int cut = Math.Min(flat.Length, 120);
            if (cut > 0 && cut < flat.Length && char.IsHighSurrogate(flat[cut - 1])) cut -= 1;
            var preview = flat.Length <= cut ? flat : string.Concat(flat.AsSpan(0, cut), "…");
            var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(c.Text)));

            using var cmdClip = conn.CreateCommand();
            cmdClip.Transaction = tx;
            cmdClip.CommandText = """
                INSERT INTO clips (
                    text_content, preview, content_hash, track, collection, is_image, favorite, pinned, sort_rank, use_count,
                    created_at, last_used_at, src_process, src_title, custom_title
                ) VALUES (
                    $text, $preview, $hash, 'manual', $col, 0, $fav, 0, $rank, 1,
                    $now, $now, 'dualclip_demo', 'DualClip Demo', $title
                );
                SELECT last_insert_rowid();
                """;
            cmdClip.Parameters.AddWithValue("$text", c.Text);
            cmdClip.Parameters.AddWithValue("$preview", preview);
            cmdClip.Parameters.AddWithValue("$hash", hash);
            cmdClip.Parameters.AddWithValue("$col", c.Col);
            cmdClip.Parameters.AddWithValue("$fav", c.Fav);
            cmdClip.Parameters.AddWithValue("$rank", rank++);
            cmdClip.Parameters.AddWithValue("$now", now);
            cmdClip.Parameters.AddWithValue("$title", c.Title);

            var clipIdObj = cmdClip.ExecuteScalar();
            if (clipIdObj != null && long.TryParse(clipIdObj.ToString(), out var clipId))
            {
                var clipTags = c.Tags.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                foreach (var ct in clipTags)
                {
                    if (tagIdMap.TryGetValue(ct, out long tid))
                    {
                        using var cmdJunc = conn.CreateCommand();
                        cmdJunc.Transaction = tx;
                        cmdJunc.CommandText = "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, assigned_at) VALUES ($cid, $tid, $now);";
                        cmdJunc.Parameters.AddWithValue("$cid", clipId);
                        cmdJunc.Parameters.AddWithValue("$tid", tid);
                        cmdJunc.Parameters.AddWithValue("$now", now);
                        cmdJunc.ExecuteNonQuery();
                    }
                }
            }
        }

        tx.Commit();

        // Checkpoint WAL
        try
        {
            using var walCmd = conn.CreateCommand();
            walCmd.CommandText = "PRAGMA wal_checkpoint(PASSIVE);";
            walCmd.ExecuteNonQuery();
        }
        catch { }

        Console.WriteLine("[DualClip Demo] Successfully seeded:");
        Console.WriteLine("  - 6 Hierarchical collections (Work -> Projects, Meeting Notes; Personal -> Finances, Reading List)");
        Console.WriteLine("  - 9 Realistic clips (Code, Color hex, Web URLs, Notes, Budgets)");
        Console.WriteLine("  - Tags: #dev, #urgent, #design, #reading, #finance");
        Console.WriteLine("Run DualClip to inspect and test the sidebar view!");
    }

    public static void PurgeDemoData()
    {
        string dbPath = PathHelper.GetDatabasePath();
        if (string.IsNullOrWhiteSpace(dbPath) || !File.Exists(dbPath))
        {
            Console.WriteLine("[DualClip Demo] No database file found to purge.");
            return;
        }

        string connStr = $"Data Source={dbPath};Mode=ReadWrite;";
        using var conn = new SqliteConnection(connStr);
        conn.Open();

        using var tx = conn.BeginTransaction();
        int clipsDeleted = PurgeInternal(conn, tx);
        tx.Commit();

        try
        {
            using var walCmd = conn.CreateCommand();
            walCmd.CommandText = "PRAGMA wal_checkpoint(TRUNCATE);";
            walCmd.ExecuteNonQuery();
        }
        catch { }

        Console.WriteLine($"[DualClip Demo] Cleanly purged {clipsDeleted} demo clips and all demo collections.");
        Console.WriteLine("[DualClip Demo] Zero demo records remaining.");
    }

    public static void RollbackDemoData()
    {
        string dbPath = PathHelper.GetDatabasePath();
        if (string.IsNullOrWhiteSpace(dbPath))
        {
            Console.WriteLine("[DualClip Demo] Could not resolve database path.");
            return;
        }

        string backupPath = dbPath + ".bak";
        if (!File.Exists(backupPath))
        {
            Console.WriteLine("[DualClip Demo] No safety backup file (.bak) found to rollback to.");
            return;
        }

        try
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            GC.Collect();
            GC.WaitForPendingFinalizers();

            string walPath = dbPath + "-wal";
            string shmPath = dbPath + "-shm";
            if (File.Exists(walPath)) File.Delete(walPath);
            if (File.Exists(shmPath)) File.Delete(shmPath);

            File.Copy(backupPath, dbPath, overwrite: true);
            File.Delete(backupPath);
            Console.WriteLine("[DualClip Demo] Successfully restored database from safety backup and removed .bak file.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[DualClip Demo] Error rolling back from backup: {ex.Message}");
        }
    }

    private static int PurgeInternal(SqliteConnection conn, SqliteTransaction tx)
    {
        // 1. Remove junction rows
        using var cmdJunc = conn.CreateCommand();
        cmdJunc.Transaction = tx;
        cmdJunc.CommandText = "DELETE FROM clip_tags WHERE clip_id IN (SELECT id FROM clips WHERE src_process = 'dualclip_demo');";
        cmdJunc.ExecuteNonQuery();

        // 2. Remove demo clips
        using var cmdClips = conn.CreateCommand();
        cmdClips.Transaction = tx;
        cmdClips.CommandText = "DELETE FROM clips WHERE src_process = 'dualclip_demo';";
        int clipsDeleted = cmdClips.ExecuteNonQuery();

        // 3. Remove demo collections
        using var cmdCols = conn.CreateCommand();
        cmdCols.Transaction = tx;
        cmdCols.CommandText = "DELETE FROM collections WHERE id LIKE 'col_demo_%';";
        cmdCols.ExecuteNonQuery();

        // 4. Remove unreferenced demo tags
        using var cmdTags = conn.CreateCommand();
        cmdTags.Transaction = tx;
        cmdTags.CommandText = "DELETE FROM tags WHERE name IN ('demo', 'python', 'sql', 'urgent', 'reading') AND id NOT IN (SELECT tag_id FROM clip_tags);";
        cmdTags.ExecuteNonQuery();

        return clipsDeleted;
    }
}
