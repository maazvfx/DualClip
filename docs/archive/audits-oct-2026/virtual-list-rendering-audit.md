# Review — Virtual list rendering (`render.js`)

**Date**: 2026-10-05
**Type**: Read-only review. V1 was subsequently fixed in `c4e636f`; V2–V4 untouched.
**Scope**: `ui/js/list/render.js` — the virtual window (`renderVirtualWindow`), the flat-item builder
(`renderList`), the height model (`getRowHeight` / `getAdaptiveTier` / `getAdaptiveHeight` /
`getHeaderHeight` / `cardsRowGap` / `getZoomScale`), `invalidateHeights`, `scrollIndexIntoView`,
`createRowElement`, `createHighlightedFragment`, and the empty-state path.
**Method**: full read of the virtualisation path, plus a grep sweep of every `innerHTML` and template
interpolation in the row builder.
**Not run**: `dotnet test` (needs explicit user permission per `AGENTS.md` rule 6) and the app itself,
so no frame timings were taken.

---

## 1. Verdict

This is the strongest code in the repository. The virtualiser uses precomputed cumulative offsets with
an O(log N) binary search, never mutates the scroll spacer during a scroll, keeps the pool as a
sibling of the spacer shifted by `transform`, self-corrects row heights after measurement, guards the
infinite-scroll fetch against re-entry, and clamps `scrollTop` when the content shrinks. The off-by-one
and blank-window cases that normally plague virtualised lists are all handled.

**The most important result is negative and worth stating plainly: there is no HTML-injection path in
the list renderer.** For an application whose entire input is untrusted clipboard content — text copied
from any web page — this is the finding that matters most, and it is clean.

One real hole exists, in the group-collapse selection contract. The rest are small.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| V1 | Collapsing *every* group skips the selection contract → selection points at an invisible clip | **Medium** | **fixed** — `render.js:869` clears `selectedIndex`/`selectedIndices` when `visibleClipItems` is empty; anchor pinned to 0 so shift-arrow ranges stay in bounds (`c4e636f`) |
| V2 | Measured row heights are discarded on every `renderList`, so the correction never sticks | **Low-Med** | new |
| V3 | The height-correction pass is O(total items) inside a scroll handler | **Low** | new |
| V4 | A synchronous `localStorage` read on every scroll render | **Low** | new |

---

## 2. Findings

### V1 — Collapsing every group skips the selection contract (Medium)

`render.js:862-884` implements an explicit, well-named contract:

```js
// COLLAPSED PINNED SELECTION CONTRACT:
// If the currently selected items are hidden inside a collapsed group,
// retain visible selected items or automatically advance selectedIndex to the first visible clip item.
const visibleClipItems = currentFlatItems.filter(it => it.type === 'clip');
if (visibleClipItems.length > 0) { … }
```

The guard is `visibleClipItems.length > 0`. When the user collapses **every** group, the flat list
contains headers only, `visibleClipItems.length === 0`, and the whole contract is skipped —
`selectedIndex` keeps pointing at a clip that is inside a collapsed group and is not rendered anywhere
on screen.

Reachable in a few clicks: date grouping has four groups (Pinned / Today / Yesterday / Older), each
header has a collapse chevron, and `collapsedGroups` persists in `localStorage`, so the state survives
restarts. App grouping makes it trivial with a handful of apps.

What the user gets: a list showing only group headers, and a selection that is invisible but live.
`scrollIndexIntoView` correctly bails out (it looks the target up in `currentFlatItems` and returns if
it is absent), so there is no scroll jump — which is exactly why the bug is easy to miss. But the
keyboard actions do not consult the flat list at all: Enter pastes the hidden clip, Delete deletes it,
Ctrl+A selects everything including the hidden items, and `applyFilters` renders nothing for the
selection. The list and the selection model have silently diverged.

**Fix (applied, `c4e636f`)** — the contract now describes the empty-visible case instead of skipping
it, at `render.js:869`:

```js
if (visibleClipItems.length === 0) {
  // Every group collapsed: nothing is reachable by keyboard or paste-by-number,
  // so leaving selectedIndex pointing into a hidden row would act on an invisible clip.
  if (selectedIndex !== -1 || selectedIndices.size > 0) {
    selectedIndex = -1;
    selectedIndices.clear();
    // 0, not -1: shift-arrow ranges compute Math.min(lastAnchorIndex, selectedIndex),
    // and a -1 anchor would seed the range with an out-of-bounds index.
    lastAnchorIndex = 0;
    if (typeof syncSelectedIds === 'function') syncSelectedIds();
  }
}
```

Two deltas from the sketch above, both deliberate. The whole block is gated on the selection actually
being non-empty, because `renderList` runs on every scroll-adjacent repaint and would otherwise clear
and re-sync an already-empty selection repeatedly. And `lastAnchorIndex` is 0 rather than -1: the
shift-arrow handler builds ranges from `Math.min(lastAnchorIndex, selectedIndex)`, so a -1 anchor
would push index `-1` into `selectedIndices`.

Still worth a regression test: collapse all groups, assert `selectedIndex === -1` and that Enter is a
no-op.

### V2 — Measured heights are discarded on every `renderList` (Low-Med)

`renderVirtualWindow` contains a careful height self-correction pass (`render.js:1050-1090`): it
measures each rendered row with `el.scrollHeight`, compares against the estimated bucket, and when they
differ by more than a pixel it rewrites `it.height` **and recomputes `top` for every subsequent item**
plus the spacer, so the scroll geometry stays exact.

None of that measurement is retained. The next `renderList` walks `currentFlatItems` again and
overwrites every height with `getRowHeight(clip, …)` — a bucket lookup, not a measurement.
`invalidateHeights` does the same. So a row whose natural height disagrees with its bucket (zoom ≠ 100%,
a long unbroken URL, a CJK string, a font-scaling difference, a very large thumbnail) is re-fitted on
**every** render, each time costing a forced synchronous layout (`void container.scrollHeight` plus
per-row `scrollHeight` reads) and each time nudging `top` for everything below it.

That is the classic virtual-list jitter signature: content that is stable on screen but whose scroll
offset creeps while scrolling, worst at non-default zoom.

**Fix**: keep the measurement. A `Map<clipId, measuredHeight>` populated by the correction pass and
consulted by `getRowHeight` (invalidated by the existing `invalidateHeights`, and on zoom/density/font
changes) turns a per-render O(window) fit into a one-off cost per clip. There is already a precedent
for exactly this shape in the same file — `getCachedUsableWidth` / `invalidateUsableWidthCache`.

### V3 — The correction pass is O(total items), not O(window) (Low)

When any row in the window is re-fitted, the pass recomputes `top` for **every** item from
`minModifiedIdx` to the end of `currentFlatItems` (`render.js:1080-1086`). With paging
(`clipPageSize`) that array grows into the thousands, so a single mismatched row in the visible window
turns one scroll frame into a multi-thousand-iteration loop plus a spacer write. It runs inside a
scroll handler, so it competes with the frame budget.

Not a correctness problem, and not currently slow at realistic list sizes — but it is the reason V2 is
worth fixing properly rather than papering over, and it is the first thing that will hurt when paging
deepens.

**Fix**: a dirty-index approach — record the corrected height deltas, apply them to a Fenwick tree or
a lazily-rebuilt offset array, and only recompute the tail when the tail is actually needed for the
next `lowerBound`. Failing that, cap the recompute window and mark the rest dirty for the next full
`renderList`.

### V4 — A synchronous `localStorage` read per scroll render (Low)

`renderVirtualWindow` does, on every invocation:

```js
_cachedUseCountBadgePref = localStorage.getItem('dualclip_show_use_count_badge') === 'true';
```

`localStorage` is synchronous and main-thread-blocking; this runs on every scroll frame. The value only
changes when the user toggles the setting, so it belongs in a `notifySettingSaved` handler or the same
cached-setting pattern used elsewhere in the file. Minor next to V2/V3, but it is on the hot path and
free to fix.

---

## 3. Checked and found clean

This section is the bulk of the value of the review.

- **No HTML injection anywhere in the row builder.** Every interpolation of clip-derived data inside
  `createRowElement`'s `innerHTML` goes through `escapeHtml` — verified by sweeping every `${…}` in the
  570-line function: `img_dims`, `img_size`, collection badge name, nickname, `age_label`, `sourceApp`
  (`render.js:1647`), and the tag badges. The two that looked risky at a glance are both handled:
  `data-overflow-tags="${overflowJson}"` uses `escapeHtml(JSON.stringify(overflowTags))`
  (`render.js:1589`) — escaped *for the attribute context it is parsed in*, which is the correct way
  to round-trip JSON through a data attribute — and the extension allowlist on the image tag is applied
  before interpolation.
- **Search highlighting is DOM-based, not string-based.** `createHighlightedFragment`
  (`render.js:10-70`) builds a `DocumentFragment` from `createTextNode` and `mark.textContent`
  elements, merging overlapping match intervals. No `innerHTML`, so a query containing `<`, `"` or
  `&` cannot break the row, and the highlight cannot introduce markup the text did not contain.
- **No blank-window edge case.** If `scrollTop` is somehow beyond the last item's bottom,
  `lowerBound` returns `length`, the "partially visible previous item" check does not fire, and the
  `Math.max(0, startIdx - overscan)` clamp still yields a valid window that renders the last items at
  the correct offset. The `offsetY` fallback to `0` is only reachable when there is genuinely nothing
  to draw.
- **Overscan in both directions** (4 rows), computed once, with `endIdx` clamped to the array length.
- **The spacer height is never mutated during a scroll** — only inside the correction pass, which
  recomputes it consistently with the shifted offsets. The comment at `render.js:1046` records the
  invariant explicitly, which is the kind of note that prevents the next person breaking it.
- **Infinite scroll cannot double-fire.** The trigger (`endIdx >= length - 15`) is additionally gated
  on `hasMoreClips` and `!isLoadingMoreClips`, and the comment records that the guard lives inside
  `loadNextClipPage` as well, so rapid scroll renders are safe by two independent mechanisms.
- **`scrollIndexIntoView` fails safe.** It resolves the target through `currentFlatItems` and returns
  early if absent, so a selection hidden in a collapsed group cannot cause a bogus scroll (this is why
  V1 produces no visible symptom). It also handles `clientHeight === 0` with a `getBoundingClientRect`
  fallback and only writes `scrollTop` when the delta exceeds 1px.
- **The empty path is thorough**: it zeroes the spacer, clears the pool, shows a query-aware empty
  state, resets `currentFlatItems`, `expandedIndex`, `selectedIndex`, `selectedIndices` and the anchor,
  and calls `syncSelectedIds`. (This is notably *more* careful than the equivalent path in
  `keyboard.js` — see K7 in the keyboard audit.)
- **Scroll clamping on shrink**: `renderList` recomputes `maxScroll` and pulls `scrollTop` back when
  the content gets shorter, so deleting the last visible rows cannot strand the user past the end.
- **Group counts are honest under paging.** The `openGrpKey` computation resolves the open group by
  `originalIdx` (the last loaded clip) and sets `countOverflow`, so a header renders `N+` rather than
  presenting a page-capped number as the true total — and it does so for every grouping mode without
  duplicating the key derivation.
- **The height model is bucket-based by design, with the contract written down.** `getRowHeight`
  carries a `DENSE HEIGHT CONTRACT` comment enumerating every (details × lines) combination and
  asserting JS bucket == CSS border-box, which makes a CSS/JS drift a deliberate, reviewable act
  rather than an accident.
- **`getEffectiveClientHeight` and the `maxScroll` clamp agree** — both read `container.clientHeight`,
  with a cached `getBoundingClientRect` fallback. The two paths cannot disagree about the viewport.
- **Container rebuilds preserve the overlay.** Both the `renderList` and `renderVirtualWindow` "spacer
  or pool missing" branches extract and re-append `emptyStateOverlay` rather than wiping
  `container.innerHTML`, and both handle the legacy nested-pool DOM shape by re-parenting the pool.

---

## 4. Suggested order of work

1. **V1** — a real behavioural hole with a reachable repro and a four-line fix.
2. **V2** — the measured-height cache; it fixes the jitter *and* removes most of V3's cost.
3. **V3 / V4** — follow from V2, or fold into the same change.

A regression test for V1 fits the repo's existing Node-harness style easily: set `groupingMode` to
`'date'`, collapse every group, call `renderList()`, assert `selectedIndex === -1`.
