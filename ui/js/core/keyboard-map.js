// --- DualClip Declarative Keyboard Shortcut Map ---
// Central registry of frontend keyboard shortcuts, actions, and execution contexts.
// Non-goals: OS-level hotkeys (HotkeyService.cs / Win32) remain separate.

(function () {
  'use strict';

  /**
   * Dispatches mapped actions to their concrete implementation functions.
   * @param {string} action
   * @param {KeyboardEvent} e
   * @returns {boolean} true if handled
   */
  function dispatchKeyboardAction(action, e) {
    if (!action) return false;
    switch (action) {
      case 'focusSearch': {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          if (e) e.preventDefault();
          searchInput.focus();
          searchInput.select();
          return true;
        }
        return false;
      }
      case 'toggleSettings': {
        if (e) e.preventDefault();
        if (typeof toggleSettingsView === 'function') toggleSettingsView();
        else if (typeof openSettingsView === 'function') openSettingsView();
        return true;
      }
      case 'toggleLivePreview': {
        if (e) e.preventDefault();
        if (typeof toggleLivePreview === 'function') toggleLivePreview();
        return true;
      }
      case 'toggleViewMode': {
        if (e) e.preventDefault();
        if (typeof cycleViewMode === 'function') cycleViewMode();
        return true;
      }
      default:
        return false;
    }
  }

  window.dispatchKeyboardAction = dispatchKeyboardAction;
})();
