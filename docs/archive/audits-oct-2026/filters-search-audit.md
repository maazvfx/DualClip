# Architecture & Code Quality Audit: ui/js/list/filters-search.js

## 1. Module Purpose & Responsibilities
- `filters-search.js`: Powers search input parsing, full-text searching, client-side fuzzy matching fallback, filter dropdowns (types, timeframes, source applications, and tags), recent search history, and format detection (`getFormatTag`).
- Key responsibilities:
  1. Search Query Parser (`parseSearchQuery`): Extracts query operators (`from:`, `type:`, `pinned:`, `fav:`, `tag:`, `nick:`) from search strings.
  2. Format Tag Classifier (`getFormatTag`): Classifies clips as `TEXT`, `FILE`, `URL`, `COLOR`, `JSON`, `MD`, or `CODE` with 2KB sample limits to avoid ReDoS on megabyte-sized text.
  3. Filter Matrix State: Coordinates combinations of format types, source apps, time horizons, and sort modes (`relevance` vs `recent`).
  4. Search Debounce & Recent Search Auto-Save: 280ms debounce for live database search; strict 2000ms delay for saving non-empty search terms to localStorage.

## 2. Dead Code & Safe Pruning Targets
- Monkey-patched hooks at the end of the file (lines 1276–1290): Uses `setTimeout(..., 500)` and `setTimeout(..., 600)` to intercept `window.onWindowShow` and `window.onClipAdded` by monkey-patching globals. This should be cleanly integrated via explicit event listeners or standard lifecycle callbacks in `state.js`.
- Client-side fuzzy search (`isFuzzyMatch` & `isWithinOneTypo`): Damerau-Levenshtein 1-typo matching implemented in JS is mostly bypassed when backend SQLite FTS5/fuzzy matching is running. Retained for disconnected browser mock runs, but adds ~80 lines.

## 3. Performance & Memory Hotspots
- `collectFromAllClips()` in `refreshSourceAppFilterOptions()`:
  - Iterates every clip in `allClips`, parses `c.meta_json` strings on every clip where `src_process` is not top-level, and builds sets on each dropdown open. In histories with 5,000+ items, this causes noticeable main-thread jank when clicking the Filter button. Backend should deliver a cached `DISTINCT src_process` list.
- Format detection on unvirtualized items: `getFormatTag` runs regex tests across multiple programming languages. The 2KB cap (`sample.slice(0, 2048)`) protects against ReDoS, but runs repeatedly during client-side filtering passes.

## 4. Code Duplication & Refactoring Targets
- Dropdown synchronization: Both `filterAppSelect` and `filterTagSelect` use repeated checks for `syncCustomDropdown` vs `window.syncCustomDropdown`.
- Filter option updates: Grid rendering in `renderFilterOptionGrids()` and manual innerHTML concatenation in `renderActivePills()` duplicate badge formatting.

## 5. Critical Invariants (DO NOT TOUCH)
- **Search Sequence Token (`searchSeq`)**: Stale debounce guard (`if (mySeq !== searchSeq) return;`). Essential to prevent out-of-order backend responses from overwriting newer search results during fast typing.
- **2KB Windowing on `getFormatTag`**: Never run regex classification across unbounded clip text. Megabyte code clips will freeze the V8 UI thread without this slice guard.
- **Recent Search Cancelation on Abandon**: `cancelRecentSearchCapture()` must be invoked on clear, empty backspace, or Escape, so aborted typos are never permanently saved to user history.

## 6. Prioritized Action Plan
- **High**: Replace client-side `collectFromAllClips()` in `refreshSourceAppFilterOptions()` with a lightweight backend RPC (`get_source_apps`) or index-backed set to eliminate `JSON.parse` loops across large clip histories.
- **Medium**: Replace monkey-patched `window.onWindowShow` / `window.onClipAdded` timeouts with formal event dispatchers in `bridge.js` / `state.js`.
- **Low**: Clean up redundant custom dropdown synchronization checks.
