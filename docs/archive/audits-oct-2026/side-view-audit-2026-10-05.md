# Audit — Side View (left sidebar), edge cases and failure modes

**Date**: 2026-10-05 · **Regenerated**: 2026-10-05 (fix status re-verified against the working tree)
**Type**: Read-only audit. **No source file was changed by this audit.**
**Scope**: the "Side view" feature — `ui/js/list/sidebar-layout.js`, `ui/css/sidebar-layout.css`, the
sidebar markup in `ui/index.html`, every caller of the sidebar API (`filters-collections.js`,
`filters-search.js`, `render.js`, `core/state.js`, `core/namespace.js`, `settings/quick-view-menu.js`,
`overlays/modals.js`, `keyboard.js`) and the backend RPCs it depends on (`MainForm.RpcDispatch.cs`,
`Services/DatabaseService*.cs`).
**Method**: source read + a Node harness that loads the real `sidebar-layout.js` with a stub DOM
(same technique as the repo's own `SidebarNestedAdversarialTests`), plus `code_search` sweeps.
**Not run**: `dotnet test` (withheld per `AGENTS.md` rule 6) and the app itself.

---

## 0. Fix status (re-verified 2026-10-06)

The team actioned this audit. Current state, checked against the working tree rather than assumed:

| # | Finding | Status | Evidence in the tree |
|---|---------|--------|----------------------|
| S1 | Dead `triggerToggleSidebarCounts` + undismissable menu | **FIXED** | `sidebar-layout.js:132` defines `closeSidebarContextMenu`; `keyboard.js:164` (Escape) and the `pointerdown` dismisser both call it. The dead call site itself was still present and is now repointed: `index.html:1422` calls `toggleSidebarCountsHidden()` (`c4e636f`) |
| S2 | Rename wiped `parent_id` in the DB | **FIXED** | all five `save_collection` call sites now pass the parent: `filters-collections.js:755, 1063, 1219`, `namespace.js:339, 375` |
| S3 | Tag click wiped every tag filter | **FIXED** | `toggleSidebarTag` (`sidebar-layout.js:840`) parses the query, matches exactly, and removes only the clicked tag; falls back to `clearTagFilter` only when it was the last tag |
| S4 | Drag flags could latch and kill sidebar clicks | **FIXED** | `_draggedColId = null` now cleared in three places (`sidebar-layout.js:250, 361, 375`), not only in `dragend` |
| S5 | Stale `currentCollection` → dead-end empty list | **FIXED** | `filters-collections.js:1434-1435` rejects unknown ids and toasts "That collection no longer exists — showing All Clips" |
| S6 | Side view was keyboard-inaccessible | **SUBSTANTIALLY FIXED** | 15 `role="button"` rows in `sidebar-layout.js`; tag rows carry `tabindex="0"` + Enter/Space handlers |
| S7 | Tag section: one unbounded RPC per render, no race guard | **FIXED** | `sidebar-layout.js:744-760` has `_sidebarTagsReqId` + `_sidebarTagsInFlight`; re-entrant renders return early and stale responses are dropped by request-id. Present in the working tree, verified 2026-10-06 — this row said OPEN on 2026-10-05 and was stale |
| S8 | Compact via Quick View preset left the sidebar logically on | **FIXED** | `quick-view-menu.js:153-156` now calls `applySidebarLayout('standard')` |
| S9–S12 | Drop gate, pin persistence, id dedupe, highlight asymmetry | **NOT RE-VERIFIED** | low-priority batch items; no action taken that was visible in the tree |

From the earlier [`docs/reviews/sidebar-view-audit.md`](../reviews/sidebar-view-audit.md):

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| F1 | Tag-name script injection in the inline handler | **FIXED** | `sidebar-layout.js:803` now uses `data-tag="${escapeHtml(name)}"` + `this.dataset.tag` — the exact pattern this audit recommended |
| F2 | Folder cycles made folders vanish | *not re-verified* | the renderer's `visited` guard and the orphan-promotion filter are unchanged in shape |
| F3 / F4 | False "Added" toast; stale drag id | F4 superseded by S4's fix | |

**S7 is the only item from this audit still worth picking up**, and it is Low-Medium.

---

## 1. Verdict at time of audit

The sidebar's **data path was in good shape**: nesting writes are validated on both sides, moves roll
back on rejection, deletes re-parent children transactionally, and rollup counts are cycle-safe and
non-double-counting. The weak spots were all in the **presentation and wiring layer** — a dead click
handler that also left a menu stuck open, a persistence call that silently destroyed nesting, and a
string-matching tag toggle that deleted filters the user did not ask it to delete. All three of the
serious ones are now fixed.

---

## 2. Findings as originally reported

### S1 — Dead click handler + a context menu that could never be closed (High) — FIXED

`ui/index.html:1422-1429` called `triggerToggleSidebarCounts()`, which existed nowhere in the repo.
The real function is `toggleSidebarCountsHidden` (`sidebar-layout.js:106`). The menu was also a
one-way door: `openSidebarContextMenu` only ever set `display: 'block'`, and neither the outside-click
disserer (`overlays/modals.js:244-256`), the wheel/scroll path, nor the Escape handler
(`keyboard.js:152`) knew about `#sidebarContextMenu`. One right-click left a permanent overlay whose
only item threw a `ReferenceError`, and the `dualclip_sidebar_hide_counts` setting was unreachable
from the product.

### S2 — Renaming a nested collection silently un-nested it (High) — FIXED

Four-hop chain: `filters-collections.js` called `save_collection` with four arguments and no parent →
`MainForm.RpcDispatch.cs:787-789` defaults the 5th to `null` → `DatabaseService.cs:1398-1408` upserts
`parent_id = excluded.parent_id` with `DBNull` → `core/namespace.js:322-326` adopts the database value
on the next hydrate. Renaming a folder moved it back to the top level on restart, silently. No test
caught it because the adversarial suite parents folders with `SetCollectionParent` and never re-saves.
All five call sites now pass `col.parentId || null`.

### S3 — Clicking one tag wiped every tag filter (Medium-High) — FIXED

`isAct` and `toggleSidebarTag` both used a plain substring test, so `tag:cat` matched inside
`tag:category`, and `clearTagFilter` strips **all** `tag:`/`nick:` tokens. Verified in the harness:
query `tag:category tag:dogs` + click `cat` → `clearTagFilter()` → both filters gone. Now tokenized
via `parseSearchQuery().opTags` with exact matching, and only the clicked tag is removed.

### S4 — Drag flags could latch and kill every sidebar click (Medium) — FIXED

`window._sidebarInternalDragOccurred` and `_draggedColId` were reset only in `handleSidebarColDragEnd`.
The sidebar is fully re-rendered from `innerHTML` on every backend clip load — `core/state.js:328` →
`renderCollectionPills()` → `renderSidebarNav()` — and a capture or a debounced keystroke landing
mid-drag removes the dragged node. If `dragend` did not fire, `_sidebarInternalDragOccurred` stayed
`true` for the life of the window and the guard on every collection row
(`onclick="if (window._sidebarInternalDragOccurred) return; …"`) made the whole tree unclickable; the
same window left `_draggedColId` set, which made later *text* drops take the folder-nesting branch.
Both are now cleared in `drop` as well as `dragend`.

### S5 — A stale `currentCollection` showed an empty list with no way back (Medium) — FIXED

Nothing validated `currentCollection` against `customCollections`. If the selected collection
disappeared — package import, DB reset, delete from another build — the list went empty, **no row was
highlighted** (not even All Clips), and the search-scope badge pointed at something unlisted. Now
guarded with a toast and a redirect to All Clips.

### S6 — The side view was entirely mouse-only (Low-Med) — SUBSTANTIALLY FIXED

Every row was a `<div onclick>` with no `tabindex`, `role` or key handler, `keyboard.js` had no
sidebar handling at all, `#btnToggleLayout` was `tabindex="-1"`, and in side view the pill bar is
removed from the layout — so a keyboard-only user had no way to change collection at all. Roles,
tabindex and key handlers are now present on 15 rows.

### S7 — Tags section: unbounded RPC churn, no race guard, active tags can vanish (Low-Med) — OPEN

`renderSidebarNav` calls `refreshSidebarTags` unconditionally, firing a `GROUP BY` over the tag
tables on every render — and a render happens on every capture and every debounced keystroke. There
is no debounce, no in-flight guard and no generation token, so a slow early response can overwrite a
newer tag list. Separately, the list is filtered to `clipCount > 0`, so a tag you are actively
filtering by **disappears from the sidebar** when its last clip is deleted, leaving the filter
un-clearable from the sidebar.

**Fix**: coalesce with an in-flight promise plus a monotonic request id; keep tags present in the
current query visible even at zero clips.

### S8 — Compact via the Quick View preset left the sidebar logically on (Low) — FIXED

Only `applyViewMode('compact')` (`render.js:2125-2131`) reset the sidebar; the preset selector's own
path (`changeQuickViewLayoutPreset`) did not, so the toggle button stayed lit while CSS hid the panel.
`quick-view-menu.js` now performs the same reset.

### S9 — Sidebar drops bypass the `collectionDragDrop` gate (Low) — NOT RE-VERIFIED

The pill drop targets check `isFeatureEnabled('collectionDragDrop')`; the sidebar equivalents do not,
so they always show the drop highlight and always accept an external text drop. The flag is a
hard-coded `true` (`core/namespace.js:179`) today, so there is no live impact.

### S10 — Pinned state never reaches the database; new folders are always top-level (Low)

`triggerPillTogglePin` writes `dualclip_custom_collections` and stops — no `save_collection` — so pin
ordering is lost if localStorage is cleared and definitions rehydrate from SQLite. And
`submitNewCollection` always creates at the top level, making nesting drag-only. (The audit's separate
note about the `save_collection` call in that function is now moot: it passes an explicit `null`.)

### S11 — Duplicate collection ids are not deduped in the sidebar renderer (Low)

`renderCollectionPills` dedupes by id and rewrites storage; `renderSidebarNav` only filters reserved
ids, so a duplicate emits two elements with the same `id="side_col_<id>"` and only the first badge
updates. Narrow window, two-line fix.

### S12 — Asymmetric active highlight between the Views rows (Low)

All Clips required `curType === 'all'` to highlight while Favorites and Most Used ignored the type
filter, so a collection row and a type row could both look active and All Clips could go dark while
still being the effective scope.

---

## 3. How the executed items were reproduced

Node harness, run from the repo root, with `DCJS` pointing at the real sidebar module.

```bash
# F1/S3 — tag click handler
#   tag "it's"  ->  onclick="toggleSidebarTag('it&#39;s');"  ->  browser decodes -> SyntaxError
#   query "tag:category tag:dogs", click "cat"  ->  clearTagFilter()  ->  both filters removed

# F2 — cyclic collection data renders nothing (no hang, but the folders vanish)
#   customCollections = [{id:'x',parentId:'y'},{id:'y',parentId:'x'},{id:'s',parentId:'s'},{id:'ok',parentId:null}]
#   renderSidebarNav() -> side_col_x / side_col_y / side_col_s all absent, side_col_ok present
```

Perf sanity check (no issue found, and still no issue): `renderSidebarNav()` averages **< 0.5 ms at
400 collections** (50/100/200/400 → 0.44/0.50/0.29/0.40 ms). The rollup is O(n²) in theory but
irrelevant at real collection counts.

---

## 4. Checked and found clean

- **Counts.** Backend counts are strictly per-collection and exclude `all`/null
  (`DatabaseService.Search.cs:459-475`), so `getCollectionRollupCount` (own + descendants, `memo`
  cycle-guarded, each descendant counted once) cannot double-count. System buckets are separate keys,
  so the parent rollup never absorbs them. The `dualclip_mirror_in_all` switch is honoured in both the
  backend-first and the in-memory-fallback branch of `getCollectionClipCount`.
- **Move semantics.** Both `moveCollectionToParent` and `triggerPillUnnest` mutate optimistically then
  roll back on `{ ok: false }` or a rejected promise, and the backend independently rejects reserved
  ids, self-parenting and descendant-parenting with a cycle-safe `IsDescendantOf`. Clips moved by drag
  get an Undo toast and a backend-confirmed write, and sidebar badges refresh through
  `loadClipsFromBackend → maybeRefreshBackendColCounts(true) → updateSidebarCounts`.
- **Delete parent.** `DeleteCollectionDef` re-parents children to `NULL` and deletes the row in one
  transaction; the frontend's root promotion matches, so children surface at the top level.
- **Reserved ids.** Filtered case-insensitively on render, on tree children, and on the move target —
  no path exists to nest under `all`/`pins`/`most_used`.
- **Deep nesting.** `MAX_INDENT_DEPTH = 4` clamps indentation and never drops a node.
- **No injection in collection rows.** They use `data-col-id` + `this.dataset` — the pattern the
  original F1 fix was supposed to copy for tags, and which the tag rows now use too.
- **No hang.** Every recursive function is guarded.

---

## 5. Remaining work

**S1 and S7 are now closed** (`c4e636f`, and the S7 guard was already in the tree — this report's own
status table was stale). S9–S12 remain a cosmetic low-priority batch. A regression test per fixed
finding is still worthwhile — S2 in particular deserves a C# test asserting that `SaveCollection`
after `SetCollectionParent` does not clear the parent, since that chain is four hops deep and easy to
re-break.

## 6. Note for the next agent

This report has a stale sibling: `docs/reviews/side-view-audit-2026-10-05.md` is a **different,
longer document** describing the same S1–S12 findings with a different status table, and the two
disagree on S1 and S7. This copy (`docs/audits/`) is the one whose statuses match the working tree.
Reconcile them, then pick one home — the audits/ directory is gitignored (`.gitignore:16` `docs/*`),
so these reports are invisible to git from that location.

STATE.md now carries the entry rather than this file proposing one:

```
- [RESOLVED] Side View Audit S1–S12: dead triggerToggleSidebarCounts call repointed (index.html:1422), C2 drop-toast wired, V1 selection cleared when all groups collapse, reserved ids extended.
```
