# Architecture & Code Quality Audit: ui/js/keyboard.js

## 1. Module Purpose & Responsibilities
- `keyboard.js`: Central event routing hub for all user keypresses, arrow navigation, shortcut triggers, quick actions (Delete, Space QuickLook, Ctrl+A multi-select, Ctrl+B sticky pin, Ctrl+S star, F2 rename), modal dismiss ladders, and window lifecycle (summon buffer, hide).
- Key responsibilities:
  1. Priority-layered Escape key handling: Dismisses dropdowns/popovers first $\rightarrow$ modals $\rightarrow$ collapses multi-selection $\rightarrow$ clears/blurs search bar $\rightarrow$ hides window.
  2. Input focus shields: Accurately distinguishes between text fields (`INPUT`, `TEXTAREA`, `contenteditable`), interactive controls (`button`, `a[href]`, `summary`), and ambient keyboard navigation.
  3. Single/Bulk actions: Direct triggers for `quickDeleteClip`, batch delete with 2MB undo budget, Spacebar QuickLook preview toggle, and arrow key browsing.
  4. Rapid re-summon repeat suppression: Ignores summon key bounce during the first 150ms after window appearance (`_windowActivatedAt`).

## 2. Dead Code & Safe Pruning Targets
- Dev hot reload constant (`const DEV_HOT_RELOAD = true`): Sits above the input/modal guards for F5 / Ctrl+R. Needs to be switched off or stripped prior to final production release to prevent accidental webview reloads during dialog editing.
- Unreachable/redundant checks: Some modal existence checks (e.g. `isSupporterPromptOpen`, `isAppPickerOpen`) check modal DOM elements that may not exist in all modes or have legacy fallback handlers.

## 3. Performance & Memory Hotspots
- `isAnyModalOpen(excludeId)`:
  - Runs `document.querySelectorAll('.modal-overlay')` and checks inline styles + `getComputedStyle()` on every single keypress. While negligible on desktop CPUs, computing style synchronously on every keydown in a busy message loop is an antipattern. A boolean modal stack counter (`modalOpenCount` or `activeModalStack`) in `modals.js` would turn this into an $O(1)$ integer check.

## 4. Code Duplication & Refactoring Targets
- Massive 1,467-line single monolithic event listener:
  - The main `keydown` listener runs over 800 continuous lines of nested `if/else if` blocks.
  - Layered Escape handler (lines 179–344) explicitly inspects 18 different modal IDs individually (`isMoveColOpen`, `isRenameOpen`, `isNickOpen`, `isEditOpen`, `isAppPickerOpen`, etc.) with repetitive `closeXModal()` calls instead of using a unified modal stack or top-of-stack closer (`ModalManager.closeTop()`).

## 5. Critical Invariants (DO NOT TOUCH)
- **Layered Escape Priority**: Never collapse the window on Escape if a modal or context menu is active. The ladder (menus $\rightarrow$ modals $\rightarrow$ multi-selection $\rightarrow$ search clear $\rightarrow$ window hide) is fundamental to user UX.
- **`isInputActive` & `isButtonActive` Guards**: Spacebar and Enter must activate focused HTML buttons and form inputs rather than triggering clip paste or QuickLook.
- **Activation Safety Buffer (`Date.now() - window._windowActivatedAt < 150`)**: Essential to suppress Windows OS key bounce when summoning DualClip with global hotkeys like Win+V / Ctrl+Shift+V.

## 6. Prioritized Action Plan
- **Medium**: Replace the 18 manual modal inspections in the Escape handler with a unified `ModalManager.closeTop()` method.
- **Medium**: Replace `isAnyModalOpen()` DOM query with an $O(1)$ modal count flag managed by modal open/close helpers.
- **Low**: Set `DEV_HOT_RELOAD = false` before final release packaging.
