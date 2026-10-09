# Virtual List & Rendering Engine

## Overview
| Concern | File |
| :--- | :--- |
| Row rendering, groups, virtualization | [`ui/js/list/render.js`](../../ui/js/list/render.js) |
| Pagination and cache state | [`ui/js/core/state.js`](../../ui/js/core/state.js) |
| Row-height / density tiers | `ui/js/settings/quick-view-menu.js` |
| HTML escaping | [`ui/js/core/namespace.js`](../../ui/js/core/namespace.js) |

---

## 🏎️ Virtual windowing
- Only rows intersecting the viewport (plus buffer zones) are materialized as DOM nodes; the rest are a scroll-height calculation.
- Page size is `UiPageSize` (100), clamped to `MaxClampedLimit` (500). `state.js` owns the page cursor and `_needsRefetch`.
- Scroll offset and selection are preserved across Standard ⇄ Compact switches and filter changes, so a layout change never loses the user's place.

---

## 📏 Density tiers
`getRowHeight()` returns per-tier heights that must stay consistent with the CSS row buckets — the pairing is asserted by `js-harness/auto-tier-invariants.js`.

- `getAdaptiveTier()` is the pure classifier behind `data-line-display="auto"`.
- `FuzzyMinLen` is 4: shorter words are never fuzzy-scanned, to avoid noise and candidate blowup.

---

## 🎨 Formatting & styling
- **Escaping** — `escapeHtml()` in `namespace.js` is the universal text/attribute sanitizer. Every interpolation of clip text goes through it.
- **Zebra striping** — driven by the `data-zebra` attribute on `<html>`; toggled in `settings-appearance.js`.
- **Line clamp** — 1–5 lines, user-configurable.
- **Tag overflow badges** — when a clip has more tags than fit, a badge renders; clicking or hovering opens a `.tag-overflow-popover` (`render.js:2311-2382`). Dismissal ignores clicks inside the popover or on the badge itself.

---

## 🗂 Group headers
- Date grouping (Today / Yesterday / Older) with collapsible headers via `toggleGroupCollapse(grpKey)` (`render.js:606`).
- Click targets: the chevron button carries `data-grpkey` and stops propagation, so toggling a group does not also select its first row.
- **Count overflow**: a group whose run reaches the end of the loaded page window renders `N+`, not a bare number — the count is genuinely unknown until the next page loads (`js-harness/group-count-invariants.js`).
- Arrow-key traversal must skip collapsed groups rather than trapping focus inside them.

---

## 🧪 Invariant Tests
- `js-harness/pagination-invariants.js` — drives the real `state.js` under a DOM shim; index clamping and viewport chunking.
- `js-harness/auto-tier-invariants.js` — tier classifier and row-height/CSS agreement.
- `js-harness/group-count-invariants.js` — `N+` overflow rendering.
- `js-harness/ui-bulk-invariants.js` — selection and escaping over the real modules.
- `.NET`: `GroupCountPaginationTests`, `AutoTierInvariantTests`.

See [testing-matrix.md](testing-matrix.md).