# Audit — Window Sizing, Mode Sync & Summon Flicker

Scope: summon flicker (680x543 flash before 360x260), the C#/WebView2 size-authority split, and every failure mode the split enables.

---

## 1. Root-Cause Analysis

### 1.1 The core defect: two different definitions of "what size is the window"

The C# backend and the WebView2 frontend each own half of the window-size state, and their
sources of truth disagree at the exact moment a summon needs them to agree.

| State | Owner | Source of truth |
|---|---|---|
| Layout preset (`compact` / `standard` / `expanded`) | JS | `localStorage['dualclip_layout_preset']` (TASK-002 deleted the C# mirror) |
| Size preset (`dualclip_size_preset`) | JS | localStorage (bundle output of the layout preset) |
| `RememberWindowSize`, `WindowWidth`, `WindowHeight` | C# | `settings.json` |
| Live OS window bounds | C# | WinForms |

`dualclip_layout_preset` (the master macro preset) and `dualclip_size_preset` (a
lower-level detail knob) can diverge — the user can change **Main Window Size** in the
Quick View menu without touching **Layout Preset**. The preset knowledge
(`compact=360x260`, `default=680x543`, `large=900x940`) exists **only** in JS
([settings-appearance.js](../../ui/js/settings/settings-appearance.js), `applyWindowSizePreset`).
C# has only `DEFAULT_WINDOW_WIDTH/HEIGHT = 680x543` ([MainForm.cs:184](../../MainForm.cs#L184)).

### 1.2 Why the summon flicker happens (warm path, hotkey/tray)

Summon calls `MainForm.ShowWindow()` ([MainForm.cs:914](../../MainForm.cs#L914)):

1. `AppSettings.Load()` is read. It contains only `RememberWindowSize` / `WindowWidth` /
   `WindowHeight` — no knowledge of the layout preset.
2. `RememberWindowSize == false` (the default) → the `else if` at
   [MainForm.cs:964](../../MainForm.cs#L964) **force-resets the window to
   `DEFAULT_WINDOW_WIDTH/HEIGHT` (680x543)**, deliberately discarding whatever bounds the
   window had when it was hidden.
3. The window is shown at 680x543. `PostEventToJs("onWindowShow")` fires
   ([MainForm.cs:1045](../../MainForm.cs#L1045)).
4. Only when the WebView2 message pump delivers it does JS run
   `applyWindowSizePreset('compact')` ([keyboard.js:1323](../../ui/js/keyboard.js#L1323)) →
   `set_window_size(360, 260)` → `StartBoundsMorph` (a **180 ms** tween).
5. The user watches: 680x543 → (some frames later) → 360x260. The visible
   artifact is a **snap-flash-shrink** on every single summon.

`onWindowShow` is round-tripped through the WebView2 message loop *after* the window is
already composited on screen, so no amount of JS-side optimization can eliminate the
flash — the wrong size is already visible.

### 1.3 Why the cold boot flicker happens

Constructor: `Width = 680; Height = 580` (680x543 only if `RememberWindowSize` is on).
`StartPosition = CenterScreen`. For `startHidden` the form never shows. For a visible
start, `RevealColdStart()` fires after a 1 s timer and calls `ShowWindow()` — the same
Remember-OFF reset to 680x543 — while the JS hydrate path
([settings-core.js:358](../../ui/js/settings/settings-core.js#L358)) issues
`applyWindowSizePreset('compact')` as an **independent RPC** from the show event. The two
resizes race; whichever lands last wins, and the user sees an intermediate size.

### 1.4 Why the divergence persists (no feedback loop)

* **The persisting-resize mirror is missing.** When JS calls
  `set_window_size(360, 260, animate, persist=true)`, the C# handler writes
  `AppSettings.WindowWidth/Height` only if `RememberWindowSize` is already ON — but
  never records the *actual window bounds as the authoritative last-known size*.
  `HideWindow()` persists position unconditionally but size only when `RememberWindowSize`
  is ON. So with Remember OFF, C# never learns that "the user's last size was 360x260",
  and its Show-time policy falls back to hardcoded 680x543.
* **`dualclip_size_preset` can diverge from the real window.** Quick View lets the user
  set **Main Window Size** (`dualclip_size_preset`) independently of the layout bundle, so
  JS's own `getEffectiveViewMode()`-based guess (`compact → 360x260`) can be wrong.

### 1.5 Summary of the causal chain

```
Preset table lives only in JS (localStorage)
        │
        ▼
C# ShowWindow knows nothing about the active preset (TASK-002 mirror deleted)
        │
        ▼
RememberWindowSize==false branch hard-resets to DEFAULT 680x543   ◄── the flash
        │
        ▼
Window shown at wrong size; onWindowShow round-trips after first paint
        │
        ▼
JS resizes to 360x260 via a 180 ms morph  ◄── the snap
```

---

## 2. Edge Cases & Failure Modes

| # | Scenario | Current behavior | Failure |
|---|---|---|---|
| E1 | **Multi-monitor, mixed DPI** (popup near-cursor across a 100 % and a 150 % display) | `Screen.FromPoint(cursor)` picks the target display's WorkingArea; position is clamped by `WindowPlacement`. PerMonitorV2 is set ([Program.cs](../../Program.cs)). | Correct-ish, but the preset pixel dimensions (e.g. 360x260) are physical px on the target monitor. C# never tells JS the active scale, and a show on monitor B may re-clamp a size tuned on monitor A. Bounds are still inside the working area (no taskbar overlap), but the *effective* UI size differs per monitor. |
| E2 | **Large → Compact on a small display** (900x940 window, switch to compact 360x260, cursor near bottom-right) | Show-time clamp keeps the smaller window fully inside; JS then re-anchors nothing — the morph keeps the top-left fixed (`_morphFromLoc`). | On the downward switch the window shrinks toward its top-left, so the visual anchor drifts up/right; the size fits but the position jumps. On a 1366x768 display, Large at 940 px height is clamped to ~748 — C# remembers the *clamped* value while JS's preset table still says 940. |
| E3 | **RememberWindowSize ON** | ShowWindow restores `WindowWidth/Height` — whatever was last persisted, which can be a *Settings* size (900x940) if Settings was open at hide time on older builds (transient flag now guards this), or a lightbox-enlarged size if it was open at hide time ([modals.js](../../ui/js/overlays/modals.js) still persists! see E6). | The "remembered" size silently diverges from the active mode preset; mode switch appears to "not stick" after some hides. |
| E4 | **RememberWindowSize OFF** | ShowWindow hard-resets to 680x543. | The exact flash under audit; also makes Compact/Large modes impossible to summon without a resize dance. |
| E5 | **Settings window isolation** | `set_window_size(900, 940, animate, persist=false)` sets `_transientSize`; `OnResizeEnd` and `HideWindow` skip persisting while transient; ShowWindow re-applies the transient value. On `closeSettingsView()` JS re-applies the History preset. | Mostly correct **as long as no persisting resize happens while Settings is open** — see E6. |
| E6 | **Compact modal / lightbox expand while Remember ON** | `modals.js` compact-expand calls `set_window_size(targetW, targetH, true)` — **missing the 4th `persist=false` argument** (lightbox passes it correctly). | With RememberWindowSize ON, opening a dialog in Compact mode writes the expanded size into `WindowWidth/Height`. Next summon restores the *dialog* size in History. Direct leak of the exact class E5 was built to prevent. |
| E7 | **Cold startup** (visible start) | Constructor sizes the form, then a 1 s reveal timer + independent JS hydrate RPC resize race. | First-paint size is a coin flip; even when the winner is correct, the loser produces one visible resize. |
| E8 | **Warm tray summon vs hotkey summon** | Identical path after `ToggleWindow`. Position mode differs (`TrayPositionMode` vs `WindowPositionMode`) only. | Same flicker either way; tray position modes suffer the same wrong-size-first-paint. |
| E9 | **`last` position mode + preset change** | Saved `WindowX/Y` validated against attached displays (`IsPositionUsable`) and clamped. | Sound. Only the *size* authority is broken, not position. |
| E10 | **Zoom (110/125 %) is JS-only state** | `applyWindowSizePreset` multiplies preset dims by `currentZoomLevel`. C# presets cannot reproduce that arithmetic. | Even a perfect preset mirror in C# must be *fed by JS* (or normalized), otherwise zoomed presets (396x286) would not round-trip. |

---

## 3. Fix Architecture (zero-flicker summon)

Design goals: single-writer principle, native sizing decided *before* the window is shown,
JS remains the sole owner of preset semantics, JSON-RPC contract unchanged, zero build
warnings under `-warnaserror`.

### 3.1 Tenet: the native side must never learn preset names

TASK-002 intentionally deleted the C# ViewMode mirror — do not re-add a `ViewMode`
property. Instead, keep **one boolean of state** on the native side:

```csharp
// Services/AppSettings.cs (AppSettingsData)
// Mirror of the size the frontend last asked for via a persisting set_window_size.
// Not a mode/preset mirror (TASK-002): JS remains the only owner of preset
// semantics; C# just replays the last bounds it was told about. Written by the
// set_window_size RPC and StartBoundsMorph completion; never parsed, never mapped.
public int LastWindowWidth { get; set; } = 0;   // 0 = "unknown"
public int LastWindowHeight { get; set; } = 0;
```

### 3.2 `WindowSizePolicy` — a pure, testable show-time policy

New file `Services/WindowSizePolicy.cs` (pure, no WinForms, mirror-image of
`WindowPlacement` which is already pure and unit-tested):

```csharp
namespace DualClip.Services;

/// <summary>
/// Pure show-time size policy for the clipboard popup. Decides, before the window
/// is revealed, which bounds a summon should restore — so the native side never
/// has to wait for an onWindowShow round-trip to discover its own size.
///
/// Authority rules, in order:
///   1. RememberWindowSize ON  → the persisted WindowWidth/Height always wins.
///   2. RememberWindowSize OFF → the frontend's last explicitly-applied size wins
///      (the active layout preset's dimensions), so a Compact summon appears at
///      Compact dimensions on the very first frame. 0/unknown → DEFAULT 680x543.
///   3. The result is clamped to the physical working area; a display smaller
///      than the preset shrinks it, never below the app minimum.
/// </summary>
public static class WindowSizePolicy
{
    public const int DefaultWidth  = 680;
    public const int DefaultHeight = 543;

    public static (int width, int height) Resolve(
        bool rememberWindowSize,
        int rememberedWidth,
        int rememberedHeight,
        int lastWindowWidth,
        int lastWindowHeight,
        Rectangle workingArea,
        int minWidth,
        int minHeight)
    {
        int w = DefaultWidth, h = DefaultHeight;

        if (rememberWindowSize && rememberedWidth >= minWidth && rememberedHeight >= minHeight)
        { w = rememberedWidth; h = rememberedHeight; }
        else if (lastWindowWidth >= minWidth && lastWindowHeight >= minHeight)
        { w = lastWindowWidth; h = lastWindowHeight; }

        var clamped = WindowPlacement.ClampSize(new Size(w, h), workingArea, minWidth, minHeight);
        return (clamped.Width, clamped.Height);
    }
}
```

`RememberWindowSize` ON wins over the mirror (explicit user choice). OFF replays the
mirror — the active mode's size — instead of the hardcoded default.

### 3.3 C# wiring (MainForm.cs)

**(a) Constructor** — apply the policy at process start, so even the first reveal is
already at preset dimensions:

```csharp
var settings = AppSettings.Load();
_listener.ApplySettings(settings);
// Size the form from the pure policy instead of the Remember-only branch, so a
// cold start already sits at the active preset's dimensions before first paint.
var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1080);
var (sw, sh) = WindowSizePolicy.Resolve(
    settings.RememberWindowSize, settings.WindowWidth, settings.WindowHeight,
    settings.LastWindowWidth, settings.LastWindowHeight, area, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
Width = sw; Height = sh;
```

**(b) `ShowWindow()`** — replace the three-branch `if/else if/else if` size block with the
policy call. Crucially, the resolution happens **before** `Show()`/`Activate()`, so the
window is composited at the correct size on its first frame:

```csharp
var screen = Screen.FromPoint(cursor).WorkingArea;   // move up: needed for size too
var (w, h) = WindowSizePolicy.Resolve(
    settings.RememberWindowSize, settings.WindowWidth, settings.WindowHeight,
    settings.LastWindowWidth, settings.LastWindowHeight, screen, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
if (Width != w || Height != h) { _suppressResizeSave = true; try { Size = new Size(w, h); } finally { _suppressResizeSave = false; } }
// ...existing transient-size branch keeps priority when Settings is still open...
```

*Ordering inside ShowWindow:* transient (Settings) branch first, then the policy. The
transient branch exists so an open Settings view is not shown at History dimensions; it
must keep priority over the mirror replay.

**(c) Mirror writes** — every place the *persisting* size changes updates the mirror
*at the moment the size is applied*, not on hide:

```csharp
private static void MirrorLastWindowSize(Size s)
{
    var s_ = AppSettings.Load();
    if (s_.LastWindowWidth != s.Width || s_.LastWindowHeight != s.Height)
    {
        s_.LastWindowWidth = s.Width;
        s_.LastWindowHeight = s.Height;
        AppSettings.Save(s_);
    }
}
```

Call sites:

1. **`set_window_size` RPC handler, non-animated path** — when `persist == true`,
   `MirrorLastWindowSize(targetSize)` right after `Size = targetSize`.
2. **`StartBoundsMorph` completion** (`MorphTimerTick` at `t >= 1.0`) — when
   `_morphPersistOnComplete`, mirror `Size` alongside the existing
   `RememberWindowSize`-gated write.
3. **`OnResizeEnd`** (user drag-resize) — when not `_transientSize`, mirror the new size
   regardless of `RememberWindowSize` (the mirror is "last size the UI was actually at",
   not a Remember-dependent value).

**Deliberately NOT mirrored** (`persist=false` transient resizes: Settings 900x940,
lightbox expand, modal expand) — that is the entire point: transient geometry never
becomes the replay authority.

### 3.4 JS: make the one persisting path reliable

[ui/js/overlays/modals.js](../../ui/js/overlays/modals.js): the compact modal expand calls
`set_window_size(targetW, targetH, true)` — the bridge defaults `persist=true` here, so
dialog geometry leaks into the remembered size (E6). Add the explicit `persist=false`
argument (the lightbox already passes it; a rpc-bridge-invariants guard is added to keep
it that way).

### 3.5 Why this yields a 0 ms summon

* `ShowWindow` resolves the target size **synchronously, before `Show()`**. The OS window
  is shown with the correct bounds; there is no second resize to paint.
* No JS involvement: no `onWindowShow` round-trip, no morph, no flash. The existing
  keyboard.js handler becomes a harmless no-op (`Width == target` → `Size` assignment is
  skipped by the `if (Width != w || Height != h)` guard, and `applyWindowSizePreset`'s
  `set_window_size(360,260)` lands on an already-correct window — the C# handler skips
  the resize when bounds match... the guard is `Width != settings...`-style checks in the
  handler; adding the same equality guard to the RPC handler makes the redundant JS call a
  true no-op).
* Cold start: constructor applies the same policy → first reveal is already correct.
* Warm summon: `HideWindow` no longer destroys the last size (Remember OFF), so the
  window's *actual* bounds are preserved between summons and merely validated by the
  policy on the next show.

### 3.6 What stays the same

* JSON-RPC surface: `set_window_size` keeps `(w, h, animate?, persist?)`; `persist` keeps
  defaulting to true; response shape `{ ok, width, height }` unchanged.
* `WindowPlacement` position pipeline (cursor/center/last/clamp) untouched.
* `StartBoundsMorph` still animates *user-initiated* mode switches — the tween is
  desirable when the user clicks Compact→Large; it is only wrong when it runs at summon
  time, which this design removes.
* The `DEFAULT_WINDOW_*` constants remain for `reset_window_size` and as the policy's
  fallback (GifCaptureTests pins them).

---

## 4. Residual risks & mitigations

* **E10 (zoom)**: the mirror replays *actual* requested pixels (already zoom-multiplied by
  JS), so zoom round-trips without C# ever knowing a zoom exists. If the user changes zoom
  while Remember is OFF, the next JS-driven mode application updates the mirror; the
  summon-flicker window (summon → JS resize) is bounded by one RPC round-trip *only in the
  zoom-changed-mid-session case*, which is rare and self-heals on first apply.
* **E2 (clamped presets)**: resolution clamps against the current working area each show,
  so a preset larger than the display shrinks instead of overflowing; the mirror stores the
  requested (unclamped) size, which self-corrects on any show.
* **First launch ever** (mirror = 0/0): falls back to 680x543 — identical to today's
  behavior, then tracks the preset after the user's first JS apply (boot hydrate issues
  `applyWindowSizePreset` for non-standard layouts even with Remember OFF).
* **Concurrent settings writes**: all mirror writes go through `AppSettings.Save`'s lock;
  `Load()` returns the cached instance mutated under the same lock discipline already used
  by tray handlers.
