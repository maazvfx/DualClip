# Audit Report: Services/DatabaseService.cs

## 1. Module Purpose & Responsibilities
- **Primary Data Access Layer**: Encapsulates SQLite connection management, schema initialization, automatic column migrations (`is_image`, `sort_rank`, `use_count`, `custom_title`, etc.), and database health checks (`PRAGMA quick_check`).
- **Thread Safety & Data Versioning**: Enforces strict single-writer serialized access via the private lock `_gate`, and tracks database mutations using the atomic monotonic counter `DataGeneration`.
- **Clip Lifecycle & Maintenance**: Manages clip ingestion and deduplication (`AddOrBump`), retrieval and filtering (`GetClips`), usage tracking (`MarkUsed`), retention capping (`EnforceMaxClips`), and automatic orphan image garbage collection (`TryDeleteOrphanImageFile`).

---

## 2. Dead Code & Safe Pruning Targets
- **`ClearAll()` (Lines 812–815)**:
  - Trivially delegates to `ClearHistory(false, null)`.
  - Zero references in the entire solution, tests, or RPC bridge (`MainForm.RpcDispatch.cs`).
  - *Recommendation*: Safe to prune.
- **`GetClipsForCollectionExport(string collection)` (Lines 1742–1789)**:
  - Legacy single-collection export query.
  - Zero references across the entire codebase; completely superseded by `GetClipsForExport` (lines 1791–1862) which supports multi-collection, pinned, and favorite filters.
  - *Recommendation*: Safe to prune.

---

## 3. Performance & Memory Hotspots
- **Ad-Hoc Connection Instantiation vs. `OpenConnection()`**:
  - `OpenConnection()` (lines 110–136) contains a resilient 5-attempt retry loop with exponential backoff for `SQLITE_BUSY` (5) and `SQLITE_LOCKED` (6).
  - However, multiple methods (e.g. `ClearHistoryAdvanced`, `GetClipsForCollectionExport`, `ClearHistory`, `RestoreClip`) directly call `new SqliteConnection(_connectionString)` without the retry logic, making them susceptible to transient busy errors under disk contention.
- **Large Object Heap (LOH) Allocations in Bulk Reads**:
  - `ReadClip` materializes `text_content` and `thumbnail_data` into strings. For large clip histories or exports, reading hundreds of clips concurrently creates transient GC pressure.
- **Lock Contention on `_gate`**:
  - Because `_gate` is held across both write operations and long-running read operations (such as `GetClipsForExport`), export operations or large pagination reads can queue background clipboard capture threads on the `ClipboardListener`.

---

## 4. Code Duplication & Refactoring Targets
- **Connection Opening Boilerplate**:
  - Unify all internal database connections to use `OpenConnection()` to guarantee consistent pragmas (`busy_timeout=5000; foreign_keys=ON;`) and busy retries across all queries.
- **Safety Backup & Orphan Image Deletion Duplication**:
  - `ClearHistory` (lines 903–1020) and `ClearHistoryAdvanced` (lines 817–901) duplicate pre-clear safety backup invocation (`CreateBackup("pre_clear")`) and distinct image path collection for post-delete orphan cleanup. This can be factored into a shared deletion execution pipeline.

---

## 5. Critical Invariants (DO NOT TOUCH)
- **Monotonic `sort_rank` Assignment**:
  - Both `AddOrBump` and `MarkUsed` MUST assign `COALESCE((SELECT MAX(sort_rank) FROM clips), 0) + 1`. This monotonic sequence is the definitive tiebreaker for same-second captures and pastes across the application.
- **Atomic `_dataGeneration` Invalidation**:
  - Every mutating command (insert, update, delete, reorder) MUST call `BumpDataGeneration()` so frontend caches and background workers detect state mutations.
- **24-Hour Grace Period for Image Cleanup**:
  - `TryDeleteOrphanImageFile(path, force: false)` MUST enforce the 24-hour creation time check for single-clip deletions. This is essential for the Undo/Restore feature (`RestoreClip`) to recover recently deleted image clips.
- **Transaction Boundary & Mutex Lock**:
  - Never execute write queries without holding `lock (_gate)`. SQLite in WAL mode allows concurrent readers, but multi-threaded writes without serialization will trigger `SQLITE_BUSY` errors.

---

## 6. Prioritized Action Plan
- **High**: Standardize all database operations to route through `OpenConnection()` to eliminate unhandled `SQLITE_BUSY` crashes.
- **Medium [COMPLETED]**: Safely prune dead methods `ClearAll()` and `GetClipsForCollectionExport()` (shipped in Phase 1).
- **Low**: Investigate separating read-only queries from the write lock `_gate` where WAL mode guarantees safe non-blocking reads.
