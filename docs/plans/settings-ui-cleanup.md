# Plan — Settings UI Cleanup + Clip Details Default

Date: 2026-10-07
Scope: 8 files. Written per RULES.md "Mandatory Planning Gate (>6 Files)".

## 1. Collections empty state in sidebar
Problem: `renderSidebarNav()` renders the "Collections" section body from `customCollections`
only. With zero collections the body is empty — no message at all.
Fix: emit a muted placeholder when no valid collection exists, mirroring the existing
"No tags yet" pattern.
File: `ui/js/list/sidebar-layout.js` (inside `renderSidebarNav`, before the closing of
`#sidebarDynamicCollections`).

## 2. Remove `.exe` from Filter by App dropdown labels
Problem: `refreshSourceAppFilterOptions()` sets `opt.value = proc; opt.textContent = proc`,
so labels read "chrome.exe".
Fix: keep the raw name as the option value (the backend filters on the exact `src_process`
string) and strip a trailing `.exe` for display only.
File: `ui/js/list/filters-search.js`.

## 3. Remove the "Search & Display" tab
Problem: the tab holds a single card ("Search & List Organization") with a single row
(`row_grouping_mode`).
Fix:
- Move the `row_grouping_mode` row into the Appearance tab (`tabContent_theme`,
  Visual Appearance section).
- Delete `tabContent_search` and the `tabBtn_search` sidebar tab button.
- Repoint the settings search index entry to `tab: 'theme'`.
Files: `ui/index.html`, `ui/js/settings/settings-shortcuts.js`.
Note: `switchSettingsTab` is DOM-id driven, so no tab registry needs editing.

## 4. Clip Details default is not actually "hidden"
Problem: after a factory reset the app shows clip details even though the frontend default
is `hidden`. Root cause is a split default:
- `ui/js/core/settings-defaults.js:23` -> `hidden`
- `Services/AppSettings.cs:53` -> `"app-time"`  (this is what a reset produces)
- `ui/js/list/render.js:282` fallback -> `'app-time'`
- `ui/js/settings/quick-view-menu.js:80,304` -> `'app-time'`
Fix: align every fallback to `hidden`.
Files: `Services/AppSettings.cs`, `ui/js/list/render.js`, `ui/js/settings/quick-view-menu.js`.

Side benefit: the subtle summon stagger only appears when clip details are visible; with the
default corrected to `hidden` a fresh install opens in the stagger-free state.

## 5. Verification
- `node --check` on every touched JS file.
- `dotnet build --no-restore -warnaserror` (0 errors / 0 warnings).
- Copy touched assets into `bin/Debug/net10.0-windows/ui/`.
- Targeted manual check by the user: sidebar empty text, app dropdown labels, tab count,
  clip details hidden on first run.

## Out of scope (noted for the user, not fixed here)
- Residual stagger when the user explicitly turns clip details ON. The cause is a small
  mismatch between the JS row-height buckets (`ROW_HEIGHT_AUTO_1/2/3` = 65/84/100) and the
  real CSS height when the details line is present. Needs a real measurement in the running
  app to fix properly; not guessed here.