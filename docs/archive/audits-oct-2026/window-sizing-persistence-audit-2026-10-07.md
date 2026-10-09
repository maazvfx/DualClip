# Audit — Persistent window resizing & startup dimension restoration

**Date**: 2026-10-07
**Type**: Read-only audit. No app file was edited (the only tree change is this report).
**Scope**: `MainForm.cs` (`OnResizeEnd`, `ShowWindow`, `HideWindow`, `EnsureOnScreen`, bounds
morph, `WndProc` WM_GETMINMAXINFO / WM_DISPLAYCHANGE / WM_DPICHANGED),
`MainForm.RpcDispatch.cs` (`set_window_size`, `reset_window_size`, `set_window_pos`,
`start_resize`), `Services/AppSettings.cs` (`Load`/`Save`),
`Services/WindowSizePolicy.cs`, `Services/WindowPlacement.cs`,
`Program.cs`, `app.manifest`/csproj DPI config, and the geometry test suites
(`WindowSizePolicyTests`, `WindowPlacementTests`).
**Method**: full read of every geometry/persistence path and its callers; trace of the
transient-size and mirror lifecycles across C#/JS; a compiled 20-line WinForms probe run
against net10.0-windows to settle the WM_GETMINMAXINFO forwarding question empirically
(§W9).
**Not run**: full `dotnet test` — the app was running (PID 6304) and locked
`bin/Debug/net10.0-windows/DualClip.exe`, so the test host could not copy the apphost.
The main project **compiles cleanly** (the only MSBuild errors were the two copy-lock
errors). `WindowSizePolicyTests`/`WindowPlacementTests` were not executed this session;
their content was reviewed line-by-line instead.

---

## 0. Executive summary

The architecture of the sizing subsystem is sound: the pure policies
(`WindowSizePolicy`, `WindowPlacement`) are unit-tested and free of WinForms/Win32, the
transient-vs-persist contract is thought through, and the mirror design genuinely
eliminates the summon flicker it was built for. No crash-class or data-destroying bug
was found, and out-of-range/corrupt dimension values cannot produce an off-screen or
invisible window at show time — every path funnels through min-checks and clamps.

The real risks are in **persistence discipline**, not geometry:

1. `AppSettings` hands every caller the **same mutable instance** and the codebase does
   unlocked read-modify-write on it from two threads, with a cache that can be replaced
   mid-flight (`Load(forceReload: true)`). This is a genuine lost-update race (W1).
2. Two **hardcoded 1600×1200 caps** silently disable *both* the remembered size and the
   mirror for drag-resizes beyond them — DPI-blind, inconsistent with the
   `set_window_size` path, and the likely root cause of a future "my size won't stick"
   report on large or high-DPI displays (W2).
3. Mixed-DPI coordinate spaces (`Screen.*` vs `Form` bounds under PerMonitorV2) are used
   interchangeably without conversion; correctness is plausible but unverified on a
   mixed-DPI rig (W3).
4. `AppSettings.Save` swallows every failure silently and writes the autostart registry
   value on **every** save (W4).

## Findings overview

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| W1 | Lost-update race: shared mutable settings instance + `forceReload` cache swap | **High** | OPEN |
| W2 | 1600×1200 persist cap: hardcoded, DPI-blind, drops mirror *and* remembered size | **High** | OPEN |
| W3 | Mixed-DPI unit risk: `Screen` geometry vs `Control` bounds (PerMonitorV2) | Medium | OPEN (needs mixed-DPI repro) |
| W4 | `Save` swallows all failures; registry write inside every save | Medium | OPEN |
| W5 | Drag-resize while Settings is open: user's size silently discarded; transient value not re-clamped | Low/Med | OPEN (design gap) |
| W6 | `reset_window_size` bypasses `ClampSize` — oversized window on small displays | Low/Med | OPEN |
| W7 | Exit flush races the async hide-persist → stale position on shutdown | Low/Med | OPEN |
| W8 | `OnResizeEnd` does synchronous disk+registry I/O on the UI thread per drag end; also fires on move-end | Low | OPEN |
| W9 | WM_GETMINMAXINFO modified then forwarded to `base.WndProc` | Low | VERIFIED SAFE on net10.0.202 (probe) |
| W10 | Magic-number duplication; persist policy lives outside the pure-policy layer; 3.6k-line `MainForm` | Low | OPEN |
| W11 | No corruption/fallback tests for `AppSettings.Load` (`.bak` path untested) | Low | OPEN |

**Corruption & out-of-bounds handling: verified sound.** Detail in §3.

---

## 1. Detailed findings — High

### W1 (High) — Lost-update race on the shared mutable settings instance

**Where**: `Services/AppSettings.cs:119` (`Load`), `:183` (`Save`), `:126-128` (forceReload
cache swap), `:207-210` (`Save` re-points the cache); consumers: `MainForm.cs:1228-1249`
(`HideWindow` persists geometry on a thread-pool worker), `MainForm.cs:990` and `:922`
(`Load(forceReload: true)` per summon/toggle), `MainForm.cs:405-422` (`OnResizeEnd`),
every mutating RPC in `MainForm.RpcDispatch.cs`.

**Problem**: `Load()` returns the *shared* cached instance (the doc comment on `Load`
even blesses "mutate then Save"), but mutation happens **outside** `_gate`. Two hazards
follow:

1. **Cache time-travel.** A worker holding instance `A` (fetched before a
   `forceReload`) can `Save(A)` *after* the cache has been replaced with a fresher `B`
   and after `B`'s changes were persisted: `Save` ends with `_cached = data`, so the
   cache — and via the next `Save`, the file — reverts to the worker's older object.
   Concrete interleave:
   - `HideWindow` queues its `Task.Run` persist (holds `A`);
   - user hits the hotkey → `ShowWindow` → `Load(forceReload: true)` creates `B` from
     disk, `cached = B`;
   - any RPC (e.g. `set_theme_color`) loads `B`, mutates, saves — file has the change;
   - the worker's `Save(A)` lands last → **the theme change is gone** from the file and
     the cache.
2. **Torn snapshots.** `Save` serializes under `_gate`, but the properties it serializes
   are being mutated on the shared instance without the lock, so a snapshot can capture
   a half-applied update (e.g. `WindowWidth` written, `WindowHeight` not yet).

The window is narrow (milliseconds around a hide), but it opens on every hide, and the
app hides constantly. Consequence: silently lost user settings — no error, no trace.

**Recommendation**: make read-modify-write atomic at the source:

```csharp
public static void Update(Action<AppSettingsData> change)
{
    lock (_gate)
    {
        var s = LoadUnlocked();          // or clone the cached instance
        change(s);
        SaveUnlocked(s);                 // already under the same lock
    }
}
```

Route every background persist (hide-flush) and every RPC mutation through it; keep
read-only call sites on `Load()`. Alternatively return deep clones from `Load` and merge
in `Save` — but `Update` is the smaller change.

### W2 (High) — The 1600×1200 persist cap silently drops both remembered size and mirror

**Where**: `MainForm.cs:413` (`OnResizeEnd`: `Width <= 1600 && Height <= 1200` gates the
*entire* save), `MainForm.cs:1241` (`HideWindow` persist, same literals), contrast
`MainForm.RpcDispatch.cs:1434-1437` (`set_window_size` clamps to
`workingArea − EdgeMargin·2` instead).

**Problems**:

- **Inconsistent policy**: drag-resizes cap at 1600×1200; frontend-driven resizes cap at
  the display's working area. Same user action, different rules per entry path.
- **DPI-blind**: the literals are compared against `Form.Width/Height`, whose unit space
  under PerMonitorV2 depends on the window's DPI (§W3). On a 2560×1440 or 4K display a
  drag beyond 1600 units is a perfectly ordinary resize — and the cap trips.
- **Silent double data-loss**: when the cap trips, the whole `if` body is skipped, so
  **`LastWindowWidth/Height` (the mirror) is not written either**. The next summon
  reverts to the stale mirror while RememberWindowSize=ON users silently lose the size
  they just chose. No toast, no log — a textbook "my size won't stick" bug with zero
  diagnostics.
- **Mirrored in `HideWindow`** with the same literals (third copy counting the min
  checks), so the two paths can drift independently.

Note `WindowSizePolicy.Resolve` itself has **no upper bound** — oversized persisted
values are clamped to the target display at show time (`ClampSize`), so the show path
never needed the cap; only the persist path invented one.

**Recommendation**: delete the upper cap from `OnResizeEnd`/`HideWindow` (the show-time
clamp already makes any persisted value safe), or centralize it as
`WindowSizePolicy.MaxPersistWidth/Height` if a cap is genuinely wanted — and in either
case **always write the mirror** (clamped), so it can never go stale. Add a
cross-file const-agreement test mirroring the existing compact-360×260 one.

---

## 2. Detailed findings — Medium

### W3 (Medium) — Mixed-DPI coordinate spaces, and WM_DPICHANGED handled before the base scale

**Where**: csproj `ApplicationHighDpiMode=PerMonitorV2` + `Program.cs:118`
(`SetHighDpiMode`); mixing points: `MainForm.cs:267-292` (`EnsureOnScreen` combines
`Cursor.Position` + `Screen.AllScreens` rects with `Form.Left/Top/Width/Height`),
`MainForm.cs:977-1083` (`ShowWindow` derives positions from `Screen.FromPoint` and
assigns them to `Location`), `MainForm.cs:570-575` (ctor resolves startup size against
`Screen.PrimaryScreen?.WorkingArea`), `MainForm.cs:849-877` (WM_DISPLAYCHANGE /
WM_DPICHANGED branch).

**Problem**: under PerMonitorV2, `Screen`/`Cursor` values and `Control` bounds do not
necessarily live in the same unit space (WinForms scales control coordinates per the
window's DPI; monitor rects come from Win32 monitor info). The code mixes them freely
and without conversion. Whether this is benign depends on the WinForms version's exact
coordinate model; it is *plausible* it works on single-DPI setups and misplaces or
mis-clamps windows on mixed-DPI rigs (e.g. remembered position from a 100% monitor
replayed on a 150% monitor; clamp math off by the scale factor). None of the pure
geometry tests can catch this by construction.

Secondary: the WM_DPICHANGED branch runs `EnsureOnScreen()` **before**
`base.WndProc(ref m)`, i.e. before WinForms rescales the window for the new DPI — the
clamp is computed against pre-change geometry, and the `Size+1 / Size` nudge hack
(`:864-871`) re-lays-out the WebView but does not re-validate bounds after scaling.

**Recommendation**: verify once on a mixed-DPI rig (100% + 150%, window dragged between
monitors, monitor removed while hidden). If misplacement is observed, normalize at the
mixing points (`LogicalToDeviceUnits` / `DeviceDpi`, or do all candidate math in one
space), and move the `EnsureOnScreen` re-validation to *after* base processing (or
defer it via `BeginInvoke`) so it clamps post-scale bounds.

### W4 (Medium) — `AppSettings.Save` swallows every failure; registry write inside every save

**Where**: `Services/AppSettings.cs:183-212`.

**Problems**:

- The whole write sequence (`tmp` write → `.bak` copy → `Move`) sits in one bare
  `catch { }`. If `File.Move` fails (AV lock, read-only share, disk full), the caller
  believes it persisted, `_cached = data` is skipped, and the next `forceReload`
  silently reverts the UI. No log, no retry, no surfaced error.
- `SetStartWithWindows(data.StartWithWindows)` executes **inside every `Save`** — so
  every drag-resize end, morph completion, hide-flush and settings toggle opens the
  `Run` registry key and rewrites the value. Wasteful, side-effectful, and a registry
  failure would abort the *settings* write half-done (file already moved, cache not
  updated).

**Recommendation**: log failures (`Debug.WriteLine` at minimum; the codebase already
uses that pattern in `ApplyScreenCaptureProtection`), expose a `LastSaveError` for
diagnostics, sync the registry only when `StartWithWindows` actually changed (compare
against `GetStartWithWindows()` first), and keep the registry call outside the file-I/O
critical section.

---

## 3. Corruption & out-of-bounds handling — verified sound

Traced every path a bad dimension value can take:

- **Unparseable JSON / wrong types / out-of-int-range numbers** → `Deserialize` throws →
  caught → `.bak` fallback → defaults. ✔
- **Negative or sub-minimum `WindowWidth/Height`/`LastWindow*`** (e.g. `-500`, `100×100`)
  → rejected by the min-checks in `WindowSizePolicy.Resolve`
  (`Services/WindowSizePolicy.cs:80-102`), falls through mirror → default. ✔
- **Huge values** (`int.MaxValue`) → pass the min-check but are clamped to the display's
  working area by `ClampSize`, never below the app minimum. ✔
- **Off-screen remembered position** (`WindowX/WindowY` on a disconnected monitor, or
  corrupt coordinates) → `IsPositionUsable` requires a ≥120×80 footprint on an attached
  display, else recenters on the cursor/primary (`MainForm.cs:1043-1058`); every mode
  then funnels through `ClampToWorkingArea` (`MainForm.cs:1079-1082`) and
  `EnsureOnScreen` runs unconditionally after positioning. The one-pixel-sliver
  regression is covered by `WindowPlacementTests.OnePixelSliverIsNotTreatedAsVisible`. ✔
- **Minimized parking spot** (`-32000,-32000`) → `HideWindow`'s
  `hx > -10000 && hy > -10000` guard skips the persist. ✔
- **Min-size enforcement** (drag/JS resize below 300×240) → verified working, see §W9. ✔

Gap: none of this is tested at the `AppSettings` layer — see §W11.

---

## 4. Detailed findings — Low

### W5 (Low/Med) — Transient-size lifecycle gaps

**Where**: `MainForm.cs:409` (`OnResizeEnd` returns early when `_transientSize`),
`:997-1010` (`ShowWindow` re-applies `_transientSizeValue`).

- A drag-resize while the Settings view is open is correctly *not persisted* — but the
  dragged size is also not recorded into `_transientSizeValue`, so the next summon
  re-applies the pre-drag transient size and the user's drag is silently discarded.
- `_transientSizeValue` is never re-clamped to the current display when re-applied; if
  the monitor changed while hidden, the re-applied transient size can exceed the new
  working area (position is clamped; size is not).

**Recommendation**: in `OnResizeEnd`, when `_transientSize`, update
`_transientSizeValue = new Size(Width, Height)` (still non-persisting); re-clamp the
value through `WindowPlacement.ClampSize` at re-show.

### W6 (Low/Med) — `reset_window_size` bypasses `ClampSize`

**Where**: `MainForm.RpcDispatch.cs:1483-1533`. The handler sets
`Size = new Size(resetW, resetH)` directly; unlike `set_window_size` (`:1434-1437`) it
never clamps to the current working area. On a display smaller than Standard 960×720
(small VM, tiny laptop), Reset produces an oversized window; only the *next* show's
position clamp partially mitigates it, and size stays wrong until then.

**Recommendation**: run the reset target through
`WindowPlacement.ClampSize(target, curScreen, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)`
like every other resize path.

### W7 (Low/Med) — Exit flush can race the async hide-persist

**Where**: `MainForm.cs:1228-1249` (hide persist on `Task.Run`), `:299-310`
(`PerformCleanExitFlush`), `:845` (`WM_ENDSESSION` → flush).

A hide immediately followed by exit (tray → Exit, shutdown, logoff) can commit the
*pre-hide* geometry: `PerformCleanExitFlush` saves the cached snapshot without waiting
for the pending worker, and per §W1 both mutate the shared instance.

**Recommendation**: persist geometry synchronously on the UI thread when a shutdown
flush is pending (one-off cost is fine), or track and join the pending persist task.

### W8 (Low) — `OnResizeEnd` does synchronous disk + registry I/O on the UI thread

**Where**: `MainForm.cs:405-422`.

Every drag end serializes settings, writes `settings.json.tmp`, copies `.bak`, moves
the file, and (per §W4) touches the registry — all on the UI thread. `HideWindow` was
deliberately moved off-thread (the H8 comment), `OnResizeEnd` was not; on AV-scanned
directories this is a visible hitch. `OnResizeEnd` also fires after a pure **move** (the
modal loop covers both), writing identical values each time.

**Recommendation**: debounce (e.g. 300 ms timer) or off-load via the §W1 `Update` API,
and skip the write when `Width/Height` match the cached values.

### W9 (Low) — WM_GETMINMAXINFO forwarded to `base.WndProc` — verified safe, pattern fragile

**Where**: `MainForm.cs:806-817`.

The handler edits `MINMAXINFO` and then falls through to `base.WndProc(ref m)`. Win32
documentation describes `DefWindowProc` as filling the struct with defaults, which
would clobber the edit — so this audit built a two-form probe (modify-then-base vs
canonical modify-and-return, both setting `ptMinTrackSize = 500×400`, message replayed
via `SendMessage`) and ran it against **net10.0.202**:

```
A_modify_then_base:   ptMinTrackSize = 500 x 400   ← MainForm's pattern: works
B_modify_then_return: ptMinTrackSize = 500 x 400   ← canonical pattern: works
```

**Conclusion: the 300×240 minimum is currently enforced; no bug.** The residual risk is
version fragility — correctness depends on `base`/`DefWindowProc` not re-filling the
struct, which a framework update could change. Optional hardening: set
`MinimumSize = new Size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)` on the form (framework-
native, version-proof) and delete the custom handler, or keep the handler but `return`
without the base call.

### W10 (Low) — Policy duplication and architecture debt

- `1600/1200` appear as literals in two files (`MainForm.cs:413`, `:1241`) — third copy
  if one counts the min-size gate; the compact-360×260 cross-file agreement is tested,
  the caps are not.
- Persist-time policy (caps, mirror-vs-remembered decisions) lives in `MainForm` and
  `RpcDispatch` while show-time policy was properly extracted into pure, tested statics.
  `WindowSizePolicy.Resolve` has no upper-bound concept, so the persist cap exists
  nowhere in the policy layer.
- Resize/geometry logic spans `MainForm.cs` (show/hide/morph/WndProc),
  `MainForm.RpcDispatch.cs` (set/reset) and two policy classes; `MainForm` itself is
  3,603 lines. Extracting a small `WindowGeometryService` (persist + transient + mirror)
  would give the whole lifecycle one testable seam.

### W11 (Low) — No corruption tests for `AppSettings.Load`

The `.bak` fallback and default-recreation are the last line of defense for corrupted
settings and are currently unexercised by tests (the class is file-bound and static).
Cheap fix: extract the settings path (ambient `Func<string>` or constructor parameter)
and add tests for: truncated JSON, valid-JSON-wrong-types, `.bak` fallback, empty file,
both files corrupt → defaults. The `DataLifecycleInvariantTests` pattern is a good
template.

---

## 5. What is done well (keep)

- **Pure policy split**: `WindowSizePolicy` / `WindowPlacement` are WinForms-free,
  deterministic, and carry 27 targeted tests including negative-origin secondaries,
  disconnected displays, and degenerate working areas.
- **Atomic-ish write strategy**: tmp → `.bak` copy of previous → move, giving one-level
  rollback on corruption; `AbandonedMutexException` handling in `Program.cs`.
- **Position-usable guards**: the 120×80 footprint requirement (vs the old
  one-pixel `IntersectsWith`) plus an unconditional `EnsureOnScreen` after every
  positioning mode, and anchor-to-cursor with primary fallback.
- **The transient/mirror/remembered authority model** is coherent, documented in
  comments and plans, and genuinely fixes the summon-flicker class of bugs; the
  `persist=false` contract is enforced end-to-end (Settings open, lightbox, modals).
- **Suppression flags** (`_suppressResizeSave`) are consistently reset in `finally`
  blocks and in the morph tick's catch path.

## 6. Recommended fix order

1. **W1** — `AppSettings.Update` (atomic RMW under `_gate`); reroute hide-flush + RPCs.
2. **W2** — delete/centralize the 1600×1200 cap; always write the mirror; add the
   const-agreement test.
3. **W4** — stop swallowing save failures; move the registry sync out of the hot path.
4. **W6 + W5** — clamp `reset_window_size`; refresh/re-clamp the transient value.
5. **W3** — one mixed-DPI verification pass; then normalize or document as verified.
6. **W7, W8** — shutdown-flush ordering; debounce `OnResizeEnd` persistence.
7. **W9, W10, W11** — optional hardening (form `MinimumSize`), policy extraction,
   corruption tests.

## 7. Verification notes

- `dotnet build DualClip.csproj` — **compiles cleanly**; only MSB3021/MSB3027 copy-lock
  errors because the running app (PID 6304) held `bin/Debug/net10.0-windows/DualClip.exe`.
- WM_GETMINMAXINFO probe — compiled and run against net10.0.202 (see §W9); scratch
  project deleted after the experiment.
- Full test suite not executed this session (app running; `dotnet test` needs the
  apphost copy). Suggested gate after fixes:
  `dotnet test --filter "FullyQualifiedName~WindowSizePolicy|FullyQualifiedName~WindowPlacement"`.
