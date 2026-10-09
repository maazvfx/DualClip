# Architecture & Code Quality Audit: ui/css/clip-list.css

## 1. Module Purpose & Responsibilities
- `clip-list.css`: Styles the primary clipboard list viewport, virtualization container, clip cards/rows, pinned sticky header, live preview sidebar panel, drag handles, tags, and badge indicators.
- Key components styled:
  1. Virtualized Rows & Cards (`.clip-row`): Layouts for single-line, multi-line auto, dense, and compact modes.
  2. Sticky Pin Indicator & Used Marker: Styles `.used-marker` (line, check, dot, pill, dim), selection highlight variants (`selection-outlined` vs tinted background), and copy flash feedback.
  3. Live Preview Panel (`.live-preview-panel`): Docked right-side preview drawer with collapsible widths, resize splitters, monospace text wrapping, and image container.
  4. Badges, Icons & Actions: App process icons (`.app-icon-img`), format tags (`.format-tag`), quick action button strip (`.clip-actions`), and drag grip indicators.

## 2. Dead Code & Safe Pruning Targets
- Defunct marker styles (lines 28, 71 in JS bootstrap / CSS): Legacy values (`check`, `pill`, `dot`, `dim`) were migrated to `line-solid`. CSS rules maintaining separate styling for unused marker classes can be pruned.
- Over-specified selectors and redundant `!important` declarations: Several rules in scrollbar definitions (`display: block !important; width: 6px !important;`) and collapsed drawer rules (`display: none !important; width: 0px !important;`) use excessive `!important` tags where selector specificity alone would suffice.

## 3. Performance & Memory Hotspots
- `box-shadow` and `backdrop-filter` in Virtualized Rows:
  - Heavy box-shadows or border transitions inside `.clip-row` elements trigger repaints when hundreds of items are rapidly scrolled in the virtual window.
  - Using `contain: content` or `contain: strict` on `.clip-row` isolates layout and paint boundaries, preventing browser reflow cascading up the document tree.

## 4. Code Duplication & Refactoring Targets
- Light theme overrides:
  - Duplication between `[data-theme="light"]` and `body.theme-light` across multiple scrollbar and row rules.
  - DualClip uses `[data-theme="light"]` on `<html>`. Standardizing on CSS custom properties (`var(--scrollbar-thumb)`) would remove dozens of repeated light-theme block overrides.

## 5. Critical Invariants (DO NOT TOUCH)
- **`user-select: none` vs `user-select: text`**: Cards and UI headers must remain strictly `user-select: none` so mouse dragging initiates native window dragging or item reordering without highlighting text. Only `.live-preview-text` and explicit preview modals should permit `user-select: text`.
- **`overscroll-behavior: contain`**: Essential on `.list-view-container` and `.list-wrapper` to prevent scroll chaining to the outer WebView2 window frame.
- **Copy Flash Animation (`.copy-flash`)**: Visual cue confirming clipboard write; relies on transient CSS animation.

## 6. Prioritized Action Plan
- **Medium**: Add `contain: layout style` to `.clip-row` to isolate repaint boundaries during virtualized scrolling.
- **Low**: Consolidate light/dark theme scrollbar styling into CSS custom properties (`var(--thumb-bg)`).
- **Low**: Clean up legacy used-marker CSS selectors.
