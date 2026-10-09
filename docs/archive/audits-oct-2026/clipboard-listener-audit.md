# Audit Report: Services/ClipboardListener.cs

## 1. Module Purpose & Responsibilities
- **Low-Level Win32 Clipboard Hook**: Spawns a dedicated high-priority STA thread (`DualClip.ClipboardListenerThread`) hosting a message-only window (`ListenerWindow`) that registers with the Win32 clipboard chain via `AddClipboardFormatListener`.
- **Fast Synchronous Provenance Capture**: Captures clipboard owner process name, executable path, and window title (`GetClipboardSourceProcessInfo`) synchronously on notification receipt before the writing application releases ownership.
- **Asynchronous Decoupled Processing**: Offloads heavy format parsing (HTML, RTF, multi-frame GIF, SVG, bitmaps), image disk encoding, and SQLite persistence to a dedicated background consumer thread (`DualClip.CaptureWorker`) via a bounded `BlockingCollection<Action>` (capacity 50).
- **Format Sanitization & Safety Envelopes**: Enforces size caps (250k characters for text, 20MB clipboard allocation ceiling, 15MB/32MP image ceiling) and strips malicious executable tags (`<script>`, `<foreignObject>`, `javascript:`) in SVG payloads.

---

## 2. Dead Code & Safe Pruning Targets
- **Zero dead code found**:
  - `ReArmListener()` is **active live code** called by `MainForm.cs` on system resume (`PowerModes.Resume`) and session unlock (`SessionSwitchReason.SessionUnlock`) to re-register the Win32 clipboard format listener after power/session state changes. **Do NOT prune.**

---

## 3. Performance & Memory Hotspots
- **GDI+ Bitmap Allocations during High-DPI Capture**:
  - Image capture decodes raw clipboard DIB/bitmaps into managed `System.Drawing.Bitmap` instances and encodes them to disk as PNG. While guarded by `MaxImagePixelArea` (32 MP), consecutive rapid screenshot captures cause burst allocations on the native heap and GC gen 2.
- **Regex Extraction on Large HTML Payloads**:
  - `ExtractHtmlSourceUrl` executes regular expressions (`SourceURL:([^\r\n]+)`) against raw HTML data. For massive DOM copies (e.g. 5–10MB web pages), this creates multiple intermediate string allocations.
- **OpenClipboard Polling Sleep Loop**:
  - `ReadClipboardText` and `WriteClipboardWithRetry` retry `OpenClipboard` up to 10 times with 15–20ms sleeps. While necessary for Windows clipboard contention, prolonged retry delays can block the STA thread if an external application hangs with the clipboard open.

---

## 4. Code Duplication & Refactoring Targets
- **File Extension & Header Detection**:
  - SVG and GIF payload detection is split across file drop inspection (`CF_HDROP`) and direct text/image stream parsing. These format checks can share a unified MIME/magic-byte detection helper.
- **Clipboard Write Retry Boilerplate**:
  - Direct Win32 memory allocation (`GlobalAlloc`, `GlobalLock`, `GlobalUnlock`) for writing text is duplicated between text write paths.

---

## 5. Critical Invariants (DO NOT TOUCH)
- **STA Thread Message Pump**:
  - `RunMessageLoop` MUST execute on a dedicated thread with `ApartmentState.STA`. Win32 clipboard API calls (`OpenClipboard`, `GetClipboardData`, `OleGetClipboard`) will fail or cause COM deadlocks if executed from a multithreaded apartment (MTA).
- **Monotonic Sequence Deduplication (`_lastCapturedSeq`)**:
  - `GetClipboardSequenceNumber()` MUST be inspected immediately in `OnClipboardUpdate`. Rapid synthetic clipboard writes (such as Wispr Flow dictation followed by clipboard restoration) deliver multiple `WM_CLIPBOARDUPDATE` messages; dropping duplicate sequence numbers prevents duplicate clips and race conditions.
- **FIFO Single-Consumer Queue**:
  - The worker `CaptureWorkerLoop` MUST remain a single sequential consumer thread. Running parallel capture workers will cause consecutive captures (e.g., dictation text followed by restored previous clip) to race into SQLite out-of-order.
- **SVG XSS Sanitization (`TryParseSvg`)**:
  - MUST strip `<script>`, `<foreignObject>`, and attributes starting with `on` or `javascript:`. SVGs are rendered directly in the WebView2 Chromium DOM, making strict sanitization non-negotiable.

---

## 6. Prioritized Action Plan
- **High**: Ensure `OpenClipboard` timeout on the STA thread is strictly bounded to prevent third-party lockups from freezing DualClip's listener loop.
- **Medium**: Safely prune unreferenced `ReArmListener()` helper.
- **Low**: Optimize HTML `SourceURL` parsing with zero-allocation `ReadOnlySpan<char>` searching instead of Regex.
