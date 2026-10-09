# Review — Settings layer, localStorage keys and backend mirroring

**Date**: 2026-10-05
**Type**: Read-only review. **No source file was changed.**
**Scope**: `ui/js/core/settings-defaults.js` (the declared registry), every `localStorage` read and
write of a `dualclip_*` key across `ui/js` and `ui/index.html`, the Settings UI modules
(`settings-core.js`, `settings-rules.js`, `settings-shortcuts.js`, `settings-storage.js`,
`settings-appearance.js`, `quick-view-menu.js`), and the C# settings mirror (`Services/AppSettings.cs`,
the `get_*` / `set_*` RPC pairs in `MainForm.RpcDispatch.cs`).
**Method**: mechanical extraction and diffing of every `dualclip_*` key against the declared
registry, plus a sweep of all 95 `window.pywebview.api` wrappers for call sites outside
`bridge.js` / `rpc-contracts.js`.
**Not run**: `dotnet test` (needs explicit user permission per `AGENTS.md` rule 6) and the app itself.

---

## 1. Verdict

The key registry is tidy: **87 declared keys, zero declared-but-unused** — no dead settings, which is
rarer than it sounds. Ten genuinely undeclared keys are used, and most of them are internal state
rather than user settings, so the impact is low.

The real finding is structural and systemic: **thirteen settings are write-only.** The UI pushes them
to the backend over RPC, then displays state from `localStorage` and never calls the matching
`get_*` RPC — thirteen getters exist, wired, with zero callers. Any failure on the write path is
swallowed, so the two copies drift and the UI keeps showing a value the backend never accepted, with
no way to recover except reopening Settings after a restart.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| S-P1 | 13 settings are write-only: no read-back, silent write failure, unrecoverable drift | **Medium** | new |
| S-P2 | `dualclip_suppress_in_fullscreen` is a literal two-store setting (localStorage + settings.json) | **Medium** | new |
| S-P3 | 10 `dualclip_*` keys in use are absent from the registry | **Low** | new |
| S-P4 | The registry test (if any) does not cover this class | **Low** | new |

---

## 2. Findings

### S-P1 — Thirteen settings are write-only (Medium)

A sweep of every bridge wrapper for call sites outside `bridge.js` / `rpc-contracts.js` found 19
unreferenced wrappers. Thirteen of them are `get_*` endpoints whose matching `set_*` **is** used:

| Write-only getter | Paired setter (used) |
|---|---|
| `get_suppress_in_fullscreen` | `set_suppress_in_fullscreen` |
| `get_capture_filters` | `set_capture_filters` |
| `get_capture_images` | `set_capture_images` |
| `get_ignore_passwords` | `set_ignore_passwords` |
| `get_blocklist` | `set_blocklist` |
| `get_auto_sort_rules` | `set_auto_sort_rules` |
| `get_line_display` | `set_line_display` |
| `get_quick_number_paste` | `set_quick_number_paste` |
| `get_restore_clipboard` | `set_restore_clipboard` |
| `get_smart_shortcuts` | `set_smart_shortcuts` |
| `get_tags_for_clip` | `set_tags_for_clip` |
| `get_live_preview`, `get_start_hidden` | (see R2 in the RPC review — fully dead) |

The shape is always the same. `ui/js/settings/settings-rules.js:70-80` is the clearest example:

```js
if (window.DC && window.DC.bridge && …set_suppress_in_fullscreen === 'function') {
  window.DC.bridge.set_suppress_in_fullscreen(willBeOn).catch(() => {});   // failure swallowed
} …
try { localStorage.setItem('dualclip_suppress_in_fullscreen', willBeOn ? '1' : '0'); } catch(e) {}
```

The toggle paints itself `on` immediately, fires the RPC, **discards any error**, mirrors the value to
`localStorage`, and is done. The displayed state on next open is read from `localStorage`
(`settings-core.js:288`). `get_suppress_in_fullscreen` exists, is contracted, has a C# handler — and is
never called. So if the RPC fails for any reason (host busy, database locked, `settings.json` write
error), the user sees the toggle ON, the stored value says ON, and the backend still has OFF. Nothing
in the app can detect or repair that, because the only authority that knows the truth is never asked.

**Why it matters beyond tidiness**: for `set_suppress_in_fullscreen` the backend copy is the one that
actually gates behaviour — `MainForm.cs:548` reads `AppSettings.Load().SuppressInFullscreen` to decide
whether to suppress the summon hotkey in full-screen apps. A user who enables "Full-screen guard",
sees it stay enabled, and finds the hotkey still firing in full-screen apps has no way to work out
why. The identical pattern applies to capture filters, image capture, password ignoring, the
blocklist and auto-sort rules — all of which have backend-enforced behaviour behind them.

**Fix** — two small changes per setting, or one shared helper:

1. Call the existing `get_*` during the settings-hydration pass (there is already one:
   `syncSettingsUiFromStorage`, called from `DOMContentLoaded` and `pywebviewready` in
   `keyboard.js`) and let the backend value win.
2. Stop swallowing the write error. On `{ ok: false }` or a rejection, revert the localStorage mirror,
   repaint the toggle to the previous state, and toast — the pattern the sidebar already uses for
   optimistic moves (`moveCollectionToParent`).

```js
const res = await window.DC.bridge.set_suppress_in_fullscreen(willBeOn);
if (res && res.ok === false) { /* revert paint + mirror, toast the reason */ }
```

---

### S-P2 — `dualclip_suppress_in_fullscreen` is a genuine two-store setting (Medium)

This one deserves its own entry because it is the only key where **both copies are load-bearing**:

| Concern | Store | Read by |
|---|---|---|
| What the Settings UI displays | `localStorage['dualclip_suppress_in_fullscreen']` | `settings-core.js:288` |
| Whether the summon hotkey is suppressed | `settings.json` → `AppSettings.SuppressInFullscreen` | `MainForm.cs:548` |
| Written by | both (the toggle writes localStorage *and* calls the RPC) | `settings-rules.js:70-80` |

A single flag with two sources of truth and no reconciliation. It is also the one setting in the whole
list where the two disagreeing produces a *security-adjacent* surprise (the guard not doing its job)
rather than a cosmetic one.

**Fix**: make the backend authoritative and treat `localStorage` as a cache only — which is exactly
what S-P1's fix does. If a localStorage mirror is kept for the pre-hydration paint, write it from the
`get_*` response rather than from the toggle click.

---

### S-P3 — Ten keys in use are absent from the registry (Low)

Declared: 87. Used in code: 98. The 11 extras that are not key *prefixes*:

| Key | Nature | Risk |
|---|---|---|
| `dualclip_deleted_collections` | collection-deletion tombstones | **Medium if lost** — resurrects deleted collections via auto-sort rules. Unbounded except for a 50-entry slice cap. |
| `dualclip_colkey_migrated` | one-time migration flag | Low — re-running the migration should be idempotent, but it is unverified |
| `dualclip_seen_milestones`, `dualclip_last_milestone_ts`, `dualclip_pending_tip_check` | milestone / tip state | Low — cosmetic prompts may reappear |
| `dualclip_remote_links` | link allow-list | Low-Medium — an undeclared security-relevant list |
| `dualclip_suppress_in_fullscreen` | see S-P2 | covered above |
| `dualclip_used_marker` | read by `quick-view-menu.js` with a hard-coded fallback | Low |
| `dualclip_col_collapsed_*`, `dualclip_sidebar_collapse_*` | per-id key prefixes | Low — fine as prefixes, but note there is no cap, so ids accumulate forever |

`dualclip_deleted_collections` is the one to register first: it is the mechanism that stops auto-sort
rules resurrecting a collection the user deleted, and it lives entirely outside the registry that
exists to track exactly this kind of state.

**Fix**: add all of them to `settings-defaults.js` with a type. For the two prefix families, add a
comment recording that they are unbounded and are only ever cleared wholesale.

---

### S-P4 — Nothing tests this class of problem (Low)

`DualClip.Tests/PackageValidationTests.cs` and the other suites cover settings *values* and window
policy, but there is no test asserting that a key read by the UI is declared, nor that a `get_*`
endpoint backing a displayed setting is actually called. Both S-P1 and S-P3 are mechanically
detectable, exactly like the RPC checks in
[`rpc-contract-audit.md`](rpc-contract-audit.md) R3.

**Fix**: one source-text invariant — *every `dualclip_*` literal read from `localStorage` in
`ui/js/**` must appear as a key in `settings-defaults.js`, or be listed in an explicit
"internal state, intentionally undeclared" allowlist with a reason.* That converts both findings into
a permanently green test and documents the exceptions on purpose rather than by accident.

---

## 3. Checked and found clean

- **No dead settings.** All 87 declared keys are read somewhere. There is no
  declare-but-never-use drift, which is the usual failure mode of a registry like this.
- **The registry is typed.** `settings-defaults.js` carries `type` and, for enums, `values`, plus
  `def` defaults — so a bad write is caught by `setSetting` rather than silently poisoning reads.
- **Enums are constrained.** `dualclip_view_layout` (`standard`/`sidebar`) and
  `dualclip_layout_preset` (`standard`/`compact`/`expanded`) are the two settings most likely to be
  corrupted by a bad write, and both are declared as enums.
- **Tombstones are bounded.** `dualclip_deleted_collections` is sliced to the last 50 entries on write
  (`filters-collections.js:47`), so it cannot grow without limit.
- **Collection definitions are re-mirrored on loss.** If `dualclip_custom_collections` is cleared,
  `rehydrateCollectionsFromBackend` (`core/namespace.js:271+`) rebuilds from the backend, including
  merging DB-side `parentId` values back into the local tree — with the one gap already reported as
  S2 in the side-view audit (a rename clears `parent_id` in the DB).
- **Import/export paths rehydrate deliberately**, forcing `rehydrateCollectionsFromBackend` and
  clearing tombstones for collections that exist in the imported DB, rather than trusting local
  state.
- **The layout preset has a single documented authority.** `localStorage['dualclip_layout_preset']`
  is authoritative and the C# mirror was deliberately deleted (TASK-002, noted in `render.js:2151`),
  so the dual-store problem in S-P2 is not systemic — it is an exception, not the rule.

---

## 4. Suggested order of work

1. **S-P2 + S-P1 for `suppress_in_fullscreen` first** — it is the one setting whose drift disables a
   user-visible guard, and it is a ~5-line change using an RPC that already exists.
2. **S-P4** — add the registry invariant test so new drift is caught at review time, not audit time.
3. **S-P1 for the remaining twelve** — mechanical once the pattern is established; can be batched.
4. **S-P3** — register the ten undeclared keys, `dualclip_deleted_collections` first.

---

## 5. Note for the next agent

`docs/STATE.md` is under another agent's uncommitted window-sizing work, so per the collision rule in
`AGENTS.md` no STATE.md line is added here. Suggested entry once that work is committed:

```
- [OPEN] [Settings Persistence Review](reviews/settings-persistence-audit.md): S-P1 13 write-only settings (no read-back, silent failure); S-P2 suppress_in_fullscreen has two stores; S-P3 10 undeclared keys; S-P4 no registry test.
```

No source file was modified by this review.
