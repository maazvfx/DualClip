# Architecture & Code Quality Audit: ui/css/settings.css

## 1. Module Purpose & Responsibilities
- `settings.css`: Styles the extensive full-window Settings interface, configuration categories, layout panels, toggle switches, custom select dropdowns, hotkey recording pills, and settings search filters.
- Key components styled:
  1. Settings Hub Frame (`#settingsView`): Header title bar, search input, left category navigation strip (`.settings-tabs`), and right scrollable pane (`.settings-pane`).
  2. Setting Cards & Rows (`.settings-row`, `.settings-row-main`): Clean two-column layout with icon, setting title, contextual description, and right-aligned interactive control.
  3. Interactive Controls: Toggle switches (`.toggle-btn`, `.toggle-slider`), chip groups (`.preset-chip`), and custom select menus (`.custom-select-wrap`, `.custom-dropdown-menu`).
  4. Hotkey Recorder View: Visual keyboard shortcut badges with recording state highlights (`.recording`).
  5. In-Settings Live Search: Tab match badges (`.st-tab-match-badge`), search highlight states, and empty search placeholder pills.

## 2. Dead Code & Safe Pruning Targets
- Duplicate `.modal-overlay` & `.modal-card` definitions: Lines 1–26 in `settings.css` re-declare styles that already exist in `overlays-modals.css`. These duplicate root selectors can be safely pruned to avoid cascade ambiguity.
- Unused experimental CSS classes: Classes like `.settings-search-pill` and legacy preset chip states from prior iterations.

## 3. Performance & Memory Hotspots
- Unvirtualized long setting rows in Settings pane:
  - Settings tabs render static HTML with over 60 rows across all categories. When search queries are entered, rows dynamically toggle `.st-search-hidden`.
  - While simple, toggling classes across 60 rows is fast and causes no performance bottlenecks.

## 4. Code Duplication & Refactoring Targets
- CSS Variable overrides:
  - Repeated color definitions for `#ef4444`, `#e11d48`, `#5e6ad2` instead of leveraging design system tokens `var(--danger)`, `var(--primary)`.
  - Toggle button animations (`.toggle-btn`, `.toggle-slider`) duplicate transitions found in other components.

## 5. Critical Invariants (DO NOT TOUCH)
- **Settings Tab Hit Targets (`.st-tab * { pointer-events: none !important; }`)**: SVG icons and text labels inside tab buttons must have pointer-events disabled so clicks reliably resolve to the parent `.st-tab` element with `data-tab`.
- **`#settingsView` Height & Width Anchors**: Must fill 100% of the window viewport (`width: 100%; height: 100%; position: absolute; inset: 0;`) when shown, completely hiding the clipboard history list.

## 6. Prioritized Action Plan
- **Medium**: Remove duplicate `.modal-overlay` and `.modal-card` root rules that conflict with `overlays-modals.css`.
- **Low**: Replace hardcoded hex colors (`#e11d48`, etc.) with semantic CSS variables (`var(--danger)`).
- **Low**: Prune defunct styling rules.
