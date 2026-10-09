# Plan — Summon Stagger, Window Size Unification, Tag Colour, Recent Searches

Date: 2026-10-07
Evidence: `%APPDATA%\DualClip\layout_debug.log` (293 lines, measured on the user's machine).
Scope: ~12 files. Written per RULES.md "Mandatory Planning Gate (>6 Files)".

## Evidence summary (measured, not guessed)
- 36 `[WINDOW RESIZE]` vs 38 `[CACHE CLEAR]` — nearly 1:1. Every summon resizes the window,
  and `render.js:1846` -> `invalidateHeights()` -> `invalidateMeasuredHeights()` wipes the
  measured-height cache 150 ms later.
- Row heights are consistently under-estimated when clip details are visible:
  3-line real 104-106 vs guess 100; 2-line real 86 vs guess 84; short row real 31 vs guess 24.
- Worst recorded shift: 36 px in one frame; typical summon 6 px then 2 px.
- Intermittent because only the tall rows mismatch, and because the same row measures
  104 px at one window width and 106 px at another (summon animates 380 -> 960).

## Step 1 — Unify window size so switching views never resizes
History/Standard becomes 970x730, identical to Settings, so no resize (and therefore no
cache wipe) happens when moving between views.
- `Services/WindowSizePolicy.cs` — `DefaultWidth/Height`, `StandardWidth/Height`
- `Services/AppSettings.cs` — `WindowWidth/WindowHeight` defaults
- `MainForm.cs` — `DEFAULT_WINDOW_WIDTH/HEIGHT` and the startup `Width/Height`
- `ui/js/settings/settings-appearance.js` — `applyWindowSizePreset` default + reset toast
- `ui/js/list/actions.js` — reset-size toast text
- `ui/js/core/namespace.js` — `currentBaseWidth` seed

## Step 2 — Stop discarding measured row heights on resize (the real fix)
Keep `invalidateMeasuredHeights()` for genuine layout changes (line display, zoom,
density, thumb size) but do not call it from the plain window `resize` handler. The
existing self-correction pass still re-fits any row that measures wrong, and it now
updates the cache instead of being punished by a wipe.
- `ui/js/list/render.js` — resize handler keeps `invalidateUsableWidthCache()` only

## Step 3 — Correct the two measured height constants
- `ui/js/list/render.js` — `ROW_HEIGHT_AUTO_2` 84 -> 86, `ROW_HEIGHT_AUTO_3` 100 -> 106

## Step 4 — Titlebar double-click must not shrink Settings
`resetWindowSizeCurrentMode()` currently resets to the Standard size even while the
Settings view is open, which shrinks the window and overwrites the History size.
- `ui/js/settings/settings-appearance.js` — when `in-settings`, do not resize the shared
  window; just report that Settings has no separate size to reset.

## Step 5 — Drop the fixed "3 Lines" option, keep Auto
Auto already picks 1/2/3 lines per clip, and fixed 3 shares the same wrong constant.
- `ui/index.html` — remove the `3 Lines` option
- `ui/js/settings/settings-appearance.js` — `changeLineDisplay` allowed list drops `'3'`
  (an existing saved `'3'` migrates to `auto`)

## Step 6 — Tag display default must be Blue Accent Pill
The dropdown already offers Blue Accent Pill and shows it selected, but a fresh install
falls back to gray, and the defaults registry uses `badge`, a value nothing understands.
- `ui/js/core/settings-defaults.js` — `dualclip_label_style` def `pill`, values `pill|gray|plain`
- `ui/js/list/render.js` — fallback `'pill'`
- `ui/js/settings/settings-core.js` — both fallbacks `'pill'`

## Step 7 — Recent searches must not save every typing pause
`filters-search.js` saves the query on each 280 ms debounce, so "hello" becomes
he/hel/hell/hello. Save only on an explicit submit (Enter).
- `ui/js/list/filters-search.js` — remove the debounce save, keep the Enter save

## Step 8 — Verification, then cleanup
- `node --check` on every touched JS file.
- `dotnet build --no-restore -warnaserror` (0 errors / 0 warnings).
- Sync assets to `bin/Debug/net10.0-windows/ui/`.
- User tests. **Only after the user confirms the stagger is gone**, remove the debug
  logging (namespace.js `logLayoutDebug`, the `write_debug_log` RPC, its rpc-contract
  entry, and the four log call sites) and delete `layout_debug.log`.

## Out of scope
- Dense/Compact row heights were not measured on this machine; left untouched rather
  than guessed.
- `dualclip_meta_before_dense` legacy key left as is.