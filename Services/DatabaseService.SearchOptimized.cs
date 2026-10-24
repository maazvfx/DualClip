using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using DualClip.Models;
using Microsoft.Data.Sqlite;

namespace DualClip.Services;

// Optimized retrieval (Phases 2–3): candidate-first FTS5 + bounded LIKE union,
// in-memory ranking, fuzzy fallback when deduplicated hits < 5.
// Served via GetClipsAsync (default: OptimizedOnly).
// Legacy GetClipsLegacy is untouched.
public partial class DatabaseService
{
    public enum SearchMode { LegacyOnly, OptimizedOnly }

    // Default OptimizedOnly: the modern engine. LegacyOnly remains available for fallback.
    public SearchMode OptimizedSearchMode { get; set; } = SearchMode.OptimizedOnly;

    public sealed class OptimizedProfile
    {
        public long CollectMs;
        public int Candidates;
        public long RankMs;
        public int Ranked;
        public bool FuzzyFired;
        public long FuzzyMs;
        public int FuzzyAdded;
        public long TotalMs;
    }

    public OptimizedProfile? LastOptimizedProfile { get; private set; }

    private const int FuzzyMinLenOpt = SearchConstants.FuzzyMinLen;

    private static bool IsFuzzyEligibleOpt(string word) =>
        !string.IsNullOrEmpty(word) && word.Length >= FuzzyMinLenOpt;

    private static string[] TokenizeHayOpt(string hay) =>
        hay.Split(new[] { ' ', '\n', '\t', '\r', '-', '/', '.', ',', ';', ':', '_', '\\', '#', '(', ')', '[', ']', '{', '}', '"', '\'', '!', '?', '|', '*', '+', '=', '<', '>', '@' }, StringSplitOptions.RemoveEmptyEntries);

    private static bool WordsMatchFtsHeuristicOpt(ClipItem c, string qRaw)
    {
        var hay = (c.Text + " " + c.Preview + " " + c.Nickname).ToLowerInvariant();
        var words = qRaw.ToLowerInvariant().Split(new[] { ' ', '-', '/', '.', ':', '_', '\\', '#' }, StringSplitOptions.RemoveEmptyEntries);
        foreach (var w in words)
        {
            var token = w.Trim().ToLowerInvariant();
            if (token.Length == 0) continue;
            if (!hay.Contains(token)) return false;
        }
        return true;
    }

    // WHERE builder mirroring GetClips main-path semantics exactly
    // (pins/voice/most_used/collection, app LIKE, time windows, type classes).
    private static void BuildOptFilterWhere(string track, string collection, string filterType,
        string filterApp, string filterTime, string alias, List<string> where, List<SqliteParameter> p)
    {
        string c = string.IsNullOrEmpty(alias) ? "" : alias + ".";
        if (track == "pins" || track == "favorites" || collection == "pins" || collection == "favorites")
        {
            where.Add($"{c}favorite = 1");
        }
        else if (track == "voice" || collection == "transcriptions" || collection == "voice")
        {
            where.Add($"{c}track = 'voice'");
        }
        else if (collection == "most_used")
        {
            where.Add($"{c}use_count >= 1");
        }
        else if (!string.IsNullOrWhiteSpace(collection) && collection != "all")
        {
            where.Add($"{c}collection = $col");
            p.Add(new SqliteParameter("$col", collection));
        }

        if (!string.IsNullOrWhiteSpace(filterApp) && filterApp != "all")
        {
            where.Add($"LOWER({c}src_process) LIKE $app ESCAPE '\\'");
            p.Add(new SqliteParameter("$app", $"%{EscapeLike(filterApp.Trim().ToLowerInvariant())}%"));
        }

        if (!string.IsNullOrWhiteSpace(filterTime) && filterTime != "any")
        {
            long todayStart = new DateTimeOffset(DateTime.Today).ToUnixTimeSeconds();
            long yesterdayStart = todayStart - 86400;
            long weekStart = todayStart - (7 * 86400);
            long monthStart = todayStart - (30 * 86400);
            if (filterTime == "today") { where.Add($"{c}created_at >= $tToday"); p.Add(new SqliteParameter("$tToday", todayStart)); }
            else if (filterTime == "yesterday") { where.Add($"{c}created_at >= $tYest AND {c}created_at < $tToday"); p.Add(new SqliteParameter("$tYest", yesterdayStart)); p.Add(new SqliteParameter("$tToday", todayStart)); }
            else if (filterTime == "this_week" || filterTime == "7days" || filterTime == "last7days") { where.Add($"{c}created_at >= $tWeek"); p.Add(new SqliteParameter("$tWeek", weekStart)); }
            else if (filterTime == "30days" || filterTime == "last30days") { where.Add($"{c}created_at >= $tMonth"); p.Add(new SqliteParameter("$tMonth", monthStart)); }
            else if (filterTime == "older") { where.Add($"{c}created_at < $tYest"); p.Add(new SqliteParameter("$tYest", yesterdayStart)); }
        }

        if (!string.IsNullOrWhiteSpace(filterType) && filterType != "all")
        {
            var ft = filterType.Trim().ToLowerInvariant();
            if (ft == "image" || ft == "images") where.Add($"{c}is_image = 1");
            else if (ft == "url" || ft == "link" || ft == "links") where.Add($"{c}is_image = 0 AND (LOWER({c}text_content) LIKE 'http://%' OR LOWER({c}text_content) LIKE 'https://%' OR LOWER({c}text_content) LIKE 'www.%')");
            else if (ft == "json" || ft == "data") where.Add($"{c}is_image = 0 AND ((TRIM({c}text_content) LIKE '{{%' AND TRIM({c}text_content) LIKE '%}}') OR (TRIM({c}text_content) LIKE '[%' AND TRIM({c}text_content) LIKE '%]'))");
            else if (ft == "md" || ft == "markdown") where.Add($"{c}is_image = 0 AND (TRIM({c}text_content) LIKE '#%' OR TRIM({c}text_content) LIKE '- %' OR TRIM({c}text_content) LIKE '* %' OR TRIM({c}text_content) LIKE '+ %' OR TRIM({c}text_content) LIKE '>%' OR TRIM({c}text_content) LIKE '```%')");
            // Deliberately a SUPERSET of the frontend getFormatTag() classifier: SQL cannot
            // cheaply run the full regex ladder, so it over-selects and the frontend applies
            // exact label equality. Under-selecting here would hide rows the UI would accept,
            // which desynchronises offset pagination between the two layers.
            else if (ft == "code") where.Add($"{c}is_image = 0 AND ({c}text_content LIKE '%class %' OR {c}text_content LIKE '%class%{{' OR {c}text_content LIKE '%function%' OR {c}text_content LIKE '%var %' OR {c}text_content LIKE '%var %' OR {c}text_content LIKE '%let %' OR {c}text_content LIKE '%let %' OR {c}text_content LIKE '%const %' OR {c}text_content LIKE '%const %' OR {c}text_content LIKE '%import %' OR {c}text_content LIKE '%import %' OR {c}text_content LIKE '%def %' OR {c}text_content LIKE '%def %' OR {c}text_content LIKE '%namespace %' OR {c}text_content LIKE '%package %' OR {c}text_content LIKE '%#include%' OR {c}text_content LIKE '%using %' OR {c}text_content LIKE '%interface %' OR {c}text_content LIKE '%enum %' OR {c}text_content LIKE '%struct %' OR {c}text_content LIKE '%fn %' OR {c}text_content LIKE '%func %' OR {c}text_content LIKE '%public %' OR {c}text_content LIKE '%private %' OR {c}text_content LIKE '%static %' OR {c}text_content LIKE '%return %' OR LOWER({c}text_content) LIKE '%select %' OR LOWER({c}text_content) LIKE '%insert into%' OR LOWER({c}text_content) LIKE '%delete from%' OR LOWER({c}text_content) LIKE '%update %' OR LOWER({c}text_content) LIKE '%create table%' OR LOWER({c}text_content) LIKE '%<!doctype%' OR instr({c}text_content, '</') > 0)");
            else if (ft == "text") where.Add($"{c}is_image = 0");
        }
    }

    private void CollectIdsOpt(SqliteConnection conn, string innerSql, Dictionary<string, object?> parms,
        string track, string collection, string filterType, string filterApp, string filterTime,
        HashSet<long> outIds, int budget)
    {
        // Scope filters wrap the candidate query: id IN (inner) AND filters.
        // Correct regardless of the inner query's own LIMIT.
        var where = new List<string>();
        var p = new List<SqliteParameter>();
        BuildOptFilterWhere(track, collection, filterType, filterApp, filterTime, "c", where, p);
        string filterSql = where.Count == 0 ? "" : " AND " + string.Join(" AND ", where);
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT c.id FROM clips c WHERE c.id IN ({innerSql}){filterSql} LIMIT $budget;";
            foreach (var kv in parms) cmd.Parameters.AddWithValue(kv.Key, kv.Value ?? DBNull.Value);
            foreach (var fp in p)
            {
                try { cmd.Parameters.Add(fp); }
                catch { cmd.Parameters.AddWithValue(fp.ParameterName, fp.Value ?? DBNull.Value); }
            }
            cmd.Parameters.AddWithValue("$budget", budget);
            using var r = cmd.ExecuteReader();
            while (r.Read()) outIds.Add(r.GetInt64(0));
        }
        catch (SqliteException) { }
    }

    private void CollectFtsIdsOpt(SqliteConnection conn, string tokens, int budget,
        string track, string collection, string filterType, string filterApp, string filterTime,
        HashSet<long> outIds)
    {
        var where = new List<string>();
        var p = new List<SqliteParameter>();
        BuildOptFilterWhere(track, collection, filterType, filterApp, filterTime, "c", where, p);
        string filterSql = where.Count == 0 ? "" : " AND " + string.Join(" AND ", where);
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT f.rowid FROM fts_clips f JOIN clips c ON c.id = f.rowid WHERE f.fts_clips MATCH $q{filterSql} LIMIT $lim;";
            cmd.Parameters.AddWithValue("$q", tokens);
            cmd.Parameters.AddWithValue("$lim", budget);
            foreach (var fp in p)
            {
                try { cmd.Parameters.Add(fp); }
                catch { cmd.Parameters.AddWithValue(fp.ParameterName, fp.Value ?? DBNull.Value); }
            }
            using var r = cmd.ExecuteReader();
            while (r.Read() && outIds.Count < budget) outIds.Add(r.GetInt64(0));
        }
        catch (SqliteException) { /* FTS hiccup → LIKE/fuzzy paths cover recall */ }
    }

    private readonly struct CandidateProjection
    {
        public readonly long Id;
        public readonly string Text;
        public readonly string Preview;
        public readonly string Nickname;
        public readonly string Title;
        public readonly string App;
        public readonly string Tags;
        public readonly bool Pinned;
        public readonly bool Favorite;
        public readonly int SortRank;
        public readonly long CreatedAtUnix;
        public readonly long LastUsedAtUnix;
        public readonly int UseCount;
        public readonly string? CustomTitle;

        public CandidateProjection(long id, string text, string preview, string nickname, string title, string app, string tags, bool pinned, bool favorite, int sortRank, long createdAtUnix, long lastUsedAtUnix, int useCount, string? customTitle = null)
        {
            Id = id;
            Text = text;
            Preview = preview;
            Nickname = nickname;
            Title = title;
            App = app;
            Tags = tags;
            Pinned = pinned;
            Favorite = favorite;
            SortRank = sortRank;
            CreatedAtUnix = createdAtUnix;
            LastUsedAtUnix = lastUsedAtUnix;
            UseCount = useCount;
            CustomTitle = customTitle;
        }
    }

    // Relevance tiers (higher = more relevant). Exact matches and prefix matches
    // always rank above generic substring/word matches, so "Best Match" surfaces
    // the clip the user most likely meant at the top.
    //  100  nickname exact
    //   95  full text exact
    //   92  custom_title exact
    //   90  nickname prefix
    //   80  custom_title prefix
    //   75  text prefix
    //   50  all query words present (multi-field AND)
    //   40  tag name exact
    //   35  whole-word substring hit (query bounded by non-word chars in haystack)
    //   30  title/app/tag whole-word hit
    //   25  generic substring / all-words substring
    //   20  title/app/tag substring or all-words hit
    //   10  fuzzy (typo-tolerant) recall
    private int ScoreClipOpt(in CandidateProjection c, string qRaw, string exact, HashSet<long> fuzzyIds)
    {
        // Scoped prefixes (nick:/nickname:/tag:/tags:) are resolved to their VALUE by the
        // candidate collectors; the raw "nick:invoice" string matches no field, so scoring it
        // verbatim scored every collected row 0 and silently discarded the result. Score the
        // resolved terms instead, while keeping the raw string for non-scoped queries.
        var effective = ResolveScopedQueryTerms(qRaw, c);
        if (effective != null) return ScoreScopedOpt(in c, effective);

        if (!string.IsNullOrEmpty(c.Nickname) && string.Equals(c.Nickname, exact, StringComparison.OrdinalIgnoreCase)) return 100;
        if (!string.IsNullOrEmpty(c.Text) && string.Equals(c.Text.Trim(), qRaw, StringComparison.OrdinalIgnoreCase)) return 95;
        if (!string.IsNullOrEmpty(c.CustomTitle) && string.Equals(c.CustomTitle, exact, StringComparison.OrdinalIgnoreCase)) return 92;
        if (!string.IsNullOrEmpty(c.Nickname) && c.Nickname.StartsWith(exact, StringComparison.OrdinalIgnoreCase)) return 90;
        if (!string.IsNullOrEmpty(c.CustomTitle) && c.CustomTitle.StartsWith(exact, StringComparison.OrdinalIgnoreCase)) return 80;
        if (!string.IsNullOrEmpty(c.Text) && c.Text.StartsWith(qRaw, StringComparison.OrdinalIgnoreCase)) return 75;
        if (WordsMatchFtsHeuristicOpt(c.Text, c.Preview, c.Nickname, c.CustomTitle, qRaw)) return 50;
        var hay = (c.Text + " " + c.Preview + " " + c.Nickname + " " + (c.CustomTitle ?? "")).ToLowerInvariant();
        var qLow = qRaw.ToLowerInvariant();
        if (hay.Contains(qLow))
        {
            // Whole-word hit (query delimited by word boundaries) outranks a
            // mid-word substring: "cat" as the word "cat" beats "category".
            return IsWholeWordHit(hay, qLow) ? 35 : 25;
        }
        var words = qLow.Split(new[] { ' ', '-', '/', '.', ':', '_', '\\', '#' }, StringSplitOptions.RemoveEmptyEntries);
        if (words.Length > 0 && words.All(w => hay.Contains(w.Trim()))) return 25;
        // Extended fields (window title, app process, tag names) rank below
        // text/nickname matches by design.
        var extHay = (c.Title + " " + c.App + " " + c.Tags).ToLowerInvariant();
        if (!string.IsNullOrWhiteSpace(extHay))
        {
            var tagNames = c.Tags.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (tagNames.Any(t => string.Equals(t, qLow, StringComparison.OrdinalIgnoreCase))) return 40;
            if (extHay.Contains(qLow)) return IsWholeWordHit(extHay, qLow) ? 30 : 20;
            if (words.Length > 0 && words.All(w => extHay.Contains(w.Trim()))) return 20;
        }
        // Fuzzy-found candidates are legitimate recall: rank below literal
        // substring but NEVER exclude (quality-first: recall over precision).
        if (fuzzyIds.Contains(c.Id)) return 10;
        return 0;
    }

    /// <summary>
    /// Returns the resolved term(s) for a scoped query such as "nick:invoice" or
    /// "tag:work,urgent", or null when the query is not scoped and should be scored as-is.
    /// </summary>
    private static string[]? ResolveScopedQueryTerms(string qRaw, in CandidateProjection c)
    {
        if (string.IsNullOrWhiteSpace(qRaw)) return null;
        var tokens = qRaw.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var terms = new List<string>();
        bool anyScoped = false;

        foreach (var t in tokens)
        {
            var lower = t.ToLowerInvariant();
            if (lower.StartsWith("nick:") || lower.StartsWith("nickname:"))
            {
                anyScoped = true;
                var v = t.Substring(t.IndexOf(':') + 1).Trim().Trim('"');
                if (v.Length > 0) terms.Add(v);
            }
            else if (lower.StartsWith("tag:") || lower.StartsWith("tags:"))
            {
                anyScoped = true;
                var v = t.Substring(t.IndexOf(':') + 1).Trim().Trim('"');
                foreach (var sub in v.Split(new[] { ',', '，' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    var clean = sub.Trim();
                    if (clean.Length > 0) terms.Add(clean);
                }
            }
            else
            {
                terms.Add(t);
            }
        }

        return anyScoped && terms.Count > 0 ? terms.ToArray() : null;
    }

    /// <summary>
    /// Scores a scoped query against the fields the scope actually targets: nick:/nickname:
    /// against the nickname column, tag:/tags: against the clip's tag names. Mirrors the
    /// EXISTS clause the candidate collectors use, so scoring cannot disagree with selection.
    /// </summary>
    private static int ScoreScopedOpt(in CandidateProjection c, string[] terms)
    {
        string nick = c.Nickname ?? "";
        string tags = c.Tags ?? "";
        string hay = (nick + " " + tags).ToLowerInvariant();
        if (hay.Length == 0) return 0;

        // Every term must match, mirroring the collectors' AND semantics.
        foreach (var term in terms)
        {
            string needle = term.ToLowerInvariant();
            if (nick.IndexOf(needle, StringComparison.Ordinal) < 0 &&
                tags.IndexOf(needle, StringComparison.Ordinal) < 0)
            {
                return 0;
            }
        }

        // An exact nickname/tag hit ranks highest; containment below that.
        foreach (var term in terms)
        {
            if (string.Equals(nick.Trim(), term.Trim(), StringComparison.OrdinalIgnoreCase)) return 100;
        }
        foreach (var term in terms)
        {
            if (nick.Equals(term.Trim(), StringComparison.OrdinalIgnoreCase) ||
                tags.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Any(t => string.Equals(t, term.Trim(), StringComparison.OrdinalIgnoreCase)))
            {
                return 90;
            }
        }
        return 50;
    }

    // True when `needle` appears in `hay` bounded by non-alphanumeric chars on
    // both sides (i.e. a standalone word/token), rather than inside a larger word.
    private static bool IsWholeWordHit(string hay, string needle)
    {
        if (string.IsNullOrEmpty(needle)) return false;
        int from = 0;
        while (true)
        {
            int idx = hay.IndexOf(needle, from, StringComparison.Ordinal);
            if (idx < 0) return false;
            bool leftOk = idx == 0 || !char.IsLetterOrDigit(hay[idx - 1]);
            int end = idx + needle.Length;
            bool rightOk = end >= hay.Length || !char.IsLetterOrDigit(hay[end]);
            if (leftOk && rightOk) return true;
            from = idx + 1;
        }
    }

    private static bool WordsMatchFtsHeuristicOpt(string text, string preview, string nickname, string? customTitle, string qRaw)
    {
        var hay = (text + " " + preview + " " + nickname + " " + (customTitle ?? "")).ToLowerInvariant();
        var words = qRaw.ToLowerInvariant().Split(new[] { ' ', '-', '/', '.', ':', '_', '\\', '#' }, StringSplitOptions.RemoveEmptyEntries);
        foreach (var w in words)
        {
            var token = w.Trim().ToLowerInvariant();
            if (token.Length == 0) continue;
            if (!hay.Contains(token)) return false;
        }
        return true;
    }

    private List<ClipItem> FetchRankedOpt(SqliteConnection conn, HashSet<long> ids, string qRaw,
        HashSet<long> fuzzyIds, int lim, int off, string sort, CancellationToken ct = default)
    {
        var result = new List<ClipItem>();
        if (ids.Count == 0) return result;
        var idList = ids.Take(SearchConstants.MaxFetchCap).ToList();
        var inParams = new List<string>();
        var parms = new List<SqliteParameter>();
        for (int i = 0; i < idList.Count; i++) { var n = $"$id{i}"; inParams.Add(n); parms.Add(new SqliteParameter(n, idList[i])); }
        
        // Light-Projection: score on lightweight metadata only; do not load thumbnail_data or heavy text blobs
        var candidates = new List<(CandidateProjection, int)>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT c.id, c.text_content, c.preview, c.nickname, c.src_title, c.src_process, (SELECT GROUP_CONCAT(t.name, ' ') FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id), c.pinned, c.favorite, c.sort_rank, c.created_at, c.use_count, c.custom_title, c.last_used_at FROM clips c WHERE c.id IN (" + string.Join(",", inParams) + ")";
            foreach (var pm in parms) cmd.Parameters.Add(pm);
            using var r = cmd.ExecuteReader();
            int scanned = 0;
            while (r.Read())
            {
                if ((++scanned & 511) == 0) ct.ThrowIfCancellationRequested();
                long id = r.GetInt64(0);
                string text = r.IsDBNull(1) ? "" : r.GetString(1);
                string preview = r.IsDBNull(2) ? "" : r.GetString(2);
                string nickname = r.IsDBNull(3) ? "" : r.GetString(3);
                string title = r.IsDBNull(4) ? "" : r.GetString(4);
                string app = r.IsDBNull(5) ? "" : r.GetString(5);
                string tags = r.IsDBNull(6) ? "" : r.GetString(6);
                bool pinned = !r.IsDBNull(7) && r.GetInt64(7) == 1;
                bool favorite = !r.IsDBNull(8) && r.GetInt64(8) == 1;
                int sortRank = r.IsDBNull(9) ? 0 : (int)r.GetInt64(9);
                long createdAtUnix = r.IsDBNull(10) ? 0 : r.GetInt64(10);
                int useCount = r.IsDBNull(11) ? 0 : r.GetInt32(11);
                string? customTitle = r.IsDBNull(12) ? null : r.GetString(12);
                long lastUsedAtUnix = r.IsDBNull(13) ? 0 : r.GetInt64(13);

                var proj = new CandidateProjection(id, text, preview, nickname, title, app, tags, pinned, favorite, sortRank, createdAtUnix, lastUsedAtUnix, useCount, customTitle);
                int score = ScoreClipOpt(in proj, qRaw, qRaw, fuzzyIds);
                if (score > 0) candidates.Add((proj, score));
            }
        }

        // Ranking tuples. Default search ranks by recent use (last used first), then relevance,
        // sort rank, and creation time. The sort string may include "pins" and/or "favorites"
        // to boost pinned clips (only once they have been used) and favorited clips.
        // The explicit newest / oldest / most-used modes keep their own axes.
        bool boostPins = sort.Contains("pins", StringComparison.Ordinal);
        bool boostFavs = sort.Contains("favorites", StringComparison.Ordinal);
        IEnumerable<(CandidateProjection, int)> ordered = sort switch
        {
            "newest" or "recent" => candidates.OrderByDescending(x => x.Item1.Pinned).ThenByDescending(x => x.Item1.CreatedAtUnix).ThenByDescending(x => x.Item2).ThenByDescending(x => x.Item1.Id),
            "oldest" => candidates.OrderByDescending(x => x.Item1.Pinned).ThenBy(x => x.Item1.CreatedAtUnix).ThenByDescending(x => x.Item2).ThenBy(x => x.Item1.Id),
            "most_used" => candidates.OrderByDescending(x => x.Item1.Pinned).ThenByDescending(x => x.Item1.UseCount).ThenByDescending(x => x.Item1.LastUsedAtUnix).ThenByDescending(x => x.Item2).ThenByDescending(x => x.Item1.Id),
            _ => candidates.OrderByDescending(x => boostPins && x.Item1.Pinned && (x.Item1.UseCount >= 1 || x.Item1.LastUsedAtUnix > x.Item1.CreatedAtUnix))
                           .ThenByDescending(x => boostFavs && x.Item1.Favorite)
                           .ThenByDescending(x => x.Item1.LastUsedAtUnix)
                           .ThenByDescending(x => x.Item2)
                           .ThenByDescending(x => x.Item1.SortRank)
                           .ThenByDescending(x => x.Item1.CreatedAtUnix)
                           .ThenByDescending(x => x.Item1.Id),
        };

        var pageIds = ordered.Skip(off).Take(Math.Clamp(lim, 1, SearchConstants.MaxClampedLimit)).Select(x => x.Item1.Id).ToList();
        if (pageIds.Count == 0) return result;

        // Hydrate only the top visible page rows in deterministic ranked order
        var pageParamNames = new List<string>();
        var pageParms = new List<SqliteParameter>();
        for (int i = 0; i < pageIds.Count; i++)
        {
            var pName = $"$pid{i}";
            pageParamNames.Add(pName);
            pageParms.Add(new SqliteParameter(pName, pageIds[i]));
        }

        var pageMap = new Dictionary<long, ClipItem>();
        using (var hydrateCmd = conn.CreateCommand())
        {
            hydrateCmd.CommandText = "SELECT c.id, c.text_content, c.preview, c.pinned, c.track, c.src_process, c.src_title, c.created_at, c.last_used_at, c.use_count, c.collection, c.is_image, c.image_path, c.thumbnail_data, c.img_dims, c.img_size, c.favorite, c.nickname, c.sort_rank, (SELECT GROUP_CONCAT(t.name, ',') FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id), c.custom_title, c.rich_text FROM clips c WHERE c.id IN (" + string.Join(",", pageParamNames) + ")";
            foreach (var pm in pageParms) hydrateCmd.Parameters.Add(pm);
            using var rHydrate = hydrateCmd.ExecuteReader();
            while (rHydrate.Read())
            {
                var clip = ReadClip(rHydrate);
                pageMap[clip.Id] = clip;
            }
        }

        foreach (var pid in pageIds)
        {
            if (pageMap.TryGetValue(pid, out var item))
            {
                result.Add(item);
            }
        }
        return result;
    }

    // Streaming typo scan: matches stream in pinned/recency order until the match
    // cap is hit — the blind 200-ROW ceiling is gone; the bound is on matches.
    private HashSet<long> FuzzyScanIdsOpt(SqliteConnection conn, string[] words, string track,
        string collection, string filterType, string filterApp, string filterTime, int matchCap,
        CancellationToken ct = default)
    {
        var found = new HashSet<long>();
        var lowered = words.Select(w => w.ToLowerInvariant()).ToArray();
        var appFilter = (filterApp ?? "").Trim().ToLowerInvariant();
        var typeFilter = (filterType ?? "").Trim().ToLowerInvariant();
        bool filterCollection = !string.IsNullOrEmpty(collection) && collection != "all" && collection != "most_used";
        var colLower = filterCollection ? collection!.ToLowerInvariant() : "";
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, text_content, preview, nickname, track, src_process, collection, is_image, favorite, pinned, src_title, custom_title FROM clips ORDER BY pinned DESC, sort_rank DESC, id DESC";
        using var r = cmd.ExecuteReader();
        int scannedRows = 0;
        while (r.Read())
        {
            if ((++scannedRows & 1023) == 0) ct.ThrowIfCancellationRequested();
            long id = r.GetInt64(0);
            string text = r.IsDBNull(1) ? "" : r.GetString(1);
            string preview = r.IsDBNull(2) ? "" : r.GetString(2);
            string nickname = r.IsDBNull(3) ? "" : r.GetString(3);
            string rowTrack = r.IsDBNull(4) ? "" : r.GetString(4);
            string proc = r.IsDBNull(5) ? "" : r.GetString(5);
            string rowCol = r.IsDBNull(6) ? "all" : r.GetString(6);
            bool isImage = !r.IsDBNull(7) && r.GetInt64(7) == 1;
            bool favorite = !r.IsDBNull(8) && r.GetInt64(8) == 1;
            bool pinned = !r.IsDBNull(9) && r.GetInt64(9) == 1;
            string rowTitle = r.IsDBNull(10) ? "" : r.GetString(10);
            string customTitle = r.IsDBNull(11) ? "" : r.GetString(11);
            if ((track == "pins" || track == "favorites" || collection == "pins" || collection == "favorites") && !favorite) continue;
            else if (track == "voice" || collection == "transcriptions" || collection == "voice")
            {
                if (!string.Equals(rowTrack, "voice", StringComparison.OrdinalIgnoreCase)) continue;
            }
            else if (collection == "most_used")
            {
                continue; // use_count check needs extra query; most_used + typo is out of scope — covered by exact path
            }
            else if (filterCollection && (rowCol ?? "").ToLowerInvariant() != colLower) continue;
            if (appFilter.Length > 0 && appFilter != "all" && !(proc ?? "").ToLowerInvariant().Contains(appFilter)) continue;
            if (typeFilter == "image" && !isImage) continue;
            if (typeFilter.Length > 0 && typeFilter != "all" && typeFilter != "image" && isImage) continue;

            var hay = (text + "\n" + preview + "\n" + nickname + "\n" + customTitle + "\n" + rowTitle + "\n" + proc).ToLowerInvariant();
            bool allMatched = true;
            string[]? tokens = null;
            foreach (var w in lowered)
            {
                if (hay.Contains(w)) continue;
                if (!IsFuzzyEligibleOpt(w)) { allMatched = false; break; }
                tokens ??= TokenizeHayOpt(hay);
                bool wordMatched = false;
                foreach (var token in tokens)
                {
                    var t = token.Trim();
                    if (t.Length == 0 || Math.Abs(t.Length - w.Length) > 1) continue;
                    if (IsWithinOneEdit(w, t)) { wordMatched = true; break; }
                }
                if (!wordMatched) { allMatched = false; break; }
            }
            if (allMatched)
            {
                found.Add(id);
                if (found.Count >= matchCap) break;
            }
        }
        return found;
    }

    public List<ClipItem> GetClipsOptimized(string track = "all", string search = "",
        int limit = 150, int offset = 0, string collection = "all", string filterType = "all",
        string filterApp = "all", string filterTime = "any", string sort = "default", bool fuzzyEnabled = false,
        CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            using var conn = OpenConnection();
            var qRaw = (search ?? "").Trim();
                int lim = Math.Clamp(limit, 1, SearchConstants.MaxClampedLimit);
                int off = Math.Max(0, offset);

                if (qRaw.Length == 0)
                    return GetClipsLegacy(track, "", lim, off, collection, filterType, filterApp, filterTime, sort, fuzzyEnabled);

                var words = qRaw.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                var candidates = new HashSet<long>();
                var fuzzyIds = new HashSet<long>();

                if (words.Length == 1 && qRaw.Length == 1)
                {
                    var t1 = Stopwatch.StartNew();
                    CollectIdsOpt(conn, "SELECT id FROM clips WHERE (text_content LIKE $v ESCAPE '\\' OR preview LIKE $v ESCAPE '\\' OR nickname LIKE $v ESCAPE '\\' OR custom_title LIKE $v ESCAPE '\\' OR src_title LIKE $v ESCAPE '\\' OR src_process LIKE $v ESCAPE '\\') LIMIT $lim",
                        new Dictionary<string, object?> { ["$v"] = $"%{EscapeLike(qRaw)}%", ["$lim"] = SearchConstants.SubstringCollectorLimit },
                        track, collection, filterType, filterApp, filterTime, candidates, SearchConstants.SubstringCollectorLimit);
                    // Pinned/starred union: legacy ORDER BY surfaces pinned rows first on
                    // broad queries; capped collectors alone would displace them.
                    CollectIdsOpt(conn, "SELECT id FROM clips WHERE (pinned = 1 OR favorite = 1) ORDER BY sort_rank DESC, id DESC LIMIT $lim",
                        new Dictionary<string, object?> { ["$lim"] = SearchConstants.SubstringCollectorLimit },
                        track, collection, filterType, filterApp, filterTime, candidates, SearchConstants.MaxFetchCap);
                    t1.Stop();
                    var t2 = Stopwatch.StartNew();
                    var single = FetchRankedOpt(conn, candidates, qRaw, fuzzyIds, lim, off, sort, ct);
                    t2.Stop();
                    LastOptimizedProfile = new OptimizedProfile { CollectMs = t1.ElapsedMilliseconds, Candidates = candidates.Count, RankMs = t2.ElapsedMilliseconds, Ranked = single.Count, TotalMs = sw.ElapsedMilliseconds };
                    return single;
                }

                var tAll = Stopwatch.StartNew();

                var ftsWords = words.Where(w => w.Replace("\"", "").Any(char.IsLetterOrDigit)).ToArray();

                // A) Nickname exact + prefix (index-friendly, bounded).
                CollectIdsOpt(conn, "SELECT id FROM clips WHERE nickname = $v COLLATE NOCASE LIMIT $lim",
                    new Dictionary<string, object?> { ["$v"] = qRaw, ["$lim"] = SearchConstants.NicknameExactLimit },
                    track, collection, filterType, filterApp, filterTime, candidates, SearchConstants.MaxFetchCap);
                CollectIdsOpt(conn, "SELECT id FROM clips WHERE nickname LIKE $v COLLATE NOCASE ESCAPE '\\' LIMIT $lim",
                    new Dictionary<string, object?> { ["$v"] = EscapeLike(qRaw) + "%", ["$lim"] = SearchConstants.PrefixCollectorLimit },
                    track, collection, filterType, filterApp, filterTime, candidates, SearchConstants.MaxFetchCap);
                // B) Text prefix.
                CollectIdsOpt(conn, "SELECT id FROM clips WHERE text_content LIKE $v ESCAPE '\\' LIMIT $lim",
                    new Dictionary<string, object?> { ["$v"] = EscapeLike(qRaw) + "%", ["$lim"] = SearchConstants.PrefixCollectorLimit },
                    track, collection, filterType, filterApp, filterTime, candidates, SearchConstants.MaxFetchCap);
                // C) FTS candidates (bounded; skipped for punct-only queries).
                if (IsFtsReady() && ftsWords.Length == words.Length && ftsWords.Length > 0)
                {
                    string tokens = string.Join(" AND ", ftsWords.Select(t => "\"" + t.Replace("\"", "") + "\"*"));
                    CollectFtsIdsOpt(conn, tokens, SearchConstants.SubstringCollectorLimit, track, collection, filterType, filterApp, filterTime, candidates);
                }
                // D) Bounded substring union (single or multi-word AND, with tag support).
                {
                    var conds = new List<string>();
                    var parms = new Dictionary<string, object?>();
                    for (int i = 0; i < words.Length; i++)
                    {
                        var w = words[i];
                        var lower = w.ToLowerInvariant();
                        if (lower.StartsWith("nick:") || lower.StartsWith("nickname:"))
                        {
                            var nickVal = w.Substring(w.IndexOf(':') + 1).Trim().Trim('"');
                            var nickKey = $"$nick_{i}";
                            conds.Add($"LOWER(nickname) LIKE {nickKey} ESCAPE '\\'");
                            parms[nickKey] = $"%{EscapeLike(nickVal.ToLowerInvariant())}%";
                        }
                        else if (lower.StartsWith("tag:") || lower.StartsWith("tags:"))
                        {
                            // tag:/tags: resolve against the normalized tag tables, NOT the
                            // nickname column. Nickname is a free-text label and is not a
                            // reliable proxy for tag membership.
                            var tagVal = w.Substring(w.IndexOf(':') + 1).Trim().Trim('"');
                            var subTags = tagVal.Split(new[] { ',', '，' }, StringSplitOptions.RemoveEmptyEntries);
                            if (subTags.Length > 0)
                            {
                                for (int tIdx = 0; tIdx < subTags.Length; tIdx++)
                                {
                                    var subKey = $"$tag_{i}_{tIdx}";
                                    conds.Add($"EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = clips.id AND (t.name LIKE {subKey} ESCAPE '\\' OR t.normalized_name LIKE {subKey} ESCAPE '\\'))");
                                    parms[subKey] = $"%{EscapeLike(subTags[tIdx].Trim().ToLowerInvariant())}%";
                                }
                            }
                        }
                        else
                        {
                            conds.Add($"(text_content LIKE $w{i} ESCAPE '\\' OR preview LIKE $w{i} ESCAPE '\\' OR nickname LIKE $w{i} ESCAPE '\\' OR custom_title LIKE $w{i} ESCAPE '\\' OR src_title LIKE $w{i} ESCAPE '\\' OR src_process LIKE $w{i} ESCAPE '\\' OR EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = clips.id AND (t.name LIKE $w{i} ESCAPE '\\' OR t.normalized_name LIKE $wt{i} ESCAPE '\\')))");
                            parms[$"$w{i}"] = $"%{EscapeLike(words[i])}%";
                            parms[$"$wt{i}"] = $"%{EscapeLike(words[i].ToLowerInvariant())}%";
                        }
                    }
                    parms["$lim"] = SearchConstants.SubstringCollectorLimit;
                    if (conds.Count > 0)
                    {
                        CollectIdsOpt(conn, $"SELECT id FROM clips WHERE {string.Join(" AND ", conds)} LIMIT $lim", parms,
                            track, collection, filterType, filterApp, filterTime, candidates, SearchConstants.MaxFetchCap);
                    }
                }
                // Pinned/starred union: legacy ORDER BY surfaces pinned rows first on
                // broad queries; capped collectors alone would displace them
                // (recall-first: never lose a pinned hit to a budget cap).
                CollectIdsOpt(conn, "SELECT id FROM clips WHERE (pinned = 1 OR favorite = 1) ORDER BY sort_rank DESC, id DESC LIMIT $lim",
                    new Dictionary<string, object?> { ["$lim"] = SearchConstants.SubstringCollectorLimit },
                    track, collection, filterType, filterApp, filterTime, candidates, SearchConstants.MaxFetchCap);

                var tRank = Stopwatch.StartNew();
                ct.ThrowIfCancellationRequested();
                var ranked = FetchRankedOpt(conn, candidates, qRaw, fuzzyIds, lim, off, sort, ct);
                tRank.Stop();
                // Fuzzy quality gate: fires when fuzzyEnabled, candidate count is low (< 5), no code/digits,
                // and no high-confidence exact/prefix match (Score >= 75) already satisfied the query.
                bool hasStrongMatch = ranked.Any(c => !string.IsNullOrEmpty(c.Nickname) && c.Nickname.StartsWith(qRaw, StringComparison.OrdinalIgnoreCase) || !string.IsNullOrEmpty(c.CustomTitle) && c.CustomTitle.StartsWith(qRaw, StringComparison.OrdinalIgnoreCase) || !string.IsNullOrEmpty(c.Text) && c.Text.StartsWith(qRaw, StringComparison.OrdinalIgnoreCase));
                bool hasCodeOrDigits = qRaw.Any(char.IsDigit) || qRaw.Contains("->") || qRaw.Contains('{') || qRaw.Contains('}') || qRaw.Contains('$') || qRaw.Contains('\\') || qRaw.Contains('/');
                bool fuzzyFired = false;
                long fuzzyMs = 0;
                int fuzzyAdded = 0;
                if (fuzzyEnabled && !hasStrongMatch && ranked.Count < Math.Min(5, lim) && !hasCodeOrDigits && words.Any(w => w.Length >= FuzzyMinLenOpt))
                {
                    fuzzyFired = true;
                    var tF = Stopwatch.StartNew();
                    var extra = FuzzyScanIdsOpt(conn, words, track, collection, filterType, filterApp, filterTime, Math.Clamp(lim, 1, SearchConstants.MaxClampedLimit), ct);
                    tF.Stop();
                    fuzzyMs = tF.ElapsedMilliseconds;
                    if (extra.Count > 0)
                    {
                        foreach (var id in extra) candidates.Add(id);
                        foreach (var id in extra) fuzzyIds.Add(id);
                        fuzzyAdded = extra.Count;
                        var tR2 = Stopwatch.StartNew();
                        ranked = FetchRankedOpt(conn, candidates, qRaw, fuzzyIds, lim, off, sort, ct);
                        tR2.Stop();
                        tRank.Stop();
                        LastOptimizedProfile = new OptimizedProfile { CollectMs = tAll.ElapsedMilliseconds, Candidates = candidates.Count, RankMs = tRank.ElapsedMilliseconds + tR2.ElapsedMilliseconds, Ranked = ranked.Count, FuzzyFired = true, FuzzyMs = fuzzyMs, FuzzyAdded = fuzzyAdded, TotalMs = sw.ElapsedMilliseconds };
                        return ranked;
                    }
                }
            LastOptimizedProfile = new OptimizedProfile { CollectMs = tAll.ElapsedMilliseconds, Candidates = candidates.Count, RankMs = tRank.ElapsedMilliseconds, Ranked = ranked.Count, FuzzyFired = fuzzyFired, FuzzyMs = fuzzyMs, FuzzyAdded = fuzzyAdded, TotalMs = sw.ElapsedMilliseconds };
            return ranked;
        }
        finally { sw.Stop(); }
    }

    /// <summary>Background-worker entry point: runs the full optimized pipeline
    /// (collectors, ranking, gated fuzzy scan) on a thread-pool thread.
    /// Cooperative cancellation is checked between stages and inside the
    /// full-table fuzzy stream (every 1024 rows), so a superseded deep scan
    /// aborts within milliseconds instead of blocking the UI.</summary>
    public Task<List<ClipItem>> GetClipsOptimizedAsync(string track = "all", string search = "",
        int limit = 150, int offset = 0, string collection = "all", string filterType = "all",
        string filterApp = "all", string filterTime = "any", string sort = "default", bool fuzzyEnabled = false,
        CancellationToken ct = default)
    {
        return Task.Run(() => GetClipsOptimized(track, search, limit, offset, collection,
            filterType, filterApp, filterTime, sort, fuzzyEnabled, ct), ct);
    }
}
