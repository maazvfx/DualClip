# Architecture & Code Quality Audit: ui/css/overlays-modals.css

## 1. Module Purpose & Responsibilities
- `overlays-modals.css`: Styles modal backdrops, dialog cards, lightboxes, toasts, and floating context menus.
- Key components styled:
  1. Modals (`.modal-overlay`, `.modal-card`): Common layout, backdrop blur, header, body, footer, button pairs.
  2. Preview Lightbox (`.preview-modal-overlay`, `.preview-card`): Image zooming viewport, pan cursor states (`grab`, `grabbing`), zoom pill dock (`.zoom-slim-group`), and text scroll wrapper.
  3. Toast Notifications (`.toast`, `.toast.show`): Screen-centered transient notification pill with action buttons (`Undo`).
  4. Context Menus & Popovers (`#contextMenu`, `#pillContextMenu`, `.submenu`): Nested menu flyouts, keyboard shortcuts hints, divider bars.
  5. Multi-faceted dialogs: Move to Collection modal, Clear History categories list, App Picker process grid, Tag Manager chips.

## 2. Dead Code & Safe Pruning Targets
- Modern `:has()` pseudo-class redundancy: Extensive fallback rules duplicating selectors with and without `:has(.has-lightbox-image)`. In WebView2 (Chromium 120+), `:has()` is fully supported natively, allowing compound selectors to be simplified.
- Repetitive scrollbar styling: 40+ lines of custom scrollbar overrides replicated across modal body classes that could use a shared `.custom-scrollbar` utility class.

## 3. Performance & Memory Hotspots
- High-frequency `:has()` selectors:
  - Selectors like `.preview-modal-overlay:has(.preview-image-lightbox) .preview-card` force the CSS engine to perform ancestor invalidations during DOM mutations.
  - Using direct class toggles on the overlay (`.preview-modal-overlay.is-image-mode`) avoids `:has()` recalculation passes during zoom/pan rendering.
- `backdrop-filter: blur(12px)` on full-viewport overlays: Can trigger GPU memory spikes on low-end integrated graphics when multiple overlays are stacked.

## 4. Code Duplication & Refactoring Targets
- Modal Card Geometry: Card paddings, border radiuses, and shadow definitions are declared independently for `#clearConfirmModal .modal-card`, `#newCollectionModal .modal-card`, `#renameModal .modal-card`, etc., with slight variations. Consolidating into standard size modifiers (`.modal-card.sm`, `.modal-card.lg`) would improve visual consistency.

## 5. Critical Invariants (DO NOT TOUCH)
- **`z-index` Tiering Hierarchy**:
  - Main UI: 10–30
  - Sidebars & docked drawers: 30–50
  - Context menus & dropdowns: 1000
  - Modal backdrops: 9999–10000
  - Toasts: 10020
  Changing these values causes menus to clip behind modals or toasts to become hidden.
- **`will-change: transform` on Lightbox Image**: Prevents continuous paint invalidations during smooth mouse panning.

## 6. Prioritized Action Plan
- **Medium**: Replace expensive `:has()` selectors in lightbox preview with direct `.is-image-mode` class toggles.
- **Medium**: Extract repeated scrollbar rules into a shared `.custom-scrollbar` utility class.
- **Low**: Consolidate individual modal card dimension declarations.
