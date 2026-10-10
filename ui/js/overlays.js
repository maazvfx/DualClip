// --- DualClip Overlays Shim ---
// Modularized: real implementation now lives in js/overlays/ (4 focused modules
// loaded by index.html BEFORE this shim):
//   - tooltips-toasts.js
//   - context-menus.js
//   - preview-lightbox.js
//   - modals.js
// This file coordinates namespace exposure (window.DC.overlays) and verifies load integrity.

(function overlaysShimCheck() {
  try {
    if (typeof window !== 'undefined') {
      window.DC = window.DC || {};
      window.DC.overlays = {
        showGlobalInfoTooltip: window.showGlobalInfoTooltip,
        hideGlobalInfoTooltip: window.hideGlobalInfoTooltip,
        showToast: window.showToast,
        openContextMenu: window.openContextMenu,
        closeContextMenu: window.closeContextMenu,
        openFullPreviewModal: window.openFullPreviewModal,
        closePreviewModal: window.closePreviewModal,
        copyPreviewContent: window.copyPreviewContent,
        openAppPicker: window.openAppPicker,
        closeAppPicker: window.closeAppPicker,
        onAppPickerSearch: window.onAppPickerSearch,
        pickApp: window.pickApp,
        browseApplicationFromExplorer: window.browseApplicationFromExplorer,
        handleAppPickerKeydown: window.handleAppPickerKeydown,
        openMoveCollectionModal: window.openMoveCollectionModal,
        closeMoveCollectionModal: window.closeMoveCollectionModal,
        submitMoveCollectionModal: window.submitMoveCollectionModal,
        renderMoveCollectionModalList: window.renderMoveCollectionModalList,
        openNewCollectionFromMoveModal: window.openNewCollectionFromMoveModal,
        openNicknameModal: window.openNicknameModal,
        closeNicknameModal: window.closeNicknameModal,
        executeSaveNickname: window.executeSaveNickname,
        executeClearNickname: window.executeClearNickname,
        openEditClipModal: window.openEditClipModal,
        closeEditClipModal: window.closeEditClipModal,
        executePasteEditedClip: window.executePasteEditedClip,
        executeSaveEditedClip: window.executeSaveEditedClip
      };

      if (typeof window.showToast === 'undefined') {
        console.error('[DualClip] Overlays modules failed to load before overlays.js shim - check index.html script order.');
      }
    }
  } catch (e) {}
})();
