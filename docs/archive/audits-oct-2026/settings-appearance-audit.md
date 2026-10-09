# Architecture & Code Quality Audit: ui/js/settings/settings-appearance.js

## 1. Module Purpose & Responsibilities
- `settings-appearance.js`: Handles visual styling, window sizing presets, display density, and theming.
- Key responsibilities:
  1. Highlight Modes & Styles: Outline selection mode (`selection-outlined`), softened tint (`soften-tint`), row hover highlight, window border toggle (`data-window-border`), label style pill/plain.
  2. Window Geometry Presets: Size presets (`compact`: 360x260, `default`: 970x730), zoom scaling (`1.0x` to `1.25x`), and reset-to-default handlers.
  3. Window Anchor Positions: Coordinates `near`, `near_above`, `center`, and `last` positioning modes with backend Win32 screen clamping.
  4. Settings View Isolation: Prevents window resizing while Settings is active (`in-settings` class check) to preserve history geometry.

## 2. Dead Code & Safe Pruning Targets
- Backward-compatibility shims (lines 132–140):
  - `window.applySelectionHighlightMode`, `window.setSelectionHighlightMode`, `window.getSelectionHighlightMode`, `window.toggleSoftSelectionSetting`, `window.toggleSoftSelection`. Retained as aliases for older code, but can be cleaned up once references are consolidated.
- Redundant migration checks for defunct presets (`medium`, `tall`, `wide`, `ultrawide`, `large`).

## 3. Performance & Memory Hotspots
- Direct DOM attribute and class toggles: Very clean and efficient. Modifies classes at root document level (`documentElement.classList.toggle`) allowing CSS rules to cascade with minimal reflow.
- Notification badge triggers (`notifySettingSaved`): Spawns short-lived DOM flash elements on each toggle. Lightweight, but could be batched if multiple settings are set programmatically.

## 4. Code Duplication & Refactoring Targets
- Boolean setting toggles:
  - `applyOutlineSelectionSetting`, `applySoftenTintSetting`, `applyHoverHighlightSetting`, `applyHideWindowBorderSetting` all follow identical 20-line templates (get state $\rightarrow$ set localStorage $\rightarrow$ toggle class $\rightarrow$ update toggle button $\rightarrow$ notify).
  - Can be abstracted into a clean `createBooleanAppearanceSetting(storageKey, className, toggleBtnId, notifyKey)` factory.

## 5. Critical Invariants (DO NOT TOUCH)
- **Settings View Isolation (`inSettingsView`)**: When the user changes window size presets inside Settings, the window must NOT instantly resize while Settings is open. It must defer (`window.__deferredSizePreset`) and only apply when returning to the History list.
- **Canonical Size Constants (`970x730` & `360x260`)**: Keep exact alignment with `MainForm.Geometry.cs` and `WindowPlacement.cs`.
- **Both documentElement and body Class Toggling**: Toggling both ensures styles work consistently across shadow roots and standalone modals.

## 6. Prioritized Action Plan
- **Medium**: Replace duplicate appearance toggle functions with a shared appearance setting factory.
- **Low**: Deprecate legacy backward-compatibility shims (`applySelectionHighlightMode`, etc.).
- **Low**: Clean up obsolete preset migration code blocks.
