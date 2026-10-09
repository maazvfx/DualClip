// --- DualClip Dialog Modals (App Picker, Move, Nickname, Edit) ---

// --- App Picker Modal ---
let appPickerCachedApps = [];
let appPickerFilteredApps = [];
let appPickerTargetInputId = null;
let appPickerCallback = null;
let appPickerSelectedIndex = -1;

async function openAppPicker(targetInputId, onPick) {
  appPickerTargetInputId = targetInputId;
  appPickerCallback = onPick || null;
  appPickerSelectedIndex = -1;

  const modal = document.getElementById('appPickerModal');
  const searchInput = document.getElementById('appPickerSearch');
  const listEl = document.getElementById('appPickerList');
  const countEl = document.getElementById('appPickerCount');

  if (searchInput) searchInput.value = '';
  if (listEl) {
    listEl.innerHTML = `
      <div class="app-picker-empty" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span>Scanning open desktop applications...</span>
      </div>
    `;
  }
  if (countEl) countEl.textContent = 'Scanning...';

  if (modal) modal.style.display = 'flex';
  if (searchInput) setTimeout(() => searchInput.focus(), 60);

  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_running_apps === 'function') {
      const res = await window.pywebview.api.get_running_apps();
      if (res && res.ok && Array.isArray(res.apps)) {
        appPickerCachedApps = res.apps;
      } else {
        appPickerCachedApps = [];
      }
    } else {
      appPickerCachedApps = [
        { process: 'code.exe', name: 'Visual Studio Code', title: 'DualClip - Visual Studio Code' },
        { process: 'chrome.exe', name: 'Google Chrome', title: 'GitHub - Google Chrome' },
        { process: 'msedge.exe', name: 'Microsoft Edge', title: 'New Tab - Microsoft Edge' },
        { process: 'slack.exe', name: 'Slack', title: 'Slack | General' },
        { process: 'notepad.exe', name: 'Notepad', title: 'Untitled - Notepad' }
      ];
    }
  } catch (err) {
    console.error('get_running_apps error:', err);
    appPickerCachedApps = [];
  }

  appPickerFilteredApps = [...appPickerCachedApps];
  renderAppPickerList();
}

function onAppPickerSearch(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) {
    appPickerFilteredApps = [...appPickerCachedApps];
  } else {
    appPickerFilteredApps = appPickerCachedApps.filter(app => {
      const name = (app.name || '').toLowerCase();
      const proc = (app.process || '').toLowerCase();
      const title = (app.title || '').toLowerCase();
      return name.includes(q) || proc.includes(q) || title.includes(q);
    });
  }
  appPickerSelectedIndex = appPickerFilteredApps.length > 0 ? 0 : -1;
  renderAppPickerList();
}


function renderAppPickerList() {
  const listEl = document.getElementById('appPickerList');
  const countEl = document.getElementById('appPickerCount');
  if (!listEl) return;

  if (appPickerFilteredApps.length === 0) {
    listEl.innerHTML = `
      <div class="app-picker-empty">
        No matching running applications found.<br>
        <span style="font-size: 11px; opacity: 0.7;">You can still type the process name manually in the input field.</span>
      </div>
    `;
    if (countEl) countEl.textContent = '0 apps found';
    return;
  }

  if (countEl) {
    countEl.textContent = `${appPickerFilteredApps.length} open app${appPickerFilteredApps.length === 1 ? '' : 's'}`;
  }

  listEl.innerHTML = '';
  appPickerFilteredApps.forEach((app, idx) => {
    const item = document.createElement('div');
    item.className = 'app-picker-item' + (idx === appPickerSelectedIndex ? ' active' : '');
    item.id = `app_picker_item_${idx}`;
    const iconSrc = app.icon || app.IconDataUrl || app.Icon || null;
    const displayName = escapeHtml(app.name || app.Name || app.process || app.Process || '');
    const titleText = (app.title && app.title !== app.name) ? app.title : (app.process || app.Process || '');
    const initial = ((app.name || app.Name || app.process || 'A')[0] || 'A').toUpperCase();
    item.innerHTML = `
      <div class="app-picker-item-left" style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
        ${iconSrc ? `<img src="${typeof sanitizeImageSrc === 'function' ? sanitizeImageSrc(iconSrc) : escapeHtml(iconSrc)}" class="app-icon-img" style="width: 22px; height: 22px; border-radius: 4px; object-fit: contain; flex-shrink: 0;" />` : `<div class="app-icon-badge" style="width: 22px; height: 22px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 10px; flex-shrink: 0; color: #ffffff; background: var(--accent);">${initial}</div>`}
        <div style="min-width: 0; display: flex; flex-direction: column;">
          <div class="app-picker-name" style="font-size: 12.5px; font-weight: 600; color: var(--text); line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</div>
          <div class="app-picker-title" style="font-size: 11px; color: var(--text-muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(titleText)}</div>
        </div>
      </div>
    `;
    item.onclick = () => {
      appPickerSelectedIndex = idx;
      updateAppPickerSelection();
    };
    item.ondblclick = () => pickApp(app.process || app.Process);
    listEl.appendChild(item);
  });
}

function confirmAppPickerSelection() {
  if (appPickerSelectedIndex >= 0 && appPickerSelectedIndex < appPickerFilteredApps.length) {
    const app = appPickerFilteredApps[appPickerSelectedIndex];
    pickApp(app.process || app.Process);
  } else if (appPickerFilteredApps.length > 0) {
    pickApp(appPickerFilteredApps[0].process || appPickerFilteredApps[0].Process);
  } else {
    closeAppPicker();
  }
}

function pickApp(processName) {
  if (!processName) return;
  if (typeof appPickerCallback === 'function') {
    appPickerCallback(processName);
  } else if (appPickerTargetInputId) {
    const targetInput = document.getElementById(appPickerTargetInputId);
    if (targetInput) {
      targetInput.value = processName;
      targetInput.focus();
    }
  }
  closeAppPicker();
}

async function browseApplicationFromExplorer(targetInputId, onPick) {
  const targetId = targetInputId || appPickerTargetInputId;
  const cb = onPick || appPickerCallback;
  if (!window.pywebview || !window.pywebview.api || typeof window.pywebview.api.browse_application !== 'function') {
    if (typeof showToast === 'function') showToast('Browsing is only available in the DualClip desktop app.');
    return;
  }
  try {
    const res = await window.pywebview.api.browse_application();
    if (res && res.ok && res.process) {
      if (typeof cb === 'function') {
        cb(res.process);
      } else if (targetId) {
        const targetInput = document.getElementById(targetId);
        if (targetInput) {
          targetInput.value = res.process;
          targetInput.focus();
        }
      }
      closeAppPicker();
    }
  } catch (err) {
    console.error('browse_application error:', err);
  }
}

function closeAppPicker(e) {
  if (e && e.target && e.target.id !== 'appPickerModal' && !e.target.classList.contains('close')) return;
  const modal = document.getElementById('appPickerModal');
  if (modal) modal.style.display = 'none';
  appPickerCallback = null;
  appPickerTargetInputId = null;
}

function handleAppPickerKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    if (appPickerFilteredApps.length > 0) {
      appPickerSelectedIndex = (appPickerSelectedIndex + 1) % appPickerFilteredApps.length;
      updateAppPickerSelection();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    if (appPickerFilteredApps.length > 0) {
      appPickerSelectedIndex = (appPickerSelectedIndex - 1 + appPickerFilteredApps.length) % appPickerFilteredApps.length;
      updateAppPickerSelection();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    if (appPickerSelectedIndex >= 0 && appPickerSelectedIndex < appPickerFilteredApps.length) {
      pickApp(appPickerFilteredApps[appPickerSelectedIndex].process);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeAppPicker();
  }
}

function updateAppPickerSelection() {
  document.querySelectorAll('.app-picker-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === appPickerSelectedIndex);
  });
  const activeEl = document.getElementById(`app_picker_item_${appPickerSelectedIndex}`);
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

// Global click listeners for overlay dismissals
document.addEventListener('click', (e) => {
  if (!e.target.closest('#contextMenu')) {
    if (typeof closeContextMenu === 'function') closeContextMenu();
  }
  if (window.__pillMenuOpenedAt && (Date.now() - window.__pillMenuOpenedAt < 150)) {
    return;
  }
  if (!e.target.closest('#pillContextMenu') && !e.target.closest('.col-pill') && !e.target.closest('.pill-options-btn')) {
    if (typeof closePillMenu === 'function') closePillMenu();
  }
  if (!e.target.closest('#filterDropdown') && !e.target.closest('#btnFilters')) {
    const fd = document.getElementById('filterDropdown');
    if (fd) fd.classList.remove('show');
  }
});

function dismissFloatingMenusOnScroll(e) {
  if (e && e.target && e.target.closest) {
    if (e.target.closest('#previewModal') || e.target.closest('.modal-card') || e.target.closest('#settingsView') || e.target.closest('#filterDropdown') || e.target.closest('.custom-dropdown-menu') || e.target.closest('.custom-select-wrap')) {
      return;
    }
  }
  if (e && e.target && e.target.closest && e.target.closest('#contextMenu, #pillContextMenu, .submenu')) {
    return;
  }
  // Grace period to ignore hardware wheel tick right when menu opens
  if ((window.__pillMenuOpenedAt && (Date.now() - window.__pillMenuOpenedAt < 300)) ||
      (window._lastMenuOpenedAt && (Date.now() - window._lastMenuOpenedAt < 300))) {
    return;
  }
  if (typeof closeContextMenu === 'function') closeContextMenu();
  if (typeof closePillMenu === 'function') closePillMenu();

  const fd = document.getElementById('filterDropdown');
  if (fd && fd.classList.contains('show')) fd.classList.remove('show');
}

window.addEventListener('scroll', dismissFloatingMenusOnScroll, { passive: true, capture: true });
window.addEventListener('wheel', (e) => {
  if (e && e.target && e.target.closest && (e.target.closest('#contextMenu, #pillContextMenu, .submenu, #filterDropdown, .custom-dropdown-menu, .custom-select-wrap'))) {
    return;
  }
  if (Math.abs(e.deltaY) < 4 && Math.abs(e.deltaX) < 4) {
    return;
  }
  // Grace period to ignore hardware wheel tick right when menu opens
  if ((window.__pillMenuOpenedAt && (Date.now() - window.__pillMenuOpenedAt < 300)) ||
      (window._lastMenuOpenedAt && (Date.now() - window._lastMenuOpenedAt < 300))) {
    return;
  }
  const ctx = document.getElementById('contextMenu');
  const pillCtx = document.getElementById('pillContextMenu');
  if ((ctx && ctx.style.display === 'block') || (pillCtx && pillCtx.style.display === 'block')) {
    dismissFloatingMenusOnScroll(e);
  }
}, { passive: true, capture: true });

// --- Move to Collection Modal Handlers ---
let moveModalTargetClipIndex = -1;
let moveModalHighlightedIndex = 0;
let moveModalCollectionsList = [];

function openMoveCollectionModal(clipIdx = -1) {
  if (typeof closeContextMenu === 'function') closeContextMenu();
  if (typeof hideHoverPopover === 'function') hideHoverPopover();

  moveModalTargetClipIndex = clipIdx >= 0 ? clipIdx : selectedIndex;
  if (moveModalTargetClipIndex < 0 || moveModalTargetClipIndex >= clips.length) return;

  const modal = document.getElementById('moveCollectionModal');
  const listEl = document.getElementById('moveCollectionList');
  if (!modal || !listEl) return;

  moveModalCollectionsList = [
    { id: 'all', name: 'All Clips', badge: '1' }
  ];

  if (Array.isArray(customCollections)) {
    customCollections.forEach((c, idx) => {
      moveModalCollectionsList.push({
        id: c.id,
        name: c.name || c.id,
        badge: String(idx + 2)
      });
    });
  }

  const clip = clips[moveModalTargetClipIndex];
  const currentTargetCol = clip ? (clip.favorite && !clip.collection ? 'pins' : (clip.collection || 'all')) : 'all';
  const foundIdx = moveModalCollectionsList.findIndex(c => c.id === currentTargetCol);
  moveModalHighlightedIndex = foundIdx >= 0 ? foundIdx : 0;

  renderMoveCollectionModalList();
  modal.style.display = 'flex';
}

function renderMoveCollectionModalList() {
  const listEl = document.getElementById('moveCollectionList');
  if (!listEl) return;
  listEl.innerHTML = '';

  const clip = (moveModalTargetClipIndex >= 0 && moveModalTargetClipIndex < clips.length) ? clips[moveModalTargetClipIndex] : null;
  const currentTargetCol = clip ? (clip.favorite && !clip.collection ? 'pins' : (clip.collection || 'all')) : '';

  moveModalCollectionsList.forEach((col, idx) => {
    const isSel = idx === moveModalHighlightedIndex;
    const isCurrent = col.id === currentTargetCol;
    const item = document.createElement('div');
    item.className = 'move-collection-item' + (isSel ? ' selected' : '') + (isCurrent ? ' is-current' : '');

    let iconSvg = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>';
    if (col.id === 'all') {
      iconSvg = '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>';
    } else if (col.id === 'pins') {
      iconSvg = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>';
    }

    item.innerHTML = `
      <div class="move-collection-item-left">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${iconSvg}
        </svg>
        <span>${escapeHtml(col.name)}</span>${isCurrent ? '<svg class="move-current-tick" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
      </div>
      <span class="move-collection-badge">${escapeHtml(col.badge)}</span>
    `;

    item.onclick = () => {
      moveModalHighlightedIndex = idx;
      submitMoveCollectionModal();
    };

    item.onmouseenter = () => {
      if (moveModalHighlightedIndex === idx) return;
      moveModalHighlightedIndex = idx;
      listEl.querySelectorAll('.move-collection-item').forEach((el, i) => {
        el.classList.toggle('selected', i === idx);
      });
    };

    listEl.appendChild(item);
  });

  const selectedEl = listEl.querySelector('.move-collection-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

function closeMoveCollectionModal(e) {
  if (e && e.target && e.target.closest && e.target.closest('.modal-card') && !e.target.classList.contains('close')) {
    return;
  }
  const modal = document.getElementById('moveCollectionModal');
  if (modal) modal.style.display = 'none';
  moveModalTargetClipIndex = -1;
}

function submitMoveCollectionModal() {
  if (moveModalHighlightedIndex < 0 || moveModalHighlightedIndex >= moveModalCollectionsList.length) {
    closeMoveCollectionModal();
    return;
  }
  const targetCol = moveModalCollectionsList[moveModalHighlightedIndex];
  if (!targetCol) {
    closeMoveCollectionModal();
    return;
  }

  const isMulti = typeof selectedIndices !== 'undefined' && selectedIndices.size > 1 && selectedIndices.has(moveModalTargetClipIndex);
  const targetIndices = isMulti ? Array.from(selectedIndices) : (moveModalTargetClipIndex >= 0 ? [moveModalTargetClipIndex] : []);

  if (targetCol.id === 'pins') {
    targetIndices.forEach(idx => {
      if (idx >= 0 && idx < clips.length) {
        const clip = clips[idx];
        if (clip) {
          if (!clip.favorite) {
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
      }
    });
    if (typeof showToast === 'function') showToast(targetIndices.length === 1 ? 'Added clip to Favorites' : `Added ${targetIndices.length} clips to Favorites`);
  } else {
    targetIndices.forEach(idx => {
      if (idx >= 0 && idx < clips.length) {
        const clip = clips[idx];
        if (clip) {
          clip.collection = targetCol.id;
          if (Array.isArray(allClips)) {
            const found = allClips.find(c => c && c.id === clip.id);
            if (found) found.collection = targetCol.id;
          }
          if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.move_to_collection === 'function') {
            try {
              const p = window.pywebview.api.move_to_collection(clip.id, targetCol.id);
              if (p && typeof p.then === 'function') {
                p.then(res => {
                  if (res && res.ok === false) {
                    if (typeof showToast === 'function') showToast("Couldn't save the move — refreshing");
                    if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch (_) {} }
                  }
                }).catch(() => {});
              }
            } catch (_) {}
          }
        }
      }
    });
  }

  if (typeof renderCollectionPills === 'function') renderCollectionPills();
  if (typeof applyFilters === 'function') applyFilters();
  closeMoveCollectionModal();
}

function openNewCollectionFromMoveModal() {
  closeMoveCollectionModal();
  if (typeof openNewCollectionModal === 'function') {
    openNewCollectionModal();
  }
}

// --- Rename Modal Logic ---
let currentRenameClip = null;

function openRenameModal(clip) {
  currentRenameClip = clip || null;
  if (!currentRenameClip && typeof selectedIndex !== 'undefined' && selectedIndex >= 0 && selectedIndex < clips.length) {
    currentRenameClip = clips[selectedIndex];
  }
  if (!currentRenameClip) return;

  const modal = document.getElementById('renameModal');
  const input = document.getElementById('renameTitleInput');
  const clearBtn = document.getElementById('renameClearBtn');
  if (!modal || !input) return;

  const existingTitle = (currentRenameClip.custom_title || '').trim();
  input.value = existingTitle;

  if (clearBtn) {
    clearBtn.style.display = existingTitle ? 'inline-block' : 'none';
  }

  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      executeSaveRename();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      closeRenameModal();
    }
  };

  modal.style.display = 'flex';
  setTimeout(() => {
    input.focus();
    input.select();
  }, 30);
}

function closeRenameModal(e) {
  if (e && e.target && e.target !== e.currentTarget && !e.target.classList.contains('tb-btn') && !e.target.closest('.tb-btn')) {
    return;
  }
  const modal = document.getElementById('renameModal');
  if (modal) modal.style.display = 'none';
  currentRenameClip = null;
  if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
  else if (typeof renderList === 'function') renderList();
}

async function executeSaveRename() {
  if (!currentRenameClip) return;
  const input = document.getElementById('renameTitleInput');
  const newTitle = input ? (input.value || '').trim() : '';
  const clipId = currentRenameClip.id;
  const oldTitle = currentRenameClip.custom_title || '';

  if (newTitle === oldTitle) {
    closeRenameModal();
    return;
  }

  // Update in-memory models immediately
  const c = Array.isArray(clips) ? clips.find(item => item && item.id === clipId) : null;
  if (c) c.custom_title = newTitle;
  const ac = Array.isArray(allClips) ? allClips.find(item => item && item.id === clipId) : null;
  if (ac) ac.custom_title = newTitle;

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_custom_title === 'function') {
    try {
      await window.pywebview.api.set_custom_title(clipId, newTitle);
    } catch(err) {}
  }

  if (typeof showToast === 'function') {
    showToast(newTitle ? 'Clip renamed' : 'Title cleared');
  }

  closeRenameModal();
}

async function executeClearRename() {
  if (!currentRenameClip) return;
  const clipId = currentRenameClip.id;

  const c = Array.isArray(clips) ? clips.find(item => item && item.id === clipId) : null;
  if (c) c.custom_title = '';
  const ac = Array.isArray(allClips) ? allClips.find(item => item && item.id === clipId) : null;
  if (ac) ac.custom_title = '';

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_custom_title === 'function') {
    try {
      await window.pywebview.api.set_custom_title(clipId, '');
    } catch(err) {}
  }

  if (typeof showToast === 'function') {
    showToast('Title cleared');
  }

  closeRenameModal();
}

// --- Nickname Modal Logic ---
let currentNicknameClip = null;
let currentNicknameTargetIds = [];

function getRecentTagsList() {
  const tagSet = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem('dualclip_recent_tags') || '[]');
    if (Array.isArray(stored)) {
      stored.forEach(t => {
        if (typeof t === 'string' && t.trim()) tagSet.add(t.trim());
      });
    }
  } catch (e) {}

  const pool = (typeof allClips !== 'undefined' && Array.isArray(allClips) && allClips.length > 0)
    ? allClips
    : ((typeof clips !== 'undefined' && Array.isArray(clips)) ? clips : []);

  pool.forEach(c => {
    if (c && c.nickname && typeof c.nickname === 'string' && c.nickname.trim()) {
      c.nickname.split(/[,，]/).forEach(t => {
        const clean = t.trim();
        if (clean) tagSet.add(clean);
      });
    }
  });

  return Array.from(tagSet).slice(0, 10);
}

let currentModalTags = [];
let pendingDeleteIndex = -1;

function focusTagInput() {
  const inp = document.getElementById('nicknameInput');
  if (inp) inp.focus();
}

function addModalTag(rawTag) {
  if (!rawTag || typeof rawTag !== 'string') return false;
  const clean = rawTag.trim().replace(/^#+/, '').replace(/[,，]/g, '').slice(0, 40);
  if (!clean) return false;
  if (currentModalTags.length >= 10) {
    if (typeof showToast === 'function') showToast('Maximum 10 tags per clip');
    return false;
  }
  const cleanLower = clean.toLowerCase();
  if (currentModalTags.some(t => t.toLowerCase() === cleanLower)) {
    return false;
  }
  currentModalTags.push(clean);
  pendingDeleteIndex = -1;
  renderModalTagChips();
  return true;
}

function removeModalTag(index) {
  if (index >= 0 && index < currentModalTags.length) {
    currentModalTags.splice(index, 1);
    pendingDeleteIndex = -1;
    renderModalTagChips();
    focusTagInput();
  }
}

function renderModalTagChips() {
  const list = document.getElementById('tagModalChipsList');
  const input = document.getElementById('nicknameInput');
  const countHint = document.getElementById('tagCountHint');
  if (!list) return;

  list.innerHTML = '';
  currentModalTags.forEach((tag, idx) => {
    const chip = document.createElement('span');
    chip.className = 'tag-modal-chip' + (idx === pendingDeleteIndex ? ' pending-delete' : '');
    chip.setAttribute('data-tag', tag);

    const textSpan = document.createElement('span');
    textSpan.className = 'tag-modal-chip-text';
    textSpan.textContent = tag;
    chip.appendChild(textSpan);

    const removeBtn = document.createElement('span');
    removeBtn.className = 'tag-modal-chip-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = `Remove ${tag}`;
    removeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeModalTag(idx);
    };
    chip.appendChild(removeBtn);

    list.appendChild(chip);
  });

  if (input) {
    if (currentModalTags.length === 0) {
      input.placeholder = 'Add tags (e.g. work, design)...';
    } else if (currentModalTags.length < 10) {
      input.placeholder = '';
    } else {
      input.placeholder = 'Max 10 tags reached';
    }
  }

  if (countHint) {
    countHint.textContent = `${currentModalTags.length}/10 tags`;
  }

  const clearBtn = document.getElementById('nicknameClearBtn');
  if (clearBtn) {
    clearBtn.disabled = currentModalTags.length === 0;
  }

  updateRecentTagsChipActiveStates();
}

function updateRecentTagsChipActiveStates() {
  const list = document.getElementById('nicknameRecentTagsList');
  if (!list) return;
  const activeLower = new Set(currentModalTags.map(t => t.toLowerCase()));
  list.querySelectorAll('.recent-tag-chip').forEach(chip => {
    const tag = (chip.getAttribute('data-tag') || '').toLowerCase();
    chip.classList.toggle('active', activeLower.has(tag));
  });
}

function toggleRecentTag(tag) {
  if (!tag) return;
  const tagLower = tag.toLowerCase();
  const existingIndex = currentModalTags.findIndex(t => t.toLowerCase() === tagLower);
  if (existingIndex >= 0) {
    removeModalTag(existingIndex);
  } else {
    addModalTag(tag);
    focusTagInput();
  }
}

function renderRecentTagsChips() {
  const container = document.getElementById('nicknameRecentTagsContainer');
  const list = document.getElementById('nicknameRecentTagsList');
  if (!container || !list) return;

  const recentTags = getRecentTagsList();
  if (recentTags.length === 0) {
    container.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  list.innerHTML = '';
  recentTags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-tag-chip';
    btn.setAttribute('data-tag', tag);
    btn.textContent = tag;
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleRecentTag(tag);
    };
    list.appendChild(btn);
  });
  container.style.display = 'flex';
  updateRecentTagsChipActiveStates();
}

let currentTagBatchMode = 'add'; // 'add' | 'remove'

function setTagBatchMode(mode) {
  currentTagBatchMode = mode;
  const addTab = document.getElementById('tagBatchAddTab');
  const remTab = document.getElementById('tagBatchRemoveTab');
  const labelEl = document.getElementById('tagModalDescLabel');
  const saveBtn = document.getElementById('nicknameSaveBtn');

  if (addTab) addTab.classList.toggle('active', mode === 'add');
  if (remTab) remTab.classList.toggle('active', mode === 'remove');

  if (labelEl) {
    if (mode === 'add') {
      labelEl.textContent = `Add tags to ${currentNicknameTargetIds.length} selected clips (existing tags are preserved).`;
    } else {
      labelEl.textContent = `Select or type tags to remove from ${currentNicknameTargetIds.length} selected clips.`;
    }
  }

  if (saveBtn) {
    saveBtn.textContent = mode === 'add' ? 'Add Tags' : 'Remove Tags';
  }
}

// --- Tag Modal Live Autocomplete Logic ---
let _tagACSeq = 0;
let _tagACItems = []; // [{name: string, count: number|null}]
let _tagACHighlight = -1;
let _tagACTimer = null;

function fetchTagSuggestions(fragment) {
  clearTimeout(_tagACTimer);
  const frag = (fragment || '').trim().toLowerCase().replace(/^#+/, '');
  if (!frag) {
    hideTagAutocomplete();
    return;
  }
  _tagACTimer = setTimeout(async () => {
    const seq = ++_tagACSeq;
    let backend = [];
    try {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_all_tags_with_stats === 'function') {
        const res = await window.pywebview.api.get_all_tags_with_stats();
        backend = Array.isArray(res) ? res : (res && (res.tags || res.stats)) || [];
      } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_suggested_tags === 'function') {
        const res = await window.pywebview.api.get_suggested_tags(15);
        backend = Array.isArray(res) ? res : (res && (res.tags || res.stats)) || [];
      }
    } catch (_) {}
    if (seq !== _tagACSeq) return;

    // Merge recent tags
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem('dualclip_recent_tags') || '[]'); } catch (_) {}
    const recentMatches = (Array.isArray(recent) ? recent : [])
      .filter(t => typeof t === 'string' && t.toLowerCase().startsWith(frag))
      .map(t => ({ name: t, count: null }));

    // Normalize backend matches
    const backendMatches = backend
      .map(b => (typeof b === 'string')
        ? { name: b, count: null }
        : { name: b.name || b.tag || '', count: (typeof b.clip_count === 'number' ? b.clip_count : (typeof b.count === 'number' ? b.count : null)) }
      )
      .filter(b => b.name && b.name.toLowerCase().includes(frag));

    // Deduplicate and drop tags already in currentModalTags
    const have = new Set((currentModalTags || []).map(t => t.toLowerCase()));
    const seen = new Set();
    _tagACItems = [...recentMatches, ...backendMatches].filter(it => {
      const k = it.name.toLowerCase();
      if (have.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 8);

    _tagACHighlight = _tagACItems.length > 0 ? 0 : -1;
    renderTagAutocomplete();
  }, 100);
}

function renderTagAutocomplete() {
  const box = document.getElementById('tagAutocomplete');
  if (!box) return;
  if (!_tagACItems.length) {
    hideTagAutocomplete();
    return;
  }
  box.innerHTML = _tagACItems.map((it, i) =>
    `<div class="tag-ac-item${i === _tagACHighlight ? ' active' : ''}" role="option" data-ac-idx="${i}" dir="auto" onmousedown="event.preventDefault()" onclick="acceptTagSuggestion(${i})">`
    + `<span class="tag-ac-name">${escapeHtml(it.name)}</span>`
    + (it.count !== null && it.count !== undefined ? `<span class="tag-ac-count">${it.count}</span>` : '')
    + `</div>`
  ).join('');
  box.style.display = 'block';
}

function hideTagAutocomplete() {
  const box = document.getElementById('tagAutocomplete');
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
  _tagACItems = [];
  _tagACHighlight = -1;
}

function acceptTagSuggestion(idx) {
  const it = _tagACItems[idx];
  if (!it) return;
  addModalTag(it.name);
  const input = document.getElementById('nicknameInput');
  if (input) input.value = '';
  hideTagAutocomplete();
  focusTagInput();
}

function openNicknameModal(clip) {
  const hasMulti = typeof selectedIndices !== 'undefined' && selectedIndices.size > 1;
  const isMulti = hasMulti && (!clip || Array.from(selectedIndices).some(i => clips[i] && clips[i].id === clip.id));

  if (!isMulti && !clip) {
    if (typeof selectedIndices !== 'undefined' && selectedIndices.size === 1) {
      const soleIdx = Array.from(selectedIndices)[0];
      if (soleIdx >= 0 && soleIdx < clips.length) clip = clips[soleIdx];
    } else if (typeof selectedIndex !== 'undefined' && selectedIndex >= 0 && selectedIndex < clips.length) {
      clip = clips[selectedIndex];
    }
  }
  if (!clip && (!selectedIndices || selectedIndices.size === 0)) return;

  currentNicknameClip = isMulti ? clips[Array.from(selectedIndices)[0]] : clip;
  currentNicknameTargetIds = isMulti
    ? Array.from(selectedIndices).map(i => clips[i]).filter(Boolean).map(c => c.id)
    : (currentNicknameClip ? [currentNicknameClip.id] : []);

  if (currentNicknameTargetIds.length === 0) return;

  window._tagModalReturnIndex = (typeof selectedIndex === 'number') ? selectedIndex : -1;

  const modal = document.getElementById('nicknameModal');
  const input = document.getElementById('nicknameInput');
  const clearBtn = document.getElementById('nicknameClearBtn');
  const titleEl = document.getElementById('nicknameModalTitle');
  const saveBtn = document.getElementById('nicknameSaveBtn');
  const batchTabs = document.getElementById('tagModalBatchTabs');
  const labelEl = document.getElementById('tagModalDescLabel');
  if (!modal || !input) return;

  pendingDeleteIndex = -1;
  hideTagAutocomplete();

  if (isMulti) {
    currentModalTags = [];
    currentTagBatchMode = 'add';
    if (batchTabs) batchTabs.style.display = 'flex';
    setTagBatchMode('add');
    if (titleEl) titleEl.textContent = `Tag ${currentNicknameTargetIds.length} Selected Clips`;
    if (clearBtn) clearBtn.style.display = 'none';
  } else {
    currentModalTags = [];
    if (batchTabs) batchTabs.style.display = 'none';
    if (labelEl) labelEl.textContent = 'Organize this clip with tags to quickly find and filter related clips.';
    const existingNick = (currentNicknameClip && currentNicknameClip.nickname) || '';
    currentModalTags = existingNick ? existingNick.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
    const hasExisting = currentModalTags.length > 0;
    if (titleEl) titleEl.textContent = hasExisting ? 'Edit Tags' : 'Add Tags';
    if (saveBtn) saveBtn.textContent = hasExisting ? 'Save Tags' : 'Add Tags';
    if (clearBtn) clearBtn.style.display = hasExisting ? 'inline-block' : 'none';
  }

  input.value = '';
  renderModalTagChips();
  renderRecentTagsChips();

  input.onkeydown = (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (_tagACItems.length > 0) {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        ev.stopPropagation();
        _tagACHighlight = Math.min(_tagACHighlight + 1, _tagACItems.length - 1);
        renderTagAutocomplete();
        return;
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        ev.stopPropagation();
        _tagACHighlight = Math.max(_tagACHighlight - 1, 0);
        renderTagAutocomplete();
        return;
      } else if (ev.key === 'Enter' || ev.key === 'Tab') {
        if (_tagACHighlight >= 0 && _tagACHighlight < _tagACItems.length) {
          ev.preventDefault();
          ev.stopPropagation();
          acceptTagSuggestion(_tagACHighlight);
          return;
        }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        hideTagAutocomplete();
        return;
      }
    }

    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      const typed = input.value.trim();
      if (typed) {
        const parts = typed.split(/[,，]/).map(t => t.trim()).filter(Boolean);
        parts.forEach(p => addModalTag(p));
        input.value = '';
        hideTagAutocomplete();
      } else if (ev.key === 'Enter') {
        executeSaveNickname();
      }
    } else if (ev.key === 'Backspace') {
      if (input.selectionStart === 0 && input.selectionEnd === 0 && !input.value) {
        if (pendingDeleteIndex === currentModalTags.length - 1 && currentModalTags.length > 0) {
          removeModalTag(pendingDeleteIndex);
        } else if (currentModalTags.length > 0) {
          pendingDeleteIndex = currentModalTags.length - 1;
          renderModalTagChips();
        }
      } else {
        if (pendingDeleteIndex !== -1) {
          pendingDeleteIndex = -1;
          renderModalTagChips();
        }
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeNicknameModal();
    } else {
      if (pendingDeleteIndex !== -1) {
        pendingDeleteIndex = -1;
        renderModalTagChips();
      }
    }
  };

  input.oninput = () => {
    if (input.value.includes(',') || input.value.includes('，')) {
      const parts = input.value.split(/[,，]/).map(t => t.trim()).filter(Boolean);
      parts.forEach(p => addModalTag(p));
      input.value = '';
      hideTagAutocomplete();
    } else {
      fetchTagSuggestions(input.value);
    }
  };

  modal.style.display = 'flex';
  setTimeout(() => {
    input.focus();
  }, 50);
}

function closeNicknameModal(e) {
  if (e && e.target && e.target !== e.currentTarget && !e.target.classList.contains('close')) return;
  const modal = document.getElementById('nicknameModal');
  if (modal) modal.style.display = 'none';
  hideTagAutocomplete();
  currentNicknameClip = null;
  currentNicknameTargetIds = [];
  currentModalTags = [];
  pendingDeleteIndex = -1;
  const input = document.getElementById('nicknameInput');
  if (input) input.value = '';

  const ri = window._tagModalReturnIndex;
  window._tagModalReturnIndex = -1;
  if (typeof ri === 'number' && ri >= 0) {
    if (typeof scrollIndexIntoView === 'function') scrollIndexIntoView(ri);
    const row = document.querySelector('.clip-row[data-idx="' + ri + '"]');
    if (row) row.focus();
  }
}

async function executeSaveNickname() {
  if (!currentNicknameTargetIds || currentNicknameTargetIds.length === 0) return;
  const input = document.getElementById('nicknameInput');
  if (input && input.value.trim()) {
    const parts = input.value.split(/[,，]/).map(t => t.trim()).filter(Boolean);
    parts.forEach(p => addModalTag(p));
    input.value = '';
  }

  const isMulti = currentNicknameTargetIds.length > 1;
  const targetIds = [...currentNicknameTargetIds];

  if (currentModalTags.length > 0 && (!isMulti || currentTagBatchMode === 'add')) {
    try {
      let existingRecent = [];
      try { existingRecent = JSON.parse(localStorage.getItem('dualclip_recent_tags') || '[]'); } catch (e) {}
      if (!Array.isArray(existingRecent)) existingRecent = [];
      const merged = Array.from(new Set([...currentModalTags, ...existingRecent])).slice(0, 15);
      localStorage.setItem('dualclip_recent_tags', JSON.stringify(merged));
    } catch (e) {}
  }

  let successCount = 0;
  let totalSkippedDueToMax = 0;

  if (isMulti) {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.batch_add_tags === 'function') {
      try {
        if (currentTagBatchMode === 'add') {
          await window.pywebview.api.batch_add_tags(targetIds, currentModalTags);
        } else {
          await window.pywebview.api.batch_remove_tags(targetIds, currentModalTags);
        }
      } catch (err) {}
    }
    for (const clipId of targetIds) {
      const clipObj = (Array.isArray(allClips) && allClips.find(c => c && c.id === clipId)) ||
                      (Array.isArray(clips) && clips.find(c => c && c.id === clipId));
      const existingTags = (clipObj && clipObj.nickname)
        ? clipObj.nickname.split(/[,，]/).map(t => t.trim()).filter(Boolean)
        : [];
      let finalNick = '';
      if (currentTagBatchMode === 'add') {
        const lowerExisting = new Set(existingTags.map(t => t.toLowerCase()));
        const updated = [...existingTags];
        currentModalTags.forEach(t => {
          if (!lowerExisting.has(t.toLowerCase())) {
            if (updated.length < 10) {
              updated.push(t);
              lowerExisting.add(t.toLowerCase());
            } else {
              totalSkippedDueToMax++;
            }
          }
        });
        finalNick = updated.join(', ');
      } else {
        const toRemove = new Set(currentModalTags.map(t => t.toLowerCase()));
        const updated = existingTags.filter(t => !toRemove.has(t.toLowerCase()));
        finalNick = updated.join(', ');
      }
      successCount++;
      if (Array.isArray(clips)) {
        const c = clips.find(x => x && x.id === clipId);
        if (c) c.nickname = finalNick;
      }
      if (Array.isArray(allClips)) {
        const ac = allClips.find(x => x && x.id === clipId);
        if (ac) ac.nickname = finalNick;
      }
    }
  } else {
    const clipId = targetIds[0];
    const finalNick = currentModalTags.join(', ');
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_tags_for_clip === 'function') {
      try {
        const res = await window.pywebview.api.set_tags_for_clip(clipId, currentModalTags);
        if (res && res.ok) successCount++;
      } catch (err) {}
    } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_nickname === 'function') {
      try {
        const res = await window.pywebview.api.set_nickname(clipId, finalNick);
        if (res && res.ok) successCount++;
      } catch (err) {}
    } else {
      successCount++;
    }
    if (Array.isArray(clips)) {
      const c = clips.find(x => x && x.id === clipId);
      if (c) c.nickname = finalNick;
    }
    if (Array.isArray(allClips)) {
      const ac = allClips.find(x => x && x.id === clipId);
      if (ac) ac.nickname = finalNick;
    }
  }

  if (typeof renderList === 'function') renderList();

  if (successCount === 0) {
    if (typeof showToast === 'function') showToast("Couldn't save tags");
    return;
  }

  if (isMulti) {
    if (typeof showToast === 'function') {
      const actionText = currentTagBatchMode === 'add' ? 'added to' : 'removed from';
      let msg = '';
      if (successCount < targetIds.length) {
        msg = `Tags ${actionText} ${successCount} of ${targetIds.length} clips`;
      } else {
        msg = `Tags ${actionText} ${successCount} clips`;
      }
      if (totalSkippedDueToMax > 0) {
        msg += ` (${totalSkippedDueToMax} skipped, 10 max per clip)`;
      }
      showToast(msg);
    }
  } else {
    if (typeof showToast === 'function') showToast('Tags saved');
  }

  closeNicknameModal();
}

function executeClearNickname() {
  if (!currentNicknameClip && (!currentNicknameTargetIds || currentNicknameTargetIds.length === 0)) return;
  const targetIds = currentNicknameTargetIds.length > 0
    ? [...currentNicknameTargetIds]
    : (currentNicknameClip ? [currentNicknameClip.id] : []);

  currentModalTags = [];
  targetIds.forEach(clipId => {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_tags_for_clip === 'function') {
      window.pywebview.api.set_tags_for_clip(clipId, []).catch(() => {});
    } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_nickname === 'function') {
      window.pywebview.api.set_nickname(clipId, '').catch(() => {});
    }
    if (Array.isArray(clips)) {
      const c = clips.find(x => x && x.id === clipId);
      if (c) c.nickname = '';
    }
    if (Array.isArray(allClips)) {
      const found = allClips.find(c => c && c.id === clipId);
      if (found) found.nickname = '';
    }
  });
  if (typeof renderList === 'function') renderList();
  closeNicknameModal();
}

// --- Edit Clip Modal Logic ---
let currentEditingClip = null;

function openEditClipModal(clip) {
  if (!clip) {
    if (typeof livePreviewEditClipId !== 'undefined' && livePreviewEditClipId != null) {
      const pool = (typeof clips !== 'undefined' && Array.isArray(clips)) ? clips : [];
      const allPool = (typeof allClips !== 'undefined' && Array.isArray(allClips)) ? allClips : [];
      clip = pool.find(c => c && c.id === livePreviewEditClipId) || allPool.find(c => c && c.id === livePreviewEditClipId) || null;
    }
    if (!clip && typeof selectedIndex !== 'undefined' && selectedIndex >= 0 && typeof clips !== 'undefined' && clips[selectedIndex]) {
      clip = clips[selectedIndex];
    }
  } else if (typeof clip === 'number' || typeof clip === 'string') {
    const id = clip;
    const pool = (typeof clips !== 'undefined' && Array.isArray(clips)) ? clips : [];
    const allPool = (typeof allClips !== 'undefined' && Array.isArray(allClips)) ? allClips : [];
    clip = pool.find(c => c && c.id === id) || allPool.find(c => c && c.id === id) || null;
  }
  if (!clip) return;

  currentEditingClip = clip;
  if (typeof openFullPreviewModal === 'function') {
    openFullPreviewModal(clip);
    setTimeout(() => {
      const ta = document.getElementById('prevContent');
      if (ta && ta.tagName === 'TEXTAREA') {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = 0;
        try { ta.scrollTop = 0; } catch (_) {}
      }
    }, 50);
  }
}

function closeEditClipModal(e) {
  if (typeof closePreviewModal === 'function') {
    closePreviewModal(e);
  }
  currentEditingClip = null;
}

function executePasteEditedClip() {
  if (typeof copyPreviewContent === 'function') copyPreviewContent();
}

function executeSaveEditedClip() {
  if (typeof savePreviewClip === 'function') savePreviewClip();
}

// --- Manage Tags Modal Logic ---
function getTagStats() {
  const pool = (typeof allClips !== 'undefined' && Array.isArray(allClips) && allClips.length > 0)
    ? allClips
    : ((typeof clips !== 'undefined' && Array.isArray(clips)) ? clips : []);

  const counts = new Map();
  pool.forEach(c => {
    if (c && c.nickname && typeof c.nickname === 'string' && c.nickname.trim()) {
      const tags = c.nickname.split(/[,，]/).map(t => t.trim()).filter(Boolean);
      tags.forEach(t => {
        const key = t.toLowerCase();
        if (!counts.has(key)) {
          counts.set(key, { displayName: t, count: 0, clipIds: [] });
        }
        const item = counts.get(key);
        item.count++;
        if (c.id && !item.clipIds.includes(c.id)) {
          item.clipIds.push(c.id);
        }
      });
    }
  });

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
}

function openManageTagsModal() {
  const modal = document.getElementById('manageTagsModal');
  const listEl = document.getElementById('manageTagsList');
  if (!modal || !listEl) return;

  renderManageTagsList();
  modal.style.display = 'flex';
}

function closeManageTagsModal(e) {
  if (e && e.target && e.target !== e.currentTarget && !e.target.classList.contains('close')) return;
  const modal = document.getElementById('manageTagsModal');
  if (modal) modal.style.display = 'none';
}

function renderManageTagsList() {
  const listEl = document.getElementById('manageTagsList');
  if (!listEl) return;

  const stats = getTagStats();
  if (stats.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 24px 10px; color: var(--text-sub); font-size: 12.5px;">
        No tags created yet.<br><span style="font-size: 11px; opacity: 0.8;">Press Ctrl+T on any clip to add tags.</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  stats.forEach(item => {
    const row = document.createElement('div');
    row.className = 'manage-tag-row';

    const info = document.createElement('div');
    info.className = 'manage-tag-info';
    info.innerHTML = `
      <span class="manage-tag-badge">${escapeHtml(item.displayName)}</span>
      <span class="manage-tag-count">${item.count} ${item.count === 1 ? 'clip' : 'clips'}</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'manage-tag-actions';

    const filterBtn = document.createElement('button');
    filterBtn.className = 'manage-tag-btn';
    filterBtn.textContent = 'Filter';
    filterBtn.title = `Filter clips with tag '${item.displayName}'`;
    filterBtn.onclick = () => {
      closeManageTagsModal();
      if (typeof filterByTag === 'function') filterByTag(item.displayName);
    };

    const renameBtn = document.createElement('button');
    renameBtn.className = 'manage-tag-btn';
    renameBtn.textContent = 'Rename';
    renameBtn.title = `Rename tag '${item.displayName}'`;
    renameBtn.onclick = () => {
      renameTagEverywhere(item.displayName, item.clipIds);
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'manage-tag-btn danger';
    delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    delBtn.title = `Remove tag '${item.displayName}' from all clips`;
    delBtn.onclick = () => {
      deleteTagEverywhere(item.displayName, item.clipIds);
    };

    actions.appendChild(filterBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

async function renameTagEverywhere(oldTag, clipIds) {
  const newName = prompt(`Rename tag '${oldTag}' across ${clipIds.length} clips:`, oldTag);
  if (!newName || !newName.trim() || newName.trim().toLowerCase() === oldTag.toLowerCase()) return;
  const cleanNew = newName.trim().replace(/^#+/, '').replace(/[,，]/g, '').slice(0, 40);
  if (!cleanNew) return;

  const oldLower = oldTag.toLowerCase();

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.rename_tag === 'function') {
    try { await window.pywebview.api.rename_tag(oldTag, cleanNew); } catch(e){}
  }

  for (const cid of clipIds) {
    const clipObj = (Array.isArray(allClips) && allClips.find(c => c && c.id === cid)) ||
                    (Array.isArray(clips) && clips.find(c => c && c.id === cid));
    if (clipObj && clipObj.nickname) {
      let tags = clipObj.nickname.split(/[,，]/).map(t => t.trim()).filter(Boolean);
      tags = tags.map(t => t.toLowerCase() === oldLower ? cleanNew : t);
      const unique = Array.from(new Set(tags));
      clipObj.nickname = unique.join(', ');
    }
  }

  try {
    let recent = JSON.parse(localStorage.getItem('dualclip_recent_tags') || '[]');
    if (Array.isArray(recent)) {
      recent = recent.map(t => t.toLowerCase() === oldLower ? cleanNew : t);
      localStorage.setItem('dualclip_recent_tags', JSON.stringify(Array.from(new Set(recent))));
    }
  } catch(e){}

  if (typeof refreshFilterTagsOptions === 'function') refreshFilterTagsOptions();
  if (typeof applyFilters === 'function') applyFilters();
  else if (typeof renderList === 'function') renderList();
  renderManageTagsList();
  if (typeof showToast === 'function') showToast(`Renamed '${oldTag}' to '${cleanNew}'`);
}

async function deleteTagEverywhere(tagToDelete, clipIds) {
  if (!confirm(`Remove tag '${tagToDelete}' from all ${clipIds.length} clips?`)) return;

  const targetLower = tagToDelete.toLowerCase();

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.delete_tag === 'function') {
    try { await window.pywebview.api.delete_tag(tagToDelete); } catch(e){}
  }

  for (const cid of clipIds) {
    const clipObj = (Array.isArray(allClips) && allClips.find(c => c && c.id === cid)) ||
                    (Array.isArray(clips) && clips.find(c => c && c.id === cid));
    if (clipObj && clipObj.nickname) {
      let tags = clipObj.nickname.split(/[,，]/).map(t => t.trim()).filter(Boolean);
      tags = tags.filter(t => t.toLowerCase() !== targetLower);
      clipObj.nickname = tags.join(', ');
    }
  }

  try {
    let recent = JSON.parse(localStorage.getItem('dualclip_recent_tags') || '[]');
    if (Array.isArray(recent)) {
      recent = recent.filter(t => t.toLowerCase() !== targetLower);
      localStorage.setItem('dualclip_recent_tags', JSON.stringify(recent));
    }
  } catch(e){}

  if (typeof refreshFilterTagsOptions === 'function') refreshFilterTagsOptions();
  if (typeof applyFilters === 'function') applyFilters();
  else if (typeof renderList === 'function') renderList();
  renderManageTagsList();
  if (typeof showToast === 'function') showToast(`Deleted tag '${tagToDelete}'`);
}

window.openAppPicker = openAppPicker;
window.closeAppPicker = closeAppPicker;
window.onAppPickerSearch = onAppPickerSearch;
window.pickApp = pickApp;
window.browseApplicationFromExplorer = browseApplicationFromExplorer;
window.handleAppPickerKeydown = handleAppPickerKeydown;
window.openMoveCollectionModal = openMoveCollectionModal;
window.closeMoveCollectionModal = closeMoveCollectionModal;
window.submitMoveCollectionModal = submitMoveCollectionModal;
window.renderMoveCollectionModalList = renderMoveCollectionModalList;
window.openNewCollectionFromMoveModal = openNewCollectionFromMoveModal;
window.openRenameModal = openRenameModal;
window.closeRenameModal = closeRenameModal;
window.executeSaveRename = executeSaveRename;
window.executeClearRename = executeClearRename;
window.openNicknameModal = openNicknameModal;
window.closeNicknameModal = closeNicknameModal;
window.executeSaveNickname = executeSaveNickname;
window.executeClearNickname = executeClearNickname;
window.openEditClipModal = openEditClipModal;
window.closeEditClipModal = closeEditClipModal;
window.executePasteEditedClip = executePasteEditedClip;
window.executeSaveEditedClip = executeSaveEditedClip;
window.renderRecentTagsChips = renderRecentTagsChips;
window.toggleRecentTag = toggleRecentTag;
window.updateRecentTagsChipActiveStates = updateRecentTagsChipActiveStates;
window.getRecentTagsList = getRecentTagsList;
window.focusTagInput = focusTagInput;
window.addModalTag = addModalTag;
window.removeModalTag = removeModalTag;
window.renderModalTagChips = renderModalTagChips;
window.setTagBatchMode = setTagBatchMode;
window.openManageTagsModal = openManageTagsModal;
window.closeManageTagsModal = closeManageTagsModal;
window.renderManageTagsList = renderManageTagsList;
window.renameTagEverywhere = renameTagEverywhere;
window.deleteTagEverywhere = deleteTagEverywhere;
window.getTagStats = getTagStats;

// --- Modal Focus Management (a11y): autofocus, Tab trap, Esc fallback, focus restore ---
// Generic observer covers every .modal-overlay dialog (current + future, e.g. Import/Export),
// so individual open/close functions don't each need wiring. Per-skill guidance: CSS over
// JS animation, rAF-batched DOM work, no heavy host state passed into the page.
(function initModalFocusManagement() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.__dcModalFocusInit) return;
  window.__dcModalFocusInit = true;

  let lastFocusedBeforeModal = null;

  function isModalOpen(el) {
    return !!el && el.classList && el.classList.contains('modal-overlay') && el.style.display === 'flex';
  }
  function getOpenModals() {
    try {
      return Array.from(document.querySelectorAll('.modal-overlay')).filter(isModalOpen);
    } catch (e) { return []; }
  }
  function getTopModal() {
    const open = getOpenModals();
    return open.length ? open[open.length - 1] : null;
  }
  function rememberFocus() {
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== document.documentElement) lastFocusedBeforeModal = ae;
    } catch (e) {}
  }
  function restoreFocus() {
    if (getOpenModals().length > 0) return;
    // ── Preview anchor restoration owns focus for previewModal; never fall back to searchInput ──
    try { if (window.__previewAnchorPending) { lastFocusedBeforeModal = null; return; } } catch {}
    try {
      if (lastFocusedBeforeModal && document.contains(lastFocusedBeforeModal) && typeof lastFocusedBeforeModal.focus === 'function') {
        lastFocusedBeforeModal.focus({ preventScroll: true });
      } else {
        const si = document.getElementById('searchInput');
        if (si && typeof si.focus === 'function') si.focus({ preventScroll: true });
      }
    } catch (e) {}
    lastFocusedBeforeModal = null;
  }
  function focusablesIn(modal) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return [];
    const sel = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    try {
      return Array.from(modal.querySelectorAll(sel)).filter((el) => {
        if (el.disabled || (el.getAttribute && el.getAttribute('aria-hidden') === 'true')) return false;
        try {
          const r = el.getBoundingClientRect();
          if ((!r || (r.width === 0 && r.height === 0)) && el !== document.activeElement) return false;
        } catch (e) {}
        return true;
      });
    } catch (e) { return []; }
  }
  function focusPrimaryInModal(modal) {
    if (!modal) return;
    let target = null;
    try {
      if (modal.id === 'previewModal') {
        // Reading modal: safe default is Close (avoids accidental Copy on stray Enter).
        const footBtns = modal.querySelectorAll('#prevFooter button');
        target = (footBtns && footBtns.length ? footBtns[footBtns.length - 1] : null)
          || modal.querySelector('#prevFooter button')
          || modal.querySelector('.tb-btn.close');
      } else {
        // Search/filter inputs first, then primary/danger confirm actions.
        target = modal.querySelector('input[type="text"], input:not([type]), textarea, select')
          || modal.querySelector('.btn-primary, .minimal-btn-danger, [data-autofocus]');
      }
    } catch (e) { target = null; }
    const doFocus = () => {
      try {
        if (target && document.contains(target) && typeof target.focus === 'function') {
          target.focus({ preventScroll: true });
        } else {
          const f = focusablesIn(modal);
          if (f.length && typeof f[0].focus === 'function') f[0].focus({ preventScroll: true });
          else {
            const card = modal.querySelector ? modal.querySelector('.modal-card') : null;
            if (card) {
              if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
              if (typeof card.focus === 'function') card.focus({ preventScroll: true });
            }
          }
        }
      } catch (e) {}
    };
    try {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(doFocus);
      else doFocus();
    } catch (e) {}
    // WebView2 paint fallback: re-assert only if focus escaped the modal entirely.
    setTimeout(() => {
      try {
        if (modal && modal.style.display === 'flex' && !modal.contains(document.activeElement)) doFocus();
      } catch (e) {}
    }, 80);
  }

  function observeModals() {
    try {
      document.querySelectorAll('.modal-overlay').forEach((el) => {
        if (!el.__dcFocusObserved) {
          el.__dcFocusObserved = true;
          modalFocusObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
        }
      });
    } catch (e) {}
  }
  const modalFocusObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const el = m.target;
      if (!el || !el.classList || !el.classList.contains('modal-overlay')) continue;
      if (el.style.display === 'flex') {
        rememberFocus();
        focusPrimaryInModal(el);
        try {
          const isCompact = document.documentElement.getAttribute('data-layout-preset') === 'compact' ||
                            (document.body && document.body.classList.contains('density-dense'));
          if (isCompact) {
            const zoom = typeof currentZoomLevel !== 'undefined' ? currentZoomLevel : 1.0;
            let optW = 540, optH = 460;
            if (el.id === 'editClipModal') { optW = 660; optH = 520; }
            else if (el.id === 'appPickerModal') { optW = 540; optH = 500; }
            else if (el.id === 'manageTagsModal') { optW = 540; optH = 480; }
            // All compact dialogs share the 660x520 footprint so switching
            // between them (preview -> edit) never re-grows the window.
            else if (el.id === 'previewModal') { optW = 660; optH = 520; }
            const needW = Math.round(optW * zoom);
            const needH = Math.round(optH * zoom);
            // Seamless switch: preview may have expanded the window already —
            // if it fits, skip the resize entirely (even same-size animated
            // resizes replay the bounds tween natively and read as flicker).
            // No expand means no flag: close must NOT restore either.
            if (needW > window.innerWidth || needH > window.innerHeight) {
              if (!window.__compactModalExpanded) {
                window.__compactPreModalSize = { w: window.innerWidth, h: window.innerHeight };
                window.__compactModalExpanded = true;
              }
              const targetW = Math.max(needW, window.innerWidth);
              const targetH = Math.max(needH, window.innerHeight);
              if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_window_size === 'function') {
                // persist=false: dialog enlargement is transient geometry (same contract as
                // the lightbox expand). Persisting it would leak the dialog size into the
                // remembered/mirrored window size and the next summon would reopen at it.
                window.pywebview.api.set_window_size(targetW, targetH, true, false);
              } else if (typeof callHost === 'function') {
                callHost('set_window_size', [targetW, targetH, true, false]);
              }
            }
          }
        } catch (_) {}
      } else {
        restoreFocus();
        try {
          const openModals = Array.from(document.querySelectorAll('.modal-overlay')).filter(mEl => mEl && mEl.style && mEl.style.display === 'flex');
          if (openModals.length === 0 && window.__compactModalExpanded) {
            window.__compactModalExpanded = false;
            const restoreW = window.__compactPreModalSize && window.__compactPreModalSize.w ? window.__compactPreModalSize.w : 360;
            const restoreH = window.__compactPreModalSize && window.__compactPreModalSize.h ? window.__compactPreModalSize.h : 260;
            window.__compactPreModalSize = null;
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_window_size === 'function') {
              // persist=true: the restore returns the window to the user's preset size.
              window.pywebview.api.set_window_size(restoreW, restoreH, true, true);
            } else if (typeof callHost === 'function') {
              callHost('set_window_size', [restoreW, restoreH, true, true]);
            }
          }
        } catch (_) {}
      }
    }
    // Pin the window while any dialog is open: tell native so an outside
    // click (blur) does not auto-hide over an open preview/edit dialog.
    // Change-only notify: the observer fires on every style write.
    try {
      const anyOpen = Array.from(document.querySelectorAll('.modal-overlay')).some(mEl => mEl && mEl.style && mEl.style.display === 'flex');
      if (document.body) {
        document.body.classList.toggle('modal-open', anyOpen);
      }
      if (window.__dcModalOpenNotified !== anyOpen) {
        window.__dcModalOpenNotified = anyOpen;
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_modal_open === 'function') {
          window.pywebview.api.set_modal_open(anyOpen);
        } else if (typeof callHost === 'function') {
          callHost('set_modal_open', [anyOpen]);
        }
      }
    } catch (_) {}
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeModals, { once: true });
  } else {
    observeModals();
  }
  setTimeout(observeModals, 500);

  // Tab trap (capture phase, ahead of the per-modal key routers): focus never
  // escapes into the hidden clip list behind an open dialog.
  document.addEventListener('keydown', (e) => {
    if (!e || e.key !== 'Tab') return;
    const top = getTopModal();
    if (!top) return;
    const f = focusablesIn(top);
    if (f.length === 0) { e.preventDefault(); return; }
    const first = f[0];
    const last = f[f.length - 1];
    const ae = document.activeElement;
    if (!ae || !top.contains(ae)) { e.preventDefault(); try { first.focus(); } catch (err) {} return; }
    if (e.shiftKey && ae === first) { e.preventDefault(); try { last.focus(); } catch (err) {} }
    else if (!e.shiftKey && ae === last) { e.preventDefault(); try { first.focus(); } catch (err) {} }
  }, true);

  // Escape fallback for dialogs the global router doesn't cover yet (plus any
  // future modal): delegate to the real close fn so pending state reverts.
  // Enter on the merge select confirms (native buttons already click on Enter).
  document.addEventListener('keydown', (e) => {
    if (!e) return;
    const top = getTopModal();
    if (!top) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      const known = ['renameModal', 'nicknameModal', 'editClipModal', 'appPickerModal', 'renameCollectionModal',
        'deleteCollectionModal', 'clearConfirmModal', 'previewModal', 'newCollectionModal', 'moveCollectionModal'];
      if (known.indexOf(top.id) !== -1) return; // keyboard.js owns these (with logging)
      e.preventDefault();
      e.stopPropagation();
      try {
        if (top.id === 'mergeCollectionModal' && typeof closeMergeCollectionModal === 'function') closeMergeCollectionModal();
        else top.style.display = 'none';
      } catch (err) {}
      restoreFocus();
    } else if (e.key === 'Enter' && top.id === 'mergeCollectionModal') {
      const ae = document.activeElement;
      if (ae && ae.tagName === 'SELECT') {
        e.preventDefault();
        if (typeof executeMergeCollection === 'function') executeMergeCollection();
      }
    } else if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      // Confirm dialogs: Enter triggers the primary action instead of falling
      // through to the global paste handler. Skip focused buttons (native
      // Enter-click already runs Cancel/Confirm) and text fields where Enter
      // has native meaning (inputs handle their own keydown; textareas need newline).
      const ae = document.activeElement;
      const tag = ae && ae.tagName;
      const inNative = ae && (tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable
        || (tag === 'INPUT' && ae.type !== 'checkbox' && ae.type !== 'radio'));
      if (!inNative) {
        let confirmFn = null;
        if (top.id === 'clearConfirmModal' && typeof executeClearHistory === 'function') {
          const btn = document.getElementById('clearModalConfirmBtn');
          if (btn && btn.disabled) return;
          confirmFn = executeClearHistory;
        }
        else if (top.id === 'deleteCollectionModal' && typeof executeDeleteCollection === 'function') confirmFn = executeDeleteCollection;
        else if (top.id === 'appPickerModal' && typeof confirmAppPickerSelection === 'function') confirmFn = confirmAppPickerSelection;
        if (confirmFn) {
          e.preventDefault();
          e.stopPropagation();
          try { confirmFn(); } catch (err) {}
        }
      }
    }
  }, true);

  window.__dcModalFocus = {
    rememberFocus: rememberFocus,
    restoreFocus: restoreFocus,
    focusPrimaryInModal: focusPrimaryInModal,
    getTopModal: getTopModal
  };
})();
