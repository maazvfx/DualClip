# Phase 2 & 3: Remaining Cleanup & Hardening Journal

**Date Completed:** 2026-10-10  
**Baseline Tests:** 280/280 xUnit passing (100%), 9/9 Node invariants passing.  
**Auditing Source:** [`docs/DEAD_CODE_AUDIT.md`](../DEAD_CODE_AUDIT.md)

---

## Completed Items & Verification

### 1. Build Output Sanitization (`DualClip.csproj`)
- **What Was Done:** Added `<Content Remove="ui\preview-*.html" />` to `DualClip.csproj`.
- **Rationale:** Local experimental preview mockups (`preview-autosort.html`, `preview-collection-rules.html`, `preview-line-clamp.html`) were matching `<Content Include="ui\**" />` and shipping inside release builds / staging directories while being gitignored.
- **Verification:** Fresh builds no longer copy `preview-*.html` into output folders.

### 2. Live Bug Fix: Thumbnail Size Persistence Bridge (`ui/js/core/bridge.js`)
- **What Was Done:** Added `set_thumb_size: (size) => callHost('set_thumb_size', [size || 'sm'])` and `get_thumb_size: () => callHost('get_thumb_size', [])` to `window.pywebview.api`.
- **Rationale:** Identified in audit §3.1. Settings called these RPCs guarded by `typeof ... === 'function'`, which previously evaluated to false, leaving persistence local-only and not communicating thumbnail preferences to the host.
- **Verification:** Both backend RPC handlers (`MainForm.RpcDispatch.cs:1799, 1813`) and JS bridge calls now connect 1:1.

### 3. Dangling Settings Tab Removal (`ui/js/keyboard.js`)
- **What Was Done:** Removed dead `'search'` tab from `tabsList` in `keyboard.js` (`['behavior', 'theme', 'window', 'routing', 'storage', 'shortcuts']`).
- **Rationale:** Tab navigation previously cycled into `'search'`, which had no corresponding button or panel in `index.html`.
- **Verification:** Keyboard navigation in settings cleanly cycles through existing tabs.

### 4. Settings Search Index Completeness (`ui/js/settings/settings-shortcuts.js`)
- **What Was Done:** Added 4 previously missing live settings rows into `SETTINGS_SEARCH_INDEX`:
  - `row_remember_selected_clip`
  - `row_fullscreen_guard`
  - `row_preview_font`
  - `row_prevent_screen_capture`
- **Rationale:** Users searching settings for "fullscreen guard", "preview font", "remember select", or "screen capture" could not locate those existing rows via the search input.
- **Verification:** All settings options now appear in the search results when queried.

### 5. Documentation Hygiene & Link Rot Fixes (`docs/ARCHITECTURE.md`)
- **What Was Done:**
  - Fixed 15 broken relative links (added `../` paths so files link correctly from `docs/`).
  - Corrected active JSON-RPC method count claim from "~100" to accurate "122".
  - Clarified dispatcher location to `MainForm.RpcDispatch.cs`.
  - Updated test count reference to 280 xUnit tests.
  - Removed outdated note regarding `export_collection`.
- **Verification:** All Markdown document references resolve correctly.

### 6. Repo Cleanliness & Object Pack (Phase 0)
- **What Was Done:**
  - Ran `git worktree prune` (cleared stale `Documents/DualClip-test` reference).
  - Purged obsolete build directories (`publish/singlefile-test/`, `publish/portable-clean/portable_data/`, and older zip in `dist/`).
  - Executed `git gc --aggressive` compressing 4,887 loose objects to packed storage (~144 MiB, reclaiming ~140+ MB).
- **Verification:** `git status` clean, git repository healthy.
