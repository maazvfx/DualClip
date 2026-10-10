# Phase 1: Dead Code Cleanup Journal & Changelog

**Date Started:** 2026-10-10  
**Baseline Tests:** 280/280 xUnit passing, 9/9 Node invariants passing.  
**Auditing Source:** [`docs/DEAD_CODE_AUDIT.md`](../DEAD_CODE_AUDIT.md)

---

## Completed Steps

### Step 1: Unreachable Post-Show Dead Block & `_needsRefetch` Retirement
- **Commit:** `416d154`
- **Files Modified:** `ui/js/core/state.js`
- **What Was Done:**
  - Removed 41 lines of unreachable legacy code in `onWindowShow` below `setTimeout(_applyAndReveal, 120); return;`.
  - Retired the dead write-only variable `_needsRefetch` and removed `window.invalidateClips`.
- **Verification:** Window show/hide, search autofocus, and clip list render normal.

### Step 2: Dead Bridge Events & Handlers
- **Commit:** `936428f`
- **Files Modified:** `ui/js/core/bridge.js`, `ui/js/keyboard.js`
- **What Was Done:**
  - Removed 6 un-emittable bridge event listeners: `onInvalidateHeight`, `onInvalidateClips`, `onPauseStateChanged` (alias), `open_edit_clip`, `onCyclePrev`, `onPasteNumbered`.
  - Removed unused handlers `window.onCyclePrev` and `window.onPasteNumbered` in `keyboard.js`.
- **Verification:** Forward cycling (`CycleNext`) and clipboard pause/resume work normally.

### Step 2.5: Hotkey Cycling Instant Responsiveness (Duct-Tape Method)
- **Commit:** `80f6653`
- **Files Modified:** `Services/HotkeyTogglePolicy.cs`, `ui/js/keyboard.js`, `DualClip.Tests/HotkeyTogglePolicyTests.cs`
- **What Was Done:**
  - In `HotkeyTogglePolicy.cs`, prioritized modifier-held cycling before the 350ms summon bounce delay check. Accidental dismiss protection remains active when modifiers are not held.
  - In `ui/js/keyboard.js`, removed the 250ms artificial sleep gate in `onCycleNext`.
  - Updated unit tests in `HotkeyTogglePolicyTests.cs`.
- **Verification:** 8/8 Hotkey tests pass; user confirmed summon + immediate cycle down is instant.

### Step 3: Dead Win32 Interop Structs & Obsolete UrlCleaner
- **Commit:** `fa55951`
- **Files Modified:** `MainForm.cs`, `Services/HotkeyService.cs`, `Services/SearchConstants.cs`, `Services/TrayService.cs`, `Services/UrlCleaner.cs` (deleted), `DualClip.Tests/UrlCleanerTests.cs` (deleted), `DualClip.Tests/StressAndEdgeTests.cs`
- **What Was Done:**
  - Removed unused Win32 mouse/hardware structs: `INPUT_MOUSE`, `INPUT_HARDWARE`, `MOUSEINPUT`, `HARDWAREINPUT`.
  - Removed dead constant `MOD_WIN` in `HotkeyService.cs`.
  - Removed dead constant `UiPageSize` in `SearchConstants.cs`.
  - Removed dead field `_currentTheme` in `TrayService.cs`.
  - Deleted obsolete `UrlCleaner.cs` (C# version had 0 callers; URL cleaning runs purely on frontend).
- **Verification:** 280/280 xUnit tests pass.

### Step 4: Write-Only Global Variables in JavaScript
- **Commit:** `605bad1`
- **Files Modified:** `ui/js/core/namespace.js`, `ui/js/overlays/tooltips-toasts.js`, `ui/js/settings/settings-appearance.js`, `ui/js/settings/settings-core.js`, `ui/js/settings/settings-shortcuts.js`
- **What Was Done:**
  - Deleted 18 global variables assigned but never read anywhere in the codebase (`isRecordingHotkey`, `hotkeyAbortHandler`, `isWindowDragging`, `dragStartScreenX/Y`, `dragStartWinX/Y`, `isHoverPreviewEnabled`, `hoverTimer`, `hoverCardMode`, `hoverPreviewDelayMs`, `currentBaseWidth`, `currentBaseHeight`, `lastTooltipMouseX/Y`, `_densityPreviewInitDone`, `currentSettingsSearchQuery`).
- **Verification:** Settings search and tooltips work cleanly.

### Step 5: Dead CSS Styles
- **Commit:** `9ad7720`
- **Files Modified:** `ui/css/overlays-modals.css`, `ui/css/layout-chrome.css`, `ui/css/settings.css`
- **What Was Done:**
  - Removed 171 lines of dead CSS:
    - Obsolete `#editClipModal` and `#editClipTextarea` styles (preview modal `#prevModal` handles clip editing).
    - Unused `@keyframes spinReload` and `.tb-btn.spinning` rules.
    - Unused `.settings-row.locked` and `.managed-hint` rules.
- **Verification:** Clip preview dialog and settings appearance render cleanly.

### Step 5.5: Fix Window Resize Drag Handles
- **Commit:** `193c9d4`
- **Files Modified:** `ui/js/list/actions.js`
- **What Was Done:**
  - Restored missing `attach()` call on `DOMContentLoaded` / immediate check inside `initWindowResizeHandles()`.
  - Allowed pointer down drag handles (`.dc-resize-edge`, `.dc-resize-corner`, `#resizeHandle`) to properly bind and call `start_resize`.
- **Verification:** User verified drag handle resizing works.

---

## Remaining Steps in Phase 1

- [ ] **Step 6**: Remove unused debug logger `write_debug_log` & dead bootstrap instrumentation sink (`__dcMark`).
- [ ] **Step 7**: Remove unused inline fallback helpers left over from old refactors.
