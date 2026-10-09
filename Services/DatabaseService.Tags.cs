using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Data.Sqlite;
using DualClip.Models;

namespace DualClip.Services;

public class TagInfo
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string NormalizedName { get; set; } = string.Empty;
    public int ClipCount { get; set; }
    public long CreatedAt { get; set; }
    public long LastUsedAt { get; set; }
    public List<long> ClipIds { get; set; } = new();
}

public partial class DatabaseService
{
    public static string NormalizeTagName(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        var clean = raw.Trim().TrimStart('#').Replace(",", "").Replace("，", "");
        if (clean.Length > 40) clean = clean.Substring(0, 40);
        return clean.Trim();
    }

    private void EnsureTagSchema(SqliteConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                normalized_name TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tags_normalized ON tags(normalized_name);
            CREATE INDEX IF NOT EXISTS idx_tags_last_used ON tags(last_used_at DESC);

            CREATE TABLE IF NOT EXISTS clip_tags (
                clip_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                assigned_at INTEGER NOT NULL,
                PRIMARY KEY (clip_id, tag_id),
                FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_clip_tags_tag_clip ON clip_tags(tag_id, clip_id);
            CREATE INDEX IF NOT EXISTS idx_clip_tags_clip ON clip_tags(clip_id);
            """;
        cmd.ExecuteNonQuery();

        MigrateLegacyNicknamesIfEmpty(conn);
    }

    private void MigrateLegacyNicknamesIfEmpty(SqliteConnection conn)
    {
        try
        {
            using var checkCmd = conn.CreateCommand();
            checkCmd.CommandText = "SELECT COUNT(*) FROM clip_tags";
            var existingCount = Convert.ToInt64(checkCmd.ExecuteScalar() ?? 0);
            if (existingCount > 0) return; // Already migrated or populated

            using var readCmd = conn.CreateCommand();
            readCmd.CommandText = "SELECT id, nickname, last_used_at FROM clips WHERE nickname IS NOT NULL AND length(trim(nickname)) > 0";
            
            var clipsToMigrate = new List<(long Id, string Nickname, long LastUsed)>();
            using (var reader = readCmd.ExecuteReader())
            {
                while (reader.Read())
                {
                    var id = reader.GetInt64(0);
                    var nick = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
                    var lastUsed = reader.IsDBNull(2) ? DateTimeOffset.UtcNow.ToUnixTimeSeconds() : reader.GetInt64(2);
                    if (!string.IsNullOrWhiteSpace(nick))
                    {
                        clipsToMigrate.Add((id, nick, lastUsed));
                    }
                }
            }

            if (clipsToMigrate.Count == 0) return;

            using var tx = conn.BeginTransaction();
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

            foreach (var item in clipsToMigrate)
            {
                var rawTags = item.Nickname.Split(new[] { ',', '，' }, StringSplitOptions.RemoveEmptyEntries);
                var distinctNormalized = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                foreach (var raw in rawTags)
                {
                    var clean = NormalizeTagName(raw);
                    if (string.IsNullOrEmpty(clean)) continue;
                    if (distinctNormalized.Count >= 10) break;
                    if (!distinctNormalized.Add(clean)) continue;

                    var tagId = GetOrCreateTagIdInternal(conn, tx, clean, item.LastUsed > 0 ? item.LastUsed : now);
                    if (tagId > 0)
                    {
                        using var insLink = conn.CreateCommand();
                        insLink.Transaction = tx;
                        insLink.CommandText = "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, assigned_at) VALUES ($cid, $tid, $assigned)";
                        insLink.Parameters.AddWithValue("$cid", item.Id);
                        insLink.Parameters.AddWithValue("$tid", tagId);
                        insLink.Parameters.AddWithValue("$assigned", item.LastUsed > 0 ? item.LastUsed : now);
                        insLink.ExecuteNonQuery();
                    }
                }
            }

            tx.Commit();
        }
        catch
        {
            // Soft failure: migration is best-effort and non-fatal
        }
    }

    private static long GetOrCreateTagIdInternal(SqliteConnection conn, SqliteTransaction? tx, string displayName, long timestamp)
    {
        var normalized = displayName.ToLowerInvariant();
        using var findCmd = conn.CreateCommand();
        if (tx != null) findCmd.Transaction = tx;
        findCmd.CommandText = "SELECT id FROM tags WHERE normalized_name = $norm LIMIT 1";
        findCmd.Parameters.AddWithValue("$norm", normalized);
        var existing = findCmd.ExecuteScalar();
        if (existing != null && existing is long id)
        {
            using var updCmd = conn.CreateCommand();
            if (tx != null) updCmd.Transaction = tx;
            updCmd.CommandText = "UPDATE tags SET last_used_at = MAX(last_used_at, $ts), updated_at = $ts WHERE id = $id";
            updCmd.Parameters.AddWithValue("$ts", timestamp);
            updCmd.Parameters.AddWithValue("$id", id);
            updCmd.ExecuteNonQuery();
            return id;
        }

        using var insCmd = conn.CreateCommand();
        if (tx != null) insCmd.Transaction = tx;
        insCmd.CommandText = """
            INSERT INTO tags (name, normalized_name, created_at, updated_at, last_used_at)
            VALUES ($name, $norm, $ts, $ts, $ts);
            SELECT last_insert_rowid();
            """;
        insCmd.Parameters.AddWithValue("$name", displayName);
        insCmd.Parameters.AddWithValue("$norm", normalized);
        insCmd.Parameters.AddWithValue("$ts", timestamp);
        var newIdObj = insCmd.ExecuteScalar();
        return newIdObj != null && long.TryParse(newIdObj.ToString(), out var newId) ? newId : -1;
    }

    public List<string> GetTagsForClip(long clipId)
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT t.name
                FROM clip_tags ct
                JOIN tags t ON ct.tag_id = t.id
                WHERE ct.clip_id = $cid
                ORDER BY ct.assigned_at ASC, t.name ASC
                """;
            cmd.Parameters.AddWithValue("$cid", clipId);

            var list = new List<string>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(reader.GetString(0));
            }
            return list;
        }
    }

    public bool SetTagsForClip(long clipId, IEnumerable<string> tagNames)
    {
        var rawList = tagNames?.ToList() ?? new List<string>();
        var distinctTags = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var t in rawList)
        {
            var clean = NormalizeTagName(t);
            if (!string.IsNullOrEmpty(clean) && distinctTags.Count < 10 && seen.Add(clean))
            {
                distinctTags.Add(clean);
            }
        }

        var denormalized = string.Join(", ", distinctTags);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            // 1. Verify clip exists
            using var checkClip = conn.CreateCommand();
            checkClip.Transaction = tx;
            checkClip.CommandText = "SELECT COUNT(*) FROM clips WHERE id = $id";
            checkClip.Parameters.AddWithValue("$id", clipId);
            if (Convert.ToInt64(checkClip.ExecuteScalar() ?? 0) == 0)
            {
                return false;
            }

            // 2. Remove existing tag links
            using var delLinks = conn.CreateCommand();
            delLinks.Transaction = tx;
            delLinks.CommandText = "DELETE FROM clip_tags WHERE clip_id = $cid";
            delLinks.Parameters.AddWithValue("$cid", clipId);
            delLinks.ExecuteNonQuery();

            // 3. Insert new tag links
            foreach (var tag in distinctTags)
            {
                var tagId = GetOrCreateTagIdInternal(conn, tx, tag, now);
                if (tagId > 0)
                {
                    using var insLink = conn.CreateCommand();
                    insLink.Transaction = tx;
                    insLink.CommandText = "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, assigned_at) VALUES ($cid, $tid, $assigned)";
                    insLink.Parameters.AddWithValue("$cid", clipId);
                    insLink.Parameters.AddWithValue("$tid", tagId);
                    insLink.Parameters.AddWithValue("$assigned", now);
                    insLink.ExecuteNonQuery();
                }
            }

            // 4. Synchronize denormalized nickname column on clips
            using var updClip = conn.CreateCommand();
            updClip.Transaction = tx;
            updClip.CommandText = "UPDATE clips SET nickname = $nick WHERE id = $id";
            updClip.Parameters.AddWithValue("$nick", denormalized);
            updClip.Parameters.AddWithValue("$id", clipId);
            updClip.ExecuteNonQuery();

            tx.Commit();
            BumpDataGeneration();
            return true;
        }
    }

    public int AddTagsToClips(IEnumerable<long> clipIds, IEnumerable<string> tagNames)
    {
        var targetIds = clipIds?.Distinct().ToList() ?? new List<long>();
        if (targetIds.Count == 0) return 0;

        var tagsToAdd = new List<string>();
        var seenTags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tagNames ?? Enumerable.Empty<string>())
        {
            var clean = NormalizeTagName(t);
            if (!string.IsNullOrEmpty(clean) && seenTags.Add(clean))
            {
                tagsToAdd.Add(clean);
            }
        }
        if (tagsToAdd.Count == 0) return 0;

        int modifiedCount = 0;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            foreach (var cid in targetIds)
            {
                // Get existing tags for clip
                var existing = new List<string>();
                using (var getCmd = conn.CreateCommand())
                {
                    getCmd.Transaction = tx;
                    getCmd.CommandText = "SELECT t.name FROM clip_tags ct JOIN tags t ON ct.tag_id = t.id WHERE ct.clip_id = $cid ORDER BY ct.assigned_at ASC";
                    getCmd.Parameters.AddWithValue("$cid", cid);
                    using var r = getCmd.ExecuteReader();
                    while (r.Read()) existing.Add(r.GetString(0));
                }

                var currentSeen = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);
                var merged = new List<string>(existing);

                foreach (var tag in tagsToAdd)
                {
                    if (!currentSeen.Contains(tag) && merged.Count < 10)
                    {
                        merged.Add(tag);
                        currentSeen.Add(tag);

                        var tagId = GetOrCreateTagIdInternal(conn, tx, tag, now);
                        if (tagId > 0)
                        {
                            using var insLink = conn.CreateCommand();
                            insLink.Transaction = tx;
                            insLink.CommandText = "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, assigned_at) VALUES ($cid, $tid, $assigned)";
                            insLink.Parameters.AddWithValue("$cid", cid);
                            insLink.Parameters.AddWithValue("$tid", tagId);
                            insLink.Parameters.AddWithValue("$assigned", now);
                            insLink.ExecuteNonQuery();
                        }
                    }
                }

                var finalNick = string.Join(", ", merged);
                using (var updClip = conn.CreateCommand())
                {
                    updClip.Transaction = tx;
                    updClip.CommandText = "UPDATE clips SET nickname = $nick WHERE id = $id";
                    updClip.Parameters.AddWithValue("$nick", finalNick);
                    updClip.Parameters.AddWithValue("$id", cid);
                    if (updClip.ExecuteNonQuery() > 0)
                    {
                        modifiedCount++;
                    }
                }
            }

            tx.Commit();
            if (modifiedCount > 0) BumpDataGeneration();
            return modifiedCount;
        }
    }

    public int RemoveTagsFromClips(IEnumerable<long> clipIds, IEnumerable<string> tagNames)
    {
        var targetIds = clipIds?.Distinct().ToList() ?? new List<long>();
        if (targetIds.Count == 0) return 0;

        var tagsToRemove = new HashSet<string>(
            (tagNames ?? Enumerable.Empty<string>()).Select(NormalizeTagName).Where(t => !string.IsNullOrEmpty(t)),
            StringComparer.OrdinalIgnoreCase
        );
        if (tagsToRemove.Count == 0) return 0;

        int modifiedCount = 0;

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            foreach (var cid in targetIds)
            {
                // Remove links matching the normalized names
                using (var delCmd = conn.CreateCommand())
                {
                    delCmd.Transaction = tx;
                    var inParams = string.Join(",", tagsToRemove.Select((_, i) => $"$t{i}"));
                    delCmd.CommandText = $"DELETE FROM clip_tags WHERE clip_id = $cid AND tag_id IN (SELECT id FROM tags WHERE normalized_name IN ({inParams}))";
                    delCmd.Parameters.AddWithValue("$cid", cid);
                    int idx = 0;
                    foreach (var tr in tagsToRemove)
                    {
                        delCmd.Parameters.AddWithValue($"$t{idx++}", tr.ToLowerInvariant());
                    }
                    delCmd.ExecuteNonQuery();
                }

                // Re-read surviving tags and update denormalized nickname column
                var surviving = new List<string>();
                using (var getCmd = conn.CreateCommand())
                {
                    getCmd.Transaction = tx;
                    getCmd.CommandText = "SELECT t.name FROM clip_tags ct JOIN tags t ON ct.tag_id = t.id WHERE ct.clip_id = $cid ORDER BY ct.assigned_at ASC";
                    getCmd.Parameters.AddWithValue("$cid", cid);
                    using var r = getCmd.ExecuteReader();
                    while (r.Read()) surviving.Add(r.GetString(0));
                }

                var finalNick = string.Join(", ", surviving);
                using (var updClip = conn.CreateCommand())
                {
                    updClip.Transaction = tx;
                    updClip.CommandText = "UPDATE clips SET nickname = $nick WHERE id = $id";
                    updClip.Parameters.AddWithValue("$nick", finalNick);
                    updClip.Parameters.AddWithValue("$id", cid);
                    if (updClip.ExecuteNonQuery() > 0)
                    {
                        modifiedCount++;
                    }
                }
            }

            tx.Commit();
            if (modifiedCount > 0) BumpDataGeneration();
            return modifiedCount;
        }
    }

    public List<TagInfo> GetAllTagsWithStats()
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT t.id, t.name, t.normalized_name, t.created_at, t.last_used_at,
                       COUNT(ct.clip_id) AS clip_count,
                       GROUP_CONCAT(ct.clip_id) AS clip_ids
                FROM tags t
                LEFT JOIN clip_tags ct ON t.id = ct.tag_id
                GROUP BY t.id
                ORDER BY clip_count DESC, t.last_used_at DESC, t.name ASC
                """;

            var list = new List<TagInfo>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var info = new TagInfo
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    NormalizedName = reader.GetString(2),
                    CreatedAt = reader.GetInt64(3),
                    LastUsedAt = reader.GetInt64(4),
                    ClipCount = reader.GetInt32(5)
                };

                if (!reader.IsDBNull(6))
                {
                    var rawIds = reader.GetString(6);
                    info.ClipIds = rawIds.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                        .Select(s => long.TryParse(s, out var id) ? id : -1)
                        .Where(id => id > 0)
                        .ToList();
                }

                list.Add(info);
            }
            return list;
        }
    }

    public TagInfo? GetTagStats(string tagName)
    {
        if (string.IsNullOrWhiteSpace(tagName)) return null;
        var clean = NormalizeTagName(tagName);
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT t.id, t.name, t.normalized_name, t.created_at, t.last_used_at,
                       COUNT(ct.clip_id) AS clip_count,
                       GROUP_CONCAT(ct.clip_id) AS clip_ids
                FROM tags t
                LEFT JOIN clip_tags ct ON t.id = ct.tag_id
                WHERE t.normalized_name = $norm
                GROUP BY t.id;
                """;
            cmd.Parameters.AddWithValue("$norm", clean);
            using var reader = cmd.ExecuteReader();
            if (reader.Read())
            {
                var info = new TagInfo
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    NormalizedName = reader.GetString(2),
                    CreatedAt = reader.GetInt64(3),
                    LastUsedAt = reader.GetInt64(4),
                    ClipCount = reader.GetInt32(5)
                };

                if (!reader.IsDBNull(6))
                {
                    var rawIds = reader.GetString(6);
                    info.ClipIds = rawIds.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                        .Select(s => long.TryParse(s, out var id) ? id : -1)
                        .Where(id => id > 0)
                        .ToList();
                }
                return info;
            }
            return null;
        }
    }

    public bool RenameTag(string oldName, string newName)
    {
        var cleanOld = NormalizeTagName(oldName);
        var cleanNew = NormalizeTagName(newName);
        if (string.IsNullOrEmpty(cleanOld) || string.IsNullOrEmpty(cleanNew)) return false;
        if (string.Equals(cleanOld, cleanNew, StringComparison.OrdinalIgnoreCase)) return true;

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            // Find old tag
            long oldTagId = -1;
            using (var findOld = conn.CreateCommand())
            {
                findOld.Transaction = tx;
                findOld.CommandText = "SELECT id FROM tags WHERE normalized_name = $norm LIMIT 1";
                findOld.Parameters.AddWithValue("$norm", cleanOld.ToLowerInvariant());
                var res = findOld.ExecuteScalar();
                if (res != null && res is long id) oldTagId = id;
            }
            if (oldTagId <= 0) return false;

            // Find if target new tag already exists (merge case)
            long targetTagId = -1;
            using (var findNew = conn.CreateCommand())
            {
                findNew.Transaction = tx;
                findNew.CommandText = "SELECT id FROM tags WHERE normalized_name = $norm LIMIT 1";
                findNew.Parameters.AddWithValue("$norm", cleanNew.ToLowerInvariant());
                var res = findNew.ExecuteScalar();
                if (res != null && res is long id) targetTagId = id;
            }

            if (targetTagId > 0 && targetTagId != oldTagId)
            {
                // Re-link clips to targetTagId
                using var relinkCmd = conn.CreateCommand();
                relinkCmd.Transaction = tx;
                relinkCmd.CommandText = "UPDATE OR IGNORE clip_tags SET tag_id = $target WHERE tag_id = $old";
                relinkCmd.Parameters.AddWithValue("$target", targetTagId);
                relinkCmd.Parameters.AddWithValue("$old", oldTagId);
                relinkCmd.ExecuteNonQuery();

                // Delete remaining old links and tag
                using var delOldLinks = conn.CreateCommand();
                delOldLinks.Transaction = tx;
                delOldLinks.CommandText = "DELETE FROM clip_tags WHERE tag_id = $old";
                delOldLinks.Parameters.AddWithValue("$old", oldTagId);
                delOldLinks.ExecuteNonQuery();

                using var delOldTag = conn.CreateCommand();
                delOldTag.Transaction = tx;
                delOldTag.CommandText = "DELETE FROM tags WHERE id = $old";
                delOldTag.Parameters.AddWithValue("$old", oldTagId);
                delOldTag.ExecuteNonQuery();
            }
            else
            {
                // Simple rename
                using var updTag = conn.CreateCommand();
                updTag.Transaction = tx;
                updTag.CommandText = "UPDATE tags SET name = $name, normalized_name = $norm, updated_at = $ts WHERE id = $id";
                updTag.Parameters.AddWithValue("$name", cleanNew);
                updTag.Parameters.AddWithValue("$norm", cleanNew.ToLowerInvariant());
                updTag.Parameters.AddWithValue("$ts", now);
                updTag.Parameters.AddWithValue("$id", oldTagId);
                updTag.ExecuteNonQuery();
            }

            // Sync denormalized nickname column across clips
            using (var syncClips = conn.CreateCommand())
            {
                syncClips.Transaction = tx;
                syncClips.CommandText = """
                    SELECT c.id, GROUP_CONCAT(t.name, ', ') AS updated_nick
                    FROM clips c
                    JOIN clip_tags ct ON c.id = ct.clip_id
                    JOIN tags t ON ct.tag_id = t.id
                    GROUP BY c.id
                    """;
                var updates = new List<(long Id, string Nick)>();
                using (var r = syncClips.ExecuteReader())
                {
                    while (r.Read())
                    {
                        updates.Add((r.GetInt64(0), r.GetString(1)));
                    }
                }

                foreach (var u in updates)
                {
                    using var upd = conn.CreateCommand();
                    upd.Transaction = tx;
                    upd.CommandText = "UPDATE clips SET nickname = $nick WHERE id = $id";
                    upd.Parameters.AddWithValue("$nick", u.Nick);
                    upd.Parameters.AddWithValue("$id", u.Id);
                    upd.ExecuteNonQuery();
                }
            }

            tx.Commit();
            BumpDataGeneration();
            return true;
        }
    }

    public bool DeleteTag(string tagName)
    {
        var clean = NormalizeTagName(tagName);
        if (string.IsNullOrEmpty(clean)) return false;

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            long tagId = -1;
            using (var findCmd = conn.CreateCommand())
            {
                findCmd.Transaction = tx;
                findCmd.CommandText = "SELECT id FROM tags WHERE normalized_name = $norm LIMIT 1";
                findCmd.Parameters.AddWithValue("$norm", clean.ToLowerInvariant());
                var res = findCmd.ExecuteScalar();
                if (res != null && res is long id) tagId = id;
            }
            if (tagId <= 0) return false;

            // Find affected clips
            var affectedClips = new List<long>();
            using (var findClips = conn.CreateCommand())
            {
                findClips.Transaction = tx;
                findClips.CommandText = "SELECT DISTINCT clip_id FROM clip_tags WHERE tag_id = $tid";
                findClips.Parameters.AddWithValue("$tid", tagId);
                using var r = findClips.ExecuteReader();
                while (r.Read()) affectedClips.Add(r.GetInt64(0));
            }

            // Delete links
            using (var delLinks = conn.CreateCommand())
            {
                delLinks.Transaction = tx;
                delLinks.CommandText = "DELETE FROM clip_tags WHERE tag_id = $tid";
                delLinks.Parameters.AddWithValue("$tid", tagId);
                delLinks.ExecuteNonQuery();
            }

            // Delete tag
            using (var delTag = conn.CreateCommand())
            {
                delTag.Transaction = tx;
                delTag.CommandText = "DELETE FROM tags WHERE id = $tid";
                delTag.Parameters.AddWithValue("$tid", tagId);
                delTag.ExecuteNonQuery();
            }

            // Sync surviving nicknames for affected clips
            foreach (var cid in affectedClips)
            {
                var surviving = new List<string>();
                using (var getSurv = conn.CreateCommand())
                {
                    getSurv.Transaction = tx;
                    getSurv.CommandText = "SELECT t.name FROM clip_tags ct JOIN tags t ON ct.tag_id = t.id WHERE ct.clip_id = $cid ORDER BY ct.assigned_at ASC";
                    getSurv.Parameters.AddWithValue("$cid", cid);
                    using var r = getSurv.ExecuteReader();
                    while (r.Read()) surviving.Add(r.GetString(0));
                }

                var finalNick = string.Join(", ", surviving);
                using var updClip = conn.CreateCommand();
                updClip.Transaction = tx;
                updClip.CommandText = "UPDATE clips SET nickname = $nick WHERE id = $id";
                updClip.Parameters.AddWithValue("$nick", finalNick);
                updClip.Parameters.AddWithValue("$id", cid);
                updClip.ExecuteNonQuery();
            }

            tx.Commit();
            BumpDataGeneration();
            return true;
        }
    }

    public List<string> GetSuggestedTags(int limit = 10)
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT t.name
                FROM tags t
                LEFT JOIN clip_tags ct ON t.id = ct.tag_id
                GROUP BY t.id
                ORDER BY COUNT(ct.clip_id) DESC, t.last_used_at DESC, t.name ASC
                LIMIT $limit
                """;
            cmd.Parameters.AddWithValue("$limit", Math.Max(1, Math.Min(limit, 50)));

            var list = new List<string>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(reader.GetString(0));
            }
            return list;
        }
    }
}
