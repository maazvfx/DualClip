// DualClip JS Module: settings-shortcuts.js
// Auto-split from settings.js - complete functions, no mid-function cuts

// Remote About links (dynamic, no app update needed).
// Owner: create this exact file as PUBLIC on GitHub, e.g.
//   https://github.com/<user>/<repo>/blob/main/links.json
// and set REMOTE_LINKS_URL to its raw URL below.
const REMOTE_LINKS_URL = 'https://raw.githubusercontent.com/maazvfx/dualclip-links/main/links.json';
const REMOTE_LINKS_DEFAULTS = {
  website: 'https://dualclip.vercel.app/',
  tip: 'https://dualclip.vercel.app/support'
};

async function refreshRemoteLinksCache() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 3000);
    const res = await fetch(REMOTE_LINKS_URL, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res && res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        try { localStorage.setItem('dualclip_remote_links', JSON.stringify(data)); } catch (e) {}
      }
    }
  } catch (e) {}
}

function openAboutLink(kind) {
  const fallback = REMOTE_LINKS_DEFAULTS[kind] || REMOTE_LINKS_DEFAULTS.website;
  const isValid = (v) => typeof v === 'string' && /^https:\/\//i.test(v);
  let url = fallback;
  try {
    const cached = localStorage.getItem('dualclip_remote_links');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && isValid(parsed[kind])) {
        url = parsed[kind];
      }
    }
  } catch (e) {}

  if (kind === 'tip') {
    try { localStorage.setItem('dualclip_pending_tip_check', String(Date.now())); } catch (e) {}
  }

  // Instant dispatch to default browser
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.postMessage({ id: 0, method: 'open_external_url', args: [url] });
  } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_external_url === 'function') {
    window.pywebview.api.open_external_url(url);
  } else {
    window.open(url, '_blank');
  }

  // Refresh remote links cache in background for future clicks (non-blocking)
  refreshRemoteLinksCache();
}
window.openAboutLink = openAboutLink;

function toggleSmartShortcutsSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_smart_shortcuts', willBeOn ? '1' : '0'); } catch(e) {}
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_smart_shortcuts === 'function') {
    window.pywebview.api.set_smart_shortcuts(willBeOn);
  }
  notifySettingSaved('row_smart_shortcuts');
}

function getQuickNumberPasteSetting() {
  return localStorage.getItem('dualclip_quick_number_paste') === '1';
}

function applyQuickNumberPasteSetting(enabled, notify = true) {
  const isEnabled = !!enabled;
  try {
    localStorage.setItem('dualclip_quick_number_paste', isEnabled ? '1' : '0');
  } catch(e) {}

  const toggleEl = document.getElementById('stQuickNumberPasteToggle');
  if (toggleEl) {
    toggleEl.classList.toggle('on', isEnabled);
  }

  const api = (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
  if (api && typeof api.set_quick_number_paste === 'function') {
    try {
      const res = api.set_quick_number_paste(isEnabled);
      if (res && typeof res.catch === 'function') res.catch(() => {});
    } catch {}
  }

  if (typeof renderList === 'function') { try { renderList(); } catch (e) {} }
  if (typeof renderVirtualWindow === 'function') { try { renderVirtualWindow(); } catch (e) {} }
  if (notify && typeof notifySettingSaved === 'function') notifySettingSaved('row_quick_number_paste');
}
window.applyQuickNumberPasteSetting = applyQuickNumberPasteSetting;

function toggleQuickNumberPasteSetting(el) {
  const current = getQuickNumberPasteSetting();
  applyQuickNumberPasteSetting(!current, true);
}
window.toggleQuickNumberPasteSetting = toggleQuickNumberPasteSetting;
window.getQuickNumberPasteSetting = getQuickNumberPasteSetting;


function toggleAutostartSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_autostart', willBeOn ? '1' : '0'); } catch(e) {}
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_autostart === 'function') {
    window.pywebview.api.set_autostart(willBeOn);
  }
  notifySettingSaved('row_autostart');
}


function toggleToastsSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_toasts_enabled', willBeOn ? '1' : '0'); } catch(e) {}
  if (willBeOn) {
    if (typeof showToast === 'function') showToast('Toast notifications enabled');
  }
  if (typeof notifySettingSaved === 'function') notifySettingSaved('row_toasts_enabled');
}




function togglePlainCopyShortcutSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_plain_copy_shortcut_enabled', willBeOn ? '1' : '0'); } catch(e) {}
  notifySettingSaved('row_toggle_plain_copy_shortcut');
}


function updateShortcutsGuide() {
  try {
    const saved = localStorage.getItem('dualclip_hotkey_cfg');
    let cfg = { win: false, ctrl: true, alt: false, shift: true, label: 'Ctrl + Shift + V' };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed) cfg = parsed;
      } catch (_) {}
    }

    const mods = [];
    if (cfg.ctrl) mods.push('Ctrl');
    if (cfg.win) mods.push('Win');
    if (cfg.alt) mods.push('Alt');
    if (cfg.shift) mods.push('Shift');
    if (mods.length === 0) {
      mods.push('Ctrl', 'Shift');
    }

    const modKbds = mods.map(m => `<kbd class="st-keycap">${m}</kbd>`).join(' + ');
    const triggerKeyKbd = `<kbd class="st-keycap">V</kbd>`;

    const toggleEl = document.getElementById('scGuideToggle');
    if (toggleEl) {
      toggleEl.innerHTML = `${modKbds} + ${triggerKeyKbd}`;
    }

    const cycleDownEl = document.getElementById('scGuideCycleDown');
    if (cycleDownEl) {
      cycleDownEl.innerHTML = `<span class="shortcut-meta">Hold</span> ${modKbds} + ${triggerKeyKbd}`;
    }

    const cycleUpEl = document.getElementById('scGuideCycleUp');
    if (cycleUpEl) {
      if (cfg.shift) {
        cycleUpEl.innerHTML = `<span class="shortcut-meta">Hold</span> ${modKbds} + <kbd class="st-keycap">V</kbd>`;
      } else {
        cycleUpEl.innerHTML = `<span class="shortcut-meta">Hold</span> ${modKbds} + <kbd class="st-keycap">Shift</kbd> + ${triggerKeyKbd}`;
      }
    }

    const releaseEl = document.getElementById('scGuideRelease');
    if (releaseEl) {
      releaseEl.innerHTML = `<span class="shortcut-meta">Release</span> ${modKbds}`;
    }

    const numberedEl = document.getElementById('scGuideNumbered');
    if (numberedEl) {
      numberedEl.innerHTML = `<span class="shortcut-meta">Hold</span> ${modKbds} + <kbd class="st-keycap">1-9</kbd>`;
    }
  } catch (e) {}
}


function updateWinVWarning(val) {
  const warn = document.getElementById('hotkeyWinVWarning');
  if (!warn) return;
  if (val === 'Win+V') {
    warn.innerHTML = '<span style="color: var(--text); font-weight: 600;">Note:</span> Win + V is reserved by Windows Clipboard History. Disable it under <strong>Settings &rarr; System &rarr; Clipboard</strong> or pick another combo if the shortcut does not respond.';
    warn.style.display = 'block';
  } else if (val === 'Alt+V' || val === 'Alt+Shift+V') {
    warn.innerHTML = '<span style="color: var(--text); font-weight: 600;">Note:</span> ' + val.replace('+', ' + ') + ' overrides the standard View menu shortcut in applications like VS Code, File Explorer, and Office.';
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }
}


function onHotkeyDropdownChanged(val) {
  const map = {
    'Alt+V': { win:false, ctrl:false, alt:true, shift:false, label:'Alt + V' },
    'Win+V': { win:true, ctrl:false, alt:false, shift:false, label:'Win + V' },
    'Ctrl+Shift+V': { win:false, ctrl:true, alt:false, shift:true, label:'Ctrl + Shift + V' },
    'Alt+Shift+V': { win:false, ctrl:false, alt:true, shift:true, label:'Alt + Shift + V' },
    'Ctrl+Alt+V': { win:false, ctrl:true, alt:true, shift:false, label:'Ctrl + Alt + V' }
  };
  const cfg = map[val] || map['Ctrl+Shift+V'];
  localStorage.setItem('dualclip_hotkey_cfg', JSON.stringify({ win:cfg.win, ctrl:cfg.ctrl, alt:cfg.alt, shift:cfg.shift, vk:0x56, label:cfg.label }));
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_hotkey === 'function') {
    window.pywebview.api.set_hotkey(cfg.win, cfg.ctrl, cfg.alt, cfg.shift, 0x56)
      .then(res => {
        if (res && res.ok === false) {
          if (typeof showToast === 'function') {
            showToast('That shortcut is already used by another app. Kept the old one.', { duration: 4000 });
          }
          const defaultCfg = map['Ctrl+Shift+V'];
          localStorage.setItem('dualclip_hotkey_cfg', JSON.stringify({ win:false, ctrl:true, alt:false, shift:true, vk:0x56, label:defaultCfg.label }));
          const inputEl = document.getElementById('stHotkeyInput');
          if (inputEl) {
            inputEl.value = 'Ctrl+Shift+V';
            const rebuildFn = (typeof rebuildCustomSelect === 'function') ? rebuildCustomSelect : (typeof window.rebuildCustomSelect === 'function' ? window.rebuildCustomSelect : null);
            if (rebuildFn) rebuildFn(inputEl);
          }
          updateWinVWarning('Ctrl+Shift+V');
          updateShortcutsGuide();
        }
      })
      .catch(() => {});
  }
  updateWinVWarning(val);
  updateShortcutsGuide();
  if (typeof notifySettingSaved === 'function') notifySettingSaved('row_hotkey');
}


function resetDefaultHotkey() {
  const inputEl = document.getElementById('stHotkeyInput');
  if (inputEl) {
    inputEl.value = 'Ctrl+Shift+V';
    const rebuildFn = (typeof rebuildCustomSelect === 'function') ? rebuildCustomSelect : (typeof window.rebuildCustomSelect === 'function' ? window.rebuildCustomSelect : null);
    if (rebuildFn) rebuildFn(inputEl);
    try { inputEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
  }  localStorage.setItem('dualclip_hotkey_cfg', JSON.stringify({ win:false, ctrl:true, alt:false, shift:true, vk:0x56, label:'Ctrl + Shift + V' }));
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_hotkey === 'function') {
    window.pywebview.api.set_hotkey(false, true, false, true, 0x56);
  }
  updateWinVWarning('Ctrl+Shift+V');
  updateShortcutsGuide();
  if (typeof notifySettingSaved === 'function') notifySettingSaved('row_hotkey');
  if (typeof showToast === 'function') showToast('Shortcut reset to Ctrl + Shift + V');
}


function syncHotkeyDisplay() {
  const inputEl = document.getElementById('stHotkeyInput');
  if (!inputEl) return;
  try {
    const applyHotkeyToUI = (cfg) => {
      let effectiveVal = 'Ctrl+Shift+V';
      if (cfg && cfg.win && !cfg.ctrl && !cfg.alt && !cfg.shift) effectiveVal = 'Win+V';
      else if (cfg && cfg.alt && !cfg.win && !cfg.ctrl && !cfg.shift) effectiveVal = 'Alt+V';
      else if (cfg && cfg.alt && cfg.shift && !cfg.win && !cfg.ctrl) effectiveVal = 'Alt+Shift+V';
      else if (cfg && cfg.ctrl && cfg.alt && !cfg.win && !cfg.shift) effectiveVal = 'Ctrl+Alt+V';
      else if (cfg && cfg.ctrl && cfg.shift && !cfg.win && !cfg.alt) effectiveVal = 'Ctrl+Shift+V';
      else if (cfg && cfg.label) {
        const mapLabelToVal = { 'Alt + V':'Alt+V', 'Win + V':'Win+V', 'Ctrl + Shift + V':'Ctrl+Shift+V', 'Alt + Shift + V':'Alt+Shift+V', 'Ctrl + Alt + V':'Ctrl+Alt+V' };
        effectiveVal = mapLabelToVal[cfg.label] || 'Ctrl+Shift+V';
      }
      inputEl.value = effectiveVal;
      const rebuildFn = (typeof rebuildCustomSelect === 'function') ? rebuildCustomSelect : (typeof window.rebuildCustomSelect === 'function' ? window.rebuildCustomSelect : null);
      if (rebuildFn) rebuildFn(inputEl);
      updateWinVWarning(effectiveVal);
      updateShortcutsGuide();
    };

    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_hotkey === 'function') {
      window.pywebview.api.get_hotkey().then((backendHot) => {
        if (backendHot) {
          applyHotkeyToUI(backendHot);
          try {
            localStorage.setItem('dualclip_hotkey_cfg', JSON.stringify(backendHot));
          } catch (_) {}
        }
      }).catch(() => {
        const saved = localStorage.getItem('dualclip_hotkey_cfg');
        if (saved) {
          try { applyHotkeyToUI(JSON.parse(saved)); } catch (_) {}
        }
      });
      return;
    }

    const saved = localStorage.getItem('dualclip_hotkey_cfg');
    if (saved) {
      try { applyHotkeyToUI(JSON.parse(saved)); } catch (_) {}
    } else {
      applyHotkeyToUI({ win:false, ctrl:true, alt:false, shift:true, label:'Ctrl + Shift + V' });
    }
  } catch(e) {}
}


// Only plain 1-9 hotkeys (per request Ã¢â‚¬â€ modifiers removed)
const HOTKEY_POP_GROUPS = [
  { label: '1 – 9', prefix: '' }
];
function formatHotkeyLabel(value) {
  if (!value || value === 'none') return '';
  return String(value).split('+').map(p => p === 'ctrl' ? 'Ctrl' : p === 'shift' ? 'Shift' : p === 'alt' ? 'Alt' : p.toUpperCase()).join(' + ');
}
function closeOpenHotkeyPopovers() {
  let any = false;
  try {
    document.querySelectorAll('.custom-hotkey-popover').forEach(p => {
      if (p.style.display === 'block' || p.style.display === 'flex') { p.style.display = 'none'; any = true; }
    });
  } catch (_) {}
  return any;
}
function assignDirectMoveHotkey(el, value) {
  const colId = (typeof el === 'string') ? el : (el && el.closest ? (el.closest('[data-col-id]') || {}).dataset?.colId : null);
  const shortcutValue = (typeof value === 'undefined' && el && typeof el.value !== 'undefined') ? el.value : value;
  if (!colId) return;
  closeOpenHotkeyPopovers();
  onDirectMoveShortcutChange(colId, shortcutValue);
}
window.assignDirectMoveHotkey = assignDirectMoveHotkey;
window.closeOpenHotkeyPopovers = closeOpenHotkeyPopovers;
(function bindHotkeyPopoverDismiss() {
  if (window._hotkeyPopDismissBound) return;
  window._hotkeyPopDismissBound = true;
  document.addEventListener('click', function (e) {
    try {
      if (e.target && e.target.closest && e.target.closest('.custom-hotkey-wrap')) return;
      closeOpenHotkeyPopovers();
    } catch (_) {}
  }, true);
  document.addEventListener('scroll', function () { closeOpenHotkeyPopovers(); }, true);
})();


function onDirectMoveShortcutChange(colId, shortcutValue) {
  let savedShortcuts = {};
  try {
    savedShortcuts = JSON.parse(localStorage.getItem('dualclip_direct_col_shortcuts') || '{}');
  } catch (e) {}

  if (shortcutValue === 'none') {
    delete savedShortcuts[colId];
  } else {
    // If another collection already had this shortcut, clear it to avoid collision
    Object.keys(savedShortcuts).forEach(k => {
      if (savedShortcuts[k] === shortcutValue) delete savedShortcuts[k];
    });
    savedShortcuts[colId] = shortcutValue;
  }

  try {
    localStorage.setItem('dualclip_direct_col_shortcuts', JSON.stringify(savedShortcuts));
  } catch (e) {}

  if (typeof renderSettingsCollectionsList === 'function') {
    renderSettingsCollectionsList();
  }
}

function renderSettingsCollectionsList() {
  const container = document.getElementById('settingsCollectionsContainer');
  if (!container) return;
  container.innerHTML = '';

  let savedShortcuts = {};
  try {
    savedShortcuts = JSON.parse(localStorage.getItem('dualclip_direct_col_shortcuts') || '{}');
  } catch (e) {}

  const availableCols = [];
  if (Array.isArray(customCollections)) {
    customCollections.forEach(c => {
      const name = (c && (c.name || c.id) || '').trim();
      if (name && !availableCols.some(col => col.id === c.id)) {
        availableCols.push({ id: c.id, name: name, type: 'custom', icon: 'folder' });
      }
    });
  }

  if (availableCols.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 12px;">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 6px; opacity: 0.6;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <div style="font-weight: 500; color: var(--text);">No custom collections yet</div>
        <div style="font-size: 11px; margin-top: 3px; opacity: 0.7;">Enter a name above and click Create to add one.</div>
      </div>
    `;
    return;
  }

  availableCols.forEach((col, colIndex) => {
    const row = document.createElement('div');
    row.className = 'direct-move-row st-collection-manage-row';
    row.draggable = true;
    row.dataset.colId = col.id;
    row.dataset.index = String(colIndex);
    const assigned = savedShortcuts[col.id] || 'none';
    const isAssigned = assigned !== 'none';
    const clipCount = typeof getCollectionClipCount === 'function' ? getCollectionClipCount(col.id) : 0;

    const assignedLabel = formatHotkeyLabel(assigned);

    const iconSvg = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

    row.innerHTML = `
      <span class="st-col-drag-handle" title="Drag to reorder" draggable="false">⋮⋮</span>
      <div class="direct-move-row-name" style="gap: 8px; flex: 1; min-width: 0;">
        ${iconSvg}
        <span class="st-col-title" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;" title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</span>
      </div>
      <span class="st-col-count-badge">${clipCount} clip${clipCount === 1 ? '' : 's'}</span>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        <select class="st-select" style="width: 80px; font-size: 11px; padding: 4px 6px;" onchange="assignDirectMoveHotkey(this)">
          ${Array.from({length:9},(_,i)=>{ const v=`${i+1}`; const isSel=v===assigned; return `<option value="${v}" ${isSel?'selected':''}>${v}</option>`; }).join('')}
        </select>
        <button type="button" class="btn-sm st-col-action-btn" title="Rename collection" onclick="triggerSettingsRenameCollection(this)">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        </button>
        <button type="button" class="btn-sm st-col-action-btn danger-hover" title="Delete collection" onclick="triggerSettingsDeleteCollection(this)">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
    // Drag reorder
    row.addEventListener('dragstart', (e) => {
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', col.id);
        // Marks this as an internal Settings reorder, not external text. The sidebar's drop
        // handler treats text/plain from any drag as a clip worth capturing, which used to
        // save the collection's raw id as a junk clip when a row was dragged out of Settings.
        e.dataTransfer.setData('application/x-dualclip-settings-collection', col.id);
      } catch {}
      window._draggedColId = col.id;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); window._draggedColId = null; row.style.borderTop = ''; });
    row.addEventListener('dragover', (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {} row.style.borderTop = '2px solid var(--accent)'; });
    row.addEventListener('dragleave', () => { row.style.borderTop = ''; });
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.style.borderTop = '';
      const draggedId = window._draggedColId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      const targetId = col.id;
      if (!draggedId || draggedId === targetId) return;
      const fromIdx = customCollections.findIndex(c => c.id === draggedId);
      const toIdx = customCollections.findIndex(c => c.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = customCollections.splice(fromIdx, 1);
      customCollections.splice(toIdx, 0, moved);
      if (typeof saveCustomCollections === 'function') saveCustomCollections(); else try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch {}
      if (typeof renderCollectionPills === 'function') renderCollectionPills();
      renderSettingsCollectionsList();
    });
    container.appendChild(row);
  });
}


function triggerSettingsRenameCollection(el) {
  const colId = (typeof el === 'string') ? el : (el && el.closest ? (el.closest('[data-col-id]') || {}).dataset?.colId : null);
  if (!colId) return;
  if (typeof promptRenameCollection === 'function') {
    promptRenameCollection(colId);
  }
}

function triggerSettingsDeleteCollection(el) {
  const colId = (typeof el === 'string') ? el : (el && el.closest ? (el.closest('[data-col-id]') || {}).dataset?.colId : null);
  if (!colId) return;
  if (typeof promptDeleteCollection === 'function') {
    promptDeleteCollection(colId);
  }
}

window.renderSettingsCollectionsList = renderSettingsCollectionsList;
window.triggerSettingsRenameCollection = triggerSettingsRenameCollection;
window.triggerSettingsDeleteCollection = triggerSettingsDeleteCollection;
window.toggleToastsSetting = toggleToastsSetting;

const SETTINGS_SEARCH_INDEX = [
  // 1. Behavior
  { id: 'row_incognito', tab: 'behavior', label: 'Pause Clipboard Capture', desc: 'Temporarily suspend recording copied items to the database', keywords: 'pause capture suspend recording stop private privacy incognito timed' },
  { id: 'row_capture_images', tab: 'behavior', label: 'Capture Images and Screenshots', desc: 'Automatically captures copied images and screenshots into your clipboard history', keywords: 'capture images screenshots pictures media clipboard bitmap png' },
  { id: 'row_autostart', tab: 'behavior', label: 'Start DualClip automatically with Windows', desc: 'Launch automatically when you sign in', keywords: 'startup autostart boot windows launch tray' },
  { id: 'row_remember_selected_clip', tab: 'behavior', label: 'Remember Selected Clip', desc: 'Keep your selected clip highlighted when reopening the window', keywords: 'remember select selected clip reopen restore position highlight last' },
  { id: 'row_fullscreen_guard', tab: 'behavior', label: 'Pause in Fullscreen Games & Apps', desc: 'Don\u2019t open DualClip while gaming or watching full-screen video', keywords: 'fullscreen guard suppress gaming video directx borderless pause suppress' },
  { id: 'row_toasts_enabled', tab: 'behavior', label: 'Pop-up Messages', desc: 'Show small confirmations when copying, moving, or managing clips', keywords: 'toast notifications popup alert banner confirmation copied moved deleted toast banner message' },
  { id: 'row_auto_update_check', tab: 'behavior', label: 'Auto-check for updates on startup', desc: 'Check quietly when DualClip starts', keywords: 'auto check updates startup version update notification' },

  // 2. Theme & Style
  { id: 'row_theme_mode', tab: 'theme', label: 'Theme', desc: 'Match your Windows system settings or lock to Light or Dark', keywords: 'theme dark light system mode appearance style color' },
  { id: 'row_visual_style', tab: 'theme', label: 'Visual Style', desc: 'Choose the look, contrast, and accent style of the window', keywords: 'visual style modern slate oled black frosted glass indigo design' },
  { id: 'row_zebra', tab: 'theme', label: 'Alternating Row Colors', desc: 'Alternating row background patterns for high density reading', keywords: 'zebra striping pattern alternating row subtle slate depth' },
  { id: 'row_hide_window_border', tab: 'theme', label: 'Hide Window Border', desc: 'Hide outer edge borders around the app frame', keywords: 'border window stroke line frame hide' },
  { id: 'row_clip_details', tab: 'theme', label: 'Clip Details', desc: 'Choose which information appears on clip cards (source app, time, or none)', keywords: 'clip details source app icon name time hidden metadata' },
  { id: 'row_preview_font', tab: 'theme', label: 'Preview Font', desc: 'Choose the font family used for the large preview popover', keywords: 'preview font typography monospace code serif sans inter font family' },
  { id: 'row_label_style', tab: 'theme', label: 'Tag Display Style', desc: 'Choose how tags appear in the list', keywords: 'tag display style badges chips dots label tags pill gray plain' },
  { id: 'row_line_display', tab: 'theme', label: 'Lines Per Clip', desc: 'Controls maximum visible text lines per clip before truncating', keywords: 'lines per clip line clamp limit truncate text rows auto 1 2 3' },
  { id: 'row_zoom', tab: 'theme', label: 'Interface Zoom', desc: 'Scale UI elements to fit more content or improve readability', keywords: 'zoom scale interface text size readability 90 100 110 125 compact small' },
  { id: 'row_thumb_size', tab: 'theme', label: 'Image Preview Size', desc: 'Choose how large image previews appear in the list', keywords: 'thumbnail size height preview image small large row height' },

  // 3. Window & Hotkeys
  { id: 'row_hotkey', tab: 'window', label: 'Open DualClip Shortcut', desc: 'Keyboard shortcut that opens or hides the window', keywords: 'hotkey shortcut win v global activation open record keybinding' },
  { id: 'row_quick_number_paste', tab: 'window', label: 'Quick Number Paste (1–9)', desc: 'Press 1–9 to paste recent clips directly; moves collection switching to Shift+1–9', keywords: 'quick number paste digits badges 1 2 3 4 5 6 7 8 9 paste collection switch shift' },
  { id: 'row_window_position', tab: 'window', label: 'Hotkey Window Position', desc: 'Where the DualClip window appears when activated by global shortcut', keywords: 'window position placement open at last center near cursor smart mouse coordinates monitor shortcut' },
  { id: 'row_tray_position', tab: 'window', label: 'Tray Window Position', desc: 'Where the DualClip window appears when clicking the system tray icon', keywords: 'tray position icon click placement open at corner center near cursor monitor' },
  { id: 'row_reset_window_size', tab: 'window', label: 'Reset Window Size', desc: 'Restore default dimensions for the current mode (Compact or Standard)', keywords: 'reset window size default dimensions compact standard geometry' },

  // 4. List Organization (now under Appearance)
  { id: 'row_grouping_mode', tab: 'theme', label: 'Group clips by', desc: 'Organize history with recency landmarks or display a clean continuous stream', keywords: 'grouping group clips by section time none continuous recency landmarks' },

  // 5. Routing Rules & Privacy
  { id: 'row_autosort_rules', tab: 'routing', label: 'Routing Rules', desc: 'Automatically route clips into collections based on the source application', keywords: 'auto sort routing rules application process collection map vscode chrome slack' },
  { id: 'row_blocklist_toggle', tab: 'routing', label: 'Ignore Blocklisted Applications', desc: 'When enabled, clipboard events originating from blocked apps are dropped immediately', keywords: 'blocklist ignore blocked applications drop filter master toggle' },
  { id: 'row_blocklist_add', tab: 'routing', label: 'Custom Application Ignore Blocklist', desc: 'DualClip won\u2019t save clips copied from these apps', keywords: 'blocklist custom add app process running picker chips ignore list' },
  { id: 'row_ignore_passwords', tab: 'routing', label: 'Ignore Password Managers & Authenticators', desc: 'Automatically blocks copying sensitive credentials from Bitwarden, 1Password, KeePass', keywords: 'password manager bitwarden 1password keepass lastpass credentials secret sensitive' },
  { id: 'row_prevent_screen_capture', tab: 'routing', label: 'Screen Capture Protection', desc: 'Prevent DualClip window from appearing in screenshots or screen shares', keywords: 'screen capture protection privacy recording stream share hide window' },

  // 6. Storage & Expiry
  { id: 'row_max_clips', tab: 'storage', label: 'Max Saved Clips', desc: 'Automatic rotation keeps your database fast and lightweight by purging older unpinned clips', keywords: 'max saved clips capacity limit history rotation purge storage database unlimited' },
  { id: 'row_auto_expire', tab: 'storage', label: 'Auto-Expire Old Clips', desc: 'Automatically purge unpinned items older than a set number of days', keywords: 'auto expire old clips days retention duration cleanup purge' },
  { id: 'row_clear_history', tab: 'storage', label: 'Clear History', desc: 'Permanently remove clips and purge database storage', keywords: 'clear history delete unpinned wipe erase reset purge cleanup' },
  { id: 'row_backup_db', tab: 'storage', label: 'Export & Import Clips', desc: 'Save clips to a JSON file or merge one back in', keywords: 'export import backup restore json save share file merge clips' }
];




function changeDragOutMode(val, notify = true) {
  try { localStorage.setItem('dualclip_drag_out_mode', val); } catch(e) {}
  const selectEl = document.getElementById('stDragOutSelect');
  if (selectEl) selectEl.value = val;
  if (notify) notifySettingSaved('row_drag_out');
}


