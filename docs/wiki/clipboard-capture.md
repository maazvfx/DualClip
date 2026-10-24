# Clipboard Capture & Listener Engine

## Overview
Clipboard monitoring, format detection, and self-capture suppression are handled in [`Services/ClipboardListener.cs`](../../Services/ClipboardListener.cs).

---

## 👂 Win32 Clipboard Monitoring
- **Listener registration**: `AddClipboardFormatListener` is registered on a dedicated hidden `ListenerWindow` — **not** on `MainForm.Handle`. That window is a zero-size, borderless, off-screen form parked at `-32000,-32000` with `ShowInTaskbar = false` (`ClipboardListener.cs:1739-1751`). It runs on its own thread with its own message loop (`RunMessageLoop`, `ClipboardListener.cs:167`).
- **Message**: `WM_CLIPBOARDUPDATE` (0x031D) is trapped in that window's `WndProc` and forwarded to `OnClipboardUpdate()` (`ClipboardListener.cs:1754-1760`).
- **Teardown**: `OnFormClosing` calls `RemoveClipboardFormatListener(Handle)` (`ClipboardListener.cs:1763-1767`).
- **Sequence numbering**: `GetClipboardSequenceNumber` guards every read/write, not just dedup.

---

## 🛡️ Critical Invariants & Guards

### 1. Self-Capture Prevention
DualClip never re-captures its own re-injected text. Two independent mechanisms:

- **PID / process-name rejection** — `ProcessCapturedText` bails out if the clipboard source PID equals `_currentPid` or the process name is `DualClip.exe` (`ClipboardListener.cs:912-916`). This is the primary guard, and it resolves provenance **before** reading the payload (see "Source attribution" below).
- **Sequence dedup** — `_lastCapturedSeq` skips repeat deliveries for an already-observed clipboard state (`ClipboardListener.cs:697-700`). It advances only after a **successful** read (`ClipboardListener.cs:785-788`), so a failed read leaves it unset and the next delivery retries instead of silently dropping a real capture. If the sequence changes mid-read, `_lastCapturedSeq` is deliberately *not* advanced, so the newer state gets its own clean `WM_CLIPBOARDUPDATE`.

Separately, `_inSequentialPaste` (`MainForm.cs:249`) suppresses the blur-to-hide handler during Shift+Enter sequential paste so the window stays up.

### 2. Stale-Clock Rejection (read path)
`WM_CLIPBOARDUPDATE` can arrive before the writer releases the clipboard lock. The read path retries, but if the sequence number has advanced since the message was posted, the payload that message described is already gone — so the read **aborts** with a "superseded by seq" diagnostic rather than mis-attributing the newer state to the older notification (`ClipboardListener.cs:1464-1470`).

### 3. Re-Arming Safety (`ReArmListener`)
`ReArmListener()` unconditionally does remove-then-add on the listener handle (`ClipboardListener.cs:299-321`). It is the recovery path when a third-party app leaves the clipboard in a bad state.

### 4. Clipboard Lock Contention (write path)
`WriteClipboardWithRetry` retries `OpenClipboard` up to **10 times at 20ms** (a 200ms ceiling) before giving up (`ClipboardListener.cs:323-328`). It snapshots the sequence before and after the write and warns via `Debug.WriteLine` if it failed to advance — a kernel-level drop or clobber signal (`ClipboardListener.cs:372-376`).

### 5. Backpressure
Captures are dispatched through a bounded queue (`EnqueueCapture`). If it is full the work item is **dropped and disposed** rather than blocking the STA thread, and the drop is counted (`ClipboardListener.cs:143-149`).

---

## 📥 Format Extraction Priority
Sniffed in this order; the first match wins.

1. **File drop (`CF_HDROP`)** — multi-file Explorer drop lists parsed into paths.
2. **SVG** — a single `.svg` drop under 2 MB is read and sanitized through `TryParseSvg`, then captured as a vector clip (`ClipboardListener.cs:710-726`).
3. **Rich text / source URL** — RTF and source-URL extraction, then plain text (`ClipboardListener.cs:1481+`).
4. **Text** — length gates: `MinClipLength`, `IgnoreWhitespaceOnly`. Captured text is stored as copied. Tracking-parameter cleaning is a separate action (see [settings-and-storage.md](settings-and-storage.md#url-cleaning)).
5. **Image** — only when `CaptureImages` is on. Rejected above `MaxImagePixelArea`, which raises `OversizedClipDropped` (`ClipboardListener.cs:830-835`).

Every capture path is dispatched through the queue as `ProcessCapturedText` / `ProcessCapturedImage` / `ProcessCapturedSvg`, so the STA thread never blocks on I/O.

### Source attribution
`GetClipboardSourceProcessInfo` reads `GetClipboardOwner()` and resolves PID, image path, and window title. When the owner is missing or has a blank title (Chrome/Edge internal message windows), it falls back to the foreground window for the process and title (`ClipboardListener.cs:1582-1613`).

### Filters applied at capture time
In `ProcessCapturedText`, before insert:
- self-capture check (above),
- `IgnorePasswords` → `IsVaultProcess` exclusion,
- `EnableBlocklist` → blocklisted process names,
- `ResolveAutoSortCollection` picks a destination collection by rule,
- voice-dictation track detection (process or window title contains `wispr`).

### Retention after capture
`EnforceMaxClipsIfNeeded` runs on every new clip, not only when the limit changes (`ClipboardListener.cs:943`).

---

## 🧪 Invariant Tests
- `DualClip.Tests/FormatDetectionInvariantTests.cs`
- `DualClip.Tests/SvgVectorCaptureTests.cs`
- `DualClip.Tests/RichTextCaptureTests.cs`
- `DualClip.Tests/FileDropCaptureTests.cs`
- `DualClip.Tests/GifCaptureTests.cs`
- `DualClip.Tests/js-harness/format-detection-invariants.js`
- `DualClip.Tests/DataLifecycleInvariantTests.cs`