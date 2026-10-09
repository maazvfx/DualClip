# Architecture & Code Quality Audit: AppSettings.cs & WindowPlacement.cs

## 1. Module Purpose & Responsibilities
- `AppSettings.cs`: Manages persistent user preferences (hotkeys, window positioning, auto-start, database retention, pinned states, sound, auto-paste, and appearance themes). Provides JSON serialization to `%APPDATA%\DualClip\settings.json` with an atomic backup fallback (`settings.json.bak`) and manages the Windows startup registry key (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`).
- `WindowPlacement.cs`: Pure geometry calculations for popup window clamping, centering, corner positioning, and multi-monitor visibility validation (`IsPositionUsable`, `IsMeaningfullyVisible`). Completely free of Win32/WinForms window handles so placement math can be thoroughly unit-tested in isolation.

## 2. Dead Code & Safe Pruning Targets
- `TopLeft(Size size, Rectangle workingArea, int margin = 16)` in `WindowPlacement.cs`: Unused in `MainForm` or anywhere else in the solution; `MainForm` handles remember-position, center, cursor, and bottom-right/tray placement.
- Unused default settings properties in `AppSettings.cs`:
  - `MaxClips`: Kept at 500, but clamp limits (e.g. 10 to 50000) are hardcoded in multiple places across UI and backend.

## 3. Performance & Memory Hotspots
- `AppSettings.Save()`: Synchronously writes to disk on UI threads whenever settings change. If rapid UI slider changes occur without debouncing, it triggers multiple synchronous disk I/O flushes. Debouncing in frontend (`settings-core.js`) currently prevents this, but a throttle or background worker write would improve robustness.
- Registry access in `SetRunOnStartup()`: Touches Windows Registry synchronously on main thread during settings save. Negligible latency, but best kept isolated.

## 4. Code Duplication & Refactoring Targets
- Default hotkey strings and modifier parsing: Modifier checks exist in both `AppSettings.cs` and `MainForm.cs`.
- Fallback window bounds: Default size `(400, 520)` is specified as defaults in `AppSettings.cs` and also hardcoded in `MainForm.Geometry.cs` / `MainForm.cs`. Unifying these into a shared constants class or `AppSettings.DefaultWidth` / `AppSettings.DefaultHeight` would prevent drift.

## 5. Critical Invariants (DO NOT TOUCH)
- **Backup File Restoration (`settings.json.bak`)**: In `AppSettings.Load()`, if the primary JSON file is corrupted or empty (due to abrupt system crash/shutdown during write), it automatically attempts recovery from `.bak`. This prevents catastrophic loss of user hotkeys and configurations.
- **Minimum Visible Footprint (`MinVisibleWidth = 120`, `MinVisibleHeight = 80`)**: Window placement must never allow a window to position itself offscreen or straddling an edge with less than this footprint.
- **Multi-Monitor Disconnection Guard (`IsPositionUsable`)**: Validates that remembered positions are visibly contained in currently attached monitors. Disconnected second screens cleanly fall back to primary monitor placement.

## 6. Prioritized Action Plan
- **Low**: Deprecate or retain `WindowPlacement.TopLeft` (harmless pure function, zero overhead).
- **Low**: Centralize default geometry constants (`DefaultWidth`, `DefaultHeight`) so `MainForm` and `AppSettings` share the same single source of truth.
