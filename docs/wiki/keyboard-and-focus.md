# Keyboard, Focus & Escape Hierarchy

## Overview
The global keydown router is a single `document` listener at [`ui/js/keyboard.js`](../../ui/js/keyboard.js:54). Everything below it is ordered; nothing is registered ad hoc.

---

## 🚧 Guard order (before any binding fires)

1. **Dev hard-reload** — `Ctrl+R` / `F5` busts the cache and reloads. Gated on `DEV_HOT_RELOAD`, which must be `false` in release builds (`keyboard.js:59-72`).
2. **Activation safety buffer** — for **150ms** after summon, stray `v`/`V` repeats are swallowed (`keyboard.js:74-80`).
3. **IME guard** — `e.isComposing` or `keyCode === 229` returns immediately, so IME composition never triggers a binding (`keyboard.js:81`).
4. **Modal-scoped handlers** — `moveCollectionModal` claims Escape/arrows/Enter/digits *before* the global ladder (`keyboard.js:94-119`).

### Input shields
- `isInputActive` — focus inside `INPUT` / `TEXTAREA` / `SELECT` / `contenteditable`, or the live-preview edit mode is active.
- `isButtonActive` — focus inside `button`, `[role="button"]`, `a[href]`, or `summary`. Without this, Enter and Space get claimed by clip actions and `preventDefault()`ed: Enter pasted the clip and Space opened QuickLook instead of activating the control. Mouse users never hit it (a pointerup handler blurs buttons); keyboard users hit it every time.
- `isModalTarget` — the event originated inside a `.modal-overlay`.
- `isAnyModalOpen()` — scans all overlays, falling back to `getComputedStyle` for dialogs shown by class rather than inline style, and also counts `#settingsView` (`keyboard.js:30-50`).

---

## 🪜 The 5-layer Escape hierarchy

`Escape` runs strictly top-down (`keyboard.js:179-358`). Each layer `return`s on a hit, so it never skips to hiding.

**Layer 1 — Popovers, dropdowns, context menus**
`#tagAutocomplete` → `closeOpenHotkeyPopovers()` → the context menu trio (`#contextMenu`, `#pillContextMenu`, `#sidebarContextMenu`) and `#hoverPopover` → `#filterDropdown` → `#recentSearchesDropdown` → `.custom-dropdown-menu.open` / `.custom-select-wrap.active`.

**Layer 2 — Modals & Settings**
Checked in this exact order: `#supporterPromptModal` → `#moveCollectionModal` → `#renameModal` → `#nicknameModal` → `#editClipModal` → `#appPickerModal` → `#manageTagsModal` → `#renameCollectionModal` → `#deleteCollectionModal` → `#clearConfirmModal` → `#previewModal` → `#settingsView` → `#newCollectionModal` → `#mergeCollectionModal` → `#exportClipsModal`.

For `#settingsView` specifically: if the settings search box has text, the first Escape clears the search; the next closes Settings.

**Layer 3 — Collapse multi-selection**
If `selectedIndices.size > 1`, collapse to a single row around the anchor. If the clip array is empty, reset to `selectedIndex = -1` and clear the set. Then `syncSelectedIds()` and re-render.

**Layer 4 — Search input clear / blur**
If `#searchInput` has focus: clear its text and re-filter when non-empty, then **blur in the same press**. (An empty search blurs without a filter reset.)

**Layer 5 — Hide the window**
`hideWindow()` → the `hide_window` RPC.

---

## 🧭 Related bindings

| Key | Behavior |
| :--- | :--- |
| `Ctrl+F` / `Cmd+F` | Focus the search bar |
| `Ctrl+A` | Select all loaded clips |
| `Shift+arrows` | Extend selection ranges |
| `Space` | QuickLook preview |
| `Delete` | Delete selected |
| `1`–`9` | Jump to / paste by number |
| `Tab` / `Shift+Tab` in Settings | Cycle settings tabs |

## 🪤 Tab trap
Modal focus trapping is a **capture-phase** listener in `ui/js/overlays/modals.js:1627-1639`, so it runs ahead of these bindings. See [overlays-and-modals.md](overlays-and-modals.md#tab-trap).

---

## 🧪 Invariant Tests
- `js-harness/ui-navigation-invariants.js`
  - `escape_closes_context_menu_without_hiding_window`
  - `escape_closes_modal_without_hiding_window`
  - `escape_with_nothing_open_hides_window`
  - search scopes, arrow navigation
- `js-harness/ui-bulk-invariants.js` — Shift-range select, Ctrl+A, bulk delete/merge.

See [testing-matrix.md](testing-matrix.md).