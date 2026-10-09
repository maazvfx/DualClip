# Architecture & Code Quality Audit: ui/js/overlays/modals.js

## 1. Module Purpose & Responsibilities
- `modals.js`: Controls lifecycle, DOM rendering, form validation, and event handling for all secondary modal dialogues in DualClip.
- Key dialogs managed:
  1. App Picker Modal (`openAppPicker`, `browseApplicationFromExplorer`): Queries active Windows processes via `get_running_apps` or file explorer picker for auto-sort rules.
  2. Nickname Modal & Rename Modal: Custom title editing, tag associations, and metadata saves.
  3. Edit Clip Modal: Text content modifications with live preview and character count.
  4. Move to Collection Modal: Numbered quick-pick keyboard workflow (`1-9` keys) and custom destination selection.
  5. Manage Tags Modal: Tag creation, deletion, and tag-to-clip associations.

## 2. Dead Code & Safe Pruning Targets
- Mock running apps list (lines 42–49): Five hardcoded dummy applications (`code.exe`, `chrome.exe`, `msedge.exe`, `slack.exe`, `notepad.exe`) used only when running outside WebView2. Could be conditional or stubbed out.
- Redundant dismiss handlers: Multiple overlapping click-outside and scroll dismiss listeners across `modals.js` and `keyboard.js`.

## 3. Performance & Memory Hotspots
- DOM reconstruction on keystroke in App Picker:
  - `onAppPickerSearch` triggers `renderAppPickerList()`, which completely clears `listEl.innerHTML = ''` and creates new DOM nodes for every running desktop process on every character typed.
  - Using a filter class (`display: none`) or Virtual List on the existing DOM nodes would eliminate layout thrashing during search typing.

## 4. Code Duplication & Refactoring Targets
- Modal open/close boilerplate:
  - Each modal (`renameModal`, `nicknameModal`, `editClipModal`, `appPickerModal`, `moveCollectionModal`) defines separate `closeXModal(e)` functions with identical backdrop-click check boilerplate (`if (e && e.target && e.target.id !== '...Modal') return;`).
  - A unified modal controller (`ModalManager.show(id)` / `ModalManager.hide(id)`) would trim ~250 lines of duplicate open/close boilerplate.

## 5. Critical Invariants (DO NOT TOUCH)
- **Host Modal State Synchronization (`set_modal_open`)**: Backend must be informed whenever a modal is open via `window.pywebview.api.set_modal_open(true)` so global hotkeys and click-away hide behaviors are temporarily suppressed.
- **Grace Period on Scroll Dismiss (`window.__pillMenuOpenedAt < 300`)**: Prevents immediate closure of popup menus due to accidental mouse wheel momentum ticks right when a menu opens.
- **Form Auto-Focus Delay (`setTimeout(..., 60)`)**: Focus calls on modal inputs must remain slightly deferred after setting `display: flex` to ensure the WebView2 layout pass has completed, avoiding focus-dropping bugs.

## 6. Prioritized Action Plan
- **Medium**: Refactor `renderAppPickerList()` to toggle CSS visibility instead of re-creating DOM elements on each search keypress.
- **Medium**: Consolidate repetitive modal open/close functions into a shared modal helper.
- **Low**: Move hardcoded mock application fallbacks into a dedicated test fixture.
