# Window Lifecycle & Sizing

## Overview
| Concern | File |
| :--- | :--- |
| Size policy (pure, unit-testable) | [`Services/WindowSizePolicy.cs`](../../Services/WindowSizePolicy.cs) |
| Placement / clamping (pure) | `Services/WindowPlacement.cs` |
| Window class, morph, show/hide | [`MainForm.cs`](../../MainForm.cs) |
| Sizing RPC handlers | [`MainForm.RpcDispatch.cs`](../../MainForm.RpcDispatch.cs) |
| Size presets UI | [`ui/js/settings/settings-appearance.js`](../../ui/js/settings/settings-appearance.js) |

`WindowSizePolicy` and `WindowPlacement` are deliberately **free of any WinForms dependency** — mirror images of each other — so both can be unit tested without constructing a window or touching a display.

---

## 📐 Layout presets

| Preset | Size |
| :--- | :--- |
| Standard (`default`, `large`, `expanded`) | `970 × 730` |
| Compact | `360 × 260` |

Compact is `360 × 260`, **not** `380 × 580` as earlier revisions of this page claimed. `Large` mode was removed; `ResetSizeFor` falls back to Standard for any unrecognized or null layout (`WindowSizePolicy.cs:54-61`).

---

## 🎯 Show-time size policy

`WindowSizePolicy.Resolve` decides bounds **before the window is revealed**, in this order:

1. **`RememberWindowSize` ON** → the persisted `WindowWidth`/`WindowHeight` always win (an explicit user choice to keep a size).
2. **`RememberWindowSize` OFF** → the frontend's `LastWindowWidth`/`LastWindowHeight` mirror wins, so a Compact summon appears at Compact dimensions on the first frame. A `0`/unknown mirror falls back to `970 × 730`.
3. The result is clamped to the target display's working area, never below the app minimum.

This ordering is the fix for the Compact summon flicker: waiting for an `onWindowShow` round-trip made the window appear at `970 × 730` before shrinking to `360 × 260`. Covered by `WindowSizePolicyTests`.

---

## 🔄 Transient vs persisted geometry

`_transientSize` marks geometry that must **not** be written to `AppSettings.WindowWidth/Height` (`MainForm.cs:232-238`).

`set_window_size`'s `persist` argument controls it:
- `persist=false` → transient. Used by Settings and the compact-modal expand (see [overlays-and-modals.md](overlays-and-modals.md)). Persisting it would leak the dialog size into the remembered size, and History would come back larger than the active layout's preset.
- `persist=true` → persisted. Used by manual resize, preset selection, and the modal *restore*.

The frontend shim defaults `persist` to **true** (`bridge.js:137`), so transient callers must pass `false` explicitly.

Morph transitions between sizes run over `MorphDurationMs = 180ms` (`MainForm.cs:231`), with `_morphPersistOnComplete` deciding whether the completed size is written back.

---

## 👁️ Auto-hide (blur) invariants

`Deactivate` (`MainForm.cs:765-788`) auto-hides the window unless **any** of these hold:
- `_inSequentialPaste` — Shift+Enter multi-paste is in flight.
- Less than **250ms** since `_lastShowTime` — bounce guard so the window cannot hide itself on the frame it appeared.
- `TopMost` is set — user pinned it.
- `_modalOpen` — a dialog is open (`set_modal_open`).
- The foreground window is one of our own (`IsDualClipHwnd`) — focus moved to the detached preview, not away from the app.

`_lastActiveHwnd` is tracked by a 100ms `System.Windows.Forms.Timer` so paste targets the window that had focus *before* the summon, even if it is not currently foreground.

---

## 📍 Placement guarantees

`EnsureOnScreen` requires a **usable footprint**, not mere intersection — `IntersectsWith` alone counted a one-pixel sliver as on-screen and let the popup open essentially off the display edge (`MainForm.cs:274-277`). `WindowPlacementTests` drives the geometry math directly with multi-monitor and mixed-DPI layouts.

---

## 🧪 Invariant Tests
- `WindowSizePolicyTests` — size resolution and layout-aware reset.
- `WindowPlacementTests` — multi-monitor, taskbar offsets, mixed DPI, screen clamps.
- `GifCaptureTests` — asserts the `970`/`730` constants in both the policy and the JS preset.
- `CompactAndSearchInteractionTests` — compact expand/collapse.

See [testing-matrix.md](testing-matrix.md).