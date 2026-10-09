# Architecture & Code Quality Audit: ui/js/list/actions.js

## 1. Module Purpose & Responsibilities
- `actions.js`: Executes high-level user actions on clips and application state.
- Key responsibilities:
  1. Clip lifecycle mutations: single and bulk deletion with 4-second undo toasts, pinning, favoriting, collection assignments, and paste-and-delete.
  2. Clip merging: concatenating multiple text clips, deleting originals, and creating a composite clip with full undo support.
  3. Context-menu transforms: uppercase, lowercase, title case, unwrap, slug, snake, camel, kebab, JSON pretty/minify, URL encode/decode, dedupe, sort, join comma.
  4. History clearing wizard: multi-faceted category selection (unpinned, images, pinned, favorites, individual collections) synchronized with `DatabaseService.ClearHistory`.
  5. Window resize interactions: multi-handle pointer event tracking delegating to Win32 non-client hit testing.

## 2. Dead Code & Safe Pruning Targets
- Fallback browser mock logic in `mergeSelectedClips()` (lines 548–574): In production DualClip runs embedded in WebView2 where `window.pywebview.api` is guaranteed. While useful for isolated browser mock testing, it introduces mock-only branches that could be gated or cleaned.
- Double exposure: Functions are assigned to both `window.*` directly and `window.DC.actions.*`. DualClip uses script tags without ES modules, so globals remain necessary until an explicit bundler or module system is used.

## 3. Performance & Memory Hotspots
- `mergeSelectedClips()` and `contextTransform()`:
  - Calls `Promise.all(clips.map(c => resolveFullClipText(c)))`. For large bulk selections of giant clips, fetching and copying megabytes into memory simultaneously can create GC pressure.
- `updateClearModalStats()`:
  - Calls `document.querySelectorAll('#clearScrollableList input[type="checkbox"]')` repeatedly inside event loops. Could cache selector references when the modal is opened.
- Undo Buffer Allocation in Bulk Delete (lines 331–354):
  - Uses `JSON.parse(JSON.stringify(item))` inside the loop for up to 25 items or 2MB budget. While the 2MB budget protects against runaway memory leaks, cloning via spread or shallow-clone of immutable properties would be faster than stringify/parse.

## 4. Code Duplication & Refactoring Targets
- `quickTogglePin` vs `quickToggleFavorite` vs `contextAction('pin')` / `contextAction('favorite')`:
  - The logic for multi-selection iteration, optimistic local update, backend RPC call, and override timestamp tracking (`pendingPinOverrides` / `pendingFavOverrides`) is duplicated almost identically across context menu handlers and quick row button handlers.
  - A unified `toggleClipProperty(property, targetState, optionalIndex)` helper would eliminate ~150 lines of repetitive boilerplate.

## 5. Critical Invariants (DO NOT TOUCH)
- **`setClipboardTextSafely(text)`**: Must route through `window.pywebview.api.set_clipboard_text` rather than direct `navigator.clipboard.writeText` so the backend listener suppresses capturing its own write via `SuppressNext()`. Bypassing this causes infinite loops where transformed text re-enters the clipboard as a new clip.
- **Bulk Merge Text Filter**: Must strictly filter out image clips (`!c.is_image`) before merging and preserve image clips in history.
- **Clear History Scope Predicates**: The checkbox mapping and `shouldKeep` filter in `executeClearHistory` must stay in exact 1:1 mathematical alignment with the SQL predicates in `DatabaseService.ClearHistory.cs`.

## 6. Prioritized Action Plan
- **Medium [COMPLETED]**: Consolidate `quickTogglePin`, `quickToggleFavorite`, and context pin/favorite into shared `toggleClipProperty` helper (shipped in Phase 2).
- **Low**: Cache DOM queries in `updateClearModalStats()` to minimize DOM traversal during modal interactions.
- **Low**: Standardize object copying in undo handlers away from `JSON.parse(JSON.stringify())`.
