# Review — Tray icon & pause lifecycle

**Date**: 2026-10-05
**Type**: Read-only review. **No source file was changed.**
**Scope**: `Services/TrayService.cs` (467 lines — icon, theme, context menu, pause/resume/clear
actions), the pause wiring in `MainForm.cs` (`_timedPauseTimer`, `_timedPauseEndTime`,
`PauseIndefiniteRequested`, `TimedPauseRequested`, `ResumeRequested`, the dispose path, and the
startup `ApplySettings` / `SetPaused` sequence), the `get_paused` / `set_paused` RPCs, and the client
side (`ui/js/core/state.js` — `onPauseChanged`, `onCaptureStateChanged`, `updatePauseStateUI`,
`syncPauseStateFromBackend`).
**Not run**: `dotnet test` (needs explicit user permission per `AGENTS.md` rule 6) and the app itself,
so timer behaviour is argued from the code rather than observed.

---

## 1. Verdict

The pause state machine is small, symmetric in its UI effects, and correctly disposes its timer on
shutdown. Every transition (pause indefinite, pause timed, resume, timed expiry) updates **all four**
of: the listener flag, the tray menu, the persisted settings, and the frontend — with one exception,
and the exception is the interesting one.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| P1 | A timed pause is never persisted, so it silently evaporates across a restart | **Medium** | new |
| P2 | The remaining-time countdown is client-side only and drifts across sleep | **Low** | new |
| P3 | `pauseRemainingSeconds` is not re-synced from the host at any point | **Low** | new |

---

## 2. Findings

### P1 — A timed pause is lost on restart (Medium)

The two pause entry points are not symmetric, and the difference is almost certainly unintentional:

```csharp
// MainForm.cs:624  PauseIndefiniteRequested — persists
_listener.IsPaused = true;
_tray.SetPaused(true, "Until Resumed");
var cur = AppSettings.Load();
cur.IsPaused = true;          // ← written
AppSettings.Save(cur);

// MainForm.cs:638  TimedPauseRequested — does not persist
_listener.IsPaused = true;
_tray.SetPaused(true, $"{minutes}m", minutes);
_timedPauseEndTime = DateTime.UtcNow.AddMinutes(minutes);   // in-memory only
_timedPauseTimer = new System.Threading.Timer(…);           // in-memory only
// no AppSettings.Load() / IsPaused = true / Save anywhere
```

A timed pause therefore lives entirely in memory. Startup restores from disk:

```csharp
_listener.ApplySettings(settings);      // MainForm.cs:584
_tray.SetPaused(settings.IsPaused);     // MainForm.cs:621
```

`settings.IsPaused` is `false` (nothing wrote it), so a 30-minute pause that spans a restart, a crash,
a logoff, or an update comes back with **capture silently resumed** and the tray showing "capturing".
The user asked the app to stop recording for half an hour; the app's answer depends on whether it
happened to restart. `_timedPauseEndTime` is not persisted either, so there is no way to reconstruct
"paused until 14:32" on the next launch.

**Fix**: persist an absolute deadline and honour it at startup.

```csharp
// in TimedPauseRequested
var s = AppSettings.Load();
s.IsPaused = true;
s.PausedUntilUtc = DateTime.UtcNow.AddMinutes(minutes);
AppSettings.Save(s);

// at startup, before ApplySettings
if (settings.IsPaused && settings.PausedUntilUtc is { } until)
{
    var remaining = until - DateTimeOffset.UtcNow;
    if (remaining > TimeSpan.Zero) { start the timer with `remaining` and post the event with remaining_seconds }
    else { clear IsPaused }
}
```

That also makes the frontend countdown honest after a restart, because the host — not the client —
becomes the authority for how long is left.

### P2 — The countdown is a client-side guess (Low)

The host posts the remaining time exactly once, when the pause starts:

```csharp
PostEventToJs("onCaptureStateChanged", new { paused = true, is_timed = true, remaining_seconds = minutes * 60 });
```

and the client decrements it on its own `setInterval` (`ui/js/core/state.js:679-694`). Nothing
re-sends it. `setInterval` does not fire while the machine is asleep, so a 30-minute pause across a
20-minute sleep resumes showing roughly "PAUSED 28:00" when about ten minutes are actually left. The
badge self-corrects only when the local count reaches zero, which for a sleeping machine is later than
the real resume — so the user can be told capture is still paused after it has resumed.

**Fix**: falls out of P1. Once the host owns a `PausedUntilUtc`, post the remaining seconds on
`onWindowShow` as well (the host already posts an event on every summon), and let the client re-sync
whenever the window regains focus.

### P3 — No re-sync path exists today (Low)

There is no `get_pause_state` RPC, and `get_paused` (`MainForm.RpcDispatch.cs:206`) is not called by the
frontend at startup — the client relies on `syncPauseStateFromBackend`, which in turn reads
`get_paused`, but only when that function is invoked. Without a host-authoritative remaining time,
the client cannot detect drift at all, which is why P1 and P2 have no self-correcting behaviour.

**Fix**: the same `get_pause_state` call should return `{ paused, is_timed, remaining_seconds }` and
be called on `pywebviewready` and on every `onWindowShow`.

---

## 3. Checked and found clean

- **The timer is disposed on shutdown.** `MainForm.cs:497` disposes `_timedPauseTimer` in the same
  guarded block as the listener, tray, hotkeys, modifier-release and foreground-tracker timers, so a
  pending callback cannot fire into a disposed handle.
- **The expiry callback marshals to the UI thread.** The `System.Threading.Timer` callback wraps its
  work in `BeginInvoke`, so it touches `_tray`, `AppSettings` and `PostEventToJs` on the right thread.
- **Re-pausing does not stack timers.** Both `TimedPauseRequested` and `ResumeRequested` dispose the
  existing timer before creating or clearing one, so repeatedly choosing "pause 5m" leaves exactly one
  pending timer.
- **The expiry path fully unwinds state**: it disposes the timer, nulls both `_timedPauseTimer` and
  `_timedPauseEndTime`, clears `_listener.IsPaused`, resets the tray, persists `IsPaused = false`, and
  posts both frontend events. The four sources of truth are all updated.
- **Both pause paths post the same pair of events** (`onPauseChanged` and `onCaptureStateChanged`), so
  the client has one shape to handle regardless of how the pause was entered.
- **Startup applies the persisted flag to both consumers** — `_listener.ApplySettings(settings)` for
  capture and `_tray.SetPaused(settings.IsPaused)` for the menu — so an indefinite pause *does* survive
  a restart correctly. That is precisely why the timed path's omission reads as an oversight rather
  than a decision.
- **The resume path is complete and idempotent**: dispose, null, clear the listener, reset the tray,
  persist, notify.
- **The clear actions from the tray are run off the UI thread** (`Task.Run`) and check the return value
  of `ClearHistoryAdvanced`, toasting `"Clear canceled: <backup error>"` when the safety backup fails —
  so the "clear older than N days" menu item cannot silently destroy history either.
- **`_tray?.Dispose()` and `_tray?.ShowNotification` are null-guarded**, so an early tray failure cannot
  cascade.

---

## 4. Suggested order of work

1. **P1** — the only one with user-visible consequences: the app resumes recording when the user asked
   it not to. A `PausedUntilUtc` setting plus a startup reconciliation is a small, self-contained
   change.
2. **P2 / P3** — fall out of the same fix; the countdown becomes host-authoritative for free.

Worth a test: a pure-logic test for the startup reconciliation (paused with a future deadline → stays
paused with the right remaining seconds; paused with a past deadline → clears). The deadline arithmetic
is trivially testable without a timer.
