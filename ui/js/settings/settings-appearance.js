function createBooleanAppearanceSetting(config) {
  const { storageKey, className, attrName, toggleId, notifyKey } = config;

  const getVal = () => localStorage.getItem(storageKey) === '1';

  const applyVal = (enabled, notify = true) => {
    const isVal = !!enabled;
    try {
      localStorage.setItem(storageKey, isVal ? '1' : '0');
    } catch(e) {}

    if (className) {
      document.documentElement.classList.toggle(className, isVal);
      if (document.body) document.body.classList.toggle(className, isVal);
    }
    if (attrName) {
      document.documentElement.setAttribute(attrName, isVal ? 'hidden' : 'visible');
    }

    const toggleEl = document.getElementById(toggleId);
    if (toggleEl) toggleEl.classList.toggle('on', isVal);

    if (notify && typeof notifySettingSaved === 'function') {
      notifySettingSaved(notifyKey);
    }
  };

  const toggleVal = () => applyVal(!getVal(), true);

  return { getVal, applyVal, toggleVal };
}

const _outlineSetting = createBooleanAppearanceSetting({
  storageKey: 'dualclip_selection_outline',
  className: 'selection-outlined',
  toggleId: 'stOutlineSelectionToggle',
  notifyKey: 'row_outline_selection'
});
const getOutlineSelectionSetting = _outlineSetting.getVal;
const applyOutlineSelectionSetting = _outlineSetting.applyVal;
const toggleOutlineSelectionSetting = _outlineSetting.toggleVal;

const _softenSetting = createBooleanAppearanceSetting({
  storageKey: 'dualclip_soften_tint',
  className: 'soften-tint',
  toggleId: 'stSoftenTintToggle',
  notifyKey: 'row_soften_tint'
});
const getSoftenTintSetting = _softenSetting.getVal;
const applySoftenTintSetting = _softenSetting.applyVal;
const toggleSoftenTintSetting = _softenSetting.toggleVal;

const _hoverSetting = createBooleanAppearanceSetting({
  storageKey: 'dualclip_row_hover_highlight',
  className: 'row-hover-highlight',
  toggleId: 'stHoverHighlightToggle',
  notifyKey: 'row_hover_highlight'
});
const getHoverHighlightSetting = _hoverSetting.getVal;
const applyHoverHighlightSetting = _hoverSetting.applyVal;
const toggleHoverHighlightSetting = _hoverSetting.toggleVal;

const _borderSetting = createBooleanAppearanceSetting({
  storageKey: 'dualclip_hide_window_border',
  attrName: 'data-window-border',
  toggleId: 'stHideWindowBorderToggle',
  notifyKey: 'row_hide_window_border'
});
const getHideWindowBorderSetting = _borderSetting.getVal;
const applyHideWindowBorderSetting = _borderSetting.applyVal;
const toggleHideWindowBorderSetting = _borderSetting.toggleVal;

window.applyOutlineSelectionSetting = applyOutlineSelectionSetting;
window.toggleOutlineSelectionSetting = toggleOutlineSelectionSetting;
window.getOutlineSelectionSetting = getOutlineSelectionSetting;
window.applySoftenTintSetting = applySoftenTintSetting;
window.toggleSoftenTintSetting = toggleSoftenTintSetting;
window.getSoftenTintSetting = getSoftenTintSetting;
window.applyHoverHighlightSetting = applyHoverHighlightSetting;
window.toggleHoverHighlightSetting = toggleHoverHighlightSetting;
window.getHoverHighlightSetting = getHoverHighlightSetting;
window.applyHideWindowBorderSetting = applyHideWindowBorderSetting;
window.toggleHideWindowBorderSetting = toggleHideWindowBorderSetting;
window.getHideWindowBorderSetting = getHideWindowBorderSetting;

// Legacy backward-compatibility shims
window.applySelectionHighlightMode = function(m) {
  applyOutlineSelectionSetting(m === 'outlined');
};
window.setSelectionHighlightMode = window.applySelectionHighlightMode;
window.getSelectionHighlightMode = function() {
  return getOutlineSelectionSetting() ? 'outlined' : 'tint';
};
window.toggleSoftSelectionSetting = toggleSoftenTintSetting;
window.toggleSoftSelection = toggleSoftenTintSetting;




function applyWindowSizePreset(preset, animate = false) {
  let canonicalVal = preset;
  if (preset === 'normal') canonicalVal = 'default';
  else if (preset === 'standard') canonicalVal = 'default';
  // Legacy Large values fall back to Default (Large mode removed).
  else if (preset === 'expanded' || preset === 'large') canonicalVal = 'default';

  let w = 970, h = 730;
  if (canonicalVal === 'compact') {
    w = 360; h = 260;
    const savedW = parseInt(localStorage.getItem('dualclip_compact_width'), 10);
    const savedH = parseInt(localStorage.getItem('dualclip_compact_height'), 10);
    if (savedW >= 300) w = savedW;
    if (savedH >= 240) h = savedH;
  } else if (canonicalVal === 'default') { w = 970; h = 730; }
  if (canonicalVal === 'default') {
    const savedW = parseInt(localStorage.getItem('dualclip_standard_width'), 10);
    const savedH = parseInt(localStorage.getItem('dualclip_standard_height'), 10);
    if (savedW >= 300) w = savedW;
    if (savedH >= 240) h = savedH;
  }
  else if (['medium', 'tall', 'wide', 'ultrawide'].includes(canonicalVal)) { canonicalVal = 'default'; }
  
  currentBaseWidth = w;
  currentBaseHeight = h;
  
  const zoom = typeof currentZoomLevel !== 'undefined' ? currentZoomLevel : 1.0;
  const targetW = Math.round(w * zoom);
  const targetH = Math.round(h * zoom);
  
  // Settings isolation: while the Settings view is open, never resize the
  // shared OS window — persist the choice and apply it on return to History.
  let inSettingsView = false;
  try { inSettingsView = !!(document.body && document.body.classList.contains('in-settings')); } catch(e) {}
  if (inSettingsView) {
    try { window.__deferredSizePreset = canonicalVal; } catch(e) {}
  }

  if (!inSettingsView && window.pywebview && window.pywebview.api) {
    if (typeof window.pywebview.api.set_window_size === 'function') {
      window.pywebview.api.set_window_size(targetW, targetH, animate === true);
    } else if (typeof window.pywebview.api.resize_window === 'function') {
      window.pywebview.api.resize_window(targetW, targetH);
    }
  }
  
  try { localStorage.setItem('dualclip_size_preset', canonicalVal); } catch(e) {}
  const stSel = document.getElementById('stWindowSizePresetSelect');
  if (stSel && stSel.value !== canonicalVal) stSel.value = canonicalVal;
  const qvSel = document.getElementById('qvWindowSize');
  if (qvSel && qvSel.value !== canonicalVal) qvSel.value = canonicalVal;
  notifySettingSaved('row_window_size');
}
window.applyWindowSizePreset = applyWindowSizePreset;

function changeWindowSizePreset(preset, showNotify) {
  applyWindowSizePreset(preset);
}
window.changeWindowSizePreset = changeWindowSizePreset;


function applyWindowPositionSetting(mode) {
  // Legacy migration: mouse/caret/center_cursor/corner -> near
  if (mode === 'mouse' || mode === 'caret' || mode === 'center_cursor' || mode === 'cursor_center' || mode === 'centercursor' || mode === 'cursorcenter' || mode === 'centered_on_cursor' || mode === 'centeredoncursor' || mode === 'corner') mode = 'near';
  const valid = ['near', 'near_above', 'center', 'last'].includes(mode) ? mode : 'near';
  try { localStorage.setItem('dualclip_window_position', valid); } catch (e) {}
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_window_position_mode === 'function') {
    window.pywebview.api.set_window_position_mode(valid);
  }
  notifySettingSaved('row_window_position');
}


function applyTrayPositionSetting(mode) {
  if (mode === 'mouse' || mode === 'caret' || mode === 'center_cursor' || mode === 'cursor_center' || mode === 'centercursor' || mode === 'cursorcenter' || mode === 'centered_on_cursor' || mode === 'centeredoncursor' || mode === 'corner') mode = 'center';
  const valid = ['center', 'near', 'last'].includes(mode) ? mode : 'center';
  try { localStorage.setItem('dualclip_tray_position', valid); } catch (e) {}
  const sel = document.getElementById('stTrayPositionSelect');
  if (sel && sel.value !== valid) sel.value = valid;
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_tray_position_mode === 'function') {
    window.pywebview.api.set_tray_position_mode(valid);
  }
  notifySettingSaved('row_tray_position');
}


function resetWindowSizeCurrentMode() {
  const isSettings = document.body && document.body.classList.contains('in-settings');
  const isCompact = !isSettings && ((typeof getEffectiveViewMode === 'function' && getEffectiveViewMode() === 'compact')
    || (document.documentElement.getAttribute('data-layout-preset') === 'compact'));
  const targetMode = isCompact ? 'compact' : 'standard';

  // Settings and History now share one size (970x730), so a reset while Settings is open
  // would only shrink the shared window and overwrite the History size. Do nothing instead.
  if (isSettings) {
    if (typeof showToast === 'function') {
      showToast('Settings already uses the default window size');
    }
    return;
  }

  if (isCompact) {
    try {
      localStorage.removeItem('dualclip_compact_width');
      localStorage.removeItem('dualclip_compact_height');
    } catch (_) {}
  } else {
    try {
      localStorage.removeItem('dualclip_standard_width');
      localStorage.removeItem('dualclip_standard_height');
    } catch (_) {}
  }

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.reset_window_size === 'function') {
    window.pywebview.api.reset_window_size(targetMode);
  } else if (typeof applyWindowSizePreset === 'function') {
    applyWindowSizePreset(isCompact ? 'compact' : 'default');
  }

  if (typeof showToast === 'function') {
    showToast('Window size reset to default');
  }
}
window.resetWindowSizeCurrentMode = resetWindowSizeCurrentMode;

function toggleRememberSizeSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_remember_window_size', willBeOn ? '1' : '0'); } catch(e) {}
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_remember_window_size === 'function') {
    window.pywebview.api.set_remember_window_size(willBeOn);
  }
  if (typeof showToast === 'function') showToast(willBeOn ? 'Window size: remember last size' : 'Window size: reset to default on open');
  notifySettingSaved('row_remember_window_size');
  notifySettingSaved('row_remember_size');
}
const toggleRememberWindowSizeSetting = toggleRememberSizeSetting;
window.toggleRememberSizeSetting = toggleRememberSizeSetting;
window.toggleRememberWindowSizeSetting = toggleRememberWindowSizeSetting;


function toggleRememberCollectionSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_remember_collection', willBeOn ? '1' : '0'); } catch(e) {}
  if (typeof showToast === 'function') showToast(willBeOn ? 'Collection memory: on — will remember last collection' : 'Collection memory: off — will open on All Clips');
  notifySettingSaved('row_remember_collection');
}

function toggleRememberSelectedClipSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_remember_selected_clip', willBeOn ? '1' : '0'); } catch(e) {}
  if (typeof showToast === 'function') showToast(willBeOn ? 'Selection memory: on — will remember selected clip' : 'Selection memory: off — will jump to top on open');
  notifySettingSaved('row_remember_selected_clip');
}
window.toggleRememberSelectedClipSetting = toggleRememberSelectedClipSetting;


function toggleTaskbarSetting(el) {
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_show_taskbar === 'function') {
    window.pywebview.api.set_show_taskbar(willBeOn);
  }
  try { localStorage.setItem('dualclip_show_taskbar', willBeOn ? '1' : '0'); } catch(e) {}
  notifySettingSaved('row_taskbar');
}


function toggleZebraSetting(el) {
  const current = document.documentElement.getAttribute('data-zebra') || 'off';
  const next = current === 'off' ? 'depth' : 'off';
  changeZebraStyle(next);
}
window.toggleZebraSetting = toggleZebraSetting;




function changeZebraStyle(val, notify = true) {
  currentZebraStyle = val;
  document.documentElement.setAttribute('data-zebra', val);
  const sel = document.getElementById('stZebraStyleSelect');
  if (sel && sel.value !== val) sel.value = val;
  const tgl = document.getElementById('stZebraToggle');
  if (tgl) tgl.classList.toggle('on', val !== 'off');
  const topBtn = document.getElementById('btnZebraToggleTop');
  if (topBtn) topBtn.classList.toggle('active', val !== 'off');
  document.querySelectorAll('[id^="qbtn_z_"]').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`qbtn_z_${val}`);
  if (activeBtn) activeBtn.classList.add('active');
  try { localStorage.setItem('dualclip_zebra_style', val); } catch(e) {}
  if (typeof syncQuickViewToggles === 'function') syncQuickViewToggles();
  if (notify) notifySettingSaved('row_zebra');
}


function changeLineDisplay(lines, notify = true) {
  // '3' (fixed three lines) was removed: Auto already picks 1/2/3 per clip and both
  // shared the same mis-sized constant. A saved '3' migrates to 'auto'.
  const allowed = ['1', '2', 'auto'];
  if (!allowed.includes(lines)) {
    lines = 'auto';
  }
  currentLineDisplay = lines;
  document.documentElement.setAttribute('data-line-display', lines);
  const sel = document.getElementById('stLineDisplaySelect');
  if (sel && sel.value !== lines) sel.value = lines;
  const qvLines = document.getElementById('qvLines');
  if (qvLines && qvLines.value !== lines) qvLines.value = lines;
  document.querySelectorAll('[id^="qbtn_l_"]').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`qbtn_l_${lines}`);
  if (activeBtn) activeBtn.classList.add('active');
  const lpcSel = document.getElementById('stLinesPerClipSelect');
  if (lpcSel && lpcSel.value !== lines) lpcSel.value = lines;
  try { localStorage.setItem('dualclip_line_display', lines); } catch(e) {}
  const hostApi = (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
  if (hostApi && typeof hostApi.set_line_display === 'function') {
    try {
      const res = hostApi.set_line_display(lines);
      if (res && typeof res.catch === 'function') res.catch(() => {});
    } catch {}
  }
  if (typeof renderList === 'function') renderList();
  if (notify) notifySettingSaved('row_line_display');
}

function changeLinesPerClipSetting(value) {
  changeLineDisplay(value, true);
}
window.changeLinesPerClipSetting = changeLinesPerClipSetting;

let _densityPreviewInitDone = false;

function setDetailsLocked(locked) {
  // No-op: Clip details is permanently unlocked for direct user control
  window._detailsLocked = false;
}
window.setDetailsLocked = setDetailsLocked;

function setAppSourceLocked(locked) {
  // No-op: App source is permanently unlocked for direct user control
  window._appSourceLocked = false;
}
window.setAppSourceLocked = setAppSourceLocked;

function switchDensityPreview(val) {
  if (!document.body) return;
  if (val === 'compact' || val === 'cards' || val === 'cards_subtle' || val === 'cards_framed' || val === 'balanced' || val === 'snug' || val === 'minimal') val = 'default';
  document.body.classList.remove('density-dense', 'density-balanced', 'density-snug', 'density-cards', 'density-cards_subtle', 'density-cards_framed', 'density-compact', 'density-minimal', 'density-elevated');
  if (val && val !== 'default') {
    document.body.classList.add(`density-${val}`);
  }
  try { localStorage.setItem('dualclip_density_preview', val); } catch(e) {}
  const sel = document.getElementById('densityPreviewSelect');
  if (sel && sel.value !== val) sel.value = val;
  const qvSel = document.getElementById('qvDensity');
  if (qvSel && qvSel.value !== val) qvSel.value = val;
  if (typeof renderList === 'function') {
    try { renderList(); } catch(e) {}
  }
  _densityPreviewInitDone = true;
}
window.switchDensityPreview = switchDensityPreview;

const PILL_STYLE_LABELS = {
  'default': 'Classic'
};


function changePillStyleSetting(val, notify = true) {
  // Migrate removed styles to default (only Classic remains)
  if (val === 'subtle' || val === 'glass' || val === 'elevated-subtle' || val === 'chamfer' || val === 'glow') val = 'default';
  const validStyles = [];
  if (document.body) {
    document.body.classList.remove('pills-subtle', 'pills-glass', 'pills-elevated-subtle', 'pills-chamfer', 'pills-glow');
    if (val && val !== 'default' && validStyles.includes(val)) {
      document.body.classList.add('pills-' + val);
    }
  }
  document.documentElement.setAttribute('data-pill-style', val);
  try { localStorage.setItem('dualclip_pill_style', val); } catch(e) {}
  syncPillStyleDropdownUi(val);
  const qvSel = document.getElementById('qvPillStyle');
  if (qvSel && qvSel.value !== val) qvSel.value = val;
  if (notify && typeof notifySettingSaved === 'function') notifySettingSaved('row_collection_bar_style');
}
window.applyPillStyle = changePillStyleSetting;
window.changePillStyleSetting = changePillStyleSetting;
window.changeCollectionBarStyle = changePillStyleSetting;


function syncPillStyleDropdownUi(val) {
  const lbl = document.getElementById('lbl_pills');
  const flyLbl = document.getElementById('fly_lbl_pills');
  const stage = document.getElementById('fly_pills_stage');
  const menu = document.getElementById('menu_pills');
  const labelText = PILL_STYLE_LABELS[val] || 'Classic';

  if (lbl) lbl.textContent = labelText;
  if (flyLbl) flyLbl.textContent = labelText;

  if (stage) {
    stage.className = 'pill-stage-box';
    if (val && val !== 'default') {
      stage.classList.add('pills-' + val);
    }
  }

  if (menu) {
    menu.querySelectorAll('.opt-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.val === val);
    });
  }
}

function changeGroupingMode(mode, notify = true) {
  const normMode = (mode === 'date') ? 'time' : mode;
  groupingMode = (normMode === 'time') ? 'date' : normMode;
  isGroupedView = normMode !== 'none';
  const sel = document.getElementById('stGroupingModeSelect');
  if (sel) sel.value = normMode;
  document.querySelectorAll('[id^="qbtn_g_"]').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`qbtn_g_${normMode}`);
  if (activeBtn) activeBtn.classList.add('active');
  try { localStorage.setItem('dualclip_grouping_mode', normMode); } catch(e) {}
  if (typeof renderList === 'function') renderList();
  if (notify) notifySettingSaved('row_grouping_mode');
}
window.changeGroupingMode = changeGroupingMode;

function changeLabelStyleSetting(style, notify = true) {
  const normStyle = (style === 'plain' || style === 'none' || style === 'text') ? 'plain' : (style === 'gray' ? 'gray' : 'pill');
  try { localStorage.setItem('dualclip_label_style', normStyle); } catch(e) {}
  document.documentElement.setAttribute('data-label-style', normStyle);
  document.body.classList.toggle('label-style-plain', normStyle === 'plain');
  const sel = document.getElementById('stLabelStyleSelect');
  if (sel) {
    sel.value = normStyle;
    const wrap = sel.closest('.custom-select-wrap');
    if (wrap) {
      const selectedOpt = sel.options[sel.selectedIndex];
      const label = wrap.querySelector('.custom-select-label');
      if (label && selectedOpt) label.textContent = selectedOpt.textContent;
      wrap.querySelectorAll('.opt-item').forEach(i => {
        i.classList.toggle('selected', i.dataset.val === normStyle);
      });
    }
  }
  if (typeof renderVirtualWindow === 'function') {
    renderVirtualWindow();
  } else if (typeof renderList === 'function') {
    renderList();
  }
  if (notify && typeof notifySettingSaved === 'function') notifySettingSaved('row_label_style');
}
window.changeLabelStyleSetting = changeLabelStyleSetting;

function toggleAutofocusSearchSetting(el) {
  const willBeOn = el ? !el.classList.contains('on') : false;
  if (el) el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_autofocus_search', willBeOn ? '1' : '0'); } catch(e) {}
  notifySettingSaved('row_autofocus_search');
}
window.toggleAutofocusSearchSetting = toggleAutofocusSearchSetting;



function changeSectionClickMode(mode, notify = true) {
  sectionClickMode = mode;
  const sel = document.getElementById('stSectionClickSelect');
  if (sel) sel.value = mode;
  try { localStorage.setItem('dualclip_section_click_mode', mode); } catch(e) {}
  if (typeof renderList === 'function') renderList();
  if (notify) notifySettingSaved('row_section_collapse');
}


function changeImageDisplayMode(mode, notify = true) {
  imageDisplayMode = mode;
  try { localStorage.setItem('dualclip_image_display_mode', mode); } catch(e) {}
  if (typeof renderList === 'function') renderList();
  if (notify) notifySettingSaved('row_image_display');
}


function setThumbSize(size, notify = true) {
  // 'lg' was removed from the product; a stored value migrates to the Small default.
  const normalized = (size === 'md') ? 'md' : 'sm';
  currentThumbSize = normalized;
  const appFrame = document.getElementById('appFrame');
  if (appFrame) appFrame.setAttribute('data-thumb-size', normalized);
  const sel = document.getElementById('stThumbSizeSelect');
  if (sel) sel.value = normalized;
  try { localStorage.setItem('dualclip_thumb_size', normalized); } catch(e) {}
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_thumb_size === 'function') {
    window.pywebview.api.set_thumb_size(normalized).catch(() => {});
  }
  if (notify) notifySettingSaved('row_thumb_size');
}


function switchThemeMode(mode, showNotification = true) {
  const validMode = (mode === 'light') ? 'light' : 'dark';
  try { localStorage.setItem('dualclip_theme', validMode); } catch(e) {}

  const selectEl = document.getElementById('stThemeModeSelect');
  if (selectEl) selectEl.value = validMode;

  applyResolvedTheme(validMode);

  if (typeof syncQuickViewToggles === 'function') syncQuickViewToggles();
  if (showNotification) notifySettingSaved('row_theme_mode');
}


const THEME_STYLES = {
  dark: [
    { id: 'linear', name: 'Default', desc: 'Precision Slate', swatch: '#5e6ad2', bg: '#08090c' },
    { id: 'notion', name: 'Notion', desc: 'Warm Paper & Ink', swatch: '#2383e2', bg: '#191919' },
    { id: 'nord', name: 'Nord', desc: 'Polar Frost Slate', swatch: '#88c0d0', bg: '#1e222a' },
    { id: 'geist', name: 'True Black', desc: 'True Pitch Black', swatch: '#ffffff', bg: '#000000' },
    { id: 'raycast', name: 'Glass', desc: 'Frosted Acrylic', swatch: '#818cf8', bg: '#12141d' }
  ],
  light: [
    { id: 'linear', name: 'Default', desc: 'Cool Slate & Indigo', swatch: '#6366f1', bg: '#edf1f6' },
    { id: 'notion', name: 'Notion', desc: 'Warm Paper & Ink', swatch: '#0075de', bg: '#f6f5f4' },
    { id: 'nord', name: 'Warm Paper', desc: 'Editorial Sepia', swatch: '#c26903', bg: '#f5f2eb' },
    { id: 'geist', name: 'Crisp Contrast', desc: 'Pure Monochrome', swatch: '#09090b', bg: '#e4e4e7' }
  ]
};

function renderVisualStylesUI(themeName, activeStyle) {
  const currentModeStyles = THEME_STYLES[themeName] || THEME_STYLES.dark;
  const currentStyleId = activeStyle || 'linear';

  // 1. Settings Dropdown Options
  const selectEl = document.getElementById('stStyleSelect');
  if (selectEl) {
    selectEl.innerHTML = currentModeStyles.map(s => `
      <option value="${s.id}" ${s.id === currentStyleId ? 'selected' : ''}>${s.name}</option>
    `).join('').trim();
    selectEl.value = currentStyleId;
    if (typeof rebuildCustomSelect === 'function') {
      rebuildCustomSelect(selectEl);
    } else if (typeof window.rebuildCustomSelect === 'function') {
      window.rebuildCustomSelect(selectEl);
    }
  }

  // 2. Quick View Dropdown Options
  const qvSelect = document.getElementById('qvVisualStyle');
  if (qvSelect) {
    qvSelect.innerHTML = currentModeStyles.map(s => `
      <option value="${s.id}" ${s.id === currentStyleId ? 'selected' : ''}>${s.name}</option>
    `).join('').trim();
    qvSelect.value = currentStyleId;
    if (typeof rebuildCustomSelect === 'function') {
      rebuildCustomSelect(qvSelect);
    } else if (typeof window.rebuildCustomSelect === 'function') {
      window.rebuildCustomSelect(qvSelect);
    }
  }
}

function applyResolvedTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
  const isLight = themeName === 'light';
  const bgHex = isLight ? '#edf1f6' : '#08090c';
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_theme_color === 'function') {
    window.pywebview.api.set_theme_color(bgHex);
  }
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_tray_theme === 'function') {
    window.pywebview.api.set_tray_theme(themeName);
  }

  // Independent style memory per theme
  const styleKey = isLight ? 'dualclip_visual_style_light' : 'dualclip_visual_style_dark';
  const validStyles = (THEME_STYLES[themeName] || THEME_STYLES.dark).map(s => s.id);
  let targetStyle = localStorage.getItem(styleKey);
  if (!targetStyle || !validStyles.includes(targetStyle)) {
    targetStyle = 'linear';
  }
  switchDesignStyle(targetStyle, false);

  // If selection highlight is on Auto, update soft-selection for new theme
  if (typeof applySelectionHighlightMode === 'function' && typeof getSelectionHighlightMode === 'function') {
    applySelectionHighlightMode(getSelectionHighlightMode(), false);
  }
}


function changeZoomSetting(zoomLevel, notify = true) {
  if (zoomLevel === '85' || zoomLevel === '90' || zoomLevel === 'compact') zoomLevel = '100';
  const level = (['110','125'].includes(zoomLevel)) ? zoomLevel : '100';
  try { localStorage.setItem('dualclip_zoom', level); } catch(e) {}

  const zoomRevMap = { '85': 'compact', '90': 'compact', '100': 'default', '110': 'large', '125': 'extra-large' };
  if (zoomRevMap[level]) {
    try { localStorage.setItem('dualclip_zoom_preset', zoomRevMap[level]); } catch(e) {}
  }

  // Keep the window-sizing multiplier in sync (H2): applyWindowSizePreset
  // multiplies preset dimensions by currentZoomLevel so the window grows/shrinks with
  // the content scale instead of clipping zoomed UI.
  if (typeof currentZoomLevel !== 'undefined') {
    const zoomMap = { '90': 0.9, '100': 1.0, '110': 1.1, '125': 1.25 };
    currentZoomLevel = zoomMap[level];
  }

  // Zoom applies to the History panel only; Settings stays locked to Large.
  const zoomHostEl = document.getElementById('mainView') || document.body;
  if (zoomHostEl) {
    zoomHostEl.classList.remove('zoomed-90', 'zoomed-110', 'zoomed-125');
    if (level === '90') {
      zoomHostEl.classList.add('zoomed-90');
    } else if (level === '110') {
      zoomHostEl.classList.add('zoomed-110');
    } else if (level === '125') {
      zoomHostEl.classList.add('zoomed-125');
    }
  }

  const selectEl = document.getElementById('stZoomSelect');
  if (selectEl && selectEl.value !== level) selectEl.value = level;
  const qvZoom = document.getElementById('qvZoom');
  if (qvZoom && qvZoom.value !== (zoomRevMap[level] || 'default')) qvZoom.value = zoomRevMap[level] || 'default';

  if (notify) notifySettingSaved('row_zoom');
}


function switchDesignStyle(styleName, notify = true) {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const validStyles = (THEME_STYLES[currentTheme] || THEME_STYLES.dark).map(s => s.id);
  const styleToApply = validStyles.includes(styleName) ? styleName : (validStyles[0] || 'linear');

  document.documentElement.setAttribute('data-style', styleToApply);
  
  try {
    localStorage.setItem('dualclip_visual_style', styleToApply);
    if (currentTheme === 'light') {
      localStorage.setItem('dualclip_visual_style_light', styleToApply);
    } else {
      localStorage.setItem('dualclip_visual_style_dark', styleToApply);
    }
  } catch(e) {}

  renderVisualStylesUI(currentTheme, styleToApply);
  if (notify) notifySettingSaved('row_visual_style');
}


function applyCollectionsBarState() {
  const bar = document.getElementById('collectionsBar');
  const restoreBtn = document.getElementById('floatingRestoreBtn');
  if (bar) bar.classList.toggle('collapsed', isCollectionsBarHidden);
  if (restoreBtn) restoreBtn.classList.toggle('show', isCollectionsBarHidden);
}
window.applyCollectionsBarState = applyCollectionsBarState;

function toggleCollectionsBar() {
  isCollectionsBarHidden = !isCollectionsBarHidden;
  try {
    localStorage.setItem('dualclip_bottom_bar_hidden', isCollectionsBarHidden ? 'true' : 'false');
  } catch(e) {}
  applyCollectionsBarState();
}
window.toggleCollectionsBar = toggleCollectionsBar;

const scrollContainer = document.getElementById('collectionsScrollArea');
if (scrollContainer) {
  scrollContainer.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      scrollContainer.scrollLeft += e.deltaY;
    }
  }, { passive: false });
}

function changeAppSourceDisplay(val, notify = true, force = false) {
  if (window._appSourceLocked && !force && val !== 'icon_only') {
    // Defense-in-depth: ignore changes while Ultra-Dense is active
    return;
  }
  const allowed = ['both', 'icon_only', 'name_only', 'hidden'];
  const mode = allowed.includes(val) ? val : 'both';
  try { localStorage.setItem('dualclip_app_source_display', mode); } catch(e) {}
  document.documentElement.setAttribute('data-app-source-display', mode);
  const sel = document.getElementById('stAppSourceDisplaySelect');
  if (sel && sel.value !== mode) sel.value = mode;
  if (notify && typeof notifySettingSaved === 'function') notifySettingSaved('row_app_source_display');
  syncUnifiedClipDetailsSelect();
}

// Unified Clip Details dropdown (single UI over the two internal axes:
// data-clip-details + data-app-source-display). Internal keys are unchanged.
function resolveUnifiedClipDetails() {
  let d = '';
  let s = '';
  try {
    d = document.documentElement.getAttribute('data-clip-details') || localStorage.getItem('dualclip_clip_details') || 'hidden';
    s = document.documentElement.getAttribute('data-app-source-display') || localStorage.getItem('dualclip_app_source_display') || 'both';
  } catch (e) {
    d = 'hidden'; s = 'both';
  }
  if (d === 'hidden' || d === 'none') return 'hidden';
  if (d === 'time-only') return 'time_only';
  if (d === 'icon-only') return 'icon_only';
  if (s === 'icon_only') return 'icon_time';
  if (s === 'name_only') return 'name_time';
  return 'default';
}
function syncUnifiedClipDetailsSelect() {
  try {
    const sel = document.getElementById('stClipDetailsSelect');
    const mode = resolveUnifiedClipDetails();
    if (sel && sel.value !== mode) sel.value = mode;
  } catch (e) {}
}
function changeUnifiedClipDetails(mode) {
  const map = {
    default:   { details: 'app-time', source: 'both' },
    icon_time: { details: 'app-time', source: 'icon_only' },
    name_time: { details: 'app-time', source: 'name_only' },
    icon_only: { details: 'icon-only', source: 'icon_only' },
    time_only: { details: 'time-only', source: null },
    hidden:    { details: 'hidden', source: null }
  };
  const m = map[mode] || map.default;
  if (typeof changeClipDetailsSetting === 'function') {
    try { changeClipDetailsSetting(m.details, false); } catch (e) {}
  }
  try { localStorage.setItem('dualclip_standard_clip_details', m.details); } catch (e) {}
  if (m.source && typeof changeAppSourceDisplay === 'function') {
    try { changeAppSourceDisplay(m.source, false, true); } catch (e) {}
  }
  syncUnifiedClipDetailsSelect();
  if (typeof notifySettingSaved === 'function') notifySettingSaved('row_clip_details');
}

// Explicit window exports for global inline event handlers and modules
window.THEME_STYLES = THEME_STYLES;
window.renderVisualStylesUI = renderVisualStylesUI;
window.applyResolvedTheme = applyResolvedTheme;
window.switchThemeMode = switchThemeMode;
window.switchDesignStyle = switchDesignStyle;
window.changeZoomSetting = changeZoomSetting;
window.setThumbSize = setThumbSize;
window.changeImageDisplayMode = changeImageDisplayMode;
window.changeSectionClickMode = changeSectionClickMode;
window.changeAppSourceDisplay = changeAppSourceDisplay;
window.resolveUnifiedClipDetails = resolveUnifiedClipDetails;
window.syncUnifiedClipDetailsSelect = syncUnifiedClipDetailsSelect;
window.changeUnifiedClipDetails = changeUnifiedClipDetails;
window.applyWindowSizePreset = applyWindowSizePreset;
window.switchDensityPreview = switchDensityPreview;
window.toggleZebraSetting = toggleZebraSetting;
window.applyCollectionsBarState = applyCollectionsBarState;
window.toggleCollectionsBar = toggleCollectionsBar;
