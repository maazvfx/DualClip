# Overlays, Context Menus & Modals

## Overview
Overlay and modal behavior is split across three files:

| File | Role |
| :--- | :--- |
| [`ui/js/overlays/modals.js`](../../ui/js/overlays/modals.js) | Focus management, Tab trap, Escape/Enter fallbacks, generic modal observer |
| [`ui/js/overlays/context-menus.js`](../../ui/js/overlays/context-menus.js) | Clip right-click menu |
| [`ui/js/overlays/preview-lightbox.js`](../../ui/js/overlays/preview-lightbox.js) | Lightbox image preview, also signals `set_modal_open` |

There is also a document-level outside-click router in `modals.js:223-273` that dismisses open surfaces on a click elsewhere.

---

## 🔒 Modal Pinning & Focus Trap

### Host Pinning (`set_modal_open`)
A `MutationObserver` on `document.body` (subtree, attribute) re-evaluates on every `.modal-overlay` style write:

1. Computes `anyOpen` — whether **any** `.modal-overlay` has `style.display === 'flex'` (`modals.js:1604`).
2. Toggles a `modal-open` class on `<body>` (`modals.js:1606`).
3. Calls `set_modal_open(anyOpen)` — but **only on change**, guarded by `window.__dcModalOpenNotified` so the observer does not spam the host (`modals.js:1608-1615`).

In C#, `_modalOpen` forces `TopMost` (`MainForm.RpcDispatch.cs:107-113`). The `Deactivate` handler skips auto-hide while `_modalOpen`, `_inSequentialPaste`, or within 250ms of showing (`MainForm.cs:765-788`).

Because the observer is generic over `.modal-overlay`, **any new modal is covered without wiring** — add the class and the display change, and pinning, pinning and focus behavior follow.

### Tab Trap
Registered in the **capture phase** so it runs ahead of per-modal key routers (`modals.js:1627-1639`):

- Uses `getTopModal()` — the **last** open `.modal-overlay` in DOM order, i.e. the topmost stack entry (`modals.js:1445-1448`).
- Focusables are `button`, `input` (excluding hidden), `select`, `textarea`, `[tabindex]:not([tabindex="-1"])`, filtered to skip disabled, `aria-hidden`, and zero-size elements unless currently focused (`focusablesIn`, `modals.js:1469-1482`).
- If focus is outside the top modal, it is pulled to the first focusable. Otherwise `Tab`/`Shift+Tab` wrap first↔last.

### Focus restore
`restoreFocus()` returns focus to the element focused before the modal opened, falling back to `#searchInput`. Two overrides: it no-ops while any modal is still open, and the lightbox owns focus restoration itself via `window.__previewAnchorPending` (`modals.js:1456-1467`).

### Escape & Enter fallbacks
A second capture-phase handler (`modals.js:1644-1691`) covers dialogs the global router does not know:

- **Escape** — the 10 modals already handled by `keyboard.js` are skipped explicitly (`modals.js:1650-1652`); anything else is hidden and focus restored.
- **Enter** — routes to the primary action for `clearConfirmModal` (respecting a disabled confirm button), `deleteCollectionModal`, and `appPickerModal`. Skipped when focus is on a native control that already handles Enter, or in text fields.

### Compact-mode geometry expansion
In Compact layout, opening a wide dialog resizes the window via `set_window_size(w, h, animate=true, **persist=false**)` so the dialog fits, then restores on close with `persist=true` (`modals.js:1570-1596`). State lives in `window.__compactModalExpanded` / `window.__compactPreModalSize`. The `persist=false` on expand is load-bearing — persisting it would leak the dialog size into the remembered window size.

---

## 📋 Context Menus & Popovers

| Surface | Selector | Trigger |
| :--- | :--- | :--- |
| Clip menu | `#contextMenu` | Clip right-click |
| Collection pill menu | `#pillContextMenu` | Right-click on a collection chip |
| Sidebar collection menu | `#sidebarContextMenu` | Right-click in the sidebar tree |
| Hover popover | `#hoverPopover` | Hover preview |
| Filter dropdown | `#filterDropdown` | `#btnFilters` |
| Recent searches | `#recentSearchesDropdown` | Search history |
| Custom selects | `.custom-dropdown-menu.open`, `.custom-select-wrap.active` | Custom select widgets |
| Tag overflow | `.tag-overflow-popover` | Overflow tag badge (see [virtual-list-and-rendering.md](virtual-list-and-rendering.md)) |

Note: the sidebar menu uses `.tag-overflow-popover`-style class naming only for tags; the sidebar context menu is its own `#sidebarContextMenu` and is dispatched from `keyboard.js:199-209`.

---

## 🧪 Invariant Tests
- `DualClip.Tests/js-harness/ui-interaction-invariants.js` — tag chips, context menu positioning.
- `DualClip.Tests/js-harness/ui-navigation-invariants.js` — modal open/close, Escape ladder.
- `DualClip.Tests/SidebarNestedAdversarialTests.cs`
- `DualClip.Tests/CompactAndSearchInteractionTests.cs` — asserts `preview-window.html` no longer exists and compact-morph globals are present.