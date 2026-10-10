// --- DualClip Keyboard Navigation, Window Dragging & Lifecycle ---

// Dev-only reload shortcut (F5 / Ctrl+R).
// Set to false for production / release so stray F5 or Ctrl+R does not reload the app and discard user edits.
const DEV_HOT_RELOAD = false;

function hideWindow(force = false) {
  window._smartHoldActive = false;
  winCycleCount = 0;
  if (typeof currentSettingsTab !== 'undefined') {
    currentSettingsTab = 'behavior';
  }
  if (!force && window.isWindowPinned) {
    return;
  }
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.hide_window === 'function') {
    window.pywebview.api.hide_window();
  } else if (window.chrome && window.chrome.webview) {
    window.chrome.webview.postMessage({id:0, method:'hide_window', args:[]});
  }
}

function resetDragState() {
  if (typeof clearAllDraggingState === 'function') clearAllDraggingState();
}

function isAnyModalOpen(excludeId) {
  const overlays = document.querySelectorAll('.modal-overlay');
  for (let i = 0; i < overlays.length; i++) {
    const el = overlays[i];
    if (!el || el.id === excludeId) continue;
    if (el.style.display && el.style.display !== 'none') {
      return true;
    }
    // Fallback for dialogs shown via class rather than inline style.
    try {
      if (!el.style.display && typeof getComputedStyle === 'function' && getComputedStyle(el).display !== 'none') {
        return true;
      }
    } catch (e) {}
  }
  const sv = document.getElementById('settingsView');
  if (sv && sv.id !== excludeId && sv.style.display && sv.style.display !== 'none') {
    return true;
  }
  return false;
}
window.isAnyModalOpen = isAnyModalOpen;

// Global Keydown Router
document.addEventListener('keydown', (e) => {
  // Dev-only hard reload (Ctrl+R / F5): re-fetch styles/scripts bypassing cache, then reload.
  // While DEV_HOT_RELOAD is true this behaves exactly like it always has — unconditional, and above
  // the IME / input / modal guards — so it is a reliable escape hatch while iterating.
  // Flip DEV_HOT_RELOAD to false before the final release build. (K1 in the keyboard audit.)
  if (DEV_HOT_RELOAD) {
    if (
      ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R' || e.code === 'KeyR')) ||
      e.key === 'F5' || e.code === 'F5'
    ) {
      try {
        const busts = [];
        document.querySelectorAll('link[rel="stylesheet"][href]').forEach(l => { try { busts.push(fetch(l.href, { cache: 'reload' }).catch(() => {})); } catch {} });
        document.querySelectorAll('script[src]').forEach(s => { try { busts.push(fetch(s.src, { cache: 'reload' }).catch(() => {})); } catch {} });
        Promise.all(busts).catch(() => {}).finally(() => { try { window.location.reload(); } catch {} });
      } catch { try { window.location.reload(); } catch {} }
      return;
    }
  }
  // Activation safety buffer: ignore stray repeat keypresses of summon key ('v' / 'V') during first 150ms (audit K9)
  if (window._windowActivatedAt && (Date.now() - window._windowActivatedAt < 150)) {
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  if (e.isComposing || e.keyCode === 229) return;
  const activeEl = document.activeElement;
  const isPreviewEdit = typeof livePreviewEditMode !== 'undefined' && livePreviewEditMode;
  const isInputActive = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable) || isPreviewEdit;
  // A focused button is not an "input", so without this the Enter and Space branches below claimed
  // those keys and preventDefault()ed them: Enter pasted the selected clip and Space opened QuickLook
  // instead of activating the control. Mouse users never hit it because the pointerup handler blurs
  // buttons after a click; keyboard users hit it every time. (K2 in the keyboard audit.)
  const isButtonActive = !!(activeEl && activeEl.closest && activeEl.closest('button, [role="button"], a[href], summary'));
  const isModalTarget = !!((e.target && e.target.closest && e.target.closest('.modal-overlay')) || (activeEl && activeEl.closest && activeEl.closest('.modal-overlay')));
  const isModalOrSettingsOpen = isAnyModalOpen() || isModalTarget;

  // Active Move to Collection Modal Navigation
  const isMoveColOpen = document.getElementById('moveCollectionModal') && document.getElementById('moveCollectionModal').style.display === 'flex';
  if (isMoveColOpen) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof closeMoveCollectionModal === 'function') closeMoveCollectionModal();
      return;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (typeof moveModalCollectionsList !== 'undefined' && moveModalCollectionsList.length > 0) {
        moveModalHighlightedIndex = Math.min(moveModalHighlightedIndex + 1, moveModalCollectionsList.length - 1);
        if (typeof renderMoveCollectionModalList === 'function') renderMoveCollectionModalList();
      }
      return;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (typeof moveModalCollectionsList !== 'undefined' && moveModalCollectionsList.length > 0) {
        moveModalHighlightedIndex = Math.max(moveModalHighlightedIndex - 1, 0);
        if (typeof renderMoveCollectionModalList === 'function') renderMoveCollectionModalList();
      }
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (typeof submitMoveCollectionModal === 'function') submitMoveCollectionModal();
      return;
    } else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const num = parseInt(e.key, 10);
      if (typeof moveModalCollectionsList !== 'undefined' && num >= 1 && num <= moveModalCollectionsList.length) {
        moveModalHighlightedIndex = num - 1;
        if (typeof renderMoveCollectionModalList === 'function') renderMoveCollectionModalList();
        if (typeof submitMoveCollectionModal === 'function') submitMoveCollectionModal();
      }
      return;
    }
    return;
  }

  // Preview Modal Arrow Key navigation (when unfocused from textarea)
  const isPrevModalOpen = document.getElementById('previewModal') && document.getElementById('previewModal').style.display === 'flex';
  if (isPrevModalOpen) {
    const isUnfocusedOrNonText = !activeEl || (activeEl.id !== 'prevContent' && activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA');

    if (isUnfocusedOrNonText) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (Array.isArray(clips) && clips.length > 0) {
          if (e.key === 'ArrowDown') {
            selectedIndex = Math.min(selectedIndex + 1, clips.length - 1);
          } else {
            selectedIndex = Math.max(selectedIndex - 1, 0);
          }
          selectedIndices.clear();
          selectedIndices.add(selectedIndex);
          lastAnchorIndex = selectedIndex;
          if (typeof scrollIndexIntoView === 'function') scrollIndexIntoView(selectedIndex);
          if (typeof openFullPreviewModal === 'function' && clips[selectedIndex]) {
            openFullPreviewModal(clips[selectedIndex]);
          }
        }
        return;
      }
    }
  }

  const isSettingsOpenNow = document.getElementById('settingsView') && document.getElementById('settingsView').style.display === 'flex';
  if (isSettingsOpenNow && (!activeEl || activeEl.id !== 'settingsSearchInput' && activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'SELECT')) {
    const tabsList = ['behavior', 'theme', 'window', 'routing', 'storage', 'shortcuts'];
    const curIdx = tabsList.indexOf(typeof currentSettingsTab !== 'undefined' ? currentSettingsTab : 'behavior');
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIdx = (curIdx + 1) % tabsList.length;
      if (typeof switchSettingsTab === 'function') switchSettingsTab(tabsList[nextIdx]);
      const nextBtn = document.getElementById(`tabBtn_${tabsList[nextIdx]}`);
      if (nextBtn) nextBtn.focus();
      return;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = (curIdx - 1 + tabsList.length) % tabsList.length;
      if (typeof switchSettingsTab === 'function') switchSettingsTab(tabsList[prevIdx]);
      const prevBtn = document.getElementById(`tabBtn_${tabsList[prevIdx]}`);
      if (prevBtn) prevBtn.focus();
      return;
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();

    // Layer 1: Dropdowns, Popovers & Context Menus
    const tagAcBox = document.getElementById('tagAutocomplete');
    const isTagAcOpen = tagAcBox && tagAcBox.style.display !== 'none' && tagAcBox.style.display !== '';
    if (isTagAcOpen) {
      if (typeof hideTagAutocomplete === 'function') hideTagAutocomplete();
      return;
    }

    if (typeof closeOpenHotkeyPopovers === 'function' && closeOpenHotkeyPopovers()) {
      return;
    }

    const ctxMenu = document.getElementById('contextMenu');
    const isCtxOpen = ctxMenu && ctxMenu.style.display !== 'none' && ctxMenu.style.display !== '';
    const pillMenu = document.getElementById('pillContextMenu');
    const isPillMenuOpen = pillMenu && pillMenu.style.display !== 'none' && pillMenu.style.display !== '';
    const sideMenu = document.getElementById('sidebarContextMenu');
    const isSideMenuOpen = sideMenu && sideMenu.style.display !== 'none' && sideMenu.style.display !== '';
    const hoverPop = document.getElementById('hoverPopover');
    const isHoverOpen = hoverPop && hoverPop.style.display !== 'none' && hoverPop.style.display !== '';

    if (isCtxOpen || isPillMenuOpen || isSideMenuOpen || isHoverOpen) {
      if (typeof closeContextMenu === 'function') closeContextMenu();
      if (typeof closePillMenu === 'function') closePillMenu();
      if (typeof closeSidebarContextMenu === 'function') closeSidebarContextMenu();
      if (typeof hideHoverPopover === 'function') hideHoverPopover();
      return;
    }

    const filterDd = document.getElementById('filterDropdown');
    const isFilterOpen = filterDd && (filterDd.classList.contains('show') || (filterDd.style.display !== 'none' && filterDd.style.display !== ''));
    if (isFilterOpen) {
      if (typeof closeFilterDropdown === 'function') closeFilterDropdown();
      else filterDd.classList.remove('show');
      return;
    }

    const recentDd = document.getElementById('recentSearchesDropdown');
    const isRecentOpen = recentDd && (recentDd.classList.contains('show') || recentDd.style.display === 'block' || (recentDd.style.display !== 'none' && recentDd.style.display !== ''));
    if (isRecentOpen) {
      if (typeof closeRecentSearchesDropdown === 'function') closeRecentSearchesDropdown();
      else recentDd.style.display = 'none';
      return;
    }
    const openCustomSelects = document.querySelectorAll('.custom-dropdown-menu.open, .custom-select-wrap.active');
    if (openCustomSelects.length > 0) {
      if (typeof closeAllCustomSelects === 'function') {
        closeAllCustomSelects();
      } else {
        openCustomSelects.forEach(el => {
          el.classList.remove('open', 'active');
          const btn = el.closest('.custom-select-wrap')?.querySelector('.custom-select-btn');
          if (btn) btn.setAttribute('aria-expanded', 'false');
        });
      }
      return;
    }

    // Layer 1.5 — Generic Transient Sweep: any floating/overlay widget that is
    // not a full modal-overlay counts as "sub-window open" and must win over hideWindow().
    const transientSelectors = [
      '.pause-for-dropdown',
      '.tag-overflow-popover',
      '.submenu.submenu-open',
      '.preview-image-lightbox',
      '#dropZoneOverlay',
      '.milestone-banner'
    ];
    let closedTransient = false;
    const isTransientVisible = (el) => {
      if (!el) return false;
      if (el.style.display && el.style.display !== 'none') return true;
      if (el.classList && (el.classList.contains('open') || el.classList.contains('show') || el.classList.contains('submenu-open') || el.classList.contains('active'))) return true;
      try { if (typeof getComputedStyle === 'function' && getComputedStyle(el).display !== 'none') return true; } catch (_) {}
      return false;
    };

    for (const sel of transientSelectors) {
      const el = document.querySelector(sel);
      if (isTransientVisible(el)) {
        if (sel === '.pause-for-dropdown') { el.style.display = 'none'; }
        else if (sel === '.tag-overflow-popover') { if (typeof closeTagOverflowPopover === 'function') closeTagOverflowPopover(); else el.remove(); }
        else if (sel === '.submenu.submenu-open') { el.classList.remove('submenu-open'); }
        else if (sel === '.preview-image-lightbox') { if (typeof teardownImageLightbox === 'function') teardownImageLightbox(); else el.remove(); }
        else if (sel === '#dropZoneOverlay') { if (typeof hideDropZone === 'function') hideDropZone(); else el.style.display = 'none'; }
        else if (sel === '.milestone-banner') { if (typeof dismissMilestoneBanner === 'function') dismissMilestoneBanner(); else el.style.display = 'none'; }
        closedTransient = true;
        break;
      }
    }
    if (closedTransient) {
      return;
    }
    // Layer 2: Modals & Settings View
    const isMoveColOpen = document.getElementById('moveCollectionModal') && document.getElementById('moveCollectionModal').style.display === 'flex';
    const isRenameOpen = document.getElementById('renameModal') && document.getElementById('renameModal').style.display === 'flex';
    const isNickOpen = document.getElementById('nicknameModal') && document.getElementById('nicknameModal').style.display === 'flex';
    const isEditOpen = document.getElementById('editClipModal') && document.getElementById('editClipModal').style.display === 'flex';
    const isAppPickerOpen = document.getElementById('appPickerModal') && document.getElementById('appPickerModal').style.display === 'flex';
    const isDeleteColOpen = document.getElementById('deleteCollectionModal') && document.getElementById('deleteCollectionModal').style.display === 'flex';
    const isRenameColOpen = document.getElementById('renameCollectionModal') && document.getElementById('renameCollectionModal').style.display === 'flex';
    const isClearOpen = document.getElementById('clearConfirmModal') && document.getElementById('clearConfirmModal').style.display === 'flex';
    const isPrevOpen = document.getElementById('previewModal') && document.getElementById('previewModal').style.display === 'flex';
    const isSettingsOpen = document.getElementById('settingsView') && document.getElementById('settingsView').style.display === 'flex';
    const isNewColOpen = document.getElementById('newCollectionModal') && document.getElementById('newCollectionModal').style.display === 'flex';
    const isMergeOpen = document.getElementById('mergeCollectionModal') && document.getElementById('mergeCollectionModal').style.display === 'flex';
    const isExportOpen = document.getElementById('exportClipsModal') && document.getElementById('exportClipsModal').style.display === 'flex';
    const isSupporterPromptOpen = document.getElementById('supporterPromptModal') && document.getElementById('supporterPromptModal').style.display === 'flex';
    const isManageTagsOpen = document.getElementById('manageTagsModal') && document.getElementById('manageTagsModal').style.display === 'flex';

    if (isSupporterPromptOpen) {
      if (typeof closeSupporterModal === 'function') closeSupporterModal();
      return;
    }
    if (isMoveColOpen) {
      if (typeof closeMoveCollectionModal === 'function') closeMoveCollectionModal();
      return;
    }
    if (isRenameOpen) {
      if (typeof closeRenameModal === 'function') closeRenameModal();
      return;
    }
    if (isNickOpen) {
      if (typeof closeNicknameModal === 'function') closeNicknameModal();
      return;
    }
    if (isEditOpen) {
      if (typeof closeEditClipModal === 'function') closeEditClipModal();
      return;
    }
    if (isAppPickerOpen) {
      if (typeof closeAppPicker === 'function') closeAppPicker();
      return;
    }
    if (isManageTagsOpen) {
      if (typeof closeManageTagsModal === 'function') closeManageTagsModal();
      return;
    }
    if (isRenameColOpen) {
      if (typeof closeRenameCollectionModal === 'function') closeRenameCollectionModal();
      return;
    }
    if (isDeleteColOpen) {
      if (typeof closeDeleteCollectionModal === 'function') closeDeleteCollectionModal();
      return;
    }
    if (isClearOpen) {
      if (typeof closeClearConfirmModal === 'function') closeClearConfirmModal();
      return;
    }
    if (isPrevOpen) {
      if (typeof closePreviewModal === 'function') closePreviewModal();
      return;
    }
    if (isSettingsOpen) {
      const setInp = document.getElementById('settingsSearchInput');
      if (setInp && setInp.value.trim().length > 0) {
        if (typeof clearSettingsSearch === 'function') clearSettingsSearch();
      } else {
        if (typeof closeSettingsView === 'function') closeSettingsView();
      }
      return;
    }
    if (isNewColOpen) {
      if (typeof closeNewCollectionModal === 'function') closeNewCollectionModal();
      return;
    }
    if (isMergeOpen) {
      if (typeof closeMergeCollectionModal === 'function') closeMergeCollectionModal();
      return;
    }
    if (isExportOpen) {
      if (typeof closeExportClipsModal === 'function') closeExportClipsModal();
      return;
    }

    // Layer 3: Collapse Multi-Selection
    if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 1) {
      if (!Array.isArray(clips) || clips.length === 0) {
        selectedIndex = -1;
        selectedIndices.clear();
        lastAnchorIndex = 0;
      } else {
        const anchor = (typeof selectedIndex !== 'undefined' && selectedIndex >= 0 && selectedIndex < clips.length)
          ? selectedIndex
          : (typeof lastAnchorIndex !== 'undefined' ? lastAnchorIndex : 0);
        selectedIndex = Math.max(0, Math.min(anchor, clips.length - 1));
        selectedIndices.clear();
        selectedIndices.add(selectedIndex);
        lastAnchorIndex = selectedIndex;
      }
      if (typeof syncSelectedIds === 'function') syncSelectedIds();
      if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
      else if (typeof renderList === 'function') renderList();
      return;
    }

    // Layer 4: Search Input Blur / Clear
    const searchInput = document.getElementById('searchInput');
    if (document.activeElement === searchInput) {
      if (searchInput.value.length > 0) {
        searchInput.value = '';
        if (typeof onSearchInput === 'function') onSearchInput({ target: searchInput });
        else if (typeof applyFilters === 'function') applyFilters();
      }
      searchInput.blur();
      return;
    }

    // Layer 5: Hide Main Window
    hideWindow();
    return;
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    if (isModalOrSettingsOpen) return;
    if (typeof dispatchKeyboardAction === 'function' && dispatchKeyboardAction('focusSearch', e)) return;
    e.preventDefault();
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    if (isModalOrSettingsOpen) return;
    if (typeof dispatchKeyboardAction === 'function' && dispatchKeyboardAction('toggleSettings', e)) return;
    e.preventDefault();
    if (typeof toggleSettingsView === 'function') toggleSettingsView();
    else if (typeof openSettingsView === 'function') openSettingsView();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !isInputActive && !isModalOrSettingsOpen && isFeatureEnabled('multiSelect')) {
    // Ctrl + A: Multi-Select All
    e.preventDefault();
    selectedIndices.clear();
    clips.forEach((_, i) => selectedIndices.add(i));
    if (clips.length > 0) {
      if (selectedIndex < 0 || selectedIndex >= clips.length) {
        selectedIndex = 0;
        lastAnchorIndex = 0;
      }
    } else {
      selectedIndex = -1;
      lastAnchorIndex = -1;
    }
    if (typeof syncSelectedIds === 'function') syncSelectedIds();
    if (typeof syncLivePreview === 'function') syncLivePreview();
    if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B') && !e.shiftKey && !isInputActive && !isModalOrSettingsOpen) {
    // Ctrl + B: Toggle Pin to Top (Sticky Zone)
    e.preventDefault();
    if (e.repeat) return;
    if (typeof toggleClipProperty === 'function') {
      toggleClipProperty('pin', selectedIndex, { anchorIndex: selectedIndex });
    }
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && !e.shiftKey && !isInputActive && !isModalOrSettingsOpen) {
    // Ctrl + S: Toggle Favorite (⭐)
    e.preventDefault();
    if (e.repeat) return;
    if (typeof toggleClipProperty === 'function') {
      toggleClipProperty('favorite', selectedIndex, { anchorIndex: selectedIndex, invalidateCounts: true });
    }
  } else if (e.key === 'Delete' && !isModalOrSettingsOpen && (!isInputActive || (activeEl && activeEl.id === 'searchInput' && !activeEl.value))) {
    if (activeEl && activeEl.id === 'searchInput') {
      e.preventDefault();
    }
    if (e.repeat) { e.preventDefault(); return; }
    if (selectedIndices.size === 1) {
      const onlyIndex = Array.from(selectedIndices)[0];
      if (typeof quickDeleteClip === 'function') quickDeleteClip(null, onlyIndex);
    } else if (selectedIndices.size > 1) {
      const count = selectedIndices.size;
      const deletedItems = [];
      const idsToDelete = [];
      const MAX_UNDO_ITEMS = 25;
      const MAX_UNDO_BYTES = 2 * 1024 * 1024; // 2MB memory budget
      let totalBytesEstimate = 0;
      let canOfferUndo = count <= MAX_UNDO_ITEMS;

      selectedIndices.forEach(idx => {
        const item = clips[idx];
        if (item) {
          idsToDelete.push(item.id);
          if (canOfferUndo) {
            const str = JSON.stringify(item);
            totalBytesEstimate += (str ? str.length * 2 : 0);
            if (totalBytesEstimate > MAX_UNDO_BYTES) {
              canOfferUndo = false;
              deletedItems.length = 0;
            } else {
              deletedItems.push(JSON.parse(str));
            }
          }
        }
      });
      if (typeof currentPreviewClip !== 'undefined' && currentPreviewClip && idsToDelete.includes(currentPreviewClip.id)) {
        if (typeof closePreviewModal === 'function') closePreviewModal();
      }
      const anchorIdx = selectedIndices.size > 0 ? Math.min(...Array.from(selectedIndices)) : 0;
      const survivingIds = (typeof snapshotSelectedIds === 'function') ? snapshotSelectedIds() : new Set();
      idsToDelete.forEach(id => survivingIds.delete(id));

      allClips = allClips.filter(c => !idsToDelete.includes(c.id));
      clips = clips.filter(c => !idsToDelete.includes(c.id));

      if (survivingIds.size > 0 && typeof restoreSelectionByIds === 'function') {
        restoreSelectionByIds(survivingIds, Math.min(anchorIdx, Math.max(0, clips.length - 1)));
      } else {
        selectedIndices.clear();
        selectedIndex = clips.length === 0 ? -1 : Math.min(anchorIdx, clips.length - 1);
        if (selectedIndex >= 0) selectedIndices.add(selectedIndex);
        lastAnchorIndex = selectedIndex >= 0 ? selectedIndex : 0;
      }
      if (expandedIndex !== -1 && (expandedIndex >= clips.length || !clips[expandedIndex])) expandedIndex = -1;
      contextTargetIndex = -1;
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.delete_clip === 'function') {
        idsToDelete.forEach(id => {
          try { window.pywebview.api.delete_clip(id); } catch(err) {}
        });
      }
      if (typeof applyFilters === 'function') applyFilters();
      else if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
      if (typeof showToast === 'function') {
        const toastOptions = canOfferUndo && deletedItems.length > 0 ? {
          actionLabel: 'Undo',
          duration: 4000,
          onAction: async () => {
            const restoreApi = window.pywebview && window.pywebview.api && window.pywebview.api.restore_clip;
            for (const item of deletedItems) {
              if (typeof restoreApi === 'function') {
                try {
                  const res = await restoreApi(item);
                  if (res && res.clip) {
                    const uiClip = typeof formatClipForUI === 'function' ? formatClipForUI(res.clip) : res.clip;
                    allClips = [uiClip, ...allClips.filter(c => c.id !== uiClip.id)];
                  }
                } catch(e) {}
              } else {
                allClips = [item, ...allClips.filter(c => c.id !== item.id)];
              }
            }
            deletedItems.length = 0;
            if (typeof applyFilters === 'function') applyFilters();
            showToast(`Restored items`);
          }
        } : { duration: 2500 };
        showToast(`Deleted ${count} items`, toastOptions);
      }
    }
  } else if ((((e.key === 'q' || e.key === 'Q') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) || e.key === 'F8') && !isInputActive && !isModalOrSettingsOpen) {
    // Ctrl+Q or F8: Toggle Live Preview Panel
    if (typeof dispatchKeyboardAction === 'function' && dispatchKeyboardAction('toggleLivePreview', e)) return;
    e.preventDefault();
    if (typeof toggleLivePreview === 'function') {
      toggleLivePreview();
    }
  } else if (e.key === 'F2' || ((e.key === 't' || e.key === 'T') && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const isModalInput = activeEl && activeEl.closest && activeEl.closest('.modal-overlay');
    if (!isModalInput && !isModalOrSettingsOpen && isFeatureEnabled('nicknameModal')) {
      if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 1) {
        if (typeof openNicknameModal === 'function') openNicknameModal();
      } else if (typeof selectedIndices !== 'undefined' && selectedIndices.size === 1) {
        const sole = Array.from(selectedIndices)[0];
        if (sole >= 0 && sole < clips.length) {
          if (e.key === 'F2' && typeof openRenameModal === 'function') {
            openRenameModal(clips[sole]);
          } else if (typeof openNicknameModal === 'function') {
            openNicknameModal(clips[sole]);
          }
        }
      } else if (selectedIndex >= 0 && selectedIndex < clips.length) {
        if (e.key === 'F2' && typeof openRenameModal === 'function') {
          openRenameModal(clips[selectedIndex]);
        } else if (typeof openNicknameModal === 'function') {
          openNicknameModal(clips[selectedIndex]);
        }
      }
    }
  } else if (e.key === ' ' && !isButtonActive && (!isInputActive || (activeEl && activeEl.id === 'searchInput' && !activeEl.value.trim()))) {
    if (e.repeat) {
      e.preventDefault();
      return;
    }

    const prevModal = document.getElementById('previewModal');
    const isPrevOpen = prevModal && prevModal.style.display === 'flex';

    if (isPrevOpen) {
      // Spacebar with preview open: close it (leave focus off inputs so Space reopens)
      e.preventDefault();
      if (typeof closePreviewModal === 'function') closePreviewModal();
      return;
    }

    // Spacebar QuickLook: open the in-app preview (Space is the only preview key).

    // Shield against other open dialogs: never pop QuickLook over them
    if (isModalOrSettingsOpen) return;

    // Spacebar QuickLook: open the in-app preview (detach via the pop-out button).
    // Closing an open preview with Space always works.
    e.preventDefault();
    let targetIdx = (selectedIndex >= 0 && selectedIndex < clips.length) ? selectedIndex : -1;
    if (targetIdx < 0 && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) {
      try {
        const first = Array.from(selectedIndices).sort((a,b)=>a-b)[0];
        if (first >= 0 && first < clips.length) targetIdx = first;
      } catch {}
    }
    if (targetIdx < 0 && Array.isArray(clips) && clips.length > 0) {
      targetIdx = 0;
    }
    if (targetIdx >= 0 && targetIdx < clips.length) {
      if (typeof openFullPreviewModal === 'function') openFullPreviewModal(clips[targetIdx]);
      else if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
      else if (typeof renderList === 'function') renderList();
    }
  } else if ((e.key === 'Enter' || e.key === 'NumpadEnter') && isModalOrSettingsOpen) {
    // Enter-to-confirm for button-only confirmation modals.
    // Skip when focus is in a text field (those dialogs own their own Enter).
    const ae = document.activeElement;
    const inTextField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (inTextField) return;

    const confirmMap = [
      ['clearConfirmModal', 'executeClearHistory'],
      ['deleteCollectionModal', 'executeDeleteCollection'],
      ['mergeCollectionModal', 'executeMergeCollection'],
    ];
    for (const [id, fn] of confirmMap) {
      const el = document.getElementById(id);
      if (el && el.style.display === 'flex') {
        const btn = el.querySelector('.minimal-btn-danger, button[type="submit"], #clearModalConfirmBtn');
        if (btn && btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (typeof window[fn] === 'function') window[fn]();
        return;
      }
    }
    return; // a different modal (e.g. settings) is open; do nothing on Enter
  } else if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !isModalOrSettingsOpen && !isButtonActive && (!isInputActive || (activeEl && activeEl.id === 'searchInput'))) {
    e.preventDefault();
    // Shift+Enter: sequential paste — paste but keep DualClip open and focused.
    // Plain Enter: paste and hide (host default).
    if (e.repeat) return;
    const stayOpenPaste = e.shiftKey === true && !e.ctrlKey && !e.metaKey;
    if (selectedIndices.size > 1) {
      const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
      const idsToPaste = [];
      const futureBase = Date.now() + 60000;
      sortedIndices.forEach((idx, orderIdx) => {
        if (clips[idx]) {
          const clip = clips[idx];
          const futureIso = new Date(futureBase - orderIdx).toISOString();
          clip.last_used_at = futureIso;
          clip.time_group = 'today';
          // preserve collection — do not mutate clip.collection
          [allClips, clips].forEach(arr => {
            const i = arr.findIndex(c => c.id === clip.id);
            if (i > -1) {
              const [t] = arr.splice(i, 1);
              t.last_used_at = futureIso;
              t.time_group = 'today';
              t.use_count = (t.use_count || 0) + 1;
              const p = arr.findIndex(c => !c.pinned);
              if (t.pinned || p === -1) arr.unshift(t);
              else arr.splice(p, 0, t);
            }
          });
          idsToPaste.push(clip.id);
        }
      });
      if (typeof sortAllClips === 'function') sortAllClips();
      if (typeof applyFilters === 'function') applyFilters();
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_multi === 'function') {
        const res = window.pywebview.api.paste_multi(idsToPaste, stayOpenPaste);
        if (res && typeof res.then === 'function') {
          res.then(r => {
            if (r && r.ok === false && typeof refreshClips === 'function') {
              refreshClips();
            }
          }).catch(() => {
            if (typeof refreshClips === 'function') refreshClips();
          });
        }
      }
    } else if (selectedIndex >= 0 && selectedIndex < clips.length) {
      const clip = clips[selectedIndex];
      const futureIso = new Date(Date.now() + 60000).toISOString();
      clip.last_used_at = futureIso;
      clip.time_group = 'today';
      clip.use_count = (clip.use_count || 0) + 1;
      clip.manually_used = true;
      [allClips, clips].forEach(arr => {
        const i = arr.findIndex(c => c.id === clip.id);
        if (i > -1) {
          const [t] = arr.splice(i, 1);
          t.last_used_at = futureIso;
          t.time_group = 'today';
          t.use_count = (t.use_count || 0) + 1;
          t.manually_used = true;
          const p = arr.findIndex(c => !c.pinned);
          if (t.pinned || p === -1) arr.unshift(t);
          else arr.splice(p, 0, t);
        }
      });
      if (typeof sortAllClips === 'function') sortAllClips();
      const newIdx = clips.findIndex(c => c.id === clip.id);
      selectedIndex = newIdx >= 0 ? newIdx : 0;
      selectedIndices.clear();
      selectedIndices.add(selectedIndex);
      lastAnchorIndex = selectedIndex;
      if (typeof applyFilters === 'function') applyFilters();
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_clip === 'function') {
        window.pywebview.api.paste_clip(clip.id, stayOpenPaste);
      }
    }
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isModalOrSettingsOpen && (!isInputActive || (activeEl && activeEl.id === 'searchInput'))) {
    e.preventDefault();
    if (!clips || clips.length === 0) {
      selectedIndex = -1;
      selectedIndices.clear();
      lastAnchorIndex = -1;
      return;
    }
    const isHoldSession = (window._smartHoldActive || winCycleCount > 0) && (e.ctrlKey || e.metaKey);
    if (isHoldSession) {
      winCycleCount++;
      if (typeof cycleSelection === 'function') {
        cycleSelection(e.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }
    if (e.shiftKey) {
      // Shift + Arrow: Multi-selection range expansion
      if (e.key === 'ArrowDown') {
        selectedIndex = Math.min(selectedIndex + 1, clips.length - 1);
      } else {
        selectedIndex = Math.max(selectedIndex - 1, 0);
      }
      const start = Math.min(lastAnchorIndex, selectedIndex);
      const end = Math.max(lastAnchorIndex, selectedIndex);
      selectedIndices.clear();
      for (let i = start; i <= end; i++) selectedIndices.add(i);
    } else {
      // Normal Arrow Navigation
      if (e.key === 'ArrowDown') {
        selectedIndex = Math.min(selectedIndex + 1, clips.length - 1);
      } else {
        if (selectedIndex <= 0 && activeEl && activeEl.id !== 'searchInput') {
          const si = document.getElementById('searchInput');
          if (si) {
            si.focus();
            si.select();
            return;
          }
        }
        selectedIndex = Math.max(selectedIndex - 1, 0);
      }
      selectedIndices.clear();
      selectedIndices.add(selectedIndex);
      lastAnchorIndex = selectedIndex;
    }
    if (typeof scrollIndexIntoView === 'function') scrollIndexIntoView(selectedIndex);
    if (activeEl && activeEl.id === 'searchInput') {
      try { activeEl.blur(); } catch (_) {}
      const lc = document.getElementById('listContainer');
      if (lc) {
        if (!lc.hasAttribute('tabindex')) lc.setAttribute('tabindex', '-1');
        try { lc.focus({ preventScroll: true }); } catch (_) {}
      }
    }
  } else if ((e.key === 'Home' || e.key === 'End') && !isInputActive && !isModalOrSettingsOpen && clips && clips.length > 0) {
    e.preventDefault();
    selectedIndex = e.key === 'Home' ? 0 : clips.length - 1;
    if (e.shiftKey) {
      // Shift+Home/End: extend the range from the anchor
      const start = Math.min(lastAnchorIndex, selectedIndex);
      const end = Math.max(lastAnchorIndex, selectedIndex);
      selectedIndices.clear();
      for (let i = start; i <= end; i++) selectedIndices.add(i);
    } else {
      selectedIndices.clear();
      selectedIndices.add(selectedIndex);
      lastAnchorIndex = selectedIndex;
    }
    if (typeof scrollIndexIntoView === 'function') scrollIndexIntoView(selectedIndex);
  } else if ((e.key === 'PageDown' || e.key === 'PageUp') && !isInputActive && !isModalOrSettingsOpen && clips && clips.length > 0) {
    e.preventDefault();
    // Viewport-aware step: visible rows (min 1), not a hard-coded 8.
    let step = 8;
    try {
      const listCont = document.getElementById('listContainer');
      const rowH = 48;
      if (listCont && listCont.clientHeight > 0) step = Math.max(1, Math.floor(listCont.clientHeight / rowH));
    } catch (_) {}
    selectedIndex = e.key === 'PageDown' ? Math.min(selectedIndex + step, clips.length - 1) : Math.max(selectedIndex - step, 0);
    if (e.shiftKey) {
      // Shift+PgUp/PgDn: extend the range from the anchor
      const start = Math.min(lastAnchorIndex, selectedIndex);
      const end = Math.max(lastAnchorIndex, selectedIndex);
      selectedIndices.clear();
      for (let i = start; i <= end; i++) selectedIndices.add(i);
    } else {
      selectedIndices.clear();
      selectedIndices.add(selectedIndex);
      lastAnchorIndex = selectedIndex;
    }
    if (typeof scrollIndexIntoView === 'function') scrollIndexIntoView(selectedIndex);
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !isInputActive && !isModalOrSettingsOpen && clips && clips.length > 0) {
    // Ctrl + C / Ctrl + Shift + C: Copy highlighted clip (or multi-clip join)
    e.preventDefault();
    if (e.repeat) return;
    if (selectedIndices && selectedIndices.size > 1) {
      const sorted = Array.from(selectedIndices).sort((a,b)=>a-b);
      const hasImage = sorted.some(i => clips[i] && clips[i].is_image);
      if (hasImage) {
        if (typeof showToast === 'function') showToast('Bulk copy: images skipped, copying text only');
      }
      const pieces = sorted.map(i => clips[i]).filter(c => c && !c.is_image && (c.text_content || c.preview)).map(c => {
        const text = c.text_content || c.preview || '';
        return e.shiftKey ? text.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim() : text;
      });
      const joined = pieces.join('\n\n');
      if (joined) {
        if (typeof setClipboardTextSafely === 'function') setClipboardTextSafely(joined);
        if (typeof showToast === 'function') showToast(`Copied ${pieces.length} clips`);
      }
      return;
    }
    if (selectedIndex >= 0 && selectedIndex < clips.length) {
      const clip = clips[selectedIndex];
      if (clip) {
        if (e.shiftKey) {
          const plainCopyEnabled = true;
          if (!clip.is_image && (clip.text_content || clip.preview)) {
            const plain = (clip.text_content || clip.preview).replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim();
            if (typeof setClipboardTextSafely === 'function') setClipboardTextSafely(plain);
          }
        } else {
          if (clip.is_image) {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.copy_clip === 'function') {
              window.pywebview.api.copy_clip(clip.id)
                .then(res => {
                  if (!res || !res.ok) {
                    if (typeof handleCopyImageError === 'function') handleCopyImageError();
                    else if (typeof showToast === 'function') showToast('Failed to copy image');
                  }
                })
                .catch(() => {
                  if (typeof handleCopyImageError === 'function') handleCopyImageError();
                  else if (typeof showToast === 'function') showToast('Failed to copy image');
                });
            }
          } else {
            if (clip.text_content || clip.preview) {
              if (typeof setClipboardTextSafely === 'function') setClipboardTextSafely(clip.text_content || clip.preview);
            }
          }
        }

        const activeRow = document.querySelector('.clip-row.selected');
        if (activeRow) {
          activeRow.classList.remove('copy-flash');
          void activeRow.offsetWidth;
          activeRow.classList.add('copy-flash');
          setTimeout(() => activeRow.classList.remove('copy-flash'), 350);
        }
      }
    }
  } else if (!isInputActive && !isModalOrSettingsOpen && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && ((e.code && /^Digit[1-9]$/.test(e.code)) || /^[1-9]$/.test(e.key)) && clips && clips.length > 0 && ((selectedIndex >= 0 && selectedIndex < clips.length) || (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0))) {
    // Direct Move Shortcuts (Ctrl+1-9 only)
    let digit = null;
    if (e.code && /^Digit([1-9])$/.test(e.code)) {
      digit = parseInt(e.code.replace('Digit', ''), 10);
    } else if (/^[1-9]$/.test(e.key)) {
      digit = parseInt(e.key, 10);
    }

    if (digit !== null) {
      const keyCombo = `ctrl+${digit}`;

      let targetCol = null;
      let targetColId = null;

      try {
        const savedShortcuts = JSON.parse(localStorage.getItem('dualclip_direct_col_shortcuts') || '{}');
        targetColId = Object.keys(savedShortcuts).find(k => savedShortcuts[k] === String(digit) || (keyCombo && savedShortcuts[k] === keyCombo));
      } catch (_) {}

      if (targetColId) {
        if (targetColId === 'all') {
          targetCol = { id: 'all', name: 'All Clips' };
        } else if (targetColId === 'pins') {
          targetCol = { id: 'pins', name: 'Favorites' };
        } else if (Array.isArray(customCollections)) {
          targetCol = customCollections.find(c => c && c.id === targetColId) || { id: targetColId, name: targetColId };
        }
      }

      // Default slot mapping (audit K5: match visible pill display order):
      // Ctrl+1: strictly reserved for "All Items" (unorganized / 'all')
      // Ctrl+2..9: visible custom collections in display order (skipping Favorites and Most Used)
      if (!targetCol) {
        if (digit === 1) {
          targetCol = { id: 'all', name: 'All Clips' };
        } else {
          const list = (typeof getSortedVisibleCustomCollections === 'function')
            ? getSortedVisibleCustomCollections()
            : (Array.isArray(customCollections) ? customCollections : []);
          if ((digit - 2) < list.length) {
            targetCol = list[digit - 2];
          }
        }
      }

    if (targetCol) {
      e.preventDefault();
      e.stopPropagation();

      const isMulti = typeof selectedIndices !== 'undefined' && selectedIndices.size > 0;
      const targetIndices = isMulti ? Array.from(selectedIndices) : (selectedIndex >= 0 && selectedIndex < clips.length ? [selectedIndex] : [0]);

      if (targetCol.id === 'pins') {
        targetIndices.forEach(idx => {
          if (idx >= 0 && idx < clips.length) {
            const clip = clips[idx];
            if (clip && !clip.favorite) {
              clip.favorite = true;
              if (Array.isArray(allClips)) {
                const found = allClips.find(c => c && c.id === clip.id);
                if (found) found.favorite = true;
              }
              if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.toggle_favorite === 'function') {
                try { window.pywebview.api.toggle_favorite(clip.id); } catch (_) {}
              }
            }
          }
        });
        if (typeof showToast === 'function') {
          showToast(targetIndices.length === 1 ? 'Added clip to Favorites' : `Added ${targetIndices.length} clips to Favorites`);
        }
      } else {
        const destId = targetCol.id === 'all' ? 'all' : targetCol.id;
        const destName = targetCol.id === 'all' ? 'All Clips' : (targetCol.name || targetCol.id);
        targetIndices.forEach(idx => {
          if (idx >= 0 && idx < clips.length) {
            const clip = clips[idx];
            if (clip) {
              clip.collection = destId;
              if (Array.isArray(allClips)) {
                const found = allClips.find(c => c && c.id === clip.id);
                if (found) found.collection = destId;
              }
              if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.move_to_collection === 'function') {
                try {
                  const p = window.pywebview.api.move_to_collection(clip.id, destId);
                  if (p && typeof p.then === 'function') {
                    p.then(res => {
                      if (res && res.ok === false) {
                        if (typeof showToast === 'function') showToast('Move did not save — reloading');
                        if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch (_) {} }
                      }
                    }).catch(() => {});
                  }
                } catch (_) {}
              }
            }
          }
        });
        if (typeof showToast === 'function') {
          showToast(targetIndices.length === 1 ? `Moved clip to ${destName}` : `Moved ${targetIndices.length} clips to ${destName}`);
        }
      }

      if (typeof renderCollectionPills === 'function') renderCollectionPills();
      if (typeof applyFilters === 'function') applyFilters();
      return;
    }
  }
} else if (!isInputActive && !isModalOrSettingsOpen && !e.ctrlKey && !e.metaKey && !e.altKey && (((e.code || '') && /^(Digit|Numpad)[1-9]$/.test(e.code || '')) || (!e.shiftKey && /^[1-9]$/.test(e.key || '')))) {
    // Digits: bare 1-9 quick-paste the badged clip when Quick Number Paste is ON
    // (collections move to Shift+1..9, matched by e.code since layouts emit symbols);
    // when OFF, bare 1-9 switch collections as before.
    let digit = null;
    const dm = /^(Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (dm) digit = parseInt(dm[2], 10);
    else if (!e.shiftKey && /^[1-9]$/.test(e.key || '')) digit = parseInt(e.key, 10);
    if (digit === null) return;
    const quickOn = (typeof getQuickNumberPasteSetting === 'function') ? getQuickNumberPasteSetting() : (localStorage.getItem('dualclip_quick_number_paste') === '1');
    if (!quickOn && e.shiftKey) {
      // Legacy behavior preserved: Shift+symbol (e.g. !) focuses search-as-you-type
      const searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.focus();
      return;
    }
    e.preventDefault();
    if (e.repeat) return;
    if (quickOn && !e.shiftKey) {
      // Bare 1-9: paste the clip at this badge position in the current view
      try {
        let seen = 0, target = null;
        if (Array.isArray(currentFlatItems)) {
          for (const it of currentFlatItems) {
            if (it && it.type === 'clip') { seen++; if (seen === digit) { target = it; break; } }
          }
        }
        const clip = target && target.clip ? target.clip : null;
        if (!clip || clip.id == null) return;
        const futureIso = new Date(Date.now() + 60000).toISOString();
        clip.last_used_at = futureIso;
        clip.time_group = 'today';
        clip.use_count = (clip.use_count || 0) + 1;
        clip.manually_used = true;
        [allClips, clips].forEach(arr => {
          const i = arr.findIndex(c => c.id === clip.id);
          if (i > -1) {
            const [t] = arr.splice(i, 1);
            t.last_used_at = futureIso;
            t.time_group = 'today';
            t.use_count = (t.use_count || 0) + 1;
            t.manually_used = true;
            const p = arr.findIndex(c => !c.pinned);
            if (t.pinned || p === -1) arr.unshift(t);
            else arr.splice(p, 0, t);
          }
        });
        if (typeof sortAllClips === 'function') sortAllClips();
        const newIdx = clips.findIndex(c => c.id === clip.id);
        selectedIndex = newIdx >= 0 ? newIdx : 0;
        selectedIndices.clear();
        selectedIndices.add(selectedIndex);
        lastAnchorIndex = selectedIndex;
        if (typeof applyFilters === 'function') applyFilters();
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_clip === 'function') {
          window.pywebview.api.paste_clip(clip.id, false);
        }
      } catch (_) {}
      return;
    }
    if (typeof selectCollection !== 'function') return;
    let targetColId = null;
    try {
      const savedShortcuts = JSON.parse(localStorage.getItem('dualclip_direct_col_shortcuts') || '{}');
      const savedId = Object.keys(savedShortcuts).find(k => savedShortcuts[k] === String(digit));
      if (savedId && savedId !== 'pins' && savedId !== 'favorites' && savedId !== 'most_used') targetColId = savedId;
    } catch (_) {}
    if (!targetColId) {
      // View switching skips Favorites + Most Used (audit K5: match visible pill display order)
      if (digit === 1) {
        targetColId = 'all';
      } else {
        const list = (typeof getSortedVisibleCustomCollections === 'function')
          ? getSortedVisibleCustomCollections()
          : (Array.isArray(customCollections) ? customCollections : []);
        if ((digit - 2) < list.length) {
          const sc = list[digit - 2];
          if (sc && sc.id) targetColId = sc.id;
        }
      }
    }
    if (targetColId) selectCollection(targetColId);
  } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !isInputActive && !isModalOrSettingsOpen && clips && clips.length > 0 && ((selectedIndex >= 0 && selectedIndex < clips.length) || (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0))) {
    // Ctrl+D: Open "Move to Collection" dialog (only if any clip(s) selected; otherwise falls through to search-as-you-type)
    e.preventDefault();
    if (e.repeat) return;
    if (typeof openMoveCollectionModal === 'function') {
      let targetIdx = selectedIndex;
      if ((targetIdx < 0 || targetIdx >= clips.length) && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) {
        try { targetIdx = Array.from(selectedIndices).sort((a,b)=>a-b)[0]; } catch(e) {}
      }
      openMoveCollectionModal(targetIdx);
    }
  } else if (!isInputActive && !isModalOrSettingsOpen && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && e.key !== ' ') {
    // Type-to-search: directly focus search input, append the typed character, and trigger live search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      e.preventDefault();
      searchInput.focus();
      searchInput.value += e.key;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

});

// --- Smart Shortcuts: Hold-to-Navigate & Auto-Paste ---
let winCycleCount = 0;

window.onCycleNext = function() {
  if (typeof isWindowHidden === 'function' && isWindowHidden()) return;
  window._smartHoldActive = true;
  winCycleCount++;
  if (typeof cycleSelection === 'function') {
    cycleSelection(1);
  }
};

window.onWinReleased = function() {
  window._smartHoldActive = false;
  const didCycle = winCycleCount > 0;
  winCycleCount = 0;
  if (didCycle) {
    if (typeof pasteCurrentSelection === 'function') {
      pasteCurrentSelection();
      return;
    }
  }
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let autofocus = false;
    try { autofocus = localStorage.getItem('dualclip_autofocus_search') === '1'; } catch {}
    if (autofocus) {
      searchInput.focus();
      searchInput.select();
    }
  }
};

// Preview button: open the full preview window for the current selection
function openPreviewForSelection() {
  if (typeof closeContextMenu === 'function') closeContextMenu();
  let targetIdx = (typeof selectedIndex !== 'undefined' && selectedIndex >= 0 && selectedIndex < clips.length) ? selectedIndex : -1;
  if (targetIdx < 0 && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) {
    try {
      const first = Array.from(selectedIndices).sort((a,b)=>a-b)[0];
      if (first >= 0 && first < clips.length) targetIdx = first;
    } catch {}
  }
  if (targetIdx < 0 && Array.isArray(clips) && clips.length > 0) {
    targetIdx = 0;
    selectedIndex = 0;
    if (typeof selectedIndices !== 'undefined') {
      selectedIndices.clear();
      selectedIndices.add(0);
    }
    if (typeof renderList === 'function') renderList();
  }
  if (targetIdx >= 0 && targetIdx < clips.length) {
    if (typeof openFullPreviewModal === 'function') openFullPreviewModal(clips[targetIdx]);
  }
}
window.openPreviewForSelection = openPreviewForSelection;

// Close open transient dropdowns or menus when clicking elsewhere inside the window
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;

  const target = e.target;
  if (!target) return;

  // If context menu or dropdown is active, close menu/dropdown
  const ctxMenu = document.getElementById('contextMenu');
  if (ctxMenu && ctxMenu.style.display !== 'none' && ctxMenu.style.display !== '') {
    if (!target.closest('#contextMenu')) {
      if (typeof closeContextMenu === 'function') closeContextMenu();
    }
  }
  const pillMenu = document.getElementById('pillContextMenu');
  if (pillMenu && pillMenu.style.display !== 'none' && pillMenu.style.display !== '') {
    if (!target.closest('#pillContextMenu')) {
      if (typeof closePillMenu === 'function') closePillMenu();
    }
  }
  // S1: the sidebar background menu was a one-way door — dismiss it here
  // (keyboard.js owns this pointerdown dismisser; modals.js was left untouched).
  const sideMenu = document.getElementById('sidebarContextMenu');
  if (sideMenu && sideMenu.style.display !== 'none' && sideMenu.style.display !== '') {
    if (!target.closest('#sidebarContextMenu')) {
      if (typeof closeSidebarContextMenu === 'function') closeSidebarContextMenu();
    }
  }
  const filterDd = document.getElementById('filterDropdown');
  if (filterDd && filterDd.classList.contains('show')) {
    if (!target.closest('#filterDropdown') && !target.closest('#btnFilters')) {
      filterDd.classList.remove('show');
    }
  }
  const recentDd = document.getElementById('recentSearchesDropdown');
  if (recentDd && recentDd.style.display === 'block') {
    if (!target.closest('#recentSearchesDropdown') && !target.closest('#btnRecentSearches')) {
      if (typeof closeRecentSearchesDropdown === 'function') {
        closeRecentSearchesDropdown();
      } else {
        recentDd.style.display = 'none';
        const b = document.getElementById('btnRecentSearches');
        if (b) b.classList.remove('active');
      }
    }
  }
});

// Release fix: blank space inside the window must NEVER hide the app.
// Inside clicks dismiss open menus only (handled above); the main window stays
// visible. Only outside-window clicks (native hook), Esc, or Close may hide.
// Titlebar & Header Window Dragging (Main Window + Modal Headers)
function initWindowDragHandlers() {
  document.addEventListener('pointerdown', (e) => {
    const dragTarget = e.target.closest('.titlebar, .settings-header, #prevHeader');
    if (!dragTarget) return;
    if (e.target.closest('button, input, select, a, [role="button"], .pause-for-dropdown, .pause-opt-item, .paused-pill, .pause-duration-container, [data-no-drag]')) return;
    if (e.button !== 0) return;

    if (dragTarget.classList.contains('titlebar')) {
      const now = Date.now();
      if (typeof window.__lastTitlebarClick === 'number' && now - window.__lastTitlebarClick < 350) {
        window.__lastTitlebarClick = 0;
        e.preventDefault();
        e.stopPropagation();
        if (typeof resetWindowSizeCurrentMode === 'function') {
          resetWindowSizeCurrentMode();
        }
        return;
      }
      window.__lastTitlebarClick = now;
    }

    e.preventDefault();
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.start_drag === 'function') {
      window.pywebview.api.start_drag();
    }
  });

  document.addEventListener('dblclick', (e) => {
    const dragTarget = e.target.closest('.titlebar');
    if (!dragTarget) return;
    if (e.target.closest('button, input, select, a, [role="button"], .pause-for-dropdown, .pause-opt-item, .paused-pill, .pause-duration-container, [data-no-drag]')) return;
    e.preventDefault();
    e.stopPropagation();
  });
}
initWindowDragHandlers();

// Disable browser zoom via wheel (Ctrl + Wheel) — zoom preview font if text preview is open
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    const prevModal = document.getElementById('previewModal');
    const textBody = document.getElementById('prevContent');
    if (prevModal && prevModal.style.display === 'flex' && textBody && textBody.style.display !== 'none') {
      const delta = e.deltaY < 0 ? 1 : -1;
      if (typeof window.changePreviewTextFontSize === 'function') {
        window.changePreviewTextFontSize(delta);
      }
    }
  }
}, { passive: false });

// Browser zoom suppression & preview text font size hotkeys (Ctrl + / - / 0 / [ / ]) & font toggle (Ctrl+Shift+F / Alt+F)
window.addEventListener('keydown', (e) => {
  const prevModal = document.getElementById('previewModal');
  const isPreviewOpen = prevModal && prevModal.style.display === 'flex';

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    if (isPreviewOpen && typeof window.cyclePreviewFont === 'function') {
      e.preventDefault();
      window.cyclePreviewFont();
      return;
    }
  }

  if (e.altKey && (e.key === 'F' || e.key === 'f')) {
    if (isPreviewOpen && typeof window.cyclePreviewFont === 'function') {
      e.preventDefault();
      window.cyclePreviewFont();
      return;
    }
  }

  if (e.ctrlKey || e.metaKey) {
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0' || e.key === ']' || e.key === '[') {
      e.preventDefault();
      const textBody = document.getElementById('prevContent');
      if (isPreviewOpen && textBody && textBody.style.display !== 'none') {
        if (typeof window.changePreviewTextFontSize === 'function') {
          if (e.key === '+' || e.key === '=' || e.key === ']') window.changePreviewTextFontSize(1);
          else if (e.key === '-' || e.key === '_' || e.key === '[') window.changePreviewTextFontSize(-1);
          else if (e.key === '0') window.changePreviewTextFontSize(0);
        }
      }
    }
  }
}, true);

// Prevent default browser right-click context menu everywhere except standard inputs and editables (audit K10)
window.addEventListener('contextmenu', (e) => {
  const target = e.target;
  if (!target) {
    e.preventDefault();
    return;
  }
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
  if (!isInput) {
    e.preventDefault();
  }
}, false);

// Window blur lifecycle: reset dragging and transient menus
window.addEventListener('blur', () => {
  resetDragState();
  if (typeof closeContextMenu === 'function') closeContextMenu();
  if (typeof closePillMenu === 'function') closePillMenu();
});

// App lifecycle event listeners — wrapped to prevent one startup failure from blocking render
window.addEventListener('DOMContentLoaded', () => {
  try { if (typeof syncSettingsUiFromStorage === 'function') syncSettingsUiFromStorage(); } catch(e) { try { console.error('DOMContentLoaded syncSettings failed', e); } catch(_){} }
});

window.addEventListener('pywebviewready', () => {
  try { if (typeof syncSettingsUiFromStorage === 'function') syncSettingsUiFromStorage(); } catch(e) { try { console.error('pywebviewready syncSettings failed', e); } catch(_){} }
  try { if (typeof syncPauseStateFromBackend === 'function') syncPauseStateFromBackend(); } catch(e) { try { console.error('syncPause failed', e); } catch(_){} }
  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_pinned === 'function') {
      window.pywebview.api.get_pinned().then(res => {
        if (res && typeof res.pinned === 'boolean') {
          window.isWindowPinned = res.pinned;
          const pinBtn = document.getElementById('pinWindowBtn');
          if (pinBtn) pinBtn.classList.toggle('active', res.pinned);
          const pinBtnSearch = document.getElementById('pinWindowBtnSearch');
          if (pinBtnSearch) pinBtnSearch.classList.toggle('active', res.pinned);
        }
      }).catch(() => {});
    }
  } catch(e) {}
  // Cold-boot dedup: bridge.js fires pywebviewready ~50ms after scripts evaluate,
  // but the immediate boot fetch below already issued an identical get_clips when the
  // bridge was ready. Skip only if a *real* fetch is done or in-flight — mock/fallback
  // fetches at immediate-boot time (pywebview not yet ready) must still be upgraded.
  try { if (typeof __dcMark === 'function') __dcMark('pywebviewready'); } catch (e) {}
  try {
    if (window.__dcBootRealDone || window.__dcBootRealInFlight) {
      try { if (typeof __dcMark === 'function') __dcMark(window.__dcBootRealDone ? 'boot.fetch.duplicate.skipped.done' : 'boot.fetch.duplicate.skipped.inflight'); } catch (e) {}
    } else if (typeof loadClipsFromBackend === 'function') loadClipsFromBackend();
  } catch(e) { try { console.error('loadClips failed', e); } catch(_){} }
  setTimeout(() => {
    try {
      window.focus();
      document.body.focus();
      let autofocus = false;
      try { autofocus = localStorage.getItem('dualclip_autofocus_search') === '1'; } catch {}
      const si = document.getElementById('searchInput');
      if (autofocus && si && document.hasFocus && !document.hasFocus()) {
        si.focus();
      } else if (si) {
        si.blur();
      }
    } catch {}
  }, 80);
});

// Focus fix: when window is shown via hotkey, ensure document has focus so arrow/Delete/typing work without click
function forceWindowFocus() {
  [10, 50, 120, 250].forEach(d => setTimeout(() => {
    try { window.focus(); } catch {}
    try { document.body.focus(); } catch {}
    // Auto-focus search only when the user opted in (default OFF).
    let autofocus = false;
    try { autofocus = localStorage.getItem('dualclip_autofocus_search') === '1'; } catch {}
    const si = document.getElementById('searchInput');
    if (si) {
      if (autofocus) {
        try {
          si.focus();
          si.select();
        } catch {}
      } else {
        try {
          si.blur();
          if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
          }
          document.body.focus();
        } catch {}
      }
    } else {
      if (document.activeElement && document.activeElement !== document.body) {
        try { document.activeElement.blur(); } catch {}
      }
    }
  }, d));
}

// Auto-blur main window buttons after click/pointerup so focus never gets trapped on toolbar icons
document.addEventListener('pointerup', (e) => {
  const btn = e.target && e.target.closest && e.target.closest('button, [role="button"], .collection-pill, .filter-chip');
  if (btn && !btn.closest('.modal-overlay') && !btn.closest('#settingsView')) {
    try { btn.blur(); } catch {}
  }
});
try {
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', (e) => {
      try {
        const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (msg && (msg.event === 'onWindowShow' || msg.event === 'onCycleNext')) {
          window._smartHoldActive = true;
          forceWindowFocus();
        }
      } catch {}
    });
  } else {
    // Non-WebView2 fallback channel (audit K8)
    window.addEventListener('message', (e) => {
      try {
        const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (msg && (msg.event === 'onWindowShow' || msg.event === 'onCycleNext')) {
          window._smartHoldActive = true;
          forceWindowFocus();
        }
      } catch {}
    });
  }
} catch {}

// Initial render and restore states
try { if (typeof __dcMark === 'function') __dcMark('scripts.evaluated'); } catch (e) {}
if (typeof applyCollectionsBarState === 'function') applyCollectionsBarState();
if (typeof renderCollectionPills === 'function') renderCollectionPills();
if (typeof syncHotkeyDisplay === 'function') syncHotkeyDisplay();
window.__dcInitDone = true;
try { if (typeof __dcMark === 'function') __dcMark('boot.fetch.kick'); } catch (e) {}
if (typeof loadClipsFromBackend === 'function') loadClipsFromBackend();

// Global & Namespace Exposure
window.hideWindow = hideWindow;
window.resetDragState = resetDragState;

window.DC = window.DC || {};
window.DC.keyboard = {
  hideWindow,
  resetDragState
};
