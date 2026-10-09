# Review — Verification of the 5 carried-forward unconfirmed items

**Date**: 2026-10-05
**Type**: Read-only verification. **No source file was changed.**
**Source**: §6 "Not yet checked — carried forward" of
[`2026-10-05-audit-triage-and-core-plan.md`](2026-10-05-audit-triage-and-core-plan.md).
**Rule followed** (that document's own ground rule 1): every item below was re-checked against the
live code today. Nothing is carried over on the strength of an older document. Where another audit
already covers an item, it is cross-referenced rather than duplicated.

**Summary: 1 confirmed still open (with a mechanism), 2 confirmed fixed, 1 partially fixed as
documented, 1 now covered by this session's other reviews.**

| # | Carried-forward item | Verdict today |
|---|----------------------|----------------|
| 1.6 | Settings collection drag creates a junk clip | **STILL OPEN — confirmed, mechanism identified** |
| B3 | Animated GIF support unreachable | Already covered by `clipboard-listener-audit-2026-10-05.md` |
| B4 | Oversized-drop notification fires on non-size failures | Already covered as **C1** in the same audit |
| M1 | `parent_id` migration swallows real failures | **STILL OPEN but low impact — self-healing** |
| group counts F1–F7 | "Lying number now honest; true total still server-side" | **Partially fixed, exactly as documented** |
| items 6–8 | Dual source of truth, dead RPCs, registry drift | **Covered** by this session's RPC + settings reviews |

---

## 1. Finding 1.6 — Settings collection drag creates a junk clip: CONFIRMED, mechanism now known

This was recorded as "dragging a collection from Settings onto the list creates a junk clip". It is
real, and the exact path is now traced end to end.

**The payload is indistinguishable from external text.** `ui/js/settings/settings-shortcuts.js:433-435`:

```js
row.addEventListener('dragstart', (e) => {
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', col.id); } catch {}
  window._draggedColId = col.id;
```

It sets **only** `text/plain` — no `application/x-dualclip-*` type, unlike every other internal drag in
the app (the sidebar sets both `text/plain` *and* `application/x-dualclip-collection-id`; clip drags
set `application/x-dualclip-ids`).

**So the global drop-zone treats a settings reorder as external text.** `ui/js/overlays/drop-zone.js`:

```js
function hasInternalDragPayload(e) {        // :70
  … if (types[i].indexOf('application/x-dualclip') === 0) return true;   // never matches
}
function hasTextPayload(e) {               // :81
  if (hasInternalDragPayload(e)) return false;                          // so → not internal
  return types.includes('text/plain') || …;                             // → TRUE
}
```

The window-level `dragover` handler (`:175`) therefore calls `showDropZone('text')` **while the user is
merely reordering collections in Settings** — a "Add to …" overlay appears over a drag that is not
adding anything.

**And the drop commits it.** The `drop` handler (`:197`) bails only for `.col-pill` targets:

```js
window.addEventListener('drop', function(e) {
  if (e.target && e.target.closest && e.target.closest('.col-pill')) { hideDropZone(); return; }
  e.preventDefault();
  …
  text = e.dataTransfer.getData('text/plain') || '';     // → "col_m9x2k_a1b"
  if (text && text.trim()) { … callHostChecked('add_text_to_collection', { text, … }) }
```

There is **no `in-settings` guard and no `modal-open` guard**, even though the rest of the codebase
treats that check as standard: `ui/js/list/actions.js:1317` returns early on `in-settings`, and
`ui/js/overlays/tooltips-toasts.js:250` suppresses toasts on `modal-open` **or** `in-settings`. The
drop-zone is the one place that forgot.

**Net effect**: dragging a collection row in Settings to reorder it shows a misleading drop overlay, and
releasing the drop anywhere that is not a pill — including back onto the Settings list itself — creates
a real clip whose entire content is the raw collection id (e.g. `col_m9x2k_a1b`). The user then finds a
junk clip in their history that they cannot explain.

**Fix** — two small changes, either of which closes it, both recommended:

1. Mark the drag as internal at the source, so every consumer recognises it:
   ```js
   e.dataTransfer.setData('application/x-dualclip-collection-id', col.id);
   ```
   This makes `hasInternalDragPayload` return true, which suppresses the overlay *and* the drop
   handling in one stroke, and it is consistent with how the sidebar already marks its drags.
2. Add the missing guard, for defence in depth and for any other text-only drag that slips through:
   ```js
   if (document.body && document.body.classList.contains('in-settings')) { hideDropZone(); return; }
   ```

**Regression test**: assert that a synthetic `drop` whose `dataTransfer.types` is exactly
`['text/plain']` while `document.body.classList.contains('in-settings')` does **not** reach
`add_text_to_collection`. That is expressible in the repo's existing DOM-stub harness style.

---

## 2. B3 / B4 — already covered, do not re-open

Both belong to `Services/ClipboardListener.cs`, which another agent audited today:
[`clipboard-listener-audit-2026-10-05.md`](clipboard-listener-audit-2026-10-05.md).

- **B4** (oversized-drop notification firing on non-size failures) is that audit's **C1 — "Oversized-clip
  reporting is coupled to message wording, and reports the wrong limit" (Medium)**. It found the event
  being raised from a string match on an error message and invoked with a limit of `0`, which is a
  superset of the original concern. Already triaged; nothing to add.
- **B3** (animated GIF support unreachable) is in the same file's scope. I did not re-derive it, to
  avoid producing a second, weaker version of a finding that already has a full write-up.

**Recommendation**: close B3 and B4 in the triage document and point at that audit.

---

## 3. M1 — the `parent_id` migration swallows real failures: still open, but self-healing

`ui/js/core/namespace.js:369-375`, inside the clip-membership sweep that synthesises placeholder
collection definitions:

```js
customCollections.push({ id: colId, name: colId });
known.add(colId);
added = true;
try { if (typeof api.save_collection === 'function') api.save_collection(colId, colId, false, customCollections.length - 1, null); } catch (e) {}
```

then unconditionally:

```js
if (added) { localStorage.setItem('dualclip_custom_collections', …); renderCollectionPills(); }
```

The swallow is real, and it is worse than it looks: `api.save_collection` returns a **promise**, so the
`try/catch` cannot observe a rejection at all — it only catches a synchronous throw. A failed write
produces an unobserved rejection and the code carries on as if it succeeded.

**Why the impact is low**, verified rather than assumed:

- The definitions being written are brand new (`{ id, name }` with `parentId` never set), so there is
  **no parent to lose** — the original worry does not apply to this call site.
- A local-only definition that never reached SQLite is **re-mirrored on the next hydrate**:
  `rehydrateCollectionsFromBackend` walks `customCollections`, finds any id absent from the DB, and
  calls `save_collection` for it (`namespace.js:339`). The system converges.

So this is a latent robustness wart, not data loss. **Fix** (small): use the promise properly and count
failures so the next hydrate is not relied on as the repair mechanism.

```js
const mirror = api.save_collection(colId, colId, false, customCollections.length - 1, null);
if (mirror && typeof mirror.catch === 'function') mirror.catch(() => { /* count + log */ });
```

---

## 4. Group heading counts F1–F7 — partially fixed, exactly as documented

The source document's own status was "partially fixed: the lying number is now honest; the true total
is still server-side work". That description is still accurate.

**Fixed and verified.** The truncation is computed and rendered:

- `ui/js/list/render.js:833` — `countOverflow: grpKey === openGrpKey`, where `openGrpKey` is resolved
  by locating the group containing the **last loaded clip's** `originalIdx`. That is the group whose run
  is provably truncated, and resolving it by `originalIdx` makes it correct for every grouping mode
  without duplicating each mode's key derivation.
- `render.js:553-554` — `const countLabel = item.countOverflow ? (item.count + '+') : String(item.count);`
  with a `countTitle` explaining the `+`. A page-capped number is no longer presented as the true total.

**Still open, as documented.** The header shows the number of clips *loaded so far* with a `+`, not the
true total, because the count is derived from the paged client array. There is no server-side group
total anywhere in `get_clips` or the RPC contract. This is the remaining F-series work and it needs a
backend aggregate.

**Recommendation**: keep the item open with the scope narrowed to "server-side group totals"; the
misrepresentation half is done and should not be re-litigated.

---

## 5. `view-mode-live-preview.md` items 6–8 — covered by this session's reviews

These were "two sources of truth for one preference (the C# side write-only), three of four new RPCs
with no callers, and RPC registry drift". All three are now covered, with better evidence:

- **Two sources of truth / write-only settings** → [`settings-persistence-audit.md`](settings-persistence-audit.md)
  **S-P1** found this is not one setting but **thirteen**: a sweep of all 95 bridge wrappers for call
  sites found 13 `get_*` endpoints with a used `set_*` counterpart and **zero callers** — the UI
  writes the backend, swallows the error, then displays `localStorage` and never asks. **S-P2** covers
  the worst instance, `dualclip_suppress_in_fullscreen`, where the backend copy is the one that actually
  gates the hotkey in full-screen apps.
- **RPCs with no callers** → [`rpc-contract-audit.md`](rpc-contract-audit.md) **R2**: 7 endpoints
  (`center_window`, `set_window_pos`, `set_live_preview`, `get_live_preview`, `set_start_hidden`,
  `get_start_hidden`, `get_tag_stats`) have live C# handlers *and* contract entries but zero JS callers.
- **Registry drift** → same report, **R1**: `clear_history` declares 2 of its 8 parameters. Note the
  registry has since gained an `optional:` field, and `resize_window` / `reset_window_size` were
  correctly migrated to it — `clear_history` was simply missed.

**Recommendation**: close items 6–8 in the triage document and point at those two reviews.

---

## 6. Also verified while here: §4.1 (the highest-severity item) is now FIXED

Not one of the five, but it is the single most important claim in the triage document — "export
silently destroys user data" — and §2/§4.1 of that document predate a lot of work. I checked all four
sub-claims against the export writer, and **all four are fixed today**:

| Claim | Current state |
|---|---|
| Clip renames lost (`custom_title` never written) | **Fixed** — `MainForm.cs:2709-2711`, written as null when absent, commented `// D1/D4: rename + rich text` |
| Rich text never exported | **Fixed** — same block, `rich_text` |
| GIFs relabelled `.png`, animation destroyed | **Fixed** — `MainForm.cs:2735-2737` detects the real container (`IsGifBytes(fileBytes) \|\| imgPath.EndsWith(".gif")`) and writes a variable `media_type`, commented `// D2: preserve the real container` |
| Folder nesting flattens | **Fixed** — `collections.json` now emits `parent_id` (`MainForm.cs:2668-2670`, commented `// D3: nesting link`) |

This is worth recording because my own
[`import-export-backup-audit.md`](import-export-backup-audit.md) was written the same day and did not
read the export writer — it reported on the import path and the backup layer, and its "clean" claim
about export was based on "it writes to a new zip and never touches the live database" rather than on
reading the field list. The finding was fixed independently and the file is correct now; the note is
here so no future reader assumes that audit covered the export writer's field list.

---

## 7. Net result for the triage document

Safe to mark **FIXED / VERIFIED FIXED**: §4.1 (all four), §4.3 (F1, already noted), §6 items B3, B4, and
items 6–8.

Still open, with pointers: §4.2 (the sidebar's reserved-id list missing `transcriptions` and `voice` —
not re-checked here; it is a one-line fix to `SYSTEM_RESERVED_IDS` and belongs with the sidebar work),
§6 item 1.6 (confirmed above), §6 item M1 (confirmed above, low impact), and the group-total backend work.

**Note for the next agent**: the triage document's §1 records that ~20 audit documents live in
`../DualClip_docs_backup/` outside the project and asks a human to decide whether to copy them back.
That decision is still open and still worth making — three of the findings in this review were
re-derived from first principles because the originals were not visible in the project.
