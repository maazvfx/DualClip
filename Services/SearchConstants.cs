using System;

namespace DualClip.Services;

/// <summary>
/// Centralized constants for clip search, ranking, pagination, and budgets.
/// Modifying these bounds impacts latency, memory, or search recall.
/// Core philosophy — quality & recall over arbitrary millisecond targets:
/// NEVER shrink a candidate budget just to hit a latency number. A thorough,
/// accurate search at 100–150ms beats a clipped 20ms search that silently
/// drops valid clips. Correctness and recall always outrank raw speed.
/// </summary>
public static class SearchConstants
{
    /// <summary>
    /// Minimum word length required for fuzzy matching (Levenshtein distance <= 1).
    /// Words shorter than this are not fuzzy-scanned to prevent noise and excessive candidate expansion.
    /// </summary>
    public const int FuzzyMinLen = 4;

    /// <summary>
    /// Default limit of clips returned when limit is unspecified.
    /// </summary>
    public const int DefaultLimit = 150;

    /// <summary>
    /// UI fetch limit (mirrors frontend get_clips limit in state.js).
    /// </summary>
    public const int UiPageSize = 100;

    /// <summary>
    /// Ceiling clamp on requested clip limits across all queries.
    /// Prevents unbounded query allocations.
    /// </summary>
    public const int MaxClampedLimit = 500;

    /// <summary>
    /// Maximum candidate ID fetch budget across SQLite index searches.
    /// </summary>
    public const int MaxFetchCap = 5000;

    /// <summary>
    /// Candidate limit for single/multi-word substring matches and FTS collector.
    /// </summary>
    public const int SubstringCollectorLimit = 500;

    /// <summary>
    /// Collector budget for nickname exact matches.
    /// </summary>
    public const int NicknameExactLimit = 50;

    /// <summary>
    /// Collector budget for nickname / text prefix matches.
    /// </summary>
    public const int PrefixCollectorLimit = 100;

    /// <summary>
    /// Fetch limit for fallback linear scan when fuzzy matching is triggered.
    /// </summary>
    public const int FuzzyFallbackLimit = 200;
}
