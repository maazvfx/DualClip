// Quick View Menu — dynamic config + renderer (pure vanilla JS) — 1:1 prototype parity
const QUICK_VIEW_MENU_CONFIG = [
  {
    section: 'Layout & Preset',
    items: [
      {
        label: 'Layout Preset',
        id: 'qvLayoutPreset',
        storageKey: 'dualclip_layout_preset',
        defaultValue: 'standard',
        onChange: 'changeQuickViewLayoutPreset',
        options: [
          { value: 'standard', label: 'Standard (Default)' },
          { value: 'compact', label: 'Compact' }
        ]
      },
      {
        label: 'Main Window Size',
        id: 'qvWindowSize',
        storageKey: 'dualclip_size_preset',
        defaultValue: 'default',
        onChange: 'applyQuickViewWindowSize',
        options: [
          { value: 'compact', label: 'Compact' },
          { value: 'default', label: 'Default' }
        ]
      }
    ]
  },
  {
    section: 'Style & Appearance',
    items: [
      {
        label: 'Visual Style',
        id: 'qvVisualStyle',
        storageKey: 'dualclip_visual_style',
        defaultValue: 'linear',
        onChange: 'switchDesignStyle',
        options: [
          { value: 'linear', label: 'Default' },
          { value: 'notion', label: 'Notion' },
          { value: 'nord', label: 'Nord' },
          { value: 'geist', label: 'True Black' },
          { value: 'raycast', label: 'Glass' }
        ]
      },
      {
        label: 'Text Power',
        id: 'qvTextPower',
        storageKey: 'dualclip_text_power',
        defaultValue: 'full',
        onChange: 'changeQuickViewTextPower',
        options: [
          { value: 'full', label: 'Full (Default)' },
          { value: 'soft', label: 'Soft' },
          { value: 'dim', label: 'Dim' }
        ]
      },
      {
        label: 'Interface Zoom',
        id: 'qvZoom',
        storageKey: 'dualclip_zoom',
        defaultValue: 'default',
        onChange: 'changeQuickViewZoom',
        options: [
          { value: 'default', label: 'Default' },
          { value: 'large', label: 'Large' },
          { value: 'extra-large', label: 'Extra Large' }
        ]
      }
    ]
  },
  {
    section: 'Item Display & Meta',
    items: [
      {
        label: 'Clip Details',
        id: 'qvClipDetails',
        storageKey: 'dualclip_clip_details',
        defaultValue: 'auto',
        onChange: 'changeClipDetailsSetting',
        options: [
          { value: 'auto', label: 'Auto (Default)' },
          { value: 'time-only', label: 'Time Only' },
          { value: 'icon-only', label: 'Icon Only' },
          { value: 'hidden', label: 'Hidden' }
        ]
      },
      {
        label: 'Selection Style',
        id: 'qvSelectionStyle',
        storageKey: 'dualclip_selection_style',
        defaultValue: 'solid',
        onChange: 'changeSelectionStyleSetting',
        options: [
          { value: 'solid', label: 'Solid / Flat' },
          { value: 'border', label: 'Border & Depth' }
        ]
      }
    ]
  }
];

function changeClipDetailsSetting(value, isProgrammatic = false) {
  try { localStorage.setItem('dualclip_clip_details', value); } catch (e) {}
  try {
    const curPreset = localStorage.getItem('dualclip_layout_preset') || 'standard';
    if (curPreset !== 'compact' && !isProgrammatic) {
      localStorage.setItem('dualclip_standard_clip_details', value);
    }
  } catch (_) {}
  const curPreset = (document.documentElement.getAttribute('data-layout-preset') || localStorage.getItem('dualclip_layout_preset') || 'standard');
  const effectiveDetails = (value === 'auto')
    ? (curPreset === 'compact' ? 'hidden' : 'app-time')
    : value;
  document.documentElement.setAttribute('data-clip-details', effectiveDetails);
  // Persist through to settings.json so the saved file and the on-screen value can never
  // drift apart. It was previously written to the file by nothing and read by nothing,
  // which left the two sources of truth disagreeing after a factory reset.
  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_clip_details === 'function') {
      window.pywebview.api.set_clip_details(value);
    }
  } catch (e) {}
  const qvSel = document.getElementById('qvClipDetails');
  if (qvSel && qvSel.value !== value) qvSel.value = value;
  if (typeof syncUnifiedClipDetailsSelect === 'function') { try { syncUnifiedClipDetailsSelect(); } catch (e) {} }
  const rebuildFn = (typeof rebuildCustomSelect === 'function') ? rebuildCustomSelect : (typeof window.rebuildCustomSelect === 'function' ? window.rebuildCustomSelect : null);
  if (rebuildFn) {
    if (qvSel) rebuildFn(qvSel);
  }
  if (typeof renderList === 'function') { try { renderList(); } catch (e) {} }
  if (typeof notifySettingSaved === 'function') notifySettingSaved('qvClipDetails');
}
function changeQuickViewLayoutPreset(value, hydrateOnly = false, animate) {
  if (!value) return;
  if (animate === undefined) {
    try { animate = localStorage.getItem('dualclip_animate_mode_switch') === '1'; } catch (_) { animate = false; }
  }
  // Legacy Large value migrates to Standard (Large mode removed).
  let previousPreset = 'standard';
  try { previousPreset = localStorage.getItem('dualclip_layout_preset') || 'standard'; } catch (_) {}
  try { localStorage.setItem('dualclip_layout_preset', value); } catch (e) {}
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_layout_preset === 'function') {
    try { window.pywebview.api.set_layout_preset(value); } catch (_) {}
  }
  document.documentElement.setAttribute('data-layout-preset', value);
  // View mode affects History only — never body, so Settings stays untouched.
  const mv = document.getElementById('mainView');
  if (mv) { mv.classList.remove('layout-standard','layout-compact','layout-expanded'); mv.classList.add('layout-' + value); }
  const lc = document.getElementById('listContainer');
  if (lc) { lc.classList.remove('layout-standard','layout-compact','layout-expanded'); lc.classList.add('layout-' + value); }

  const stLayout = document.getElementById('stLayoutPresetSelect');
  if (stLayout && stLayout.value !== value) stLayout.value = value;
  const qvLayout = document.getElementById('qvLayoutPreset');
  if (qvLayout && qvLayout.value !== value) qvLayout.value = value;
  const rebuildFn = (typeof rebuildCustomSelect === 'function') ? rebuildCustomSelect : (typeof window.rebuildCustomSelect === 'function' ? window.rebuildCustomSelect : null);
  if (rebuildFn) {
    if (stLayout) rebuildFn(stLayout);
    if (qvLayout) rebuildFn(qvLayout);
  }

  if (hydrateOnly) {
    // When booting / hydrating UI from storage, do NOT re-run macro sub-overrides
    return;
  }

  // S8: Compact hides the sidebar panel in CSS. A stale 'sidebar' layout would
  // stay logically on and pop back when returning to Standard — reset it, the
  // same way applyViewMode('compact') does.
  if (value === 'compact') {
    try {
      const layout = (typeof getSidebarLayoutSetting === 'function')
        ? getSidebarLayoutSetting()
        : localStorage.getItem('dualclip_view_layout');
      if (layout === 'sidebar' && typeof applySidebarLayout === 'function') applySidebarLayout('standard');
    } catch (_) {}
  }

  // Macro bundle (prototype parity): one preset drives density + window + lines + meta + thumbs + zoom
  const bundles = {
    standard: { density: 'default', windowSize: 'default', lines: 'auto', meta: 'app-time', thumb: 'sm', zoom: '100' },
    compact: { density: 'dense', windowSize: 'compact', lines: '1', meta: 'hidden', thumb: 'sm', zoom: '100' }
  };
  const b = bundles[value] || bundles.standard;
  // Line density is decoupled from mode switching (TASK-002): the user's line
  // setting survives Compact/Standard switches.
  let savedLineSetting = 'auto';
  try { savedLineSetting = localStorage.getItem('dualclip_line_display') || 'auto'; } catch (_) {}
  try { if (typeof switchDensityPreview === 'function') switchDensityPreview(b.density); } catch (e) {}
  try { if (typeof changeLineDisplay === 'function') changeLineDisplay(savedLineSetting, true); } catch (e3) {}
  if (animate === true) {
    window._isModeMorphing = true;
    clearTimeout(window._modeMorphTimer);
    window._modeMorphTimer = setTimeout(function() {
      window._isModeMorphing = false;
      try { if (typeof renderList === 'function') renderList(); else if (typeof renderVirtualWindow === 'function') renderVirtualWindow(); } catch (e) {}
    }, 220);
  }
  try {
    if (typeof applyQuickViewWindowSize === 'function') applyQuickViewWindowSize(b.windowSize, animate === true);
    else if (typeof window.applyWindowSizePreset === 'function') window.applyWindowSizePreset(b.windowSize, animate === true);
  } catch (e2) {}
  // Clip details setting is decoupled from mode switching: preserve user's preferred detail setting.
  // Clip details: Compact is ALWAYS 'hidden' to ensure zero layout shift.
  // Standard mode restores the user's saved preference for standard mode.
  if (value === 'compact') {
    if (previousPreset !== 'compact') {
      let currentDetails = 'auto';
      try { currentDetails = localStorage.getItem('dualclip_clip_details') || 'auto'; } catch (_) {}
      try { localStorage.setItem('dualclip_standard_clip_details', currentDetails); } catch (_) {}
    }
    const current = localStorage.getItem('dualclip_clip_details') || 'auto';
    if (current === 'auto') {
      document.documentElement.setAttribute('data-clip-details', 'hidden');
      const qvSel = document.getElementById('qvClipDetails');
      if (qvSel && qvSel.value !== 'auto') qvSel.value = 'auto';
    } else {
      try { if (typeof changeClipDetailsSetting === 'function') changeClipDetailsSetting('hidden', true); } catch (e4) {}
    }
  } else {
    let savedStandardDetails = 'auto';
    try {
      savedStandardDetails = localStorage.getItem('dualclip_standard_clip_details')
        || localStorage.getItem('dualclip_clip_details')
        || 'auto';
    } catch (_) {}
    try { if (typeof changeClipDetailsSetting === 'function') changeClipDetailsSetting(savedStandardDetails, true); } catch (e4) {}
  }
  let savedThumbSetting = 'sm';
  try { savedThumbSetting = localStorage.getItem('dualclip_thumb_size') || 'sm'; } catch (_) {}
  try { if (typeof setThumbSize === 'function') setThumbSize(savedThumbSetting, false); } catch (e5) {}
  try { if (typeof changeZoomSetting === 'function') changeZoomSetting(b.zoom, false); } catch (e6) {}
  if (typeof syncQuickViewMenuValues === 'function') { try { syncQuickViewMenuValues(); } catch (e7) {} }
  if (animate !== true) {
    if (typeof renderList === 'function') { try { renderList(); } catch (e8) {} }
    if (typeof renderVirtualWindow === 'function') { try { renderVirtualWindow(); } catch (e9) {} }
  }
  if (typeof notifySettingSaved === 'function') {
    notifySettingSaved('qvLayoutPreset');
    notifySettingSaved('row_layout_preset');
  }
  if (typeof updateViewModeButton === 'function') {
    try { updateViewModeButton(typeof getEffectiveViewMode === 'function' ? getEffectiveViewMode() : null); } catch (e) {}
  }
}
function changeQuickViewZoom(value) {
  const zoomMap = { 'default': '100', 'large': '110', 'extra-large': '125', '100': '100', '110': '110', '125': '125' };
  const targetZoom = zoomMap[value] || '100';
  if (typeof changeZoomSetting === 'function') {
    changeZoomSetting(targetZoom);
  }
  const qvSel = document.getElementById('qvZoom');
  if (qvSel && qvSel.value !== value) qvSel.value = value;
  if (typeof notifySettingSaved === 'function') notifySettingSaved('qvZoom');
}
function changeSelectionStyleSetting(value) {
  const safeVal = value === 'border' ? 'border' : 'solid';
  try { localStorage.setItem('dualclip_selection_style', safeVal); } catch (e) {}
  document.documentElement.setAttribute('data-selection-style', safeVal);
  const qvSel = document.getElementById('qvSelectionStyle');
  if (qvSel && qvSel.value !== safeVal) qvSel.value = safeVal;
  if (typeof notifySettingSaved === 'function') notifySettingSaved('qvSelectionStyle');
}
function resetQuickViewSettings() {
  if (typeof restoreCurrentTabDefaults === 'function') {
    restoreCurrentTabDefaults('theme');
  } else {
    try { localStorage.setItem('dualclip_theme', 'dark'); } catch (e) {}
    try { localStorage.setItem('dualclip_visual_style', 'linear'); } catch (e) {}
    try { localStorage.setItem('dualclip_size_preset', 'default'); } catch (e) {}
    try { localStorage.setItem('dualclip_zoom', '100'); } catch (e) {}
    try { localStorage.setItem('dualclip_layout_preset', 'standard'); } catch (e) {}
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-layout-preset', 'standard');
    if (typeof applyWindowSizePreset === 'function') applyWindowSizePreset('default');
    if (typeof changeZoomSetting === 'function') changeZoomSetting('100');
  }
  if (typeof syncQuickViewMenuValues === 'function') syncQuickViewMenuValues();
  if (typeof showToast === 'function') showToast('Quick View settings reset');
}
function changeQuickViewTextPower(value) {
  try { localStorage.setItem('dualclip_text_power', value); } catch (e) {}
  document.documentElement.setAttribute('data-text-power', value);
  const stTextPower = document.getElementById('stTextPowerSelect');
  if (stTextPower && stTextPower.value !== value) stTextPower.value = value;
  const qvTextPower = document.getElementById('qvTextPower');
  if (qvTextPower && qvTextPower.value !== value) qvTextPower.value = value;
  if (typeof notifySettingSaved === 'function') {
    notifySettingSaved('qvTextPower');
    notifySettingSaved('row_text_power');
  }
}
function applyQuickViewWindowSize(value, animate = false) {
  const v = (typeof normalizeSizePreset === 'function') ? normalizeSizePreset(value) : value;
  if (typeof window.applyWindowSizePreset === 'function') window.applyWindowSizePreset(v, animate === true);
  else if (typeof applyWindowSizePreset === 'function') applyWindowSizePreset(v, animate === true);
}
function getQuickViewStoredValue(storageKey, defaultValue) {
  try { const v = localStorage.getItem(storageKey); return v !== null ? v : defaultValue; } catch (e) { return defaultValue; }
}
function normalizeSizePreset(value) {
  if (value === 'normal') return 'default';
  if (value === 'standard') return 'default';
  // Legacy Large values fall back to Default (Large mode removed).
  if (value === 'expanded' || value === 'large') return 'default';
  if (['compact','default'].includes(value)) return value;
  return 'default';
}
function toggleQuickViewTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  if (typeof switchThemeMode === 'function') {
    switchThemeMode(next, true);
  } else if (typeof applyResolvedTheme === 'function') {
    try { localStorage.setItem('dualclip_theme', next); } catch (e) {}
    applyResolvedTheme(next);
  } else {
    try { localStorage.setItem('dualclip_theme', next); } catch (e) {}
    document.documentElement.setAttribute('data-theme', next);
  }
  if (typeof syncQuickViewToggles === 'function') syncQuickViewToggles();
}

function syncQuickViewToggles() {
  try {
    // Actions toggle removed: card actions always visible
    if (document.body) document.body.classList.remove('hide-actions');
    let theme = 'dark';
    try { theme = localStorage.getItem('dualclip_theme') || document.documentElement.getAttribute('data-theme') || 'dark'; } catch (e) {}
    const setBtn = (id, label, active) => {
      const b = document.getElementById(id);
      if (!b) return;
      const s = b.querySelector('span');
      if (s) s.textContent = label;
      b.classList.toggle('active', !!active);
    };
    setBtn('qvTglTheme', 'Theme: ' + (theme === 'light' ? 'Light' : 'Dark'), theme === 'light');
  } catch (e) {}
}
function syncQuickViewMenuValues() {
  QUICK_VIEW_MENU_CONFIG.forEach((group) => {
    group.items.forEach((item) => {
      const el = document.getElementById(item.id);
      if (!el) return;
      let v = getQuickViewStoredValue(item.storageKey, item.defaultValue);
      if (item.id === 'qvWindowSize') v = normalizeSizePreset(v);
      if (item.id === 'qvZoom') {
        const preset = getQuickViewStoredValue('dualclip_zoom_preset','');
        if (preset) v = preset;
        else {
          const rev = { '85':'compact','100':'default','110':'large','125':'extra-large' };
          const curZoom = getQuickViewStoredValue('dualclip_zoom','100');
          if (rev[curZoom]) v = rev[curZoom];
        }
      }
      el.value = v;
    });
  });
  // Text Shade removed — default standard styling applies
  const clipDetails = getQuickViewStoredValue('dualclip_clip_details', 'auto');
  const curPreset = getQuickViewStoredValue('dualclip_layout_preset', 'standard');
  const effectiveDetails = (clipDetails === 'auto')
    ? (curPreset === 'compact' ? 'hidden' : 'app-time')
    : clipDetails;
  document.documentElement.setAttribute('data-clip-details', effectiveDetails);
  // settings.json and localStorage sync: Local UI state takes priority.
  // When the user has a saved local preference, push it into the backend to repair drift rather than stomping.
  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clip_details === 'function') {
      window.pywebview.api.get_clip_details().then(res => {
        const backend = (res && typeof res.details === 'string') ? res.details : null;
        if (!backend) return;
        let local = null;
        try { local = localStorage.getItem('dualclip_clip_details'); } catch (e) {}
        if (local != null && local !== backend) {
          if (typeof window.pywebview.api.set_clip_details === 'function') {
            window.pywebview.api.set_clip_details(local);
          }
          return;
        }
        if (local == null && backend !== clipDetails) {
          try { localStorage.setItem('dualclip_clip_details', backend); } catch (e) {}
          document.documentElement.setAttribute('data-clip-details', backend);
          if (typeof renderList === 'function') { try { renderList(); } catch (e) {} }
          if (typeof syncUnifiedClipDetailsSelect === 'function') { try { syncUnifiedClipDetailsSelect(); } catch (e) {} }
        }
      }).catch(() => {});
    }
  } catch (e) {}
  const selectionStyle = getQuickViewStoredValue('dualclip_selection_style', 'solid');
  document.documentElement.setAttribute('data-selection-style', selectionStyle === 'border' ? 'border' : 'solid');
  const layoutPreset = getQuickViewStoredValue('dualclip_layout_preset','standard');
  document.documentElement.setAttribute('data-layout-preset', layoutPreset);
  // View mode affects History only — never body, so Settings stays untouched.
  const mv2 = document.getElementById('mainView');
  if (mv2) { mv2.classList.remove('layout-standard','layout-compact','layout-expanded'); mv2.classList.add('layout-' + layoutPreset); }
  const lc2 = document.getElementById('listContainer');
  if (lc2) { lc2.classList.remove('layout-standard','layout-compact','layout-expanded'); lc2.classList.add('layout-' + layoutPreset); }
  const textPower = getQuickViewStoredValue('dualclip_text_power','full');
  document.documentElement.setAttribute('data-text-power', textPower);
  syncQuickViewToggles();

  // Sync to settings window controls if present
  try {
    const stLayout = document.getElementById('stLayoutPresetSelect');
    if (stLayout && stLayout.value !== layoutPreset) stLayout.value = layoutPreset;
    const qvLayout = document.getElementById('qvLayoutPreset');
    if (qvLayout && qvLayout.value !== layoutPreset) qvLayout.value = layoutPreset;

    const usedMarker = getQuickViewStoredValue('dualclip_used_marker', 'line-solid');
    const stMarker = document.getElementById('stUsedMarkerSelect');
    if (stMarker && stMarker.value !== usedMarker) stMarker.value = usedMarker;

    const lines = getQuickViewStoredValue('dualclip_line_display', 'auto');
    const stLines = document.getElementById('stLineDisplaySelect');
    if (stLines && stLines.value !== lines) stLines.value = lines;

    const size = getQuickViewStoredValue('dualclip_size_preset', 'default');
    const stSize = document.getElementById('stWindowSizePresetSelect');
    const normSize = size === 'normal' ? 'default' : size;
    if (stSize && stSize.value !== normSize) stSize.value = normSize;

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const style = getQuickViewStoredValue('dualclip_visual_style', 'linear');
    if (typeof renderVisualStylesUI === 'function') {
      renderVisualStylesUI(currentTheme, style);
    } else {
      const stStyle = document.getElementById('stStyleSelect');
      if (stStyle && stStyle.value !== style) stStyle.value = style;
    }

    const zoom = getQuickViewStoredValue('dualclip_zoom', '100');
    const stZoom = document.getElementById('stZoomSelect');
    if (stZoom && stZoom.value !== zoom) stZoom.value = zoom;

    const theme = getQuickViewStoredValue('dualclip_theme', 'dark');
    const stTheme = document.getElementById('stThemeModeSelect');
    if (stTheme && stTheme.value !== theme) stTheme.value = theme;

    const stTextPower = document.getElementById('stTextPowerSelect');
    if (stTextPower && stTextPower.value !== textPower) stTextPower.value = textPower;

    const zebra = getQuickViewStoredValue('dualclip_zebra_style', 'off');
    const stZebra = document.getElementById('stZebraToggle');
    if (stZebra) stZebra.classList.toggle('on', zebra !== 'off');
    document.documentElement.setAttribute('data-zebra', zebra);
    if (typeof syncUnifiedClipDetailsSelect === 'function') {
      try { syncUnifiedClipDetailsSelect(); } catch (_) {}
    }
  } catch (e) {}
}
(function initQuickViewMenu() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { syncQuickViewMenuValues(); });
  } else { syncQuickViewMenuValues(); }
  const origSync = window.syncSettingsUiFromStorage;
  window.syncSettingsUiFromStorage = function () { if (typeof origSync === 'function') { try { origSync(); } catch (e) {} } syncQuickViewMenuValues(); };
})();
window.QUICK_VIEW_MENU_CONFIG = QUICK_VIEW_MENU_CONFIG;
window.syncQuickViewMenuValues = syncQuickViewMenuValues;
window.syncQuickViewToggles = syncQuickViewToggles;
window.toggleQuickViewTheme = toggleQuickViewTheme;
window.changeClipDetailsSetting = changeClipDetailsSetting;
window.changeQuickViewLayoutPreset = changeQuickViewLayoutPreset;
window.changeQuickViewTextPower = changeQuickViewTextPower;
window.changeQuickViewZoom = changeQuickViewZoom;
window.applyQuickViewWindowSize = applyQuickViewWindowSize;
