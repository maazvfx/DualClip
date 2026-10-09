# Verification of Carried-Forward Findings

**Date**: 2026-10-05
**Source**: the five items left unconfirmed in `docs/reviews/2026-10-05-audit-triage-and-core-plan.md` §6,
plus the registry-drift item from the `view-mode-live-preview` review.
**Status**: Verdicts only. **Nothing was changed.** No fix applied to anything below.

---

## Summary

Two are still real. One is partly fixed. Two no longer describe the code.

| Item | Verdict |
|---|---|
| **M1** — `parent_id` migration swallows failures | **Still open** |
| **1.6** — dragging a collection from Settings creates a junk clip | **Still open** |
| Group heading counts (F1) | **Fixed**; residual limitation remains by design |
| **B3** — animated GIF "unreachable dead code" | **No longer accurate** — feature is reachable |
| **B4** — oversized notification fires on non-size failures | **Resolved** |
| RPC registry drift | **Resolved** — proven in sync today |

---

## M1 — The `parent_id` migration swallows real failures (STILL OPEN)

```csharp
// Services/DatabaseService.cs:215-221
try
{
    using var migColCmd = conn.CreateCommand();
    migColCmd.CommandText = "ALTER TABLE collections ADD COLUMN parent_id TEXT NULL;";
    migColCmd.ExecuteNonQuery();
}
catch (SqliteException) { }
```

The intent is clearly "ignore the error when the column already exists". But the catch swallows
**every** `SqliteException`, and SQLite uses that one exception type for all of:

- duplicate column (the intended case)
- database locked by another connection
- disk full / out of space
- database corrupt or not a database
- read-only or permission denied

If `ALTER TABLE` fails for any of the other reasons, the app carries on as though the migration
succeeded. Every later query touching `parent_id` then fails at runtime with *no such column*, or —
worse — nesting silently does not work with no error anywhere.

**There is already a helper for this, and it is not usable here as written.** `EnsureColumn`
(`DatabaseService.cs:249`) checks for the column before adding it, which is the correct approach —
but it hardcodes `PRAGMA table_info(clips)`. It only works for the `clips` table, which is why the
`collections` migration went down the raw-`ALTER` path in the first place.

**Suggested fix:** add a table parameter to `EnsureColumn` so it inspects the right table, then route
this migration through it. That removes the swallow entirely — the "already exists" case stops being
an exception.

---

## 1.6 — Dragging a collection from Settings creates a junk clip (STILL OPEN)

Confirmed at **both ends** of the path.

**Source** — collection rows in the Settings screen are draggable for reordering:

```js
// ui/js/settings/settings-shortcuts.js:403
row.draggable = true;

// ui/js/settings/settings-shortcuts.js:435
try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', col.id); } catch {}
```

**Sink** — the sidebar's drop handler treats `text/plain` from *any* drag as external text worth
capturing as a new clip:

```js
// ui/js/list/sidebar-layout.js:279-311
text = e.dataTransfer.getData('text/plain') || '';
...
if (text && text.trim()) { /* add_text_to_collection */ }
```

The sidebar's own reordering drags are guarded by `window._sidebarInternalDragOccurred`, but that flag
is set by the sidebar's dragstart handler — a drag that *begins* in Settings never sets it.

**Result:** drag a collection row out of Settings and drop it on the sidebar, and the collection's
raw internal id is saved as a new clip. The user sees a junk entry appear, with an id like
`col_l3k9x` as its content.

*Verified by reading both ends. The end-to-end drag itself still needs a human to perform.*

**Suggested fix:** use a payload type the capture path ignores. The app already has one — drops carry
`application/x-dualclip-collection-id` / `application/x-dualclip-ids`, and `handleSidebarColDrop`
branches on those first. Settings should set a dedicated type and never populate `text/plain`.

---

## Group heading counts (F1) — FIXED, with a residual limitation by design

The fix described in that review's "Resolution" section has shipped. Group headings no longer present
a page-capped number as an exact total:

```js
// ui/js/list/render.js:551-555
const countLabel = item.countOverflow ? (item.count + '+') : String(item.count);
const countTitle = item.countOverflow
  ? (item.count + ' loaded — more may exist; scroll to load the rest')
  : '';
```

The count now renders as `N+` with a tooltip explaining that more may exist. That directly addresses
the original complaint — the number is no longer lying.

**The residual limitation is real but is a known scope decision, not a defect.** The count reflects
what has been *loaded*, not the true total. The review's own status line says this — "the true total
is still server-side work." F2-F7 in that document (counts shifting on scroll, collapsing one group
changing another's number) are all downstream consequences of counting loaded rows rather than
matching rows, so they persist by design until the server-side work is done.

**No action recommended** beyond the backlog item for true totals.

---

## B3 — "Animated GIF support is unreachable dead code" (NO LONGER ACCURATE)

The code has moved on. GIF capture is reachable through two live paths:

- **File drops** — `OnClipboardUpdate` detects a single dropped `.gif`, validates the header with
  `IsGifHeader`, and enqueues `ProcessCapturedGifBytes`.
- **Clipboard images** — `ProcessCapturedImage` calls `IsMultiFrameGif` on the pasted image and routes
  multi-frame content accordingly.

What genuinely does not exist is a **user-facing toggle**: there is no GIF-related control anywhere in
`ui/index.html` or the settings modules. Whether that is a gap depends on intent — if GIF support was
meant to be user-controllable, the setting is missing; if it was meant to be automatic, there is
nothing to fix.

*Note on method: a case-insensitive search for "gif" across the UI returns false positives, because
`JSON.stringify` contains the substring. The conclusion above is from reading the capture paths, not
from that search.*

---

## B4 — Oversized notification firing on non-size failures (RESOLVED)

Checked every site that raises `OversizedClipDropped`. Both remaining call sites are genuine size
checks:

- `ProcessCapturedText` — fires only when `text.Length > MaxTextChars`
- `ProcessCapturedImage` — fires only when `img.Width * img.Height > MaxImagePixelArea`

The earlier over-firing is gone.

One related oddity **does** remain, and it is already logged as finding **C1** in
`docs/reviews/clipboard-listener-audit-2026-10-05.md`: the text path decides to notify by searching
the error message for `"limit"` or `"too large"`, and reports `MaxTextChars` even when the actual
cause was the 20 MB allocation ceiling. That is a wrong-number bug, not a wrong-trigger bug.

---

## RPC registry drift (RESOLVED)

Proven directly during the bridge audit rather than re-derived here:

| Check | Result |
|---|---|
| `case` labels in `MainForm.RpcDispatch.cs` | 119 |
| Entries in `ui/js/core/rpc-contracts.js` | 119 |
| Declared but unhandled | **0** |
| Handled but undeclared | **0** |

The registry and the dispatch switch agree exactly in both directions. Item 8 of the
`view-mode-live-preview` review can be closed.

---

## Net position

The backlog is now clear enough to act on. Two real defects remain, both small and both local:

1. **M1** — generalise `EnsureColumn` to take a table name, then use it for the collections migration.
2. **1.6** — stop writing the collection id into `text/plain` when dragging in Settings.

Neither needs a design decision. Both are a few lines each.