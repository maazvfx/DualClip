# Audit Report: MainForm.cs

## 1. Module Purpose & Responsibilities
- **Application Shell & Host Container**: WinForms Form hosting the WebView2 Chromium control, managing OS lifecycle, single-instance messaging (`WM_SHOW_DUALCLIP`), taskbar recreation, global shortcuts (`HotkeyService`), and tray notifications (`TrayService`).
- **WebView2 Lifecycle & Security Sandbox**: Configures private user data directory (`%LOCALAPPDATA%\DualClip\webview2_profile`), establishes virtual host mapping (`https://appassets.example` $\rightarrow$ `ui/`), and denies all sensitive web permissions.
- **Window Geometry & Positioning Engine**: Computes display bounds across multiple monitors, clamps popup coordinates (`WindowPlacement.ClampToWorkingArea`), animates sizing changes (`_morphTimer`), and enforces the size-persistence policy (`WindowSizePolicy`).
- **External Paste Dispatcher**: Captures the previously focused external window handle (`CapturePasteTarget`), manages Win32 input thread attachment (`AttachThreadInput`), and synthesizes keyboard input (`keybd_event` / `SendInput` Ctrl+V) to inject clips into third-party target applications.

---

## 2. Dead Code & Safe Pruning Targets
- **Legacy Resizing Constants & P/Invoke Definitions**:
  - `MOUSEINPUT` and `HARDWAREINPUT` in `InputUnion` exist strictly to pad the Win32 `INPUT` struct to 40 bytes for x64 `SendInput`; they are not directly instantiated.
  - No orphaned methods detected; all private helpers (`EnsureClipImagePath`, `EnsureClipTextFile`, `PurgeStaleDragTempFiles`, `SimulatePaste`, `FormatClipForJs`) have active callers across the dispatch pipeline.

---

## 3. Performance & Memory Hotspots
- **Synthetic Paste Delays on Worker Threads**:
  - `HandlePasteClip` and `SimulatePaste` introduce deliberate `Thread.Sleep(20)` and `Thread.Sleep(30)` intervals to allow Windows to transition foreground focus and release keyboard modifier keys. While essential for OS reliability, these sleeps hold `_pasteExecutionLock` worker threads.
- **Large Clip Format Serialization (`FormatClipForJs`)**:
  - When returning 500 clips, `FormatClipForJs` runs in parallel or batch, creating strings for preview, timestamps, and icons. `SafeTruncateString` clamps large payloads to 4,000 characters, effectively protecting the UI thread from memory bloat.
- **`_getClipsCts` Cancellation Token**:
  - Rapid keystrokes in the search bar cancel previous queries cleanly via `_getClipsCts.Cancel()`. Well-implemented; ensures obsolete search tasks do not saturate the threadpool.

---

## 4. Code Duplication & Refactoring Targets
- **Monolithic God-Class File Size (3,618 Lines)**:
  - While logically cohesive, `MainForm.cs` contains at least 3 distinct subsystems that can be split into C# `partial class` files without changing a single line of logic:
    1. `MainForm.Geometry.cs` (~550 lines): `ShowWindow`, `HideWindow`, `ClampToWorkingArea`, `EnsureOnScreen`, `MorphTimerTick`.
    2. `MainForm.Paste.cs` (~650 lines): `CapturePasteTarget`, `HandlePasteClip`, `HandlePasteText`, `SimulatePaste`, `ForceForegroundWindow`.
    3. `MainForm.Archives.cs` (~500 lines): `HandleFormDragEnter`, `HandleFormDragDrop`, `ExecutePackageImport`, `HandleExportClips`.

---

## 5. Critical Invariants (DO NOT TOUCH)
- **Foreground Stealing Sequence (`AttachThreadInput` + `BringWindowToTop`)**:
  - Windows strictly prevents background applications from claiming foreground focus (`SetForegroundWindow`). The thread-attachment sequence in `ForceForegroundWindow` is required to summon the DualClip window or return focus to the user's active editor when pasting.
- **WebView2 Permission Deny-All**:
  - `CoreWebView2.PermissionRequested` MUST always deny all permissions. DualClip runs as a local clipboard viewer; granting web permissions opens local security vectors.
- **Virtual Host Scheme (`https://appassets.example`)**:
  - All UI resources MUST load via this virtual scheme rather than `file:///` to prevent Chromium CORS restrictions and local file access vulnerabilities.
- **Single-Instance Mutex & `WM_SHOW_DUALCLIP`**:
  - Secondary launches signal `WM_SHOW_DUALCLIP` to activate the running instance and immediately exit.

---

## 6. Prioritized Action Plan
- **High**: Maintain the Win32 focus-attachment sequence (`AttachThreadInput`) intact across all Windows 10/11 versions.
- **Medium**: Partition `MainForm.cs` into partial classes (`MainForm.Geometry.cs`, `MainForm.Paste.cs`, `MainForm.Archives.cs`) to improve code navigation.
- **Low**: Fine-tune `SimulatePaste` delay thresholds for modern high-refresh displays.
