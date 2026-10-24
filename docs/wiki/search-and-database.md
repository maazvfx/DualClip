# Search Engine & SQLite Storage

## Overview
Database code is split into partial classes:

| File | Role |
| :--- | :--- |
| [`Services/DatabaseService.cs`](../../Services/DatabaseService.cs) | Schema, pragmas, insert/upsert, collections, clearing |
| [`Services/DatabaseService.Search.cs`](../../Services/DatabaseService.Search.cs) | Legacy `LIKE`-based search |
| [`Services/DatabaseService.SearchOptimized.cs`](../../Services/DatabaseService.SearchOptimized.cs) | Bounded-candidate optimized search (the live path) |
| [`Services/DatabaseService.Fts.cs`](../../Services/DatabaseService.Fts.cs) | FTS5 schema, triggers, backfill, availability probe |
| [`Services/DatabaseService.Tags.cs`](../../Services/DatabaseService.Tags.cs) | Tag tables and queries |
| [`Services/DatabaseService.Backup.cs`](../../Services/DatabaseService.Backup.cs) | Snapshots, integrity checks, restore |
| [`Services/SearchConstants.cs`](../../Services/SearchConstants.cs) | Collector caps and limits |
| [`Services/PathHelper.cs`](../../Services/PathHelper.cs) | Resolves the DB path |

---

## 💾 Connection Setup

One-time pragmas applied at init (`DatabaseService.cs:146`):
```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;
PRAGMA auto_vacuum=INCREMENTAL;
```

The database file is **`clips.db`**, not `DualClip.db`. Its location depends on portable mode and is documented in [settings-and-storage.md](settings-and-storage.md#storage-locations).

---

## 🔍 The optimized search path

`SearchOptimized` does **not** run one ranked query. It collects a bounded candidate ID set from several independent collectors, unions them, then ranks. Every collector is capped by a `SearchConstants` limit so a pathological query cannot scan the whole table.

### Collectors (all capped)

| Collector | Query shape | Cap |
| :--- | :--- | :--- |
| Single-char fast path | `LIKE '%q%'` across `text_content`, `preview`, `nickname`, `custom_title`, `src_title`, `src_process` | `SubstringCollectorLimit` (500) |
| Pinned/favorite union | `pinned = 1 OR favorite = 1` ordered by `sort_rank DESC, id DESC` | 500, then `MaxFetchCap` |
| Nickname exact | `nickname = $v COLLATE NOCASE` | `NicknameExactLimit` |
| Nickname prefix | `nickname LIKE 'v%' COLLATE NOCASE` | `PrefixCollectorLimit` (100) |
| Text prefix | `text_content LIKE 'v%'` | `PrefixCollectorLimit` (100) |
| FTS5 | `"tok"* AND "tok"*` joined | `SubstringCollectorLimit` |
| Substring AND union | one `%token%` condition per word | `SubstringCollectorLimit` |

**Why the pinned union exists**: legacy `ORDER BY` surfaces pinned rows first on broad queries, but capped collectors alone would displace them. It is a separate union specifically to preserve that ordering.

### Query prefixes
Parsed inside the substring collector (`SearchOptimized.cs:598-608`):
- `nick:` / `nickname:` → `LOWER(nickname) LIKE ...`
- `tag:` / `tags:` → resolved against the **normalized tag tables**, deliberately *not* the nickname column, because nickname is a free-text label and not a reliable proxy for tag membership
- `type:image` / `type:text` → type filters

### SQL injection safety
`EscapeLike` doubles `\`, `%`, and `_` (`DatabaseService.Search.cs:14`), and every LIKE clause declares `ESCAPE '\'`. All values are bound parameters — never string-interpolated into SQL.

### Result order

The backend sets the order of search results, and the frontend shows them as returned.

- **Default:** most recently used first (`last_used_at`), then match score, then `sort_rank`, then newest. Use count does not affect search order. The "Most Used" collection still sorts by use count.
- **Boosts:** the frontend sends the order as the `sort` argument of `get_clips`: `default`, `pins`, `favorites`, or `pins_favorites`.
  - `pins`: pinned clips that have been used go first, in recent-use order. "Used" means `use_count >= 1` or `last_used_at > created_at`. An unused pinned clip is ordered like any other clip.
  - `favorites`: favorites go after the pinned group and before the rest.
- **Where it lives:** `FetchRankedOpt` in `DatabaseService.SearchOptimized.cs` for the optimized path, and `RecentFirstSearchOrderSql` in `DatabaseService.Search.cs` for the legacy path. Both must stay in step.
- **Browsing** (no query) is still ordered locally by `sortClipsForBrowsing` in `filters-search.js`.
- **Known gap:** the typo-tolerant fallback that runs on zero matches still orders by `pinned DESC` first. It does not use the recent-use order yet.

### FTS5
`DatabaseService.Fts.cs` creates `fts_clips` as an external-content FTS5 table over `clips` using `porter unicode61` with `prefix='2 3'`, kept in sync by insert/delete/update triggers.

- Availability is probed via `sqlite_compileoption_used('ENABLE_FTS5')`; on a build without FTS5 the table is simply never created and search falls back to `LIKE`.
- Backfill runs in batches of `FtsBackfillBatch` (2000) **outside** the DB gate, so it cannot block UI writes.
- `FtsStagingEnabled` is a staging kill-switch (default `true`); set `false` to keep a database completely free of FTS objects.
- `ResetAndRestartFtsAfterRestore()` must be called after a backup restore, since restored rows arrive without triggering index maintenance.

---

## 🗑 Retention

- `ClearHistory(...)` and `ClearHistoryAdvanced(...)` implement the destructive-delete checkbox matrix — see `ClearHistoryScopeTests`.
- `EnforceMaxClips` / `EnforceMaxClipsIfNeeded` cap history. The check is amortized and runs **during capture**, not only when the setting changes.
- `MaybeCreateWeeklySnapshot()` and `ShutdownMaintenance()` handle backup scheduling.

---

## 🧪 Invariant Tests
- `SearchScopeTests`, `SearchTokenizationTests`, `TagAndNicknameQueryTests`
- `AutoSortPatternTests`, `DataLifecycleInvariantTests`
- `MaxClipsEnforcementTests`, `DeduplicationTests`, `ExportImportOrderingTests`
- `js-harness/auto-tier-invariants.js`, `js-harness/pagination-invariants.js`

See [testing-matrix.md](testing-matrix.md) for the full list.