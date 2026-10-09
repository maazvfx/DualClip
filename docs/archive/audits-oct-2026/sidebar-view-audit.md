# Sidebar View & General Code Audit

**Date**: 2026-10-05
**Type**: Read-only audit. No source files were changed.
**Scope**: `ui/js/list/sidebar-layout.js` (the "Sidebar view from the left" feature), the escaping helper it relies on, `Services/WindowSizePolicy.cs` / `Services/WindowPlacement.cs`, and SQL construction across `Services/`.
**Not run**: `dotnet test` (withheld pending user approval). No findings below are test-backed.

---

## Summary

Seven issues, plus one area checked and found clean. The two that matter most are both in
`sidebar-layout.js`: one breaks tag clicks outright and opens a script-injection path, the other
can make folders disappear from the sidebar with no error and no way back.

---

## F1 — Tag clicks break and can execute injected script (High)

`ui/js/list/sidebar-layout.js:711`

```js
onclick="toggleSidebarTag('${escapeHtml(name)}');"
```

`escapeHtml` (`ui/js/core/namespace.js:467`) maps `'` to `&#39;`. The browser decodes HTML
entities in an attribute value **before** evaluating the inline handler, so the escaping is
undone exactly where it matters:

- Tag name `it's` produces `toggleSidebarTag('it's')` → SyntaxError → the handler never runs.
  The tag row looks clickable but does nothing.
- A crafted tag name can close the string and append arbitrary JavaScript, which then runs in
  the WebView2 page with full access to `window.chrome.webview` — i.e. it can call any RPC
  method the app exposes. Tag names originate from user clipboard content, so this is reachable
  without any special privilege.

**Fix**: use the pattern already used for collections in this same file — put the value in a
`data-` attribute and read `this.dataset` in the handler:

```js
onclick="toggleSidebarTag(this.dataset.tagName)"
data-tag-name="${escapeHtml(name)}"
```

**Why it matters here**: this file already got this right for collections
(`data-col-id` + `this.dataset.colId`, lines 456-464) and wrong for tags, one screen down.
`escapeHtml` itself is not the bug; it is correct. The bug is using it inside a JS string.

---

## F2 — Folder cycles make folders vanish silently (Medium-High)

`ui/js/list/sidebar-layout.js:584-590` and `440-444`

```js
const rootCols = validCols.filter(c => !c.parentId || !validIdSet.has(c.parentId));
```

A collection is only rendered if it is a root, or if its children get rendered beneath it.
If the stored data ever contains a cycle — `A.parentId = B`, `B.parentId = A` — then both
members have a live parent inside the valid set, so neither qualifies as a root. Neither is
reached by recursion. Result: **both folders disappear from the sidebar entirely**, while
still existing in the database, still counted in their ancestors' rollups, and still holding
clips. No toast, no console error.

The same drop-without-warning exists one level down: `renderCollectionTreeNode` returns `''`
for any id already in `visited`, so a node reachable twice is silently discarded.

Notably, lines 435-437 of this file already document this exact failure mode for indentation
depth ("returning `''` at the cap silently removed folders from the sidebar while they still
existed in the database"). The cycle path was left unprotected.

**Fix**: after rendering roots, render any collection that was not reached as a root-level
entry, and toast once naming the affected folders.

---

## F3 — Sidebar text drop reports success even when nothing was saved (Medium)

`ui/js/list/sidebar-layout.js:292-311`

The `Added clip to <name>` toast fires unconditionally, with no check on the host's response
and no fallback message when neither bridge is present. If the backend rejects the add, or
the page is running without a host bridge, the user is still told it worked.

**Contrast**: `moveCollectionToParent` in this same file (lines 371-404) does this correctly —
optimistic update, explicit rollback, and a toast that names the failure reason. The
collection-drop path should match that shape, and should await the result before toasting.

---

## F4 — Stale drag id can turn a text drop into a folder move (Medium)

`ui/js/list/sidebar-layout.js:170-205`, `346-356`

`_draggedColId` is a module-level global, and `isSidebarColDrag()` returns `true` whenever it
is non-null. It is cleared only inside `handleSidebarColDragEnd`. If a drag is cancelled
without that event firing — Escape pressed, pointer released outside the window, or the dragged
element removed from the DOM — `_draggedColId` stays set.

After that, `handleSidebarColDrop` takes the *nesting* branch for every subsequent drop, so
dropping text onto a folder attempts `moveCollectionToParent` instead of adding the text.

**Fix**: clear `_draggedColId` in `drop` as well as `dragend`, and re-validate it still
resolves to a real collection before acting on it.

---

## F5 — Misleading toggle tooltip (Low)

`ui/js/list/sidebar-layout.js:65`

```js
const tipText = isSidebar ? 'Switch to Standard View (Compact)' : 'Switch to Sidebar View';
```

Compact is unrelated to leaving sidebar view. Compact is the mode that *blocks entering* the
sidebar (see `isSidebarBlockedByPreset`, lines 43-51). The label describes a different setting
than the button does.

---

## F6 — Documentation contradicts the code on Compact size (Low)

`docs/STATE.md` describes the presets as "420×380 / 680×540 / 880×640", but
`Services/WindowSizePolicy.cs:37-40` defines Compact as **360×260**. The XML doc comment on
line 9 of that same file also says 360×260, so STATE.md is the odd one out and is stale.

This is the "prose rots" trap called out in `docs/knowledge/INDEX.md`. Since 29/29 sizing tests
were reported green, the code is almost certainly correct and the whiteboard is wrong.

Separately, `DefaultWidth/Height` and `StandardWidth/Height` (lines 31-46) are two names for the
same 680×540 value with near-identical doc text — a standing invitation for the two to drift.

---

## F7 — Raw id interpolation in inline handlers (Low, defence in depth)

- `ui/js/list/filters-collections.js:1107` — `openPillMenu(event, '${c.id}')`
- `ui/js/settings/settings-rules.js:341,344` — `editAutoSortRule('${r.id}')`, `removeAutoSortRule('${r.id}')`

These interpolate unescaped values into inline JS. They are safe **today** only because ids are
machine-generated (`col_` + base36 timestamp + random, `filters-collections.js:1202`). If ids
are ever imported, restored from a backup, or otherwise user-influenced, this becomes the same
bug as F1. Worth switching to `data-` attributes while the pattern is fresh.

---

## Checked and found clean

**SQL injection — clear.** Every dynamic SQL fragment in `Services/` composes *generated
parameter names*, never values. `keyIn`/`delIn` in `DatabaseService.cs:1692-1718` build
`IN ($k0, $k1, ...)` and bind each value separately. `whereSql`, `filterSql` and `innerSql`
follow the same rule. The `$`-prefixed named parameters throughout `DatabaseService.Search*.cs`
and `.Tags.cs` are bound via `Parameters.AddWithValue`, not string-formatted. No injection found.

**RPC message-id collision — clear.** `bridge.js:4` derives ids from
`Date.now()` and increments. The sidebar's hardcoded `id: 0` at `sidebar-layout.js:303` is a
fire-and-forget post that never enters the pending-request map, so it cannot collide.

**Deep-nesting indent clamp — handled.** `MAX_INDENT_DEPTH` (line 438) clamps display depth
rather than dropping nodes, which is the correct choice and is documented as such.

---

## Suggested order of work

1. **F1** — small, contained, and it is a live injection path.
2. **F2** — silent data-shaped failure, the worst kind to debug from the UI.
3. **F3 / F4** — both are about the sidebar lying to the user; they belong together.
4. **F6** — one-line correction to STATE.md, but see the note below.
5. **F5 / F7** — cosmetic and hardening, batch them.

---

## Note for the fixer

`docs/STATE.md` is **currently modified with another agent's uncommitted window-sizing work**
(`git status` shows it alongside `Services/WindowSizePolicy.cs`, `ui/js/list/render.js`,
`ui/js/overlays/modals.js`, `ui/js/overlays/preview-lightbox.js`,
`ui/js/settings/settings-appearance.js`). Per the collision rule in `AGENTS.md`, the usual
one-line STATE.md link for this review has been **left out on purpose** — add it when the
window-sizing work is committed:

```
- [OPEN] [Sidebar View & General Audit](reviews/sidebar-view-audit.md): F1 tag-name script injection in inline handler; F2 folder cycles render nothing; F3 false "Added" toast; F4 stale drag id.
```