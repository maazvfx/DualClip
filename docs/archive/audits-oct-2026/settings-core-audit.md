# Architecture & Code Quality Audit: ui/js/settings/settings-core.js

## 1. Module Purpose & Responsibilities
- `settings-core.js`: Manages configuration view switching, local persistence initialization, backend settings synchronization, hotkey capture recorder, and application behaviors (startup, incognito pause, size presets, window positioning, auto-updates).
- Key responsibilities:
  1. Instant Theme & Style Bootstrapping (`bootstrapThemeAndZoom`): Executes synchronously at page load to set root HTML attributes (`data-theme`, `data-used-marker`, `data-clip-details`) avoiding visual flashes before UI paint.
  2. Tabbed Settings Hub: Behavior, Theme/Appearance, Window/Geometry, Search, Routing/Auto-sort, Storage/Database, Shortcuts.
  3. Settings Synchronization (`syncSettingsUiFromStorage`): Reconciles localStorage keys with backend `AppSettings` via RPC (`get_remember_window_size`, `get_hotkey`, `get_blocklist`, etc.).
  4. Interactive Hotkey Recorder: Captures modifier combinations (Win, Ctrl, Alt, Shift + VK) and transmits new registrations to `MainForm.RpcDispatch.cs`.

## 2. Dead Code & Safe Pruning Targets
- Legacy migration fallback blocks (lines 139–147): Code migrating removed settings keys (`center_cursor`, `mouse`, `caret`, `top_left`, `tall`, `wide`, `ultrawide`) to modern presets (`near`, `default`). Once existing users have migrated, these defensive checks add ~40 lines of obsolete string arrays.
- Dual-path setting reads: Many functions alternate between `getSetting(...)` and direct `localStorage.getItem(...)`.

## 3. Performance & Memory Hotspots
- Redundant setting writes on rapid toggle:
  - Several toggles write to both `localStorage` and trigger host RPC calls (`set_smart_shortcuts`, `syncCaptureFiltersToBackend`) synchronously without debounce.
  - While toggles are typically clicked individually, automated preset switching triggers a burst of simultaneous RPC calls.

## 4. Code Duplication & Refactoring Targets
- Toggle binding boilerplate:
  - Every individual toggle button (`stLivePreviewToggle`, `stRememberCollectionToggle`, `stShowTaskbarToggle`, `stAutostartToggle`, `stStartHiddenToggle`, etc.) follows an identical ~10-line pattern of reading class `on`, toggling `classList.toggle('on')`, writing to localStorage, and calling pywebview.api.
  - A declarative `bindToggle(elementId, storageKey, apiCallback)` helper would eliminate over 150 lines of duplicate toggle code.

## 5. Critical Invariants (DO NOT TOUCH)
- **Synchronous Bootstrap Execution (`bootstrapThemeAndZoom`)**: Must run immediately in head/body parse before DOM rendering; moving this into an async callback or DOMContentLoaded event would reintroduce a visible white/unthemed flash on startup.
- **Settings View Exemption from Zoom**: The History panel zoom (`zoomed-90`, `zoomed-110`) must strictly apply to `#mainView`, not `#settingsView` or root `<html>`, ensuring the Settings modal remains crisp and readable.
- **Incognito Red Dot Atomic Synchronization**: `updatePauseStateUI` must synchronously bind the incognito toggle and the header red indicator dot together.

## 6. Prioritized Action Plan
- **Medium**: Create a declarative `bindToggle` and `bindSelect` utility to condense repetitive settings bindings.
- **Low**: Clean up legacy preset migrations (`tall`, `wide`, `center_cursor`).
- **Low**: Centralize setting reads through `getSetting()` single source of truth.
