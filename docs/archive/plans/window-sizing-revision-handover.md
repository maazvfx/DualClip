# Window Sizing — Revision Handover & Audit

**Date**: 2026-10-05
**Status**: Read-only investigation. **Nothing was fixed.** No app file was edited.
**For**: the agent picking up `docs/plans/window-sizing-persistence.md`.
**Note**: this file is uncommitted. The working tree carries other agents' uncommitted work — see §5.

---

## 1. Bottom line

The **code half of the plan is done and self-consistent**. Compact 360×260, Standard 680×540,
Large 960×720 agree across the C# policy, the C# tests, the frontend preset table, and
`AppSettings` defaults.

What remains is **documentation drift**, plus one **infrastructure question** that affects how
this plan (and ADR-002 generally) gets verified. No logic changes are needed.

---

## 2. Verified consistent — no action

| Location | Value |
|---|---|
| `Services/WindowSizePolicy.cs` `CompactWidth/Height` | 360 / 260 |
| `Services/WindowSizePolicy.cs` `StandardWidth/Height` | 680 / 540 |
| `Services/WindowSizePolicy.cs` `LargeWidth/Height` | 960 / 720 |
| `ui/js/settings/settings-appearance.js:149-151` | compact 360×260, default 680×540, large 960×720 |
| `Services/AppSettings.cs:38-39` | 680 / 540 |
| `DualClip.Tests/WindowSizePolicyTests.cs:131-135` | matches policy for compact/standard/expanded/large |
| `DualClip.Tests/WindowSizePolicyTests.cs:81-82,91` | 960×720 fits 1366×768 unclamped; clamps on tiny areas |
| `ui/js/core/rpc-contracts.js:20` | `reset_window_size: { args: [], optional: ['layout'] }` |
| `ui/js/list/actions.js:1334-1335` | passes `resetLayout` |
| `MainForm.RpcDispatch.cs:1448` | `reset_window_size` handler present (committed in `2f2d133`) |

`MIN` remains 300×240 per the plan, and all presets clear it.

---

## 3. Remaining work — documentation only

### 3.1 Stale comment in the policy file (the only stale code comment)

`Services/WindowSizePolicy.cs:22`

```
/// active layout mode, so "Reset Window Size" in Compact restores 420x380 instead
```

Should read 360×260. Line 9 of the same file was already corrected in the working tree; line 22
was missed. This is the last code-side edit the plan needs.

### 3.2 STATE.md advertises the superseded table

`docs/STATE.md` (section 1 "Current Task", section 4, and the 2026-10-05 milestone entry) still
says **420×380 / 680×540 / 880×640** in several places. The shipped table is
**360×260 / 680×540 / 960×720**. STATE.md is the file new agents read first, so this actively
misdirects.

### 3.3 The plan file contradicts its own header

`docs/plans/window-sizing-persistence.md` states the final table correctly at lines 3-5 and in
section 0, but its body still uses the **old** 420×380 / 880×640 numbers:

- **:44** — frontend preset table still lists "compact 420×380 … large 880×640"
- **:60** — test expectation still says `ResetSizeFor("compact") == (420,380)`
- **:66** — "That is the point of 880×640"
- **:69** — "(420px still narrow)"
- **:90** — manual check "Reset in Compact → 420×380"

The header is authoritative; the body is stale. Anyone re-running the plan as written would
"fix" the working code back to the old numbers.

---

## 4. Infrastructure question — needs the user's decision, not ours

These files are **deleted in the working tree** (unstaged). Intent unknown — this may be a
deliberate cleanup by another agent:

- `DualClip.Tests/js-harness/*.js` — all 6, including `mode-switch-invariants.js` and
  `rpc-bridge-invariants.js`
- `scripts/*.ps1` — all 7, including **`test-core.ps1`**
- `.agents/skills/*` — both files
- `docs/knowledge/*.md` — 6 files (`CODEMAP`, `INDEX`, `SYSTEMATIC_DEBUGGING`,
  `EXTERNAL_REVIEWER_SYNC`, `MULTI_AGENT_ROLES`), replaced by a new untracked
  `docs/knowledge/FEATURE_STATUS.md`

**Why it blocks verification:**

- The plan's §4 tells the implementer to re-run the mode-switch and rpc-bridge harnesses after
  updating literals. Both are gone. That step is currently impossible.
- ADR-002 tier 2 defines milestone testing as "targeted core/smoke tests". The designated core
  runner, `scripts/test-core.ps1`, is gone. **ADR-002 tier 2 currently has no tooling.**

**Options for the user:** accept the cleanup and re-point tier 2 at a subset of `dotnet test`
(filter by class), or restore `test-core.ps1` and the two harnesses. Do not guess — restoring
would silently undo another agent's deliberate work.

Note the knowledge-docs consolidation looks coherent (`build-knowledge.ps1` removed alongside the
docs it generated, replaced by `FEATURE_STATUS.md`), which suggests it was intentional. Confirm
before acting.

---

## 5. Uncommitted work inventory

Per the collision rule in `AGENTS.md`, none of this was touched. Ownership is unconfirmed.

**Sizing revision (belongs to this plan):**
`Services/WindowSizePolicy.cs`, `DualClip.Tests/WindowSizePolicyTests.cs`,
`ui/js/settings/settings-appearance.js`, `ui/js/list/render.js`, `ui/js/overlays/modals.js`,
`ui/js/overlays/preview-lightbox.js` — all six carry the Compact 360×260 / Large 960×720 revision.

**Other agents' work, unrelated to sizing:**
`AGENTS.md`, `docs/STATE.md`, `docs/DECISIONS.md`, `docs/plans/IDEAS.md`,
`.gitignore`, plus the §4 deletions.

**Mine:** `docs/reviews/sidebar-view-audit.md`, committed alone as `2242c7e` ("docs(review): add
read-only sidebar view and general code audit"). Nothing else was staged.

---

## 6. Suggested order once unblocked

1. Get the user's answer on §4.
2. Fix the three doc items in §3 — smallest first (3.1, then 3.3, then 3.2).
3. Tier-1 verification only, per ADR-002:
   ```
   taskkill /F /IM DualClip.exe 2>$null
   dotnet build -c Debug -warnaserror
   dotnet build -c Release -warnaserror
   node --check ui/js/settings/settings-appearance.js
   node --check ui/js/overlays/modals.js
   node --check ui/js/overlays/preview-lightbox.js
   node --check ui/js/list/render.js
   ```
   Expect 0 errors, 0 warnings.
4. Ask before any `dotnet test` (ADR-002 tier 2/3, and the user's standing instruction).
5. Only then decide the commit. The sizing revision and the cleanup deletions are **different
   concerns and should be separate commits** — do not bundle them.
6. If the §4 cleanup is confirmed intentional, add the missing ADR-002 link to STATE.md at the
   same time as the §3.2 fix.

---

## 7. Separate open item

**RESOLVED 2026-10-06.** The audit was archived to
`docs/archive/reviews/window-sizing-mode-sync-flicker-audit.md` and closed after code verification:
`WindowSizePolicy.Resolve` + `LastWindowWidth/Height` + `persist=false` all shipped, and E6's missing
4th argument is present at `ui/js/core/bridge.js:137`. Only residual remains: the open backlog item
to skip `applyWindowSizePreset` in `keyboard.js` when native bounds already match.