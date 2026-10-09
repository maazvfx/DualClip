# Plan — Image Preview Size: Drop Large, Isolate Compact, Recalibrate Row Heights

Date: 2026-10-07
Scope: 6 files. Written per RULES.md "Mandatory Planning Gate".

## Verified facts (scanned, not assumed)
1. **Compact is NOT isolated today** — the user was right and my earlier claim was wrong.
   - The Compact preset applies the dense layout (`quick-view-menu.js:167,174`).
   - Dense layout varies BOTH the thumbnail and the row height by preview size:
     thumbnail 32/56/88 (`overlays-modals.css:632-637`), row 40/64/96
     (`overlays-modals.css:624-629`), and the JS mirrors it (`render.js:408-418`).
   - Mode switching deliberately preserves the chosen preview size
     (`quick-view-menu.js:181-184`), so a size picked in Standard leaks into Compact.
2. **Standard IS isolated** — `clip-list.css:1170-1172` is guarded by
   `html:not([data-layout-preset="compact"])`.
3. `getRowHeight` checks `density-dense` before `density-compact`
   (`render.js:405-437`), and the Compact preset sets dense — so the dense branch is the one
   that actually runs in Compact. `getThumbRowHeight`'s own compact branch (38/46) is only
   reachable when the dense class is absent, i.e. effectively dead for the layout preset.

## Step 1 — Remove "Large"
- `ui/index.html` — drop the option
- `ui/js/core/settings-defaults.js` — enum becomes `['sm','md']`
- `ui/js/settings/settings-appearance.js` — `setThumbSize` migrates a stored `'lg'` to `'sm'`
- `ui/js/list/render.js` — drop the `lg` branches (both row-height paths)
- `ui/css/clip-list.css`, `ui/css/overlays-modals.css` — drop the `lg` rules

## Step 2 — Isolate Compact
Compact always uses its own fixed small thumbnail and row height, unaffected by the setting.
- `ui/css/overlays-modals.css` — scope the dense thumb-size rules to
  `html:not([data-layout-preset="compact"])`
- `ui/js/list/render.js` — in the dense branch, return the fixed Compact values when the
  layout preset is compact, instead of reading the preview size

## Step 3 — Recalibrate row heights from measurement, not arithmetic
Hand-computing the image row heights from the stylesheet produced inconsistent results
(sm off by +1, md/lg by -1), so the numbers are not reliable by hand — the same trap that
produced a wrong fix earlier. Re-enable the height logger for one short run, read the true
values for Small and Medium, set the constants, then remove the logger again.

## Step 4 — Verification
- `node --check` on touched JS, `dotnet build --no-restore -warnaserror`.
- Core test filter, since removing `lg` and changing dense heights may affect
  `UiStaticInvariantTests` / `AutoTierInvariantTests`.
- Sync assets to `bin/Debug/net10.0-windows/ui/`.

## Pending user decision
The display names for the two remaining sizes were offered as options A-E; the choice is
still outstanding and is a branding decision, so it is not guessed here.