# Clipboard Capture Audit — `Services/ClipboardListener.cs`

**Date**: 2026-10-05
**File**: 2,012 lines
**Status**: Fix status updated 2026-10-06 (C1–C3 shipped in `0f1ce07`, C2 completed in `c4e636f`). C4–C6 still open.
**Method**: full structure map, then line-by-line reading of the capture, queue, image, format-detection
and shutdown paths. Every finding below was confirmed by reading the surrounding code, not inferred
from a pattern match.

---

## Summary

**This is the best-written file in the codebase.** The capture path has real bounds checking, correct
`finally` handling on every Win32 handle, deliberate ownership transfer for image objects, and
comments that explain *why* rather than *what*. Several of the checks below are things I expected to
find as bugs and did not.

Six findings. None is an emergency; two are worth fixing because they lose information silently.

| # | Issue | Severity | Status |
|---|---|---|---|
| C1 | Oversized-clip reporting matches on error-message wording, and reports the wrong limit | Medium | fixed — `OversizeKind` reason enum, correct limit per cause |
| C2 | Clipboard events are dropped without a trace when the queue is full | Medium | **fixed** — `DroppedClipCount` + `CaptureQueueDropped` in `Services/ClipboardListener.cs:649` (`0f1ce07`); subscribed in `MainForm.cs` `OnCaptureQueueDropped`, which raises a tray warning + `onToast` and re-warns only per power-of-ten of the running total (`c4e636f`) |
| C3 | Shutdown waits 2s and cannot cancel in-flight work; queue is never disposed | Medium | fixed — `_shutdownRequested` flag + queue disposed |
| C4 | Image-capture failure can leave an orphan file (mitigated by an existing sweeper) | Low | open |
| C5 | Listener thread runs at raised priority for the life of the process | Low | open (documented trade, needs decision) |
| C6 | Listener window is not disposed if its handle was never created | Low | open |

---

## C1 — Oversized-clip reporting is coupled to message wording, and reports the wrong number (Medium)

The decision to notify the user is made by searching an English error string:

```csharp
// ClipboardListener.cs:731-734
if (note != null && (note.Contains("limit", StringComparison.OrdinalIgnoreCase)
                  || note.Contains("too large", StringComparison.OrdinalIgnoreCase)))
{
    OversizedClipDropped?.Invoke("text", 0, MaxTextChars);
}
```

`note` is a human-readable diagnostic string produced elsewhere in `ReadClipboardText`. Two separate
conditions are being detected by vocabulary:

| Real cause | Message text | Matches on |
|---|---|---|
| Text longer than `MaxTextChars` | `"text length exceeds MaxTextChars limit"` | `"limit"` |
| Allocation over 20 MB | `"clipboard allocation too large (N bytes)"` | `"too large"` |

**The reported limit is wrong for the second case.** `OversizedClipDropped` is invoked with
`MaxTextChars` (250,000) as its limit argument, but the clip was actually rejected by
`MaxClipboardAllocBytes` (20 MB). A user whose 30 MB clipboard was refused is told the limit was
250,000 characters. The three numbers are unrelated units.

**Why it matters:** this is a display bug that will survive every test that doesn't assert on the
message text, and the message text is exactly the kind of thing someone tidies up. Reword
"too large" to "exceeds the maximum" and the notification silently stops firing.

**Suggested fix:** have `ReadClipboardText` return the reason as an enum (or a nullable limit value)
alongside the note, and switch on that instead of matching strings. The `note` can stay for logging.

---

## C2 — Queue saturation drops clips with no record in Release builds (Medium)

The capture queue is deliberately bounded:

```csharp
// ClipboardListener.cs:22
private readonly BlockingCollection<Action> _captureQueue = new(50);
```

and `EnqueueCapture` handles overflow correctly — it disposes the owned resource and returns `false`:

```csharp
// ClipboardListener.cs:119-124
if (!_captureQueue.TryAdd(work))
{
    owned?.Dispose();
    System.Diagnostics.Debug.WriteLine("[ClipboardListener] Capture queue full (backpressure); dropping clip update...");
    return false;
}
```

The design is right. The problem is the **only trace is `Debug.WriteLine`**, which the compiler
removes entirely from Release builds. So under load — bulk-copying many items, a rapid paste burst, a
large drag-and-drop — up to 50 queued items can be discarded with nothing logged and nothing shown.

Backpressure here is a deliberate and correct trade (it protects the STA thread, per the file's own
comments). But silently losing clipboard history is exactly the failure a clipboard manager must not
have, and the user has no way to learn it happened.

**Suggested fix:** count drops in a field and surface it — either fold it into the existing stats
view, or raise a toast the first time a drop occurs. Keep the `Debug.WriteLine` for diagnostics.

---

## C3 — Shutdown gives up after 2 seconds and cannot cancel; the queue is never disposed (Medium)

```csharp
// ClipboardListener.cs:1665-1673
_captureQueue.CompleteAdding();
...
if (_captureWorkerThread.IsAlive)
{
    _captureWorkerThread.Join(2000);
}
```

`CompleteAdding` lets the worker drain what is already queued, then `Join` waits 2 seconds. If a
capture is mid-flight — writing a large PNG, a GIF, or a batch of clips — it will not finish, and
`Dispose` returns with the worker **still running**. Nothing checks `_disposed` inside
`CaptureWorkerLoop`, so the worker keeps writing to the database after the listener has been torn
down. There is no cancellation token and no second wait.

**The queue object is never disposed either.** `_captureQueue` is only ever `CompleteAdding`-ed
(line 1668) and enumerated (line 99). `BlockingCollection<T>` implements `IDisposable` and owns
internal semaphores and wait handles; dropping it without `Dispose` leaks those for the process
lifetime. It is one line, and it is a genuine handle leak on every app exit.

**Suggested fix:** dispose the queue after the join, and give the worker a cancellation flag checked
between items so shutdown is bounded by the in-flight item rather than by a fixed timeout. If the
2s join is failing in practice, that is worth measuring before changing anything.

---

## C4 — Image capture swallows every exception (Low)

`ProcessCapturedImage` ends in a bare `catch { }`. If the image file is written and the database
insert then fails, the file stays on disk with no row pointing at it.

**Mitigated:** `DatabaseService.TryDeleteOrphanImageFile` exists specifically to reclaim unreferenced
image files, and the delete paths call it deliberately. So this is a housekeeping matter rather than
data loss — the sweeper will eventually collect it.

Worth a comment at minimum, so the next reader knows the sweep is deliberate and not an oversight.
There are 17 empty catches in this file; most are defensible for the same reason.

---

## C5 — Listener thread runs at raised priority (Low)

```csharp
// ClipboardListener.cs:91
_listenerThread.Priority = ThreadPriority.AboveNormal;
```

This thread lives for the entire process. On a loaded machine, a permanently-above-normal thread
competes with foreground work. The intent is clearly to win the `OpenClipboard` race against fast
writers, which is a real constraint — so this may well be the right trade. It just deserves to be a
deliberate, documented one rather than a single unexplained line.

---

## C6 — Listener window leaks when its handle was never created (Low)

```csharp
// ClipboardListener.cs:1650-1662
if (_window != null && !_window.IsDisposed)
{
    if (_window.IsHandleCreated)
    {
        _window.Invoke(new Action(() => { _window.Close(); _window.Dispose(); }));
    }
}
```

If `IsHandleCreated` is false, neither `Close` nor `Dispose` is ever called and the `Form` object is
abandoned. The impact is small — with no handle there is no native window to leak — but the object
itself is never cleaned up, and the nesting makes the intent harder to read than it needs to be.

---

## Checked carefully and found correct

This section is the point of the audit. These are all places I expected a bug and verified there
wasn't one.

**Win32 handle discipline in `ReadClipboardText` — correct.**
- Allocation size checked via `GlobalSize` against `MaxClipboardAllocBytes` before any read.
- `GlobalLock` result checked for `IntPtr.Zero`.
- `GlobalUnlock` in a `finally`, so the lock is released on every path including the early return.
- `CloseClipboard` in a `finally` around the whole read.
- The `char*` scan is bounded by `min(allocBytes/2, MaxTextChars + 1)` — it cannot walk off the end
  of the allocation, and it cannot read unbounded memory even if the clipboard lies about its size.

**Retry logic — correct and thoughtful.** On `OpenClipboard` failure the loop re-reads the sequence
number and, if the clipboard changed while waiting, **stops retrying** rather than reading content
that now belongs to a newer event. The comment explains this prevents mis-attributing one app's
clipboard to another. The wait stays sub-millisecond for the first three attempts precisely because
a fast writer may restore the previous content. This is careful work.

**Image ownership — correct.** Three separate things that commonly leak, all handled:
- `EnqueueCapture(work, capturedImg)` transfers ownership explicitly, and the `owned?.Dispose()` calls
  on every failure path prevent a leak when the queue rejects the work.
- `ProcessCapturedImage` wraps the image in `using (img)`.
- `ClampImageIfNeeded` returns a new bitmap but deliberately does **not** dispose its `src` argument
  — the caller owns it — and the caller disposes the returned `clamped` in a `finally`. No double-free,
  no leak.

**Sequence-number de-duplication — correct.** `_lastCapturedSeq` is only advanced once a payload is
successfully read, so a failed read is retried by the next delivery rather than silently skipping a
real capture. There is explicit reasoning about the mid-read sequence change.

**SVG and GIF pre-capture paths** check file size before reading and fall through to the generic
path on any failure rather than dropping the clipboard event.

---

## Recommended order

1. **C1** — small, and it puts a wrong number in front of the user.
2. **C3** — the queue dispose is one line; the cancellation work is small and removes a shutdown race.
3. **C2** — surface the drop count; the mechanism is already correct.
4. **C4, C5, C6** — comments and small tidies. Batch them.

Nothing here blocks a release.