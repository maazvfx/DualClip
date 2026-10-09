# Architecture & Code Quality Audit: ui/js/list/filters-collections.js

## 1. Module Purpose & Responsibilities
- `filters-collections.js`: Manages user collections, pill navigation bar, drag-and-drop categorization, pill reordering, and backend count caching.
- Key responsibilities:
  1. Collection persistence: dual-layer synchronization between `localStorage` (`dualclip_custom_collections`) and SQLite via RPC `save_collection`, `delete_collection_def`, and `reassign_collection`.
  2. Tombstone tracking: deleted collection IDs tracked in `dualclip_deleted_collections` to prevent auto-sort rules from resurrecting purged buckets.
  3. Pill reordering and drag-and-drop: HTML5 drag-and-drop between clip cards and collection pills with optimistic UI updates and backend rollback on error.
  4. Backend count throttling: `maybeRefreshBackendColCounts()` throttles count queries (15-second cache window) with immediate invalidation on mutations.

## 2. Dead Code & Safe Pruning Targets
- Fallback mock branches: If `window.pywebview.api` is absent (such as opening `index.html` directly in a browser without WebView2), branches fall back to in-memory/localStorage mutations. While convenient for quick UI styling, these code paths add ~80 lines of duplicate mutation code.
- Retired collection ID checks: `const retired = ['work', 'personal', 'code', 'templates'];` (line 872) from older default presets could be migrated cleanly rather than continually checked on each render.

## 3. Performance & Memory Hotspots
- Repeated collection iteration during clip rendering: `getCollectionClipCount()` iterates through the entire `allClips` array in Javascript when backend counts are not yet populated.
- DOM rebuilding in `renderCollectionPills()`: Completely wipes and regenerates pill DOM nodes (`innerHTML = ''`) on each render instead of reconciling changed badge counts or active classes.

## 4. Code Duplication & Refactoring Targets
- Modal keydown handlers: `handleRenameCollectionKeydown` and `handleNewCollectionKeydown` both duplicate Enter-to-save and Escape-to-close handling with near-identical boilerplate.
- Collection reassignment during deletion: Lines 1342–1380 have two separate branches (backend RPC vs fallback loop) that duplicate optimistic clip property reassignment.

## 5. Critical Invariants (DO NOT TOUCH)
- **Tombstone Persistence (`isCollectionTombstoned`)**: Essential for preventing auto-sort rules or background clip ingest from recreating a deleted collection when clips with old tags are processed.
- **Optimistic Rollback on DnD Failures**: In `handleCollectionPillDrop()`, optimistic array mutations are stored in `prevCollections` map. If `window.pywebview.api.move_to_collection` rejects or fails, state is reverted back to `prevCollections`.
- **Active Collection Safety Guard (`selectCollection`)**: If an invalid/deleted collection ID is selected, it must fallback to `'all'` to prevent permanently empty views with unclickable state.

## 6. Prioritized Action Plan
- **Medium**: Refactor `renderCollectionPills()` to update badge text and active classes in-place rather than rebuilding the entire pill strip DOM on every state change.
- **Low**: Unify modal Enter/Escape key listeners into a general modal helper in `modals.js`.
- **Low**: Clean up legacy hardcoded collection ID checks once confirmed no users are running pre-1.0 schemas.
