# Plan: Window Sizing, Presets & State Persistence Overhaul

> SUPERSEDED (2026-10-06): Large mode removed entirely — only Compact
> (360×260) and Standard (680×540) remain. Legacy `expanded`/`large`
> values migrate to Standard/Default. Kept for history.

> Status: IMPLEMENTED with user revisions — Compact reverted to 360×260,
> Large set to 960×720 per user. Final table: Compact 360×260,
> Standard 680×540, Large 960×720. Settings transient stays 880×680.

## 0. New preset table (single source of change)

| Preset | Old | New | Why |
|---|---|---|---|
| Compact | 360 × 260 | **360 × 260 (unchanged)** | user reverted — tiny popup preferred |
| Standard | 680 × 543 | **680 × 540** | round number, same feel |
| Large | 900 × 940 | **960 × 720** | fits 768p screens unclamped (720 < 728) |

MIN stays 300 × 240 (all presets above it). No other minimum change.

## 1. Authority hierarchy (the rule everything follows)

1. **Transient** (`persist=false`): lightbox expand, modal expand, Settings-open
   enlarge. Never writes mirror or remembered size. Restore leg uses
   `persist=true`.
2. **Remember ON**: summon restores `WindowWidth/Height`.
3. **Remember OFF**: summon replays `LastWindowWidth/Height` mirror.
   Unknown (0) → Standard 680 × 540.
4. **Clamp last**: everything is clamped to the target display working area,
   never below minimum.

## 2. Exact change breakdown

### C# backend

| File | Change |
|---|---|
| `Services/WindowSizePolicy.cs` | `DefaultHeight` 543 → **540**. Add `CompactWidth/Height = 360/260`, `StandardWidth/Height = 680/540`, `LargeWidth/Height = 960/720`. Add `ResetSizeFor(layout)` helper returning the preset base (unknown → Standard). |
| `Services/AppSettings.cs` | Defaults `WindowHeight` 543 → **540**. Comments referencing 360×260/680×543 → new numbers. |
| `MainForm.RpcDispatch.cs` (`reset_window_size`, ~:1448) | Accept optional `layout` arg (`compact`/`standard`/`expanded`). With arg → resize to that preset base. Without arg → fall back to nearest-preset of the mirror, then Standard. Persist the reset (it IS a user choice). |
| `MainForm.cs` (DEFAULT consts ~:184, `ShowWindow`/`Resolve` call sites ~:563, ~:969) | Default consts → 680 × 540. No logic change — `WindowSizePolicy.Resolve` already handles it. |
| `ui/js/core/rpc-contracts.js` | `reset_window_size: { args: [], optional: ['layout'] }`. |

### Frontend

| File | Change |
|---|---|
| `ui/js/settings/settings-appearance.js` (`applyWindowSizePreset`) | Table → compact 420×380, default 680×540, large 880×640. Zoom multiply + in-settings defer unchanged. |
| `ui/js/settings/quick-view-menu.js` | Bundle unchanged in shape; `compact` bundle still maps to `windowSize: 'compact'` (new px flow through). No edit unless bundle overrides px directly. |
| `ui/js/list/actions.js` (reset flow ~:1333) | Pass active layout: `reset_window_size(getEffectiveViewMode() === 'compact' ? 'compact' : 'standard')`. Large resets to Standard base (880×640 is a mode, not a reset target). |
| `ui/js/settings/settings-core.js` (:740 Settings-open transient) | `set_window_size(900, 940, false, false)` → **`set_window_size(880, 680, false, false)`** (fits new Large, still persist=false). Close path (:769) already re-applies `size_preset` — keep, verify no drift. |
| `ui/js/overlays/preview-lightbox.js` (:254, :569) | Expand target 620×480 stays (fits inside 960×720). Restore fallback 360/260 (unchanged). |
| `ui/js/overlays/modals.js` (:1667) | Restore fallback 360/260 (unchanged). |
| `ui/js/list/render.js` (:2125 comment) | "only 360px wide" (unchanged). No logic change. |

### Tests

| File | Change |
|---|---|
| `DualClip.Tests/WindowSizePolicyTests.cs` | Compact 360×260 (unchanged); default 680×543 → 680×540; large 900×940 → 960×720. Small-display case (1366×728 area): large now fits → expect **(960, 720)** unclamped; smaller area (800×500) keeps one clamp case. |
| `DualClip.Tests/js-harness/mode-switch-invariants.js` | Preset table (:213–217) → new numbers. |
| `DualClip.Tests/js-harness/rpc-bridge-invariants.js` | 680/543, 360/260, 900/940 literals → new numbers. |
| `DualClip.Tests/GifCaptureTests.cs` (:78 comment) | 680×543 reference → 680×540. |
| New fact in `WindowSizePolicyTests` | `ResetSizeFor("compact") == (420,380)`; unknown layout → (680,540). |

## 3. Edge cases

- **Multi-monitor**: `Screen.FromControl` working area per summon; negative-origin (left-of-primary) covered by existing `SecondaryDisplayWithNegativeOrigin` fact. Clamp keeps presets inside; position clamp unchanged.
- **High DPI / zoom**: `target = base × zoom`, then C# clamps. Compact @125% = 525×475 — still above min, fits 768p. Large @150% = 1320×960 → clamps on laptops; accepted (mirror stores the *requested* preset, replay re-clamps per display — same as today).
- **Small display**: 1366×768 (area ~1366×728): all three presets now fit unclamped. That is the point of 880×640.
- **Cold boot / first launch**: mirror 0 → Standard 680×540 (same as today, new numbers).
- **Hide while dialog open**: transient `persist=false` already guards; restore uses `persist=true`. No change.
- **Compact + sidebar**: sidebar still auto-collapses on compact entry (420px still narrow). No change in this plan.
- **Reset while Remember ON**: reset writes remembered size too (user choice), same as current persist behavior.

## 4. Verification (implementer runs these)

```powershell
taskkill /F /IM DualClip.exe 2>$null
node --check ui/js/settings/settings-appearance.js
node --check ui/js/settings/settings-core.js
node --check ui/js/settings/quick-view-menu.js
node --check ui/js/list/actions.js
node --check ui/js/list/render.js
node --check ui/js/overlays/preview-lightbox.js
node --check ui/js/overlays/modals.js
node --check ui/js/core/rpc-contracts.js
dotnet build -c Debug -warnaserror
dotnet build -c Release -warnaserror
```

- `dotnet test` — USER-GATED (rule 6). Ask before running.
- JS harnesses (mode-switch, rpc-bridge) — re-run after literal updates.
- Manual: summon in Compact / Standard / Large; Settings open → close (size restores, no drift); Reset in Compact → 420×380, in Standard → 680×540.

## 5. Out of scope

- Sidebar-in-compact behavior, collections-bar auto-restore, `getEffectiveViewMode` expanded mapping — separate issues, not this plan.
- Knowledge regen (`scripts/build-knowledge.ps1`) after merge — docs-updater pass.
