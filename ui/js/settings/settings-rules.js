// DualClip JS Module: settings-rules.js
// Auto-split from settings.js - complete functions, no mid-function cuts

function toggleIgnorePasswordsSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_ignore_passwords === 'function') {
    window.pywebview.api.set_ignore_passwords(willBeOn);
  }
  try { localStorage.setItem('dualclip_ignore_passwords', willBeOn ? '1' : '0'); } catch(e) {}
  notifySettingSaved('row_ignore_passwords');
}

function togglePreventScreenCaptureSetting(el) {
  if (!el) el = document.getElementById('stPreventScreenCaptureToggle');
  if (!el) return;
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_prevent_screen_capture === 'function') {
    window.pywebview.api.set_prevent_screen_capture(willBeOn).catch(() => {});
  }
  try { localStorage.setItem('dualclip_prevent_screen_capture', willBeOn ? '1' : '0'); } catch(e) {}
  notifySettingSaved('row_prevent_screen_capture');
}


function toggleIncognitoSetting(el) {
  // Delegate directly to authoritative handler in core/state.js
  const coreFn = window._coreToggleIncognito || null;
  if (typeof coreFn === 'function') {
    return coreFn(el);
  }
}

function toggleCaptureImagesSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_capture_images === 'function') {
    window.pywebview.api.set_capture_images(willBeOn);
  }
  try { localStorage.setItem('dualclip_capture_images', willBeOn ? '1' : '0'); } catch(e) {}
  notifySettingSaved('row_capture_images');
}

function toggleFullscreenGuardSetting(el) {
  if (!el) el = document.getElementById('stFullscreenGuardToggle');
  if (!el) return;
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  // S-P1: the backend copy gates real behaviour — a swallowed write failure
  // leaves the UI showing ON while the guard is OFF. Revert on failure.
  const revertFullscreenGuard = () => {
    el.classList.toggle('on', !willBeOn);
    try { localStorage.setItem('dualclip_suppress_in_fullscreen', !willBeOn ? '1' : '0'); } catch(e) {}
    if (typeof showToast === 'function') showToast('Could not save fullscreen guard — reverted');
  };
  const guardWrite = (() => {
    try {
      if (window.DC && window.DC.bridge && typeof window.DC.bridge.set_suppress_in_fullscreen === 'function') {
        return window.DC.bridge.set_suppress_in_fullscreen(willBeOn);
      } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_suppress_in_fullscreen === 'function') {
        return window.pywebview.api.set_suppress_in_fullscreen(willBeOn);
      } else if (typeof callHost === 'function') {
        return callHost('set_suppress_in_fullscreen', [willBeOn]);
      }
    } catch (_) { return Promise.resolve({ ok: false }); }
    return Promise.resolve({ ok: true });
  })();
  try {
    Promise.resolve(guardWrite).then(res => {
      if (res && res.ok === false) { revertFullscreenGuard(); return; }
      try { localStorage.setItem('dualclip_suppress_in_fullscreen', willBeOn ? '1' : '0'); } catch(e) {}
    }).catch(() => revertFullscreenGuard());
  } catch (_) { revertFullscreenGuard(); return; }
  if (typeof notifySettingSaved === 'function') notifySettingSaved('row_fullscreen_guard');
}

// --- Minimum Clip Length & Whitespace Filter ---


function syncCaptureFiltersToBackend(minLength, ignoreWhitespace) {
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_capture_filters === 'function') {
    window.pywebview.api.set_capture_filters(minLength, ignoreWhitespace).catch(() => {});
  }
}




function updatePresetChips(val) {
  document.querySelectorAll('.min-length-presets .preset-chip').forEach(chip => {
    const chipVal = parseInt(chip.textContent, 10);
    chip.classList.toggle('active', chipVal === val);
  });
}



// --- Auto-Sort Rules Management ---


function saveAutoSortRules() {
  try {
    localStorage.setItem('dualclip_autosort_rules', JSON.stringify(autoSortRules));
  } catch(e) {}
  syncAutoSortRulesToBackend();
}


function syncAutoSortRulesToBackend() {
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_auto_sort_rules === 'function') {
    window.pywebview.api.set_auto_sort_rules(autoSortRules).catch(() => {});
  }
}


function getAllAvailableCollections() {
  const map = new Map();
  if (Array.isArray(customCollections)) {
    customCollections.forEach(c => {
      if (c && c.id) map.set(c.id, c.name || c.id);
    });
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

let lastValidRuleCollection = '';


function populateAutoSortCollectionSelect(preferredSelectedId) {
  const sel = document.getElementById('newRuleCollection');
  if (!sel) return;
  const previousVal = preferredSelectedId || sel.value;
  sel.innerHTML = '';

  const collections = getAllAvailableCollections().filter(c => c && c.id !== '__create_new__');
  if (collections.length === 0) {
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'No collections created yet';
    emptyOpt.disabled = true;
    sel.appendChild(emptyOpt);
  } else {
    collections.forEach(col => {
      const opt = document.createElement('option');
      opt.value = col.id;
      opt.textContent = col.name;
      sel.appendChild(opt);
    });
  }

  // Create New Collection action option inside the dropdown
  const createOpt = document.createElement('option');
  createOpt.value = '__create_new__';
  createOpt.textContent = '+ Create New Collection...';
  sel.appendChild(createOpt);

  if (preferredSelectedId && collections.some(c => c.id === preferredSelectedId)) {
    sel.value = preferredSelectedId;
    lastValidRuleCollection = preferredSelectedId;
  } else if (previousVal && previousVal !== '__create_new__' && collections.some(c => c.id === previousVal)) {
    sel.value = previousVal;
    lastValidRuleCollection = previousVal;
  } else if (collections.length > 0) {
    sel.value = collections[0].id;
    lastValidRuleCollection = collections[0].id;
  } else {
    sel.value = '';
    lastValidRuleCollection = '';
  }
  if (typeof rebuildCustomSelect === 'function') {
    rebuildCustomSelect(sel);
  }
}


function handleRuleCollectionChange(sel) {
  if (!sel) return;
  if (sel.value === '__create_new__') {
    const collections = getAllAvailableCollections().filter(c => c && c.id !== '__create_new__');
    if (lastValidRuleCollection && collections.some(c => c.id === lastValidRuleCollection)) {
      sel.value = lastValidRuleCollection;
    } else if (collections.length > 0) {
      sel.value = collections[0].id;
    } else {
      sel.value = '';
    }
    if (typeof openNewCollectionModal === 'function') {
      openNewCollectionModal();
    }
  } else if (sel.value) {
    lastValidRuleCollection = sel.value;
  }
}


function onAutoSortRuleTypeChange(type) {
  const input = document.getElementById('newRuleProcess');
  const browseBtn = document.getElementById('newRuleBrowseBtn');
  if (!input) return;

  const t = (type || 'process').toLowerCase();
  if (t === 'title') {
    input.placeholder = 'Window title keyword (e.g. *GitHub*, *YouTube*)';
    if (browseBtn) browseBtn.style.display = 'none';
  } else if (t === 'url') {
    input.placeholder = 'Website domain or URL (e.g. github.com, notion.so)';
    if (browseBtn) browseBtn.style.display = 'none';
  } else {
    input.placeholder = 'App name (e.g. Chrome or code.exe)';
    if (browseBtn) browseBtn.style.display = 'inline-flex';
  }
}
window.onAutoSortRuleTypeChange = onAutoSortRuleTypeChange;

function autoSortBadgeColors(pattern, type) {
  const t = (type || 'process').toLowerCase();
  if (t === 'url') return { bg: 'rgba(16, 185, 129, 0.15)', fg: '#10b981', label: 'URL' };
  if (t === 'title') return { bg: 'rgba(168, 85, 247, 0.15)', fg: '#a855f7', label: 'Title' };

  const p = (pattern || '').toLowerCase();
  if (p.includes('code') || p.includes('devenv') || p.includes('rider') || p.includes('sublime')) return { bg: 'rgba(59, 130, 246, 0.15)', fg: '#3b82f6', label: 'App' };
  if (p.includes('slack')) return { bg: 'rgba(245, 158, 11, 0.15)', fg: '#f59e0b', label: 'App' };
  if (p.includes('chrome') || p.includes('edge') || p.includes('firefox')) return { bg: 'rgba(76, 209, 55, 0.15)', fg: '#4cd137', label: 'App' };
  if (p.includes('discord') || p.includes('teams')) return { bg: 'rgba(88, 101, 242, 0.15)', fg: '#5865f2', label: 'App' };
  if (p.includes('spotify') || p.includes('vlc')) return { bg: 'rgba(29, 185, 84, 0.15)', fg: '#1DB954', label: 'App' };
  if (p.includes('terminal') || p.includes('powershell') || p.includes('cmd')) return { bg: 'rgba(76, 209, 55, 0.12)', fg: '#4cd137', label: 'App' };
  if (p.includes('word') || p.includes('excel') || p.includes('powerpnt') || p.includes('outlook')) return { bg: 'rgba(43, 87, 154, 0.18)', fg: '#2B579A', label: 'App' };
  return { bg: 'color-mix(in srgb, var(--accent) 18%, transparent)', fg: 'var(--accent)', label: 'App' };
}

function matchUrlPattern(input, pattern) {
  if (!input || !pattern) return false;
  const cleanPat = pattern.trim();

  // 1. Wildcard rules: strict wildcard evaluation
  if (cleanPat.includes('*') || cleanPat.includes('?')) {
    if (matchWildcardPattern(input, cleanPat)) return true;
  }

  // 2. Normalize pattern: remove protocol (https://, http://) and leading www.
  let normPat = cleanPat.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');

  // 3. Direct substring match
  const inputLower = input.toLowerCase();
  if (inputLower.includes(cleanPat.toLowerCase()) ||
      (Boolean(normPat) && inputLower.includes(normPat.toLowerCase()))) {
    return true;
  }

  // 4. URL Host / Domain matching if input is a valid URL
  let isValidUrl = false;
  try {
    const urlObj = new URL(input);
    isValidUrl = true;
    const host = urlObj.hostname.toLowerCase();
    let targetHost = normPat.toLowerCase();
    const slashIdx = targetHost.indexOf('/');
    if (slashIdx >= 0) targetHost = targetHost.substring(0, slashIdx);

    if (host === targetHost || host.endsWith('.' + targetHost)) {
      return true;
    }
  } catch (_) {}

  // 5. If input is a window title (e.g. "My Document - Notion - Google Chrome"),
  // match the brand name from the domain pattern (e.g. "notion" from "app.notion.com")
  if (!isValidUrl) {
    const coreDomain = cleanPat.replace(/^[*?\s/\\]+|[*?\s/\\]+$/g, '')
                               .replace(/^https?:\/\//i, '')
                               .replace(/^www\./i, '');
    const domainParts = coreDomain.split(/[./]/).filter(Boolean);
    const skipTokens = new Set(['com', 'net', 'org', 'app', 'www', 'api', 'co', 'io']);
    for (const part of domainParts) {
      if (part.length >= 3 && !skipTokens.has(part.toLowerCase())) {
        if (inputLower.includes(part.toLowerCase())) return true;
      }
    }
  }

  return false;
}

function matchWildcardPattern(text, pattern) {
  if (!text || !pattern) return false;
  const cleanPattern = pattern.trim();
  if (!cleanPattern.includes('*') && !cleanPattern.includes('?')) {
    return text.toLowerCase().includes(cleanPattern.toLowerCase());
  }
  try {
    const escaped = cleanPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    return new RegExp(regexStr, 'i').test(text.trim());
  } catch (_) {
    return text.toLowerCase().includes(cleanPattern.replace(/[*?]/g, '').toLowerCase());
  }
}

function renderAutoSortRulesTable() {
  const container = document.getElementById('autoSortRulesContainer');
  const list = document.getElementById('autoSortRulesList');
  if (!list) return;
  list.innerHTML = '';

  if (!autoSortRules || autoSortRules.length === 0) {
    if (container) container.style.display = 'none';
    return;
  }

  if (container) { container.style.display = 'block'; }

  const allCols = getAllAvailableCollections();
  autoSortRules.forEach(r => {
    const targetColId = r.collectionId || r.collection;
    const foundCol = allCols.find(c => c.id === targetColId);
    const colDisplayName = foundCol ? foundCol.name : (r.collectionName || r.collection || targetColId || 'all');
    const pattern = r.pattern || r.process || '';
    const type = r.type || 'process';
    const initials = (pattern || 'AP').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'AP';

    const row = document.createElement('div');
    row.className = 'rule-item-row';
    const badge = autoSortBadgeColors(pattern, type);
    row.innerHTML = `
      <div class="rule-item-app">
        <span class="rule-item-app-icon" style="background: ${badge.bg}; color: ${badge.fg}; font-size: 10px; font-weight: 600;">${initials}</span>
        <div style="display: flex; flex-direction: column; gap: 1px;">
          <span style="font-weight: 500;">${escapeHtml(pattern)}</span>
          <span style="font-size: 9.5px; color: ${badge.fg}; opacity: 0.85; text-transform: uppercase; font-weight: 600; letter-spacing: 0.3px;">${badge.label}</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="rule-item-badge">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          <span>${escapeHtml(colDisplayName)}</span>
        </span>
        <button type="button" class="rule-item-edit-btn" title="Edit rule" onclick="editAutoSortRule('${r.id}')">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        </button>
        <button type="button" class="rule-item-del-btn" title="Delete rule" onclick="removeAutoSortRule('${r.id}')">
          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
    list.appendChild(row);
  });
}


let editingAutoSortRuleId = null;

function setAutoSortSubmitLabel() {
  try {
    const label = document.querySelector('#newRuleAddBtn span');
    if (label) label.textContent = editingAutoSortRuleId ? 'Update Rule' : 'Add Rule';
  } catch (_) {}
}

function resetAutoSortEditing() {
  editingAutoSortRuleId = null;
  setAutoSortSubmitLabel();
}

function editAutoSortRule(ruleId) {
  const r = Array.isArray(autoSortRules) ? autoSortRules.find(x => x && x.id === ruleId) : null;
  if (!r) return;
  const typeSelect = document.getElementById('newRuleType');
  const procInput = document.getElementById('newRuleProcess');
  const colSelect = document.getElementById('newRuleCollection');
  const ruleType = (r.type || 'process').toLowerCase();
  if (typeSelect) {
    typeSelect.value = ruleType;
    if (typeof onAutoSortRuleTypeChange === 'function') onAutoSortRuleTypeChange(ruleType);
  }
  if (procInput) {
    procInput.value = r.pattern || r.process || '';
    procInput.focus();
  }
  const targetColId = r.collectionId || r.collection;
  if (colSelect && targetColId) {
    const hasOption = Array.from(colSelect.options).some(o => o.value === targetColId);
    if (hasOption) colSelect.value = targetColId;
  }
  editingAutoSortRuleId = ruleId;
  setAutoSortSubmitLabel();
}

function addNewAutoSortRule() {
  const typeSelect = document.getElementById('newRuleType');
  const procInput = document.getElementById('newRuleProcess');
  const colSelect = document.getElementById('newRuleCollection');
  if (!procInput || !colSelect) return;

  const type = typeSelect ? (typeSelect.value || 'process').toLowerCase() : 'process';
  const pattern = procInput.value.trim();
  const collectionId = colSelect.value;
  const collectionName = colSelect.options[colSelect.selectedIndex]?.text || collectionId;

  if (!collectionId || collectionId === '__create_new__') {
    if (typeof showToast === 'function') showToast('Please select or create a collection first (+ New)');
    return;
  }

  if (!pattern) {
    const promptMsg = type === 'title' ? 'Please enter a window title keyword (e.g. *GitHub*)'
                    : type === 'url' ? 'Please enter a domain or URL (e.g. github.com)'
                    : 'Please enter an application process name (e.g. code.exe)';
    if (typeof showToast === 'function') showToast(promptMsg);
    procInput.focus();
    return;
  }

  // Ensure collection exists in customCollections so its pill appears in the collections bar
  if (Array.isArray(customCollections) && !customCollections.some(c => c.id === collectionId)) {
    customCollections.push({ id: collectionId, name: collectionName });
    if (typeof saveCustomCollections === 'function') saveCustomCollections();
    if (typeof renderCollectionPills === 'function') renderCollectionPills();
  }

  const id = editingAutoSortRuleId && autoSortRules.some(r => r && r.id === editingAutoSortRuleId)
    ? editingAutoSortRuleId
    : 'rule_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
  if (editingAutoSortRuleId === id) {
    const existing = autoSortRules.find(r => r && r.id === id);
    if (existing) {
      existing.type = type;
      existing.pattern = pattern;
      existing.process = pattern;
      existing.collectionId = collectionId;
      existing.collectionName = collectionName;
    }
  } else {
    autoSortRules.push({ id, type, pattern, process: pattern, collectionId, collectionName });
  }
  resetAutoSortEditing();
  saveAutoSortRules();
  renderAutoSortRulesTable();
  procInput.value = '';
}




function removeAutoSortRule(ruleId) {
  autoSortRules = autoSortRules.filter(r => r.id !== ruleId);
  if (editingAutoSortRuleId === ruleId) resetAutoSortEditing();
  saveAutoSortRules();
  renderAutoSortRulesTable();
}


function handleAutoSortRuleKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    addNewAutoSortRule();
  }
}


function findAutoSortRule(srcApp, text, title) {
  if (!Array.isArray(autoSortRules) || autoSortRules.length === 0) return null;

  // 1. Priority 1: URL / domain rules on copied text
  if (text) {
    for (const rule of autoSortRules) {
      const t = (rule.type || 'process').toLowerCase();
      if (t === 'url' || t === 'url_domain' || t === 'domain' || t === 'website') {
        const pat = (rule.pattern || rule.process || '').trim();
        if (!pat) continue;
        if (matchUrlPattern(text, pat)) return rule;
      }
    }
  }

  // 2. Priority 2: Window / Tab title rules
  if (title) {
    for (const rule of autoSortRules) {
      const t = (rule.type || 'process').toLowerCase();
      if (t === 'title' || t === 'window' || t === 'window_title') {
        const pat = (rule.pattern || rule.process || '').trim();
        if (!pat) continue;
        if (matchWildcardPattern(title, pat)) return rule;
      }
    }
  }

  // 3. Priority 3: URL / domain rules on browser window title
  if (title) {
    for (const rule of autoSortRules) {
      const t = (rule.type || 'process').toLowerCase();
      if (t === 'url' || t === 'url_domain' || t === 'domain' || t === 'website') {
        const pat = (rule.pattern || rule.process || '').trim();
        if (!pat) continue;
        if (matchUrlPattern(title, pat)) return rule;
      }
    }
  }

  // 4. Priority 4: Process rules
  if (srcApp) {
    const appClean = srcApp.trim().toLowerCase();
    const cleanA = appClean.replace(/\.exe$/i, '').trim();
    for (const rule of autoSortRules) {
      const t = (rule.type || 'process').toLowerCase();
      if (t === 'process') {
        const ruleProc = (rule.pattern || rule.process || '').trim().toLowerCase();
        if (!ruleProc) continue;
        const cleanR = ruleProc.replace(/\.exe$/i, '').trim();
        if (appClean === ruleProc || cleanA === cleanR || cleanA.includes(cleanR) || cleanR.includes(cleanA)) {
          return rule;
        }
      }
    }
  }
  return null;
}

// --- Custom Application Blocklist Management ---


function toggleIgnoreBlocklistSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  isBlocklistEnabled = willBeOn;
  try { localStorage.setItem('dualclip_ignore_blocklist', willBeOn ? '1' : '0'); } catch(e) {}
  syncBlocklistToBackend();
  notifySettingSaved('row_ignore_blocklist');
}


function saveBlockedApps() {
  try {
    localStorage.setItem('dualclip_blocked_apps', JSON.stringify(blockedApps));
  } catch(e) {}
  syncBlocklistToBackend();
}


function syncBlocklistToBackend() {
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_blocklist === 'function') {
    window.pywebview.api.set_blocklist(isBlocklistEnabled, blockedApps).catch(() => {});
  }
}


function renderBlockedAppsList() {
  const container = document.getElementById('blockedAppsContainer');
  if (!container) return;

  if (!Array.isArray(blockedApps) || blockedApps.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = '';
  blockedApps.forEach(proc => {
    const chip = document.createElement('div');
    chip.className = 'blocked-app-chip';
    chip.innerHTML = `
      <span>${escapeHtml(proc)}</span>
      <button type="button" class="blocked-app-chip-remove" title="Remove ${escapeHtml(proc)}" data-proc="${escapeHtml(proc)}" onclick="removeBlockedApp(this)">&times;</button>
    `;
    container.appendChild(chip);
  });
}


function addNewBlockedApp() {
  const input = document.getElementById('newBlockedAppProcess');
  if (!input) return;
  let val = (input.value || '').trim();
  if (!val) {
    if (typeof showToast === 'function') showToast('Please enter an application process name');
    input.focus();
    return;
  }

  const lastSlash = Math.max(val.lastIndexOf('/'), val.lastIndexOf('\\'));
  if (lastSlash >= 0) val = val.substring(lastSlash + 1);

  val = val.toLowerCase().trim();
  if (!val.includes('.')) val += '.exe';

  if (blockedApps.includes(val)) {
    if (typeof showToast === 'function') showToast(`"${val}" is already in your blocklist`);
    input.value = '';
    return;
  }

  blockedApps.push(val);
  saveBlockedApps();
  renderBlockedAppsList();
  input.value = '';
}


function removeBlockedApp(el) {
  const proc = (typeof el === 'string') ? el : (el && el.getAttribute ? el.getAttribute('data-proc') : null);
  if (!proc) return;
  blockedApps = blockedApps.filter(p => p.toLowerCase() !== proc.toLowerCase());
  saveBlockedApps();
  renderBlockedAppsList();
}


function handleBlockedAppKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    addNewBlockedApp();
  }
}

function toggleDoubleCopyOverrideSetting(el) {
  if (!el) el = document.getElementById('stDoubleCopyOverrideToggle');
  if (!el) return;
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_double_copy_override', willBeOn ? '1' : '0'); } catch(e) {}
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_double_copy_override === 'function') {
    window.pywebview.api.set_double_copy_override(willBeOn).catch(() => {});
  }
  if (typeof showToast === 'function') {
    showToast(willBeOn ? 'Double-copy override: Enabled' : 'Double-copy override: Disabled');
  }
  notifySettingSaved('row_double_copy_override');
}

window.toggleDoubleCopyOverrideSetting = toggleDoubleCopyOverrideSetting;
window.toggleIncognitoSetting = toggleIncognitoSetting;
window.toggleCaptureImagesSetting = toggleCaptureImagesSetting;
window.toggleIgnorePasswordsSetting = toggleIgnorePasswordsSetting;
window.togglePreventScreenCaptureSetting = togglePreventScreenCaptureSetting;
// Backfill DC.settings (settings-storage.js parses BEFORE this file, so its
// guarded entries are undefined until now).
try {
  window.DC = window.DC || {};
  window.DC.settings = window.DC.settings || {};
  window.DC.settings.toggleIgnorePasswordsSetting = toggleIgnorePasswordsSetting;
  window.DC.settings.toggleCaptureImagesSetting = toggleCaptureImagesSetting;
  window.DC.settings.togglePreventScreenCaptureSetting = togglePreventScreenCaptureSetting;
  window.DC.settings.toggleDoubleCopyOverrideSetting = toggleDoubleCopyOverrideSetting;
} catch (e) {}



