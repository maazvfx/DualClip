# Prior Audit Triage + Plan for Unreviewed Core Areas

**Date**: 2026-10-05
**Author**: Buffy (agent)
**Status**: Read-only at time of writing. §4.2 was subsequently fixed in `c4e636f`; §4.1, §4.3, §4.4 were fixed earlier.
**Purpose**: (1) find the audit work that already exists, (2) confirm which findings are still
real, (3) plan the review of areas nothing has ever covered.

---

## 1. Why this document exists

Between 2026-10-03 and 2026-10-05, roughly **20 audit and review documents** were written for this
project. They are **not in the project**. They sit in a backup folder outside it:

```
../DualClip_docs_backup/audits/     (4 files)
../DualClip_docs_backup/reviews/    (16 files)
```

The project's own `docs/audits/` and `docs/reviews/` folders hold only two files. So the knowledge
exists but is invisible to any agent starting a fresh session — including this one, which
independently re-derived two findings that had already been written down a day earlier.

**Action for a human:** decide whether these should be copied back into the project. Left where they
are, the same findings will keep getting rediscovered.

---

## 2. Triage: which of the 20 matter

Kept — deep, bug-focused, and about areas that still exist:

| Document | Why kept |
|---|---|
| `audits/2026-10-04-changes-audit.md` | Data-loss and correctness findings across the app |
| `audits/2026-10-04-sidebar-view-audit.md` | Same, for the sidebar |
| `reviews/sidebar-nested-collections.md` | Data-integrity and contract findings |
| `reviews/group-header-count-bugs.md` | Known-incomplete fix; needs a decision |

Set aside — largely superseded or cosmetic:

- `reviews/window-sizing-review.md` — describes a working tree since rewritten by the current plan
- `reviews/css-density-audit.md` — CSS density tiers, `!important` cleanup; no data risk
- `reviews/view-mode-live-preview.md` — reviewed an uncommitted tree that has since been committed;
  a few items may still be live (§4)
- `audits/clipboard-formats-languages-audit.md`, `audits/unsupported-features-gaps.md` — capability
  and gap lists, not defects
- The nine short feature notes (`animated-gif-support`, `clear-history-on-lock`, `url-tracking-cleaner`,
  `rich-text-rtf-capture`, `drag-drop-archive-import` (already marked archived — its own authors
  say its claims were wrong), `oversized-drop-notifications`, `sidebar-layout-toggle`,
  `view-morph-hover-experiment`, `plans-batch-review`) — implementation reviews, not open defects

---

## 3. Verified FIXED since the audits were written

Each was confirmed against today's code. Safe to close.

| Finding | Evidence |
|---|---|
| Foreign keys were never enabled, so `ON DELETE SET NULL` silently did nothing | `Services/DatabaseService.cs:120,133,146` — all three connection paths now set `PRAGMA foreign_keys=ON` |
| Clip rename reverted after every reload (`custom_title` missing from the data sent to the UI) | `MainForm.cs:2267` — `custom_title = c.CustomTitle ?? ""` is now emitted |
| Editing a clip left stale `rich_text` attached to the new text | `Services/DatabaseService.Search.cs:561` — `UpdateText` now sets `rich_text = NULL` |
| Sidebar + Compact window was a dead end with no way back | `ui/js/list/sidebar-layout.js:43-51` — a guard plus a toast now blocks entry |
| Collections nested deeper than the cap silently disappeared | `ui/js/list/sidebar-layout.js:438,446` — depth is clamped for display instead of dropping nodes |
| Folder nesting moves were fire-and-forget; a rejected move looked successful | `ui/js/list/sidebar-layout.js:371-404` — optimistic update with rollback now exists |

---

## 4. Verified STILL OPEN

Each confirmed by reading the live code today. **Nothing here has been fixed.**

### 4.1 Export silently destroys user data — HIGHEST SEVERITY

Found in `2026-10-04-changes-audit.md` as H6. Still present. The export writer
(`MainForm.cs:2605-2690`) drops four things:

1. **Clip renames.** `custom_title` is never written to `clips.json`. Every rename a user has made
   is lost the moment they export. The rename *saves* correctly — it just never leaves the app.
2. **Rich text.** `rich_text` is never exported and never imported.
3. **Animated GIFs.** `MainForm.cs:2675` hardcodes `media_type` to `image/png`, and image entries are
   always named `images/{sha}.png`. A GIF is relabelled and re-saved under a `.png` name, so the
   animation is destroyed. The importer's filename pattern only accepts `.png`, so this is
   irreversible — not a round-trip bug but permanent loss.
4. **Folder nesting.** The collections writer (`MainForm.cs:2586-2593`) emits only `id`, `name`,
   `sort_order`, `pinned`. No parent link. An entire nested folder tree flattens on export.

The user gets no warning. The export reports success.

**Why it matters most:** this is the one area users trust with their only copy of their data.

### 4.2 The sidebar does not know two reserved folder names — FIXED (`c4e636f`)

The backend treats `transcriptions` and `voice` as reserved collection scopes
(`Services/DatabaseService.Search.cs:122,321`; `DatabaseService.SearchOptimized.cs:66,491`, and
`DatabaseService.IsReservedSystemCollectionId:1380-1381`). The frontend's reserved list omitted both:

```js
// ui/js/list/sidebar-layout.js:7
const SYSTEM_RESERVED_IDS = new Set(['all','pins','most_used','favorites','all_total','all_unorganized']);
```

Both ids were added to all four copies of that list (`sidebar-layout.js:7`, `namespace.js:257`,
`namespace.js:290`, `filters-collections.js:1085`). The four-way duplication remains — the backend
already owns the authoritative list, so consolidating to a single RPC-sourced set is still open.

A user-created folder named `voice` or `transcriptions` would render as an ordinary folder and
collide with a built-in search scope. Same root cause as `M3` in the changes audit.

### 4.3 Sidebar tag names containing an apostrophe break the click — and can inject script

`ui/js/list/sidebar-layout.js:711`. Recorded yesterday as finding 1.5; independently re-derived
today as F1. `escapeHtml` turns `'` into `&#39;`, but the browser decodes that before running the
inline handler, so a tag named `it's` throws a syntax error and the click silently does nothing. A
crafted name can close the string and inject script into the WebView2 page, which can then call any
app function the page can reach.

Fix: move the value into a `data-` attribute and read `this.dataset` — the pattern the same file
already uses correctly for collections a few lines above.

> **FIXED in `9a3e33b`** (verified in live code): tag rows now render
> `data-tag="${escapeHtml(name)}"` with `onclick="toggleSidebarTag(this.dataset.tag);"`
> (`ui/js/list/sidebar-layout.js:794`). No tag value reaches an inline JS string.

### 4.4 A folder cycle makes both folders vanish

`ui/js/list/sidebar-layout.js:584-590` and `440-444`. Recorded yesterday as 1.4; re-derived today as
F2. If two folders ever point at each other, neither counts as top-level, so neither is rendered —
both disappear from the sidebar while still existing in the database and still holding clips. No
error, no toast, no recovery.

The same file already documents this exact failure mode for nesting depth (lines 435-437); the cycle
path was left unprotected.

---

## 5. Never real

`M2` in the changes audit claimed `IsDescendantOf` could deadlock by taking `_gate` while already
inside `_gate`. The method does not exist in the codebase under that name, and C# locks are
reentrant on the same thread, so this could not have manifested as described. Close it.

---

## 6. Not yet checked — carried forward

Verify before acting; these were not examined today.

- **Group heading counts** (`reviews/group-header-count-bugs.md`) — the document's own status is
  "partially fixed: the lying number is now honest; the true total is still server-side work."
  Seven findings, F1-F7.
- **Prior finding 1.6** — dragging a collection from Settings onto the list creates a junk clip.
- **`M1`** — the `parent_id` migration swallows real failures.
- **`B3`/`B4`** — animated GIF support unreachable; oversized-drop notification fires on
  non-size failures.
- **`view-mode-live-preview.md`** items 6-8 — two sources of truth for one preference (the C# side
  write-only), three of four new RPCs with no callers, and RPC registry drift. This is the closest
  thing to a bridge review that exists, and belongs in §7c.

---

## 7. Plan for the unreviewed core areas

Nothing has ever reviewed these. Order is by blast radius: worst outcome first.

### 7a. Data safety — do first

Targets: `Services/DatabaseService.Backup.cs` (806 lines), the delete/clear paths in
`Services/DatabaseService.cs`, the export/import pair in `MainForm.cs` (~2590-3200).

Why: §4.1 is already a confirmed data-loss bug in this area, which is evidence the area has real
holes. It is also the area where a bug costs the user something irreplaceable.

Look for: writes that claim success without confirming; deletes that run before their safety backup
completes; file deletions that ignore orphaned/shared files; transactions that span more than needed;
anything that deletes a file another clip still points at.

### 7b. Clipboard capture

Target: `Services/ClipboardListener.cs` (2,012 lines) — always running, the most timing- and
OS-dependent code in the project, and the largest single file.

Why: it runs constantly in the background on every machine, so a fault here is the one most likely
to be hit by ordinary use rather than by an edge case.

Look for: leaks on repeated clipboard events; work done while holding a lock; unthrottled
re-entry; format detection failures that throw rather than fall back; large-payload handling.

### 7c. The bridge between UI and app

Targets: `MainForm.cs` + `MainForm.RpcDispatch.cs` (~5,300 lines, 119 RPC methods) and
`ui/js/core/rpc-contracts.js`.

Why: this is where a silent half-failure lives — the UI believes a call succeeded when the handler
did something else, or nothing. It is also where the §5 note about drift applies.

Look for: methods the UI calls that no handler serves; handlers with no caller; argument-shape
mismatches between the contract registry and the C# switch; responses sent on some paths and not
others.

---

## 8. Ground rules for whoever picks this up

1. **Verify before reporting.** Each finding in §4 was confirmed by reading the code. A finding
   copied from an old document without checking is how the 2026-10-04 sidebar findings got reported
   as new work twice.
2. **Fix §4.1 before anything else.** It is the only confirmed irreversible data loss.
3. **Run tests only at milestones** — ADR-002. Tier 1 is build-only:
   `dotnet build -c Debug -warnaserror` and `dotnet build -c Release -warnaserror`, both currently
   0 errors / 0 warnings.
4. **The JS test harnesses no longer exist.** `DualClip.Tests/js-harness/*.js` and
   `scripts/test-core.ps1` were deleted in an uncommitted cleanup. ADR-002 tier 2 currently has no
   tooling. Confirm with the user whether that cleanup was intended before relying on any harness step.

---

## 9. Provenance

- Prior audits: `../DualClip_docs_backup/audits/`, `../DualClip_docs_backup/reviews/`
- Independent audit from earlier today, committed as `2242c7e`:
  `docs/reviews/sidebar-view-audit.md` (findings F1-F7; F1 and F2 duplicate §4.3 and §4.4 above)
- Handover for the window-sizing plan: `docs/plans/window-sizing-revision-handover.md`