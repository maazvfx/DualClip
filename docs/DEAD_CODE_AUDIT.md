# DualClip Dead-Code Audit

**Date:** 2026-10-10
**Commit audited:** `9a77a7e` (`fix(settings): use clean toast text for remember selected clip toggle`)
**Repo state:** working tree clean
**Method:** read-only static reference analysis across `ui/js/`, `ui/`, `*.cs`, `DualClip.Tests/`, `docs/`, `scripts/`, and repo root

> This file is an audit artifact. It has not been committed. Nothing in the codebase was
> modified to produce it.

---

## Scope Corrections

Initial raw line counts were inflated by `backup/` and `.obsidian/` directories, which are
untracked and gitignored. Actual audited source:

| Surface | Real size |
|---|---|
| `ui/index.html` | 1,904 lines (293 unique `id=` attrs) |
| `ui/css/` | 8 files, 8,215 lines |
| `ui/js/` | 26 files, ~19,000 lines |
| C# source | ~50 files, ~19,000 lines |
| `DualClip.Tests/` | 45 files, 248 `[Fact]`/`[Theory]` across 34 suites |
| Repo total | 1.16 GB, of which ~933 MB is build output |

### Confidence legend

- **[V]** — independently re-verified during this audit with a direct grep/inspection
- **[A]** — from sub-audit, cross-checked against at least one other source
- **[U]** — from sub-audit, not independently re-verified

---

# Category 1 — Safe to Remove Immediately (Zero Risk)

## 1.1 The 41-line unreachable block `[V]`

**`ui/js/core/state.js:1336-1376`**

```
1334:   setTimeout(_applyAndReveal, 120);
1335:   return;
1336:   // Refetch needed (extended sleep >5min or external DB change)
1337:   _needsRefetch = false;
1338:   selectedIndex = 0;
1339:   selectedIndices.clear();
```

Line 1335 is a bare `return;`. Line 1336 onward is the legacy "Refetch needed" path with its
own `selectedIndex = 0` / `selectedIndices.clear()` / `scrollTop = 0` resets, its own
`loadClipsFromBackend()` + `_wslAck()`, its own `_dcRevealWindow()` + `window_show_ack`, and
its own searchInput reset.

**Verified unreachable:** no label, `break`, or `try`/`catch` can reach 1336+.

**Corroborating evidence — the gate has no consumer.** `_needsRefetch` is write-only across
the entire codebase:

| Location | Operation |
|---|---|
| `ui/js/core/state.js:474` | declared |
| `ui/js/core/state.js:508` | set `true` (only writer) |
| `ui/js/core/state.js:1323` | set `false` |
| `ui/js/core/state.js:1337` | set `false` |
| — | **never read anywhere** |

**Origin.** Commit `3096335` ("fix(selection): eliminate jump flicker on reopen by latching
restore and reveal once") removed the `if (true) {` wrapper and hoisted the `return;`. The
block was already dead at its introduction (`43599a7a`) — the `if (true)` wrapper combined
with an unconditional trailing `return` made it unreachable from day one. `3096335` merely
made the deadness syntactically obvious.

`grep -r "if\s*\(\s*true\s*\)" ui/` → 0 hits. The wrapper is gone.

**Lines reclaimable: ~45**

---

## 1.2 Dead cluster — 6 un-emittable events → 25 lines of handlers → 1 flag `[V]`

The C# host emits exactly 13 event names. These `bridge.js` branches can never fire.

### Un-emittable bridge branches

| Location | Event | Evidence |
|---|---|---|
| `ui/js/core/bridge.js:35-36` | `onInvalidateHeight` | absent from all `*.cs` |
| `ui/js/core/bridge.js:37-38` | `onInvalidateClips` | absent from all `*.cs` |
| `ui/js/core/bridge.js:41` | `onPauseStateChanged` | absent — alias of the live `onPauseChanged` |
| `ui/js/core/bridge.js:45-46` | `open_edit_clip` | absent from all `*.cs` |
| `ui/js/core/bridge.js:47-48` | `onCyclePrev` | absent — `HotkeyAction` enum has `CycleNext`, no `CyclePrev` |
| `ui/js/core/bridge.js:49-50` | `onPasteNumbered` | absent from all `*.cs` |

### Their handlers

| Location | Function | Reachable via |
|---|---|---|
| `ui/js/keyboard.js:1096-1110` | `window.onCyclePrev` | dead `bridge.js:47` only |
| `ui/js/keyboard.js:1112-1121` | `window.onPasteNumbered` | dead `bridge.js:49` only |

The `dualclip_quick_number_paste` RPC is stored server-side
(`MainForm.RpcDispatch.cs:1765-1778`) but never acted upon and never emits the event.

### Their enabler

`ui/js/core/state.js:508` — `window.invalidateClips = function() { _needsRefetch = true; };`

Only caller is the dead `bridge.js:38`. This is the **only writer** of `_needsRefetch = true`,
so removing 1.1 + 1.2 together retires the `_needsRefetch` flag entirely.

**Lines reclaimable: ~35 (incl. flag retirement)**

---

## 1.3 Dead C# — verified independently `[V]`

| File | Item | Evidence | Lines |
|---|---|---|---|
| `Services/UrlCleaner.cs` | entire file | Only self-reference outside tests. Superseded by JS `cleanTrackingUrl()` at `ui/js/list/actions.js:318`, wired from `index.html:1268` `ctxCleanUrl` | 139 |
| `MainForm.cs:98` | `INPUT_MOUSE` | 1 hit (declaration) | — |
| `MainForm.cs:100` | `INPUT_HARDWARE` | 1 hit (declaration) | — |
| `MainForm.cs:103-111` | `MOUSEINPUT` struct | transitively dead | — |
| `MainForm.cs:124-129` | `HARDWAREINPUT` struct | transitively dead | — |
| `MainForm.cs:134,136` | `InputUnion.mi` / `.hi` | transitively dead | ~25 total |
| `MainForm.cs:187-188` | `DEFAULT_WINDOW_WIDTH/HEIGHT` | `WindowSizePolicy.DefaultWidth/Height` (`:31,:34`) own 970/730 | 2 |
| `Services/HotkeyService.cs:16` | `MOD_WIN` | 1 hit. (`MOD_SHIFT`/`MOD_ALT`/`MOD_CONTROL` live) | 1 |
| `Services/SearchConstants.cs:29` | `UiPageSize = 100` | 0 refs, unlike all 7 sibling constants | 1 |
| `Services/TrayService.cs:165` | `_currentTheme` | Written at `:169` (`SetTheme`), never read. `ApplyTheme` takes it as a parameter | 1 |

Only `INPUT_KEYBOARD` + `KEYBDINPUT` are ever constructed (`MainForm.cs:2172-2173`, for
`SimulatePaste`).

⚠️ **`GifCaptureTests.cs:73`** asserts on the literal source text
`"private const int DEFAULT_WINDOW_HEIGHT = 730;"`. Delete the constant **and** the
assertion in the same commit. The comment at `:76-78` already admits the hard-coded default
"lives on as the policy fallback" — i.e. the const is vestigial.

---

## 1.4 Zero-caller JS functions `[A]`

| Location | Function | Note |
|---|---|---|
| `ui/js/settings/settings-appearance.js:241-247` | `toggleRememberCollectionSetting` | ⚠️ see warning below |
| `ui/js/settings/settings-appearance.js:259-267` | `toggleTaskbarSetting` | ⚠️ see warning below |
| `ui/js/settings/settings-shortcuts.js:61-69` | `toggleSmartShortcutsSetting` | `#stSmartShortcutsToggle` queried at `settings-core.js:250` but absent from `index.html` |
| `ui/js/settings/settings-appearance.js:335-339` | `setDetailsLocked` | explicit no-op — "Clip details is permanently unlocked" |
| `ui/js/settings/settings-appearance.js:341-345` | `setAppSourceLocked` | same no-op |
| `ui/js/core/namespace.js:249` | `PROTOTYPE_COLLECTIONS` | comment: "zero third-party presets" |

### ⚠️ Two of these are feature regressions, not cleanup

- `toggleRememberCollectionSetting` is the **only writer** of `dualclip_remember_collection`.
  The setting is still *read* at `state.js:999`, `state.js:1172`, `settings-core.js:190`.
  If its settings row was removed from the UI, deleting this makes the setting permanently
  stuck at whatever `settings-core.js:190` last hydrated. **Confirm the row is intentionally gone.**
- `toggleTaskbarSetting` is the only UI path to `set_show_taskbar`. Deleting it removes the
  ability to toggle taskbar visibility.

### Dead constant and shim

| Location | Item | Evidence |
|---|---|---|
| `ui/js/settings/settings-shortcuts.js:315-321` + `:382` | `renderDirectMoveSettingsList` | self-documented: *"**Deprecated:** Direct Move section was removed… Kept as a safe shim."* Its only caller (`:382`) is immediately followed by `:383-385` calling `renderSettingsCollectionsList()` a **second time** — the shim causes a double render |
| `ui/js/settings/settings-shortcuts.js:324-326` | `HOTKEY_POP_GROUPS` | 3-line array, 1 hit (declaration) |

### Superseded inline `cycleSelection` fallbacks `[A]`

The canonical helper is `window.cycleSelection` at `ui/js/list/render.js:501-515`. Script order
in `index.html` guarantees it loads first (`render.js` at `:1879`, `keyboard.js` at `:1901`),
so each `else` arm can never execute:

| Location | Lines |
|---|---|
| `ui/js/keyboard.js:711-721` | 11 — arrow-key hold-session fallback |
| `ui/js/keyboard.js:1087-1093` | 7 — `onCycleNext` fallback |
| `ui/js/keyboard.js:1103-1109` | 7 — `onCyclePrev` fallback (file already dead per 1.2) |

These are **newer** code, not older — pre-`cycleSelection` implementations left behind when the
helper was extracted into `render.js`.

### Dead fallback under a live shim `[A]`

`ui/js/settings/settings-rules.js:34-51` — 18 lines. `toggleIncognitoSetting` (`:27`) tries
`window._coreToggleIncognito` first (`:30-33`). That is assigned unconditionally at
`core/state.js:563`, and `state.js` loads at `index.html:1878` *before* `settings-rules.js`
at `:1890`. The `coreFn` is therefore always truthy, making lines 34-51 unreachable.

Related: **two** `function toggleIncognitoSetting` declarations exist in the same global scope
— `core/state.js:517` and `settings/settings-rules.js:27`. `settings-rules.js:639` re-assigns
`window.toggleIncognitoSetting`, overwriting the `state.js:1409` export. Two shim layers for
one handler.

### Dead bridge probes `[A]`

`ui/js/core/bridge.js:250-253` defines `window.DC.bridge = { callHost, pendingCalls }` — only.
Two call sites probe for a method that does not exist:

- `ui/js/settings/settings-core.js:296-297` — `typeof window.DC.bridge.set_suppress_in_fullscreen === 'function'` → always false
- `ui/js/settings/settings-rules.js:78-79` — same probe

Both fall through to the `window.pywebview.api.set_suppress_in_fullscreen` branch
(`bridge.js:188`), which is real.

### Dead local `[A]`

`ui/js/list/filters-search.js:298` — `const mySeq = ++sourceAppRefreshSeq;` never read in
`refreshSourceAppFilterOptions` (`:294-379`). Vestige of a removed race guard. Delete `:292`
and `:298` together.

### Dead branch via hardcoded empty array `[A]`

`ui/js/settings/settings-appearance.js:374-379` — `const validStyles = [];` hardcoded empty,
so the `validStyles.includes(val)` guard at `:377` is always false and `:378` never runs. Only
`:376` (the `classList.remove` sweep) has effect.

---

## 1.5 Write-only globals — assigned, never read `[A]`

Scanned every top-level `var`/`let`/`const` (3,000+ candidates).

| Location | Symbol | Writes | Reads |
|---|---|---|---|
| `ui/js/core/namespace.js:474` | `hotkeyAbortHandler` | 1 | 0 |
| `ui/js/core/namespace.js:473` | `isRecordingHotkey` | 1 | 0 |
| `ui/js/core/namespace.js:477` | `isWindowDragging` | 1 | 0 |
| `ui/js/core/namespace.js:478` | `dragStartScreenX`, `dragStartScreenY` | 1 | 0 |
| `ui/js/core/namespace.js:479` | `dragStartWinX`, `dragStartWinY` | 1 | 0 |
| `ui/js/core/namespace.js:217` | `hoverTimer` | 1 | 0 |
| `ui/js/core/namespace.js:215`,`:226` | `hoverCardMode` | 2 | 0 |
| `ui/js/core/namespace.js:214`,`:225` | `hoverPreviewDelayMs` | 2 | 0 |
| `ui/js/core/namespace.js:178`,`:181` | `isHoverPreviewEnabled` | 2 | 0 |
| `ui/js/core/namespace.js:242-243` | `currentBaseWidth`, `currentBaseHeight` | 2 each | 0 |
| `ui/js/list/filters-search.js:292` | `sourceAppRefreshSeq` | 1 | 0 |
| `ui/js/overlays/tooltips-toasts.js:41-42`,`:149-150` | `lastTooltipMouseX/Y` | 2 each | 0 |
| `ui/js/settings/settings-appearance.js:333`,`:362` | `_densityPreviewInitDone` | 2 | 0 |
| `ui/js/settings/settings-shortcuts.js:550` + `settings-core.js:1058` | `currentSettingsSearchQuery` | 2 | 0 |
| `ui/js/settings/settings-appearance.js:337` | `window._detailsLocked` | 1 | 0 |
| `ui/js/overlays/modals.js:1693` | `window.__dcModalFocus` | 1 | 0 |
| `ui/js/settings/settings-appearance.js:135` + `settings-core.js:789` | `window.__deferredSizePreset` | 2 | 0 |

`namespace.js:473-479` is the entire window-drag refactor residue.

---

## 1.6 `__dcMark` boot instrumentation is a no-op sink `[A]`

```
ui/js/core/namespace.js:39   var detail = 'frontend boot ...'   <-- ASSIGNED, NEVER USED
ui/js/core/namespace.js:40   __dcBootMarks = [];                <-- data dropped on the floor
```

The header comment at `namespace.js:5-6` claims the table is *"flushed to app.log once at
ui_ready via `log_action`"* — **no `log_action` RPC exists.** Verified absent from
`bridge.js:95-244`, absent from `rpc-contracts.js`, absent from all `*.cs`.

**14 call sites discard the output:** `bridge.js:277`; `state.js:189,244,267,311,315`;
`namespace.js:530`; `render.js:777,1041,1080`; `filters-search.js:795`;
`keyboard.js:1354,1357,1441,1446`.

Supporting dead helpers: `__dcT0` (`namespace.js:12`), `__dcSince` (`namespace.js:16`).

⚠️ **KEEP** `window.__dcBootRealDone` / `__dcBootRealInFlight` (`state.js:337`, read at
`keyboard.js:1356`) — that is a live duplicate-fetch guard, not instrumentation.

---

## 1.7 Triplicated global error handlers `[A]`

Three independent `window.addEventListener('error'|'unhandledrejection')` registrations, all
of which only `console.error`:

1. `ui/index.html:20-35` (16 lines) — earliest, fires first
2. `ui/js/core/state.js:5-25` (21 lines) — comment at `:3` claims *"Forward uncaught JS errors
   to app.log"* but `:11` says *"Console only. No backend logging in release builds."* —
   **doc/impl contradiction**
3. `ui/js/core/bridge.js:255-271` (17 lines)

Every uncaught error is logged **3×**. No backend path exists in any of them. Keep one.

---

## 1.8 `window.DC.*` namespace facade is ~100% write-only `[A]`

The only property of `DC` ever *read* is `DC.bridge` — and its two readers are themselves
broken (see 1.4, "Dead bridge probes").

| Definition site | Namespace | Lines |
|---|---|---|
| `ui/js/core/namespace.js:512-529` | `DC.state` | 18 |
| `ui/js/core/state.js:1414-1422` | `DC.state = Object.assign(…)` | 9 |
| `ui/js/list/render.js:2435-2454` | `DC.render` | 20 |
| `ui/js/keyboard.js:1453-1457` | `DC.keyboard` | 5 |
| `ui/js/overlays.js:14-42` | `DC.overlays` | 29 |
| `ui/js/list/filters.js:11-15` | `DC.filters` | 5 |
| `ui/js/list/filters-collections.js:1499` + `filters-search.js:1316` | `DC.filtersCollections`, `DC.filtersSearch` | ~35 |
| `ui/js/list/actions.js:1326` | `DC.actions` | ~15 |
| `ui/js/settings/settings-rules.js:643-651` + `settings-storage.js:284-286` | `DC.settings` | ~12 |

**Test-harness caveat (verified):** `DualClip.Tests/js-harness/*.js` *stub* `DC: { state: {} }`
— they inject a fake, they do **not** read the production facade. `RpcContractInvariantTests.cs`
parses `rpc-contracts.js` **source text**, not `window.RpcContracts`. These are therefore also
safe to drop:

- `ui/js/core/rpc-contracts.js:203` `window.RpcContracts`, `:204` `window.buildRpcArgs`
- `ui/js/core/settings-defaults.js:161` `window.SETTING_DEFAULTS`
- `ui/js/settings/settings-appearance.js:743` `window.THEME_STYLES`
- `ui/js/settings/quick-view-menu.js:441` `window.QUICK_VIEW_MENU_CONFIG`

⚠️ **Keep `DC.bridge.callHost`** — it is the `rpc-contracts.js:196` fallback.

---

## 1.9 Dev scaffolding gated to an unreachable protocol `[A]`

`ui/js/overlays/milestones.js:389-396` guards on
`window.location.protocol === 'devtools:'`, which cannot occur in `file:` or `https:`. The 4
function bodies at `:322-357` are production-unreachable. The file's own comment says
*"MA-013: dev simulation functions must never be reachable in production builds."*

Note `devResetMilestoneState` (`:395`) flips real supporter state via RPC.

**Lines reclaimable: ~38**

---

## 1.10 Dead CSS `[A]`

| Location | Lines | Item |
|---|---|---|
| `ui/css/overlays-modals.css:1958-2058` | 101 | Whole `#editClipModal` block — modal not in `index.html`, never created by JS |
| `ui/css/overlays-modals.css:1106-1141` | 36 | Whole `#editClipTextarea` block (incl. light-theme scrollbar variants) |
| `ui/css/settings.css:1199-1220` | 22 | `.settings-row.locked`, `.notion-setting-row.locked`, `.managed-hint` — `locked` never applied (the no-ops in 1.4); `managed-hint` appears in zero HTML/JS |
| `ui/css/settings.css:260-278` | 19 | Legacy `.settings-row`, `.settings-row > div:first-child`, `.settings-row-desc` — HTML uses `.notion-setting-row` / `.setting-caption` |
| `ui/css/base-variables.css` | 54 | 10 custom properties declared but never `var()`-referenced |
| `ui/css/settings.css:1072-1086` | 15 | `.st-row > .st-select`, `.st-row > div:not(...)` — `.st-row` never in HTML |
| `ui/css/layout-chrome.css:370-376` | 7 | `@keyframes spinReload` + `.tb-btn.spinning svg` — `spinning` never added by JS |
| `ui/css/settings.css:735-739` | 5 | `.st-row > .st-toggle` — same |
| `ui/css/layout-chrome.css:253-256` | 4 | `@keyframes pulsePaused` — **unused keyframe**, 0 `animation:` refs |
| `ui/css/square-corners.css:14-16` | 3 | Empty rule (comment only) |

**Unused custom properties (10):** `--bg-surface`, `--border-chrome`, `--danger-solid`,
`--field-bg`, `--group-header-bg`, `--group-header-border`, `--group-header-text`,
`--hover-bg`, `--inset-bg`, `--text-strong`.

Note `--group-header-*` is re-declared in **all 10 theme blocks** yet the `.group-header` rules
use `--bg-card`/`--border` instead.

**Used but never defined (6, all have fallbacks → cosmetic only):** `--accent-light`,
`--accent-subtle`, `--bg-dropdown`, `--card-hover`, `--text-highlight`, `--text-main`.

**Dead class selectors (5 names):** `.tb-btn.spinning`, `.style-pill`
(`layout-chrome.css:519,520,529,530,533,534` — `render.js:1723` only emits
`style-plain`/`style-blue`/`style-gray`), `.settings-row`, `.settings-row-desc`,
`.managed-hint`, `.st-row`.

**Lines reclaimable: ~280**

---

# Category 2 — Obsolete / Legacy Architectural Remnants

## 2.1 The `pywebview` shim — a Python-era namespace on a pure C# host `[A]`

`ui/js/core/bridge.js:95-243` defines `window.pywebview = { api: {...} }`, and **~200 call
sites across 15 JS files** call through it. There is no Python in this project.

**Verified:** no `ExecuteScriptAsync`, no `AddScriptToExecuteOnDocumentCreated`, no
`System.Web.WebBrowser`, no `AxInterop` anywhere in `*.cs`. WebView2 is the only host and no
dual-mode fallback path survives. The only `System.Web` usage is `UrlCleaner.cs:4`
(`HttpUtility.ParseQueryString`), which is itself dead.

Related residue: `bridge.js:275` `dispatchEvent(new Event('pywebviewready'))` and
`index.html:139` `class="… pywebview-drag-region"`.

**Risk:** low functionally (rename-only), high in diff surface. Do it as its own PR.

---

## 2.2 `write_debug_log` — self-declared temporary, still shipping `[A]`

`MainForm.RpcDispatch.cs:1980-1994`. The comment at `:1981-1982` reads:

> "TEMPORARY: image-row height calibration. Removed as soon as the constants in render.js are
> set from measured values."

It is **live** — called from `ui/js/core/namespace.js:47-50` — and appends to
`layout_debug.log` on every invocation.

**Removal set:** the dispatch case + `rpc-contracts.js:27` + the `namespace.js:47-50` shim.

---

## 2.3 `DemoDataSeeder` — dev CLI compiled into the shipping exe `[A]`

`Services/DemoDataSeeder.cs` — 348 lines, 17 `Console.WriteLine`. Reachable only via
`--seed-demo` / `--purge-demo` / `--rollback-demo` argv (`Program.cs:62-79`) — and it writes to
the **real user database**.

Consider gating behind `#if DEBUG` or moving to a separate project.

---

## 2.4 Backup-restore subsystem has no entry point `[A]`

| Location | Item | Lines |
|---|---|---|
| `Services/DatabaseService.Backup.cs:606-805` | `RestoreFromBackup` | 200 |
| `MainForm.cs:3539-3587` | `HandleRestoreBackupDialog` | 49 |
| — | `ListBackups` | 27 |
| — | `BackupFileInfo` | 8 |
| — | `LastRestoreError` | 1 |

**Verified: no `case "restore_backup"` exists** in the 122-case RPC switch. The subsystem is
guarded by 5 tests (`DataLifecycleInvariantTests.cs:56,93,107,122,148,163`).

**Lines reclaimable: ~285** as one coherent group.

---

## 2.5 22 orphaned RPC cases `[A]`

Dispatch (`MainForm.RpcDispatch.cs:57`) and `ui/js/core/rpc-contracts.js` are **perfectly
aligned at 122** — enforced by `RpcContractInvariantTests.cs`. But **22 dispatched cases have
zero callers anywhere in `ui/`** — mostly orphaned `get_*` read-backs whose settings screens
kept a localStorage mirror instead.

| # | RPC case | Dispatch | bridge.js | Note |
|---|---|---|---|---|
| 1 | `center_window` | `:1426` | `:133` | |
| 2 | `get_auto_sort_rules` | `:1228` | `:187` | |
| 3 | `get_autostart` | `:1038` | **none** | `rpc-contracts.js:87` comment admits "no caller" |
| 4 | `get_blocklist` | `:1188` | `:196` | |
| 5 | `get_capture_filters` | `:1160` | `:182` | |
| 6 | `get_capture_images` | `:1139` | `:180` | |
| 7 | `get_ignore_passwords` | `:1121` | `:178` | |
| 8 | `get_layout_preset` | `:1516` | `:146` | |
| 9 | `get_line_display` | `:1795` | `:242` | |
| 10 | `get_live_preview` | `:1668` | `:237` | |
| 11 | `get_quick_number_paste` | `:1777` | `:240` | |
| 12 | `get_restore_clipboard` | `:1717` | `:214` | |
| 13 | `get_smart_shortcuts` | `:1618` | `:193` | |
| 14 | `get_start_hidden` | `:1054` | `:150` | |
| 15 | `get_suppress_in_fullscreen` | `:1245` | `:189` | |
| 16 | `get_tags_for_clip` | `:638` | `:224` | UI uses `set_tags_for_clip`+`set_nickname` instead (`modals.js:1082-1089`) |
| 17 | `get_tray_position_mode` | `:1652` | `:206` | |
| 18 | `get_window_position_mode` | `:1635` | `:204` | |
| 19 | `reset_usage_stats` | `:1292` | `:211` | |
| 20 | `set_live_preview` | `:1656` | `:236` | setter exists, never called |
| 21 | `set_start_hidden` | `:1042` | `:149` | |
| 22 | `set_window_pos` | `:1414` | `:132` | |

**Lines reclaimable: ~330**

⚠️ **Removing any one requires deleting the matching `rpc-contracts.js` entry in the same
commit**, or `RpcContractInvariantTests.cs` fails.

### Three false positives — do NOT delete

- `get_tag_stats` (`:651`) — reachable via `bridge.js:228` → `get_all_tags_with_stats`
- `import_dropped_package` (`:1015`) / `import_package_base64` (`:1020`) — reachable via
  `drop-zone.js:129,149` `invokeHostImport(...)`
- `toggle_pin` (`:198`) — reachable via computed name `rpcMethod` at `actions.js:33,84`

---

## 2.6 Two near-duplicate search engines `[A]`

`Services/DatabaseService.Search.cs` (574 lines) vs `Services/DatabaseService.SearchOptimized.cs`
(693 lines) — **~480 lines of overlapping retrieval logic**.

**`SearchOptimized` is the live default path** (`Search.cs:86-89` → `GetClipsOptimizedAsync` →
`GetClipsOptimized`), so neither file is deletable. `GetClipsLegacy` survives solely via
`SearchOptimized.cs:544` and `SearchTokenizationTests.cs:107-124`.

Specific overlap:

| Concern | Legacy | Optimized |
|---|---|---|
| `BuildOptFilterWhere` / WHERE clause | `Search.cs:118-140` | `SearchOptimized.cs:58-90` |
| `nick:`/`tag:` scoped query parsing | `Search.cs:230-253` | `SearchOptimized.cs:594-628` |
| Fuzzy eligibility + tokenizer | inline at `Search.cs:295,428` | `IsFuzzyEligibleOpt`/`TokenizeHayOpt` `:37,:40` |

Both share `EscapeLike` (`:14`) and `IsWithinOneEdit` (`:18`). Also
`FuzzyMinLen` (`Search.cs:16`) and `FuzzyMinLenOpt` (`SearchOptimized.cs:35`) are two aliases
for `SearchConstants.FuzzyMinLen`.

**This is consolidation debt, not cleanup.** No line savings without a behavior-preserving
refactor.

---

## 2.7 Duplicated logic in the host `[A]`

| Duplication | Locations | Note |
|---|---|---|
| Window-size persistence | `MainForm.cs:410-438`, `MainForm.RpcDispatch.cs:1477-1496`, `MainForm.RpcDispatch.cs:1559-1574` | Implemented **3×**. `SaveCurrentWindowSize()` is canonical; `set_window_size` and `reset_window_size` each re-implement the `isCompact → CompactW/H else StandardW/H + WindowW/H + LastWindowW/H` write inline. **Highest-value extraction target.** |
| `ForceForegroundWindow` | `MainForm.cs:1132-1183` vs `MainForm.cs:2105-2159` | Two overloads (instance vs `static(IntPtr)`) with near-identical `AttachThreadInput` → `BringWindowToTop` → `SetForegroundWindow`. The `IntPtr` version additionally sweeps Win/Shift/Alt/Ctrl keyups — **behavior divergence** |
| GIF magic check | `MainForm.cs:2492-2497` `IsGifBytes` vs `ClipboardListener.cs:276-281` `IsGifHeader` | Byte-for-byte identical GIF87a/89a check. Obvious policy extraction, mirroring `SearchConstants`/`WindowSizePolicy` |
| `ClampSize` re-implementation | `MainForm.RpcDispatch.cs:1449-1451` | Uses a **different formula** (`curScreen.Width - EdgeMargin*2`) than `WindowPlacement.ClampSize` (`workingArea.Width`) — policy divergence, not just duplication |
| Magic bounds | `MainForm.RpcDispatch.cs:1680-1681` | Hardcoded `Width <= 1600 && Height <= 1200`; no policy class owns these |
| Default binding | `MainForm.RpcDispatch.cs:1080-1087` and `MainForm.cs:567-573` | Ctrl+Shift+V fallback hotkey written **twice**. `HotkeyTogglePolicy` owns debounce, not the default binding |

---

## 2.8 Test files pinning dead behavior `[A]`

| Test location | Pins | Action |
|---|---|---|
| `DualClip.Tests/GifCaptureTests.cs:73` | `Assert.Contains("private const int DEFAULT_WINDOW_HEIGHT = 730;", …)` — a **source-text grep pinning a dead constant** | delete const + assertion |
| `DualClip.Tests/UrlCleanerTests.cs` | entire file, 95 lines, 16 tests, all targeting 0-reference `UrlCleaner` | delete with `Services/UrlCleaner.cs` |
| `DualClip.Tests/RichTextCaptureTests.cs:50-89` | 3 tests pin `ClipboardListener.TryParseRichPayload` — 0 prod refs | delete `:50-89`; keep `:1-48` and `:91-150` (live `CopyRichText`) |
| `DualClip.Tests/StressAndEdgeTests.cs:140` | calls `UrlCleaner.CleanUrl` | delete with the above |
| `DualClip.Tests/DataLifecycleInvariantTests.cs:56,93,107,122,148,163` | `ListBackups` (test-only) and `RestoreFromBackup` (5 tests, prod-unreachable) | delete with 2.4 |
| `DualClip.Tests/RpcContractInvariantTests.cs:24-25` | `RpcContracts_CountsMatch` + direction checks **protect the 22 dead RPC cases from removal** | must be updated in lockstep with 2.5 |
| `DualClip.Tests/SearchTokenizationTests.cs:107-124` | calls `GetClipsLegacy` directly, bypassing the `GetClipsAsync` router | the only thing keeping the legacy routing branch honest |

---

# Category 3 — Questionable / Ambiguous

## 3.1 🔴 LIVE BUG: thumbnail size never persists `[V]`

**This is the only finding in the audit that is a functional defect rather than cleanup.**

| Location | Call | Guard |
|---|---|---|
| `ui/js/settings/settings-appearance.js:496` | `window.pywebview.api.set_thumb_size(normalized)` | `typeof … === 'function'` |
| `ui/js/settings/settings-core.js:334` | `window.pywebview.api.get_thumb_size()` | `typeof … === 'function'` |

**`grep thumb ui/js/core/bridge.js` → 0 hits.** Neither wrapper exists.

Both C# handlers are dispatched (`MainForm.RpcDispatch.cs:1799`, `:1813`) and both contracts
are declared (`ui/js/core/rpc-contracts.js:145-146`). Every guard is permanently false, so the
RPCs are unreachable.

The UI degrades gracefully to its localStorage mirror
(`settings-appearance.js:495` `localStorage.setItem('dualclip_thumb_size', …)`), so the setting
*appears* to work — but the host never learns the value, so anything reading it server-side
sees the default.

**Fix: add two wrappers to `ui/js/core/bridge.js`.** Not a deletion.

---

## 3.2 `ui/preview-*.html` ship to production `[V]`

`DualClip.csproj:27` is:

```xml
<Content Include="ui\**" CopyToOutputDirectory="PreserveNewest" CopyToPublishDirectory="PreserveNewest" />
```

These three files match the glob:

| Path | Bytes | Lines |
|---|---|---|
| `ui/preview-autosort.html` | 17,719 | 377 |
| `ui/preview-collection-rules.html` | 12,616 | 270 |
| `ui/preview-line-clamp.html` | 2,179 | 47 |

**Verified present in:** `bin/Debug/net10.0-windows/`, `bin/Release/net10.0-windows/win-x64/`,
`publish/win-x64/ui/`, `publish/singlefile-test/ui/`.

`installer/DualClip.iss:33` packages `..\publish\win-x64\*`, so these prototypes are
**installed into the shipped app**.

They are gitignored (`.gitignore:36` `ui/preview-*.html`), so they are invisible in a clean
checkout — a **reproducible-build hazard**: a fresh clone produces a build *without* them,
this machine produces one *with* them.

**Fix:** add `<Content Remove="ui\preview-*.html" />` to `DualClip.csproj`.

(Note: `publish/portable-clean/ui/` has 0 — that staging step already strips them;
`publish/win-x64/` does not.)

---

## 3.3 Dangling `search` settings tab `[A]`

`ui/js/keyboard.js:157` — `tabsList = ['behavior','theme','window','search','routing','storage','shortcuts']`
contains `'search'`, but **no `tabBtn_search` or `tabContent_search` exists** in `index.html`.
Ctrl+Tab cycling (`keyboard.js:163,170` → `settings-core.js:856,866`) lands on a non-existent tab.

---

## 3.4 Live settings rows missing from Settings search `[A]`

`ui/js/settings/settings-shortcuts.js:508-548` `SETTINGS_SEARCH_INDEX` omits four live rows:

| Row | Location | Symptom |
|---|---|---|
| `row_preview_font` | `index.html:696` — fully wired (`onchange="changePreviewFontSetting(this.value)"` at `:701`) | searching "Preview Font" returns nothing |
| `row_fullscreen_guard` | `index.html:484` | same |
| `row_screen_capture_protection` | `index.html:902` | same |
| `row_prevent_screen_capture` | `index.html:904` | same |

**This is a fix, not a deletion.**

---

## 3.5 `notifySettingSaved()` is an empty function `[V]`

```
ui/js/settings/settings-core.js:1266  function notifySettingSaved(rowId) {
ui/js/settings/settings-core.js:1267    // Silent persistence - no visual "Saved" badge or flash per user preference
ui/js/settings/settings-core.js:1268  }
```

Intentional per its comment. But ~40 call sites are consequently dead, and **46 element IDs are
queried in JS but absent from `index.html`** — orphaned JS for deleted settings rows:

`stWindowSizePresetSelect` (4 refs), `stTextPowerSelect` (4), `stRememberWindowSizeToggle` (2),
`stRememberSizeToggle` (2), `stUsedMarkerSelect` (2), `stLineDisplaySelect` (2),
`stLayoutPresetSelect` (2), `stLivePreviewToggle` (2), `stDragOutSelect`, `stSmartShortcutsToggle`,
`stTaskbarToggle`, `statsTopAppsList`, `statsReusedClipsList`, and ~33 more.

All are guarded, so they cause no runtime errors — roughly 500+ lines of unreachable logic.

---

## 3.6 Contradictory hover-preview defaults `[A]`

| Setting | `namespace.js` | `settings-defaults.js` |
|---|---|---|
| `dualclip_hover_mode` | default `'meta'` (`:215`) | default `'full'` (`:97`) |
| `dualclip_hover_delay` | default `1000` (`:225`) | default `200` |

Both symbols are write-only (see 1.5), so currently harmless — but they would bite if the
hover-preview feature is ever revived.

---

## 3.7 `optBoostFavs` never read `[A]`

`index.html:295` `optBoostFavs` has `onclick="toggleFavoritesBoost(this)"`, so the element is
live. But the sort logic at `ui/js/list/filters-search.js:138,144,150,164` reads only
`optFuzzySearch` and `optSortRecent`. `optBoostFavs` is never read by the sort path.

---

## 3.8 The `disabled` class has no CSS `[A]`

`ui/js/overlays/context-menus.js` toggles `disabled` via `classList`, but `grep disabled ui/css/`
returns 0 hits. Minor dead code.

---

## 3.9 Techically unreachable `window.chrome.webview` fallbacks `[A]`

Eight sites — `list/sidebar-layout.js:368`, `overlays/drop-zone.js:100,243`,
`keyboard.js:18`, `core/state.js:197,1254,1322`, plus `rpc-contracts.js:205` — contain
`else if (window.chrome && window.chrome.webview)`. `window.pywebview` is assigned
unconditionally at `bridge.js:95` before these scripts run, so the arms are unreachable.

Listed as defence-in-depth, not recommended for deletion. Delete only if the `pywebview`
alias is also removed (see 2.1).

**One genuine exception — DO NOT "simplify":** `namespace.js:47-51` has the same pattern, but
`write_debug_log` is **not** in the `bridge.js:95-244` `pywebview.api` shim, so that
`window.chrome.webview` arm actually fires. `MainForm.RpcDispatch.cs:1980` handles it.

---

# Category 4 — Repository-Level

## 4.1 Disk ledger

| Path | Files | Size | Reclaimable |
|---|---:|---:|---|
| `publish/` | 892 | 371.27 MB | build output |
| `bin/` | 499 | 260.15 MB | build output |
| `.git/objects` | 4,807 | 215.65 MB | via `git gc` |
| `DualClip.Tests/bin/` | 351 | 148.88 MB | build output |
| `dist/` | 3 | 137.21 MB | release artifacts |
| `obj/` + tests `obj/` | 97 | 15.32 MB | build output |
| `.obsidian/` | 27 | 10.18 MB | **confirm with user** |
| `backup/` | 124 | 0.69 MB | likely yes |
| **Repo total** | **6,927** | **1,162 MB** | **~933 MB** |

All build output is gitignored; **zero** build files are tracked by git. **No large binaries
are tracked** — only `assets/app.ico` (190 KB) and `assets/app-paused.ico` (119 KB).

---

## 4.2 `backup/` — premise corrected `[A]`

It is **not** two full app copies. There are **no `.cs`, `ui/js/`, `Services/`, or `Models/`
files anywhere under `backup/`**.

| Subdirectory | Files | Lines | KB |
|---|---:|---:|---:|
| `backup/DualClip_auxiliary_backup/` | 11 | 1,387 | 84.4 |
| `backup/DualClip_simplified_backup/` | 24 | 2,640 | 135.8 |
| `backup/DualClip_docs_backup/` | 59 | 4,408 | 359 |
| `backup/DualClip_agents_backup/` | 22 | 1,211 | 78.5 |
| `backup/DualClip_Docs/` | 7 | 576 | 50.6 |
| `backup/DualClip_Prompts/` | 1 | 25 | 2.6 |

- **Not referenced by build:** `DualClip.csproj:23-24` explicitly excludes it
  (`<Compile Remove="backup\**">`, `<None Remove="backup\**">`)
- **Not referenced by scripts/tests:** zero hits
- **Not tracked by git:** `git ls-files backup/` → empty
- **Gitignored:** `.gitignore:34`

### Its `js-harness/` is a stale partial snapshot, not a mirror

| File | Live | Backup | Identical |
|---|---:|---:|---|
| `auto-tier-invariants.js` | 9,201 B | 9,041 B | No |
| `format-detection-invariants.js` | 4,647 B | 4,641 B | No |
| `group-count-invariants.js` | 7,376 B | 7,376 B | Yes |
| `mode-switch-invariants.js` | 15,681 B | 13,179 B | No (2,502 B behind) |
| `pagination-invariants.js` | 8,868 B | 8,868 B | Yes |
| `rpc-bridge-invariants.js` | 11,265 B | 11,237 B | No |

**4 live harnesses missing from backup:** `about-links-invariants.js`,
`ui-bulk-invariants.js`, `ui-interaction-invariants.js`, `ui-navigation-invariants.js`.

**It is not a safe rollback target.**

### Notable content — not junk

- `backup/DualClip_simplified_backup/scripts/publish-release.ps1` is the **only copy in the
  repo** of the script documented at `docs/ARCHITECTURE.md:279`
- `backup/DualClip_agents_backup/queue/responses/` may contain prior agent run logs
- `backup/DualClip_auxiliary_backup/CODEMAP.md` is **byte-identical** to
  `backup/DualClip_simplified_backup/knowledge/CODEMAP.md` (both 12,119 B)
- `check-docs-freshness.ps1` exists in **3 divergent versions**

---

## 4.3 `prototypes/` `[A]`

| Path | Bytes | Lines |
|---|---:|---:|
| `prototypes/preview.html` | **0** | **0** — empty file, safe to delete outright |
| `prototypes/preview-current-badge.html` | 6,064 | 45 |
| `prototypes/preview-move-collection.html` | 8,152 | 149 |

Gitignored (`.gitignore:35`), excluded from build (`DualClip.csproj:23-24`), not referenced
anywhere. The latter two may be WIP design comps — **confirm before deleting.**

---

## 4.4 `.obsidian/` — confirm with user `[A]`

27 files, 10.18 MB. **Not tracked by git** (`.gitignore:37`). **Does NOT ship in the build** —
`DualClip.csproj` includes only the two `.ico` files and `ui\**`.

- **Only 2 of 5 plugin folders are enabled** (`community-plugins.json`): `templater-obsidian`,
  `dataview`
- Present but disabled: `obsidian-kanban` (967.5 KB), `obsidian-projects` (975.9 KB),
  `make-md` (5,610.3 KB)
- `make-md/main.js` (5.6 MB) + `dataview/main.js` (2.3 MB) = **~7.9 MB (78%)**
- **This is not a vault** — there are no `.md` notes at repo root
- `.obsidian/workspace.json:14` references `docs/current_prompt.md`, **which does not exist**
  (only `docs/prompt.md`) — leftover session config from when the repo folder was opened as
  a vault

Deleting the 3 disabled plugin folders alone reclaims ~7.5 MB.

---

## 4.5 `scripts/check-docs-freshness.ps1` is a green lie `[V]`

Ran it directly. Output:

```
PS> powershell -File scripts\check-docs-freshness.ps1
No docs/wiki directory; nothing to lint.
EXITCODE=0
```

**Cause:** `check-docs-freshness.ps1:40` sets `$wikiDir = docs\wiki`, and lines 55-58
`exit 0` if missing. `docs/wiki/` does not exist — and `.gitignore:56` explicitly ignores it.

**All 5 advertised validations are unreachable:**

| # | Mode | Lines | Status |
|---|---|---|---|
| 1 | Link rot in `docs/wiki` | 52-124 | dead (early exit) |
| 2 | RPC surface drift | 126-185 | dead |
| 3 | Host event drift | 187-223 | dead |
| 4 | Test-suite count drift | 225-264 | dead |
| 5 | Sibling layer presence | 266-287 | dead |

Also **not wired into CI** — there is no `.github/`, no `.gitlab-ci.yml`, no CI file of any kind.

The only reference to it is `backup/DualClip_agents_backup/AGENTS.md:15`.

---

## 4.6 `docs/ARCHITECTURE.md` — claims vs. code `[A]`

**RPC surface: actually correct.** 122 contracts ↔ 122 handlers.

| Doc claim | Line | Reality |
|---|---|---|
| `export_collection` "still appears as a stub in `rpc-contracts.js` and `bridge.js`" | 168-170 | ❌ **False** — zero occurrences anywhere in `ui/` |
| Window group: `show`/`hide` | 163 | ⚠️ only `hide_window` exists; no `show_window` RPC (show path is local) |
| "~100 methods" | 20, 154 | ⚠️ actual: **122** |
| All other 32 named methods | 156-166 | ✅ all verified present |

### Wrong file/line references

| Doc ref | Reality |
|---|---|
| L45 `MainForm.cs:1111` (PermissionRequested→Deny) | actual **`MainForm.cs:1375`** |
| L149 "`MainForm.cs` handles inbound JSON with a large `switch`" | ❌ the switch is in **`MainForm.RpcDispatch.cs:57`** |
| L344-345 "update both `MainForm.cs` and `rpc-contracts.js`" | ❌ should be **`MainForm.RpcDispatch.cs`** |
| L91 `DatabaseService.cs:83` (`journal_mode=WAL`) | actual **`DatabaseService.cs:146`** |
| L69 `PathHelper.cs:52` (`DUALCLIP_DB_PATH`) | actual **51** |
| L139 `DatabaseService.Fts.cs:41` | ✅ correct |
| L53 `PathHelper.cs:16` (portable.dat) | ✅ correct |
| L26 "DatabaseService* … 6 partials" | ⚠️ 6 **files**, all `partial class` incl. the primary — really 5 partials + 1 primary |

### Stale claims

- L272 **"93 xUnit tests"** — actual **248** across **34** suites.
  (`docs/FULL_TEST_REPORT.md` says 280/280 — also inconsistent.)
- **L279 `powershell -File scripts/publish-release.ps1` — THIS SCRIPT DOES NOT EXIST.**
  `scripts/` contains only `check-docs-freshness.ps1`. The sole copy is in
  `backup/DualClip_simplified_backup/scripts/`. L290 also references
  `-ReleaseOutDir`/`-SkipInstaller` params of that missing script.
- L282 "runs `node -c` over every file in `ui/js`" — unverifiable, script absent

### Systematic link rot — 15 broken links in a tracked file

Every link in `ARCHITECTURE.md` is written as if the file sat at repo root
(`Services/PathHelper.cs`, `ui/js/core/rpc-contracts.js`, `README.md`, `MainForm.cs`) but the
file lives in `docs/`, so all 15 resolve to `docs/<path>` and fail. Need `../` prefixes.

`docs/FULL_TEST_REPORT.md:5` → `[prompt.md](../prompt.md)` is also broken: wrong path *and*
`docs/prompt.md` is gitignored (`.gitignore:59`), so it can never resolve in a fresh clone.

### Referenced-but-nonexistent

`docs/wiki/`, `docs/knowledge/`, `docs/STATE.md`, `docs/CODEMAP.md` — all referenced by
`check-docs-freshness.ps1` and `backup/.../AGENTS.md:15,19`; **none exist**; all gitignored
(`.gitignore:55-64`).

---

## 4.7 Root-level config gaps `[A]`

| Path | Status |
|---|---|
| `DualClip.csproj` | ✅ 42 lines, 3 PackageReferences |
| `DualClip.Tests/DualClip.Tests.csproj` | ✅ 34 lines |
| `README.md` | ✅ 51 lines, links resolve |
| `.gitignore` | ✅ 80 lines, well-organized, covers all cruft found |
| `app.manifest` | ✅ 687 B |
| **`package.json`** | ❌ **absent** — no declared scripts despite 10 Node harnesses |
| **`AGENTS.md`** | ❌ absent (and gitignored, `.gitignore:53`) |
| **`CLAUDE.md`** | ❌ absent (gitignored, `.gitignore:41`) |
| **`LICENSE`** | ❌ **absent** — `README.md:51` says "proprietary, all rights reserved" but there is no LICENSE file |
| `*.sln` | ❌ none — intentional, documented at `ARCHITECTURE.md:264` |
| `.gitattributes` | ❌ absent — no CRLF/LF normalization |
| `.editorconfig` | ❌ absent |
| `global.json` | ❌ absent — SDK version unpinned despite "Requires .NET 10 SDK" |
| CI | ❌ **none** |

### `.gitignore` issues

| Line | Issue |
|---|---|
| 53 | `AGENTS.md` ignored **globally** — will hide a nested `AGENTS.md` in any subfolder |
| 32-33 | `*.exe` and `*.zip` are global — would silently ignore a legitimately committed binary; prefer `dist/`, `release/**` |
| 55-65 | 11 `docs/` patterns — these are what make `check-docs-freshness.ps1` permanently inert |
| — | no generic `*.orig` / `*.rej` / `*.tmp` (only `settings.json.tmp`) |
| 78 | blank line orphans `publish/` into an unnamed trailing section (cosmetic) |

**Tracked file distribution (119 files):** `DualClip.Tests` 46 · `ui` 38 · `Services` 19 ·
`docs` 3 · `Models` 2 · `assets` 2 · root 9.

---

## 4.8 Git hygiene `[A]`

```
git status --short      → (clean)
git count-objects -vH   → count: 4767   size: 215.52 MiB
                          in-pack: 0     packs: 0
                          size-pack: 0 bytes
```

### Two issues

1. **`.git` is 100% loose objects, never packed.** 4,767 loose objects, `in-pack: 0`,
   `packs: 0`. `.git/objects/pack/` exists but is **empty**. A single `git gc --aggressive`
   typically reclaims **60-75%** of 215 MB → likely **~130-160 MB**, no data loss.

2. **Stale linked worktree registration:**
   ```
   $ git worktree list
   C:/Users/Maaz/Music/DualClip          9a77a7e [master]
   C:/Users/Maaz/Documents/DualClip-test 623363a [test-bench] prunable

   $ git worktree prune --dry-run -v
   Removing worktrees/DualClip-test: gitdir file points to non-existent location
   ```
   `C:\Users\Maaz\Documents\DualClip-test` does not exist.

### Build-output sub-item cruft

| Path | Size | Note |
|---|---|---|
| `publish/singlefile-test/` | 116.21 MB | one-off single-file publish experiment. `DualClip.csproj` has **no** `PublishSingleFile` property → **not reproducible from the csproj**. Superseded by `publish/portable-clean/` (commit `3193d6c`) |
| `publish/portable-clean/portable_data/` | — | **live runtime profile** left in staging: `data/clips.db`, `settings.json`, `clips_backup_*.db`, `clips_weekly_*.db`, and a full `webview2_profile/EBWebView/` Chromium profile (~300 files) |
| `dist/DualClip-v1.0.0-win-x64-portable.zip` | 49.88 MB | dated 2026-10-07, superseded by `DualClip-Portable-1.0.0.zip` (2026-10-09) |
| `release/docs/`, `release/installer/`, `release/portable/` | — | all **empty**; `release/` has no `.gitignore` entry |
| `sandbox_app/` | — | **completely empty** dir; referenced only by `backup/.../plans/standalone-sandbox-app.md` |

### Temp-file scan

Scanned the whole tree excluding `bin`, `obj`, `.git`, `publish`, `dist` for `*.log`, `*.bak`,
`*.tmp`, `*.orig`, `*.rej`, `Thumbs.db`, `.DS_Store`, `ehthumbs.db`, `Desktop.ini`.

**Result: ZERO matches.** Clean.

---

# Category 5 — Cleanup Plan

## Line estimate

| Category | Lines | Risk |
|---|---|---|
| **1. Safe now** | **~600** | none |
| **2. Legacy remnants** | ~1,400 | low–medium; 2.5 needs paired contract edits |
| **3. Ambiguous** | ~250 | investigate first; includes a live bug |
| **4. Disk (not lines)** | **~933 MB** | none |

---

## Phase 0 — no source changes (~933 MB)

1. `git gc --aggressive` → **~130-160 MB**. `.git` is 4,767 loose objects, zero packs.
2. `git worktree prune` → clears stale `Documents/DualClip-test` registration.
3. Delete `publish/singlefile-test/` (116 MB),
   `publish/portable-clean/portable_data/` (live Chromium profile + `clips.db`),
   superseded `dist/DualClip-v1.0.0-win-x64-portable.zip` (50 MB).
4. Delete `bin/`, `obj/`, `DualClip.Tests/{bin,obj,TestResults}/` (~424 MB).

---

## Phase 1 — zero-risk code (~600 lines, one commit each)

5. `ui/js/core/state.js:1336-1376` + the `_needsRefetch` flag
6. The 6-event dead cluster → `onCyclePrev`/`onPasteNumbered` → `window.invalidateClips`
7. `Services/UrlCleaner.cs` + `UrlCleanerTests.cs` + `StressAndEdgeTests.cs:140`;
   `MainForm.cs:98-136` interop structs; the 5 dead constants (**with** `GifCaptureTests.cs:73`)
8. 18 write-only globals + the `__dcMark` sink (**keep** `__dcBootRealInFlight`);
   `RichTextCaptureTests.cs:50-89`
9. Dead CSS blocks (~280 lines)
10. `write_debug_log` + `rpc-contracts.js:27` + `namespace.js:47-50`
11. 2 of 3 error handlers; the `DC.*` facade except `DC.bridge.callHost`

**After each commit run the full suite: 248 xUnit tests + 10 Node harnesses.**

---

## Phase 2 — structural (paired edits, one commit per RPC)

12. 22 orphaned RPC cases — each needs a same-commit `rpc-contracts.js` deletion or
    `RpcContractInvariantTests` fails.
13. `DualClip.csproj`: add `<Content Remove="ui\preview-*.html" />`
14. `check-docs-freshness.ps1` — retarget to `docs/` or delete. A no-op validator is worse
    than none.
15. `docs/ARCHITECTURE.md` — 15 broken links, 4 wrong file/line refs, "~100 methods" → 122,
    delete the `export_collection` note, fix/remove the `publish-release.ps1` instructions.

---

## Phase 3 — fixes, not cleanup

16. **Add the two `thumb_size` wrappers to `ui/js/core/bridge.js`** — live functional bug (§3.1)
17. Add the 4 missing rows to `SETTINGS_SEARCH_INDEX` (§3.4)
18. Remove the dangling `'search'` entry from `keyboard.js:157` tabsList (§3.3)
19. Add `LICENSE`; add `.gitattributes`; add `global.json` (SDK pin)

---

## Phase 4 — ask first

20. `backup/` — 124 files, 10.2k lines, fully untracked/ignored. Contains the only copy of
    `publish-release.ps1`. Archive outside the repo or keep one trimmed set. **Not a usable
    rollback** (stale, partial harnesses).
21. `.obsidian/` — 10.18 MB. Move outside the repo; the 3 disabled plugin folders alone are
    ~7.5 MB.
22. `prototypes/` — `preview.html` is 0 bytes (safe now); confirm the other two.

---

## Two structural notes

**Don't bundle the `pywebview` rename with anything.** It is the highest-value cleanup (it
removes a false claim about the architecture) but touches ~200 call sites across 15 files. Own
PR, tests green.

**The best-value work isn't deletion.** `DatabaseService.Backup.cs` and the window-size
persistence block in `MainForm.cs:410` are live but triplicated. The codebase has already
established the pure-policy pattern (`WindowSizePolicy`, `WindowPlacement`, `HotkeyTogglePolicy`,
`SearchConstants`). Collapsing the 3× size-persistence block and unifying the 2×
`ForceForegroundWindow` / `IsGifBytes`/`IsGifHeader` is where that pattern pays out.

---

## Caveats

- Line counts come from **static reference analysis**, not runtime tracing. Category 1 items
  are high-confidence (independently verified); Categories 2 and 3 rely more on sub-audit
  detail and should be spot-checked before deletion.
- `DualClip.Tests/RpcContractInvariantTests.cs` is the most likely source of unexpected
  failures during Phase 2 — it enforces exact count parity between the JS contract table and
  the C# dispatch switch.