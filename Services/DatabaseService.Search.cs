using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using DualClip.Models;

namespace DualClip.Services;

public partial class DatabaseService
{
    private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private const int FuzzyMinLen = SearchConstants.FuzzyMinLen;

    private static bool IsWithinOneEdit(string a, string b)
    {
        if (a == b) return true;
        if (string.IsNullOrEmpty(a)) return (b?.Length ?? 0) <= 1;
        if (string.IsNullOrEmpty(b)) return a.Length <= 1;
        if (Math.Abs(a.Length - b.Length) > 1) return false;

        if (a.Length == b.Length)
        {
            int first = -1;
            for (int k = 0; k < a.Length; k++)
            {
                if (a[k] != b[k]) { first = k; break; }
            }
            if (first < 0) return true;
            bool subst = true;
            for (int k = first + 1; k < a.Length; k++)
            {
                if (a[k] != b[k]) { subst = false; break; }
            }
            if (subst) return true;
            if (first + 1 < a.Length && a[first] == b[first + 1] && a[first + 1] == b[first])
            {
                for (int k = first + 2; k < a.Length; k++)
                {
                    if (a[k] != b[k]) return false;
                }
                return true;
            }
            return false;
        }

        int i = 0, j = 0, diff = 0;
        string shorter = a.Length < b.Length ? a : b;
        string longer = a.Length < b.Length ? b : a;
        while (i < shorter.Length && j < longer.Length)
        {
            if (shorter[i] != longer[j])
            {
                diff++;
                if (diff > 1) return false;
                j++;
            }
            else
            {
                i++; j++;
            }
        }
        diff += (longer.Length - j);
        return diff <= 1;
    }

    /// <summary>Async routed entry point for the UI thread. OptimizedOnly runs the
    /// full pipeline on a thread-pool worker (cancellable); every other mode serves
    /// the legacy path on a worker. Awaiting this never blocks the message loop.</summary>
    public Task<List<ClipItem>> GetClipsAsync(
        string track = "all",
        string search = "",
        int limit = 150,
        int offset = 0,
        string collection = "all",
        string filterType = "all",
        string filterApp = "all",
        string filterTime = "any",
        string sort = "default",
        bool fuzzyEnabled = false,
        CancellationToken ct = default)
    {
        if (OptimizedSearchMode == SearchMode.OptimizedOnly && IsFtsReady())
        {
            return GetClipsOptimizedAsync(track, search, limit, offset, collection,
                filterType, filterApp, filterTime, sort, fuzzyEnabled, ct);
        }
        return Task.Run(() => GetClipsLegacy(track, search, limit, offset, collection,
            filterType, filterApp, filterTime, sort, fuzzyEnabled, ct), ct);
    }

    public List<ClipItem> GetClipsLegacy(
        string track = "all",
        string search = "",
        int limit = 150,
        int offset = 0,
        string collection = "all",
        string filterType = "all",
        string filterApp = "all",
        string filterTime = "any",
        string sort = "default",
        bool fuzzyEnabled = false,
        CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        using var conn = OpenConnection();

        var where = new List<string>();
            var p = new List<SqliteParameter>();

            var qRaw = (search ?? "").Trim();
            bool hasSearch = qRaw.Length >= 1;

            // 1. Collections & Track filtering
            if (track == "pins" || track == "favorites" || collection == "pins" || collection == "favorites")
            {
                where.Add("c.favorite = 1");
            }
            else if (track == "voice" || collection == "transcriptions" || collection == "voice")
            {
                where.Add("c.track = 'voice'");
            }
            else if (collection == "most_used")
            {
                where.Add("c.use_count >= 1");
            }
            else if (!string.IsNullOrWhiteSpace(collection) && collection != "all")
            {
                where.Add("c.collection = $col");
                p.Add(new SqliteParameter("$col", collection));
            }

            // 2. Source App filtering
            if (!string.IsNullOrWhiteSpace(filterApp) && filterApp != "all")
            {
                where.Add("LOWER(c.src_process) LIKE $app ESCAPE '\\'");
                p.Add(new SqliteParameter("$app", $"%{EscapeLike(filterApp.Trim().ToLowerInvariant())}%"));
            }

            // 3. Time Window filtering
            if (!string.IsNullOrWhiteSpace(filterTime) && filterTime != "any")
            {
                long todayStart = new DateTimeOffset(DateTime.Today).ToUnixTimeSeconds();
                long yesterdayStart = todayStart - 86400;
                long weekStart = todayStart - (7 * 86400);
                long monthStart = todayStart - (30 * 86400);

                if (filterTime == "today")
                {
                    where.Add("c.created_at >= $tToday");
                    p.Add(new SqliteParameter("$tToday", todayStart));
                }
                else if (filterTime == "yesterday")
                {
                    where.Add("c.created_at >= $tYest AND c.created_at < $tToday");
                    p.Add(new SqliteParameter("$tYest", yesterdayStart));
                    p.Add(new SqliteParameter("$tToday", todayStart));
                }
                else if (filterTime == "this_week" || filterTime == "7days" || filterTime == "last7days")
                {
                    where.Add("c.created_at >= $tWeek");
                    p.Add(new SqliteParameter("$tWeek", weekStart));
                }
                else if (filterTime == "30days" || filterTime == "last30days")
                {
                    where.Add("c.created_at >= $tMonth");
                    p.Add(new SqliteParameter("$tMonth", monthStart));
                }
                else if (filterTime == "older")
                {
                    where.Add("c.created_at < $tYest");
                    p.Add(new SqliteParameter("$tYest", yesterdayStart));
                }
            }

            // 4. Type filtering
            if (!string.IsNullOrWhiteSpace(filterType) && filterType != "all")
            {
                var ft = filterType.Trim().ToLowerInvariant();
                if (ft == "image" || ft == "images")
                {
                    where.Add("c.is_image = 1");
                }
                else if (ft == "url" || ft == "link" || ft == "links")
                {
                    where.Add("c.is_image = 0 AND (LOWER(c.text_content) LIKE 'http://%' OR LOWER(c.text_content) LIKE 'https://%' OR LOWER(c.text_content) LIKE 'www.%')");
                }
                else if (ft == "json" || ft == "data")
                {
                    where.Add("c.is_image = 0 AND ((TRIM(c.text_content) LIKE '{%' AND TRIM(c.text_content) LIKE '%}') OR (TRIM(c.text_content) LIKE '[%' AND TRIM(c.text_content) LIKE '%]'))");
                }
                else if (ft == "md" || ft == "markdown")
                {
                    where.Add("c.is_image = 0 AND (TRIM(c.text_content) LIKE '#%' OR TRIM(c.text_content) LIKE '- %' OR TRIM(c.text_content) LIKE '* %' OR TRIM(c.text_content) LIKE '+ %' OR TRIM(c.text_content) LIKE '>%' OR TRIM(c.text_content) LIKE '```%')");
                }
                // Deliberately a SUPERSET of the frontend getFormatTag() classifier: SQL cannot
                // cheaply run the full regex ladder, so it over-selects and the frontend applies
                // exact label equality. Under-selecting here would hide rows the UI would accept,
                // which desynchronises offset pagination between the two layers.
                else if (ft == "code")
                {
                    where.Add("c.is_image = 0 AND (c.text_content LIKE '%class %' OR c.text_content LIKE '%class%{' OR c.text_content LIKE '%function%' OR c.text_content LIKE '%var %' OR c.text_content LIKE '%var %' OR c.text_content LIKE '%let %' OR c.text_content LIKE '%let %' OR c.text_content LIKE '%const %' OR c.text_content LIKE '%const %' OR c.text_content LIKE '%import %' OR c.text_content LIKE '%import %' OR c.text_content LIKE '%def %' OR c.text_content LIKE '%def %' OR c.text_content LIKE '%namespace %' OR c.text_content LIKE '%package %' OR c.text_content LIKE '%#include%' OR c.text_content LIKE '%using %' OR c.text_content LIKE '%interface %' OR c.text_content LIKE '%enum %' OR c.text_content LIKE '%struct %' OR c.text_content LIKE '%fn %' OR c.text_content LIKE '%func %' OR c.text_content LIKE '%public %' OR c.text_content LIKE '%private %' OR c.text_content LIKE '%static %' OR c.text_content LIKE '%return %' OR LOWER(c.text_content) LIKE '%select %' OR LOWER(c.text_content) LIKE '%insert into%' OR LOWER(c.text_content) LIKE '%delete from%' OR LOWER(c.text_content) LIKE '%update %' OR LOWER(c.text_content) LIKE '%create table%' OR LOWER(c.text_content) LIKE '%<!doctype%' OR instr(c.text_content, '</') > 0)");
                }
                else if (ft == "color" || ft == "colors")
                {
                    where.Add("c.is_image = 0 AND (c.text_content GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' OR c.text_content GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' OR c.text_content GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' OR c.text_content GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' OR LOWER(c.text_content) LIKE 'rgb(%' OR LOWER(c.text_content) LIKE 'rgba(%' OR LOWER(c.text_content) LIKE 'hsl(%')");
                }
                else if (ft == "text")
                {
                    where.Add("c.is_image = 0");
                }
            }

            // 5. Keyword search (multi-word tokenization and tag filters)
            if (hasSearch)
            {
                var tokens = qRaw.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                for (int idx = 0; idx < tokens.Length; idx++)
                {
                    var token = tokens[idx];
                    var lower = token.ToLowerInvariant();
                    if (lower.StartsWith("nick:") || lower.StartsWith("nickname:"))
                    {
                        var nickVal = token.Substring(token.IndexOf(':') + 1).Trim().Trim('"');
                        var nickParam = $"$nick{idx}";
                        where.Add($"LOWER(c.nickname) LIKE {nickParam} ESCAPE '\\'");
                        p.Add(new SqliteParameter(nickParam, $"%{EscapeLike(nickVal.ToLowerInvariant())}%"));
                    }
                    else if (lower.StartsWith("tag:") || lower.StartsWith("tags:"))
                    {
                        // tag:/tags: resolve against the normalized tag tables, NOT the
                        // nickname column. Nickname is a free-text label and is not a
                        // reliable proxy for tag membership.
                        var tagVal = token.Substring(token.IndexOf(':') + 1).Trim().Trim('"');
                        var subTags = tagVal.Split(new[] { ',', '，' }, StringSplitOptions.RemoveEmptyEntries);
                        if (subTags.Length > 0)
                        {
                            for (int tIdx = 0; tIdx < subTags.Length; tIdx++)
                            {
                                var paramName = $"$tag_{idx}_{tIdx}";
                                where.Add($"EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id AND (LOWER(t.name) LIKE {paramName} ESCAPE '\\' OR LOWER(t.normalized_name) LIKE {paramName} ESCAPE '\\'))");
                                p.Add(new SqliteParameter(paramName, $"%{EscapeLike(subTags[tIdx].Trim().ToLowerInvariant())}%"));
                            }
                        }
                    }
                    else
                    {
                        var paramName = $"$token{idx}";
                        where.Add($"(LOWER(c.text_content) LIKE {paramName} ESCAPE '\\' OR LOWER(c.preview) LIKE {paramName} ESCAPE '\\' OR LOWER(c.src_process) LIKE {paramName} ESCAPE '\\' OR LOWER(c.src_title) LIKE {paramName} ESCAPE '\\' OR LOWER(c.nickname) LIKE {paramName} ESCAPE '\\' OR LOWER(c.custom_title) LIKE {paramName} ESCAPE '\\' OR EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id AND (LOWER(t.name) LIKE {paramName} ESCAPE '\\' OR LOWER(t.normalized_name) LIKE {paramName} ESCAPE '\\')))");
                        p.Add(new SqliteParameter(paramName, $"%{EscapeLike(token.ToLowerInvariant())}%"));
                    }
                }
            }

            string orderClause = sort switch
            {
                "newest" or "recent" => "c.created_at DESC, c.id DESC",
                "oldest" => "c.created_at ASC, c.id ASC",
                "most_used" => "c.use_count DESC, c.pinned DESC, c.sort_rank DESC, c.id DESC",
                _ => collection == "most_used"
                    ? "c.use_count DESC, c.pinned DESC, c.sort_rank DESC, c.id DESC"
                    : "c.pinned DESC, c.sort_rank DESC, c.id DESC",
            };

            var whereSql = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";
            var sql = $"""
                SELECT c.id, c.text_content, c.preview, c.pinned, c.track, c.src_process, c.src_title, c.created_at, c.last_used_at, c.use_count, c.collection, c.is_image, c.image_path, c.thumbnail_data, c.img_dims, c.img_size, c.favorite, c.nickname, c.sort_rank, (SELECT GROUP_CONCAT(t.name, ',') FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id), c.custom_title, c.rich_text
                FROM clips c
                {whereSql}
                ORDER BY {orderClause}
                LIMIT $lim OFFSET $off
                """;

            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var param in p) cmd.Parameters.Add(param);
            cmd.Parameters.AddWithValue("$lim", Math.Clamp(limit, 1, SearchConstants.MaxClampedLimit));
            cmd.Parameters.AddWithValue("$off", Math.Max(0, offset));

            var list = new List<ClipItem>();
            using (var r = cmd.ExecuteReader())
            {
                int readCount = 0;
                while (r.Read())
                {
                    if ((++readCount & 63) == 0) ct.ThrowIfCancellationRequested();
                    list.Add(ReadClip(r));
                }
            }

            // Typo-tolerant fallback if multi-char query returned 0 matches
            if (fuzzyEnabled && list.Count == 0 && hasSearch && qRaw.Length >= FuzzyMinLen)
            {
                ct.ThrowIfCancellationRequested();
                var fallbackList = GetFuzzyClipsFallback(conn, qRaw, track, collection, filterType, filterApp, filterTime, limit, ct);
                if (fallbackList.Count > 0) return fallbackList;
            }

            return list;
    }

    private List<ClipItem> GetFuzzyClipsFallback(
        SqliteConnection conn,
        string query,
        string track,
        string collection,
        string filterType,
        string filterApp,
        string filterTime,
        int limit,
        CancellationToken ct = default)
    {
        var where = new List<string>();
        var p = new List<SqliteParameter>();

        if (track == "pins" || track == "favorites" || collection == "pins" || collection == "favorites")
            where.Add("c.favorite = 1");
        else if (track == "voice" || collection == "transcriptions" || collection == "voice")
            where.Add("c.track = 'voice'");
        else if (track == "most_used" || collection == "most_used")
            where.Add("c.use_count >= 1");
        else if (!string.IsNullOrWhiteSpace(collection) && collection != "all")
        {
            where.Add("c.collection = $col");
            p.Add(new SqliteParameter("$col", collection));
        }

        if (!string.IsNullOrWhiteSpace(filterApp) && filterApp != "all")
        {
            where.Add("LOWER(c.src_process) LIKE $app ESCAPE '\\'");
            p.Add(new SqliteParameter("$app", $"%{EscapeLike(filterApp.Trim().ToLowerInvariant())}%"));
        }

        if (!string.IsNullOrWhiteSpace(filterTime) && filterTime != "any")
        {
            long todayStart = new DateTimeOffset(DateTime.Today).ToUnixTimeSeconds();
            long yesterdayStart = todayStart - 86400;
            long weekStart = todayStart - (7 * 86400);
            long monthStart = todayStart - (30 * 86400);

            if (filterTime == "today")
            {
                where.Add("c.created_at >= $tToday");
                p.Add(new SqliteParameter("$tToday", todayStart));
            }
            else if (filterTime == "yesterday")
            {
                where.Add("c.created_at >= $tYest AND c.created_at < $tToday");
                p.Add(new SqliteParameter("$tYest", yesterdayStart));
                p.Add(new SqliteParameter("$tToday", todayStart));
            }
            else if (filterTime == "this_week" || filterTime == "7days" || filterTime == "last7days")
            {
                where.Add("c.created_at >= $tWeek");
                p.Add(new SqliteParameter("$tWeek", weekStart));
            }
            else if (filterTime == "30days" || filterTime == "last30days")
            {
                where.Add("c.created_at >= $tMonth");
                p.Add(new SqliteParameter("$tMonth", monthStart));
            }
            else if (filterTime == "older")
            {
                where.Add("c.created_at < $tYest");
                p.Add(new SqliteParameter("$tYest", yesterdayStart));
            }
        }

        if (!string.IsNullOrWhiteSpace(filterType) && filterType != "all")
        {
            var ft = filterType.Trim().ToLowerInvariant();
            if (ft == "image" || ft == "images")
            {
                where.Add("c.is_image = 1");
            }
            else if (ft == "url" || ft == "link" || ft == "links")
            {
                where.Add("c.is_image = 0 AND (LOWER(c.text_content) LIKE 'http://%' OR LOWER(c.text_content) LIKE 'https://%' OR LOWER(c.text_content) LIKE 'www.%')");
            }
            else if (ft == "json" || ft == "data")
            {
                where.Add("c.is_image = 0 AND ((TRIM(c.text_content) LIKE '{%' AND TRIM(c.text_content) LIKE '%}') OR (TRIM(c.text_content) LIKE '[%' AND TRIM(c.text_content) LIKE '%]'))");
            }
            else if (ft == "md" || ft == "markdown")
            {
                where.Add("c.is_image = 0 AND (TRIM(c.text_content) LIKE '#%' OR TRIM(c.text_content) LIKE '- %' OR TRIM(c.text_content) LIKE '* %' OR TRIM(c.text_content) LIKE '+ %' OR TRIM(c.text_content) LIKE '>%' OR TRIM(c.text_content) LIKE '```%')");
            }
            // Deliberately a SUPERSET of the frontend getFormatTag() classifier — see the
            // matching note in GetClipsLegacy's main-path filter above.
            else if (ft == "code")
            {
                where.Add("c.is_image = 0 AND (c.text_content LIKE '%class %' OR c.text_content LIKE '%class%{' OR c.text_content LIKE '%function%' OR c.text_content LIKE '%var %' OR c.text_content LIKE '%var %' OR c.text_content LIKE '%let %' OR c.text_content LIKE '%let %' OR c.text_content LIKE '%const %' OR c.text_content LIKE '%const %' OR c.text_content LIKE '%import %' OR c.text_content LIKE '%import %' OR c.text_content LIKE '%def %' OR c.text_content LIKE '%def %' OR c.text_content LIKE '%namespace %' OR c.text_content LIKE '%package %' OR c.text_content LIKE '%#include%' OR c.text_content LIKE '%using %' OR c.text_content LIKE '%interface %' OR c.text_content LIKE '%enum %' OR c.text_content LIKE '%struct %' OR c.text_content LIKE '%fn %' OR c.text_content LIKE '%func %' OR c.text_content LIKE '%public %' OR c.text_content LIKE '%private %' OR c.text_content LIKE '%static %' OR c.text_content LIKE '%return %' OR LOWER(c.text_content) LIKE '%select %' OR LOWER(c.text_content) LIKE '%insert into%' OR LOWER(c.text_content) LIKE '%delete from%' OR LOWER(c.text_content) LIKE '%update %' OR LOWER(c.text_content) LIKE '%create table%' OR LOWER(c.text_content) LIKE '%<!doctype%' OR instr(c.text_content, '</') > 0)");
            }
            else if (ft == "text")
            {
                where.Add("c.is_image = 0");
            }
        }

        var whereSql = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";
        var sql = $"""
            SELECT c.id, c.text_content, c.preview, c.pinned, c.track, c.src_process, c.src_title, c.created_at, c.last_used_at, c.use_count, c.collection, c.is_image, c.image_path, c.thumbnail_data, c.img_dims, c.img_size, c.favorite, c.nickname, c.sort_rank
            FROM clips c
            {whereSql}
            ORDER BY c.pinned DESC, c.sort_rank DESC, c.id DESC
            LIMIT {SearchConstants.FuzzyFallbackLimit}
            """;

        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var param in p) cmd.Parameters.Add(param);

        var queryLower = query.ToLowerInvariant();
        var matches = new List<ClipItem>();
        using var r = cmd.ExecuteReader();
        int fuzzyReadCount = 0;
        while (r.Read())
        {
            if ((++fuzzyReadCount & 63) == 0) ct.ThrowIfCancellationRequested();
            var item = ReadClip(r);
            var hay = (item.Text + " " + item.Preview + " " + item.Nickname + " " + (item.CustomTitle ?? "")).ToLowerInvariant();
            var words = hay.Split(new[] { ' ', '\n', '\t', '\r', '-', '/', '.', ',', ';', ':', '_', '\\', '#' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var w in words)
            {
                if (IsWithinOneEdit(queryLower, w))
                {
                    matches.Add(item);
                    break;
                }
            }
            if (matches.Count >= limit) break;
        }

        return matches;
    }

    public List<string> GetDistinctApps()
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT DISTINCT src_process FROM clips WHERE src_process IS NOT NULL AND TRIM(src_process) != '' AND LOWER(TRIM(src_process)) NOT IN ('clipboard','image','unknown','manual entry') ORDER BY src_process ASC";
            var apps = new List<string>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                apps.Add(r.GetString(0));
            }
            return apps;
        }
    }

    public CollectionCountsData GetCollectionCountsData()
    {
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            var result = new CollectionCountsData();

            // 1. Grouped counts strictly by custom collection (excluding NULL, empty, or 'all')
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT collection, COUNT(*) FROM clips WHERE collection IS NOT NULL AND collection != '' AND collection != 'all' GROUP BY collection";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    var col = r.GetString(0);
                    var count = r.GetInt32(1);
                    result.Collections[col] = count;
                }
            }

            // 2. Global system buckets in a single round-trip
            using (var cmdSys = conn.CreateCommand())
            {
                cmdSys.CommandText = @"
                    SELECT 
                        COUNT(*),
                        TOTAL(CASE WHEN favorite = 1 THEN 1 ELSE 0 END),
                        TOTAL(CASE WHEN use_count >= 1 THEN 1 ELSE 0 END),
                        TOTAL(CASE WHEN collection IS NULL OR collection = '' OR collection = 'all' THEN 1 ELSE 0 END)
                    FROM clips";
                using var rSys = cmdSys.ExecuteReader();
                if (rSys.Read())
                {
                    result.AllTotal = rSys.GetInt32(0);
                    result.Pins = (int)rSys.GetDouble(1);
                    result.MostUsed = (int)rSys.GetDouble(2);
                    result.AllUnorganized = (int)rSys.GetDouble(3);
                }
            }

            return result;
        }
    }

    public Dictionary<string, int> GetCollectionsWithCounts()
    {
        var data = GetCollectionCountsData();
        var dict = new Dictionary<string, int>(data.Collections, StringComparer.OrdinalIgnoreCase)
        {
            ["all_total"] = data.AllTotal,
            ["all_unorganized"] = data.AllUnorganized,
            ["pins"] = data.Pins,
            ["most_used"] = data.MostUsed
        };
        return dict;
    }

    public bool SetCollection(long id, string collection)
    {
        var target = string.IsNullOrWhiteSpace(collection) ? "all" : collection.Trim();
        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();

            if (!IsValidCollectionTarget(conn, target))
            {
                return false;
            }

            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE clips SET collection = $col WHERE id = $id";
            cmd.Parameters.AddWithValue("$col", target);
            cmd.Parameters.AddWithValue("$id", id);
            bool ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }

    public bool SetNickname(long id, string nickname)
    {
        var rawTags = (nickname ?? string.Empty).Split(new[] { ',', '，' }, StringSplitOptions.RemoveEmptyEntries);
        return SetTagsForClip(id, rawTags);
    }

    public bool UpdateText(long id, string newText)
    {
        newText = newText ?? string.Empty;
        var flat = newText.Replace("\r", " ").Replace("\n", " ").Trim();
        var preview = flat.Length <= 120 ? flat : string.Concat(flat.AsSpan(0, 120), "…");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(newText)));

        lock (_gate)
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                UPDATE clips
                SET text_content = $text,
                    preview = $prev,
                    content_hash = $hash,
                    rich_text = NULL
                WHERE id = $id
                """;
            cmd.Parameters.AddWithValue("$text", newText);
            cmd.Parameters.AddWithValue("$prev", preview);
            cmd.Parameters.AddWithValue("$hash", hash);
            cmd.Parameters.AddWithValue("$id", id);
            bool ok = cmd.ExecuteNonQuery() > 0;
            if (ok) BumpDataGeneration();
            return ok;
        }
    }
}
