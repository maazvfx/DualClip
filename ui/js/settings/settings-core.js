// DualClip JS Module: settings-core.js
// Auto-split from settings.js - complete functions, no mid-function cuts

// --- DualClip Settings Views, Preferences & Hotkey Recording ---

// Immediate theme & zoom bootstrap to eliminate flash
(function bootstrapThemeAndZoom() {
  try {
    const saved = localStorage.getItem('dualclip_theme') || 'dark';
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      // Only dark/light are supported; legacy 'system' values fall back to dark.
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    const savedZoom = localStorage.getItem('dualclip_zoom') || '100';
    // Zoom applies to the History panel only; Settings stays locked to Large.
    const zoomHostEl = document.getElementById('mainView') || document.body;
    if (zoomHostEl) {
      zoomHostEl.classList.remove('zoomed-90', 'zoomed-110', 'zoomed-125');
      if (savedZoom === '90' || savedZoom === '85') zoomHostEl.classList.add('zoomed-90');
      else if (savedZoom === '110') zoomHostEl.classList.add('zoomed-110');
      else if (savedZoom === '125') zoomHostEl.classList.add('zoomed-125');
    }

    let savedMarker = localStorage.getItem('dualclip_used_marker') || 'line';
    if (savedMarker === 'check' || savedMarker === 'pill' || savedMarker === 'dot' || savedMarker === 'dim') { savedMarker = 'line-solid'; try { localStorage.setItem('dualclip_used_marker', savedMarker); } catch(e2) {} }
    document.documentElement.setAttribute('data-used-marker', savedMarker);

    const savedDetails = localStorage.getItem('dualclip_clip_details') || 'hidden';
    document.documentElement.setAttribute('data-clip-details', savedDetails);

    const savedOutlined = localStorage.getItem('dualclip_selection_outline') === '1';
    if (savedOutlined) {
      document.documentElement.classList.add('selection-outlined');
    }

    const savedSoftenTint = localStorage.getItem('dualclip_soften_tint') === '1';
    if (savedSoftenTint) {
      document.documentElement.classList.add('soften-tint');
    }

    const savedHoverHighlight = localStorage.getItem('dualclip_row_hover_highlight') === '1';
    if (savedHoverHighlight) {
      document.documentElement.classList.add('row-hover-highlight');
    }

    if (localStorage.getItem('dualclip_hide_window_border') === '1') {
      document.documentElement.setAttribute('data-window-border', 'hidden');
    }

    const savedLabelStyle = localStorage.getItem('dualclip_label_style') || 'pill';
    document.documentElement.setAttribute('data-label-style', savedLabelStyle);
  } catch (e) {}
})();

function syncSettingsUiFromStorage() {
  try {
    const savedTheme = localStorage.getItem('dualclip_theme') || 'dark';
    if (typeof switchThemeMode === 'function') {
      switchThemeMode(savedTheme, false);
    }

    const savedZoom = localStorage.getItem('dualclip_zoom') || '100';
    if (typeof changeZoomSetting === 'function') {
      changeZoomSetting(savedZoom, false);
    }

    let savedMarker2 = localStorage.getItem('dualclip_used_marker') || 'line';
    if (savedMarker2 === 'check' || savedMarker2 === 'pill' || savedMarker2 === 'dot' || savedMarker2 === 'dim') { savedMarker2 = 'line-solid'; try { localStorage.setItem('dualclip_used_marker', savedMarker2); } catch(e2) {} }
    document.documentElement.setAttribute('data-used-marker', savedMarker2);
    const markerSel = document.getElementById('stUsedMarkerSelect');
    if (markerSel) markerSel.value = savedMarker2;

    const savedClipDetails = localStorage.getItem('dualclip_clip_details') || 'hidden';
    document.documentElement.setAttribute('data-clip-details', savedClipDetails);

    const savedAppSource = localStorage.getItem('dualclip_app_source_display') || 'both';
    document.documentElement.setAttribute('data-app-source-display', savedAppSource);
    if (typeof syncUnifiedClipDetailsSelect === 'function') { try { syncUnifiedClipDetailsSelect(); } catch (e) {} }

    const savedLabelStyle = localStorage.getItem('dualclip_label_style') || 'pill';
    document.documentElement.setAttribute('data-label-style', savedLabelStyle);
    const labelStyleSel = document.getElementById('stLabelStyleSelect');
    if (labelStyleSel) {
      labelStyleSel.value = savedLabelStyle;
      const wrap = labelStyleSel.closest('.custom-select-wrap');
      if (wrap) {
        const selectedOpt = labelStyleSel.options[labelStyleSel.selectedIndex];
        const label = wrap.querySelector('.custom-select-label');
        if (label && selectedOpt) label.textContent = selectedOpt.textContent;
        wrap.querySelectorAll('.opt-item').forEach(i => {
          i.classList.toggle('selected', i.dataset.val === savedLabelStyle);
        });
      }
    }
    document.body.classList.toggle('label-style-plain', savedLabelStyle === 'plain');

    const showCountBadge = localStorage.getItem('dualclip_show_use_count_badge') === 'true';
    const countBadgeTgl = document.getElementById('stShowUseCountBadgeToggle');
    if (countBadgeTgl) countBadgeTgl.classList.toggle('on', showCountBadge);

    const savedOutlined = localStorage.getItem('dualclip_selection_outline') === '1';
    if (typeof applyOutlineSelectionSetting === 'function') {
      applyOutlineSelectionSetting(savedOutlined, false);
    }
    const savedSoftenTint = localStorage.getItem('dualclip_soften_tint') === '1';
    if (typeof applySoftenTintSetting === 'function') {
      applySoftenTintSetting(savedSoftenTint, false);
    }
    const savedHoverHighlight = localStorage.getItem('dualclip_row_hover_highlight') === '1';
    if (typeof applyHoverHighlightSetting === 'function') {
      applyHoverHighlightSetting(savedHoverHighlight, false);
    }
    const savedHideBorder = localStorage.getItem('dualclip_hide_window_border') === '1';
    if (typeof applyHideWindowBorderSetting === 'function') {
      applyHideWindowBorderSetting(savedHideBorder, false);
    }

    const livePreviewEnabled = localStorage.getItem('dualclip_live_preview_enabled') === '1';
    const livePreviewTgl = document.getElementById('stLivePreviewToggle');
    if (livePreviewTgl) livePreviewTgl.classList.toggle('on', livePreviewEnabled);
    const livePreviewPanel = document.getElementById('livePreviewPanel');
    if (livePreviewPanel) livePreviewPanel.style.display = livePreviewEnabled ? 'flex' : 'none';

    let savedPreset = localStorage.getItem('dualclip_size_preset') || 'default';
    if (savedPreset === 'normal') savedPreset = 'default';
    // Migrate removed sizes (tall/wide/ultrawide/large) to default
    if (['tall', 'wide', 'ultrawide', 'large'].includes(savedPreset)) {
      savedPreset = 'default';
      try { localStorage.setItem('dualclip_size_preset', 'default'); } catch(e) {}
    }
    const presetSel = document.getElementById('stWindowSizePresetSelect');
    if (presetSel) presetSel.value = savedPreset;

    let savedPosition = localStorage.getItem('dualclip_window_position') || 'near';
    // Migrate legacy center_cursor and other removed values to near
    if (['center_cursor','cursor_center','centercursor','cursorcenter','centered_on_cursor','centeredoncursor','mouse','caret'].includes(savedPosition)) {
      savedPosition = 'near';
      try { localStorage.setItem('dualclip_window_position', 'near'); } catch(e) {}
    }
    // Migrate removed screen-fixed modes (top_left, top_center) to near
    if (['top_left','topleft','top-left','top left','top_center','topcenter','top-center','top middle'].includes(savedPosition)) {
      savedPosition = 'near';
      try { localStorage.setItem('dualclip_window_position', 'near'); } catch(e) {}
    }
    if (!['last','center','near','near_above'].includes(savedPosition)) {
      savedPosition = 'near';
      try { localStorage.setItem('dualclip_window_position', 'near'); } catch(e) {}
    }
    const posSel = document.getElementById('stWindowPositionSelect');
    if (posSel) {
      posSel.value = savedPosition;
      if (!posSel.value || posSel.selectedIndex === -1) {
        posSel.value = 'near';
        try { localStorage.setItem('dualclip_window_position', 'near'); } catch(e) {}
        savedPosition = 'near';
      }
    }

    let savedTrayPos = localStorage.getItem('dualclip_tray_position') || 'center';
    if (!['center', 'near', 'last', 'top_left', 'topleft'].includes(savedTrayPos)) {
      savedTrayPos = 'center';
      try { localStorage.setItem('dualclip_tray_position', 'center'); } catch(e) {}
    }
    const trayPosSel = document.getElementById('stTrayPositionSelect');
    if (trayPosSel) {
      trayPosSel.value = savedTrayPos;
      if (!trayPosSel.value || trayPosSel.selectedIndex === -1) {
        trayPosSel.value = 'center';
        try { localStorage.setItem('dualclip_tray_position', 'center'); } catch(e) {}
        savedTrayPos = 'center';
      }
    }

    const rememberSize = localStorage.getItem('dualclip_remember_window_size') === '1';
    const rsTgl = document.getElementById('stRememberWindowSizeToggle') || document.getElementById('stRememberSizeToggle');
    if (rsTgl) rsTgl.classList.toggle('on', rememberSize);
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_remember_window_size === 'function') {
      window.pywebview.api.get_remember_window_size().then(res => {
        if (res && typeof res.remember === 'boolean') {
          try { localStorage.setItem('dualclip_remember_window_size', res.remember ? '1' : '0'); } catch(e) {}
          const tgl = document.getElementById('stRememberWindowSizeToggle') || document.getElementById('stRememberSizeToggle');
          if (tgl) tgl.classList.toggle('on', res.remember);
        }
      }).catch(() => {});
    }

    const rememberCollection = localStorage.getItem('dualclip_remember_collection') !== '0';
    const rcTgl = document.getElementById('stRememberCollectionToggle');
    if (rcTgl) rcTgl.classList.toggle('on', rememberCollection);

    const rememberSelectedClip = localStorage.getItem('dualclip_remember_selected_clip') !== '0';
    const rscTgl = document.getElementById('stRememberSelectedClipToggle');
    if (rscTgl) rscTgl.classList.toggle('on', rememberSelectedClip);

    const showTaskbar = localStorage.getItem('dualclip_show_taskbar') === '1';
    const taskbarTgl = document.getElementById('stShowTaskbarToggle');
    if (taskbarTgl) taskbarTgl.classList.toggle('on', showTaskbar);

    const autostart = localStorage.getItem('dualclip_autostart') === '1';
    const autostartTgl = document.getElementById('stAutostartToggle');
    if (autostartTgl) autostartTgl.classList.toggle('on', autostart);

    // Opt-in only: fresh installs (no stored value) resolve via getSetting() to
    // the SSOT default (false) and stay offline. Never treat "absent" as ON.
    const autoCheckUpdates = (typeof getSetting === 'function')
      ? getSetting('dualclip_auto_check_updates') === true
      : localStorage.getItem('dualclip_auto_check_updates') === '1';
    const autoCheckTgl = document.getElementById('aboutAutoToggle');
    if (autoCheckTgl) autoCheckTgl.classList.toggle('on', autoCheckUpdates);
    if (autoCheckUpdates) {
      try { setTimeout(() => { if (typeof runAutoUpdateBackgroundCheck === 'function') runAutoUpdateBackgroundCheck(); }, 2500); } catch(e) {}
    }

    // Single source of truth: keep toggle + red dot atomically in sync via updatePauseStateUI (fixes mismatch where toggle off but dot on)
    if (typeof updatePauseStateUI === 'function' && typeof isCapturePaused !== 'undefined') {
      updatePauseStateUI(!!isCapturePaused);
    } else {
      const incognitoActive = typeof isCapturePaused !== 'undefined' ? isCapturePaused : false;
      const incognitoTgl = document.getElementById('stIncognitoToggle');
      if (incognitoTgl) incognitoTgl.classList.toggle('on', !!incognitoActive);
      const badge = document.getElementById('pausedIndicator');
      if (badge) badge.style.display = incognitoActive ? 'inline-block' : 'none';
    }
    // Hydrate authoritative state from backend
    if (typeof syncPauseStateFromBackend === 'function') { try { syncPauseStateFromBackend(); } catch(e) {} }

    const savedStartHidden = localStorage.getItem('dualclip_start_hidden');
    const startHidden = savedStartHidden === null ? false : savedStartHidden === '1';
    const startHiddenTgl = document.getElementById('stStartHiddenToggle');
    if (startHiddenTgl) startHiddenTgl.classList.toggle('on', startHidden);

    const rememberView = localStorage.getItem('dualclip_remember_view') === '1';
    const rvTgl = document.getElementById('stRememberViewToggle');
    if (rvTgl) rvTgl.classList.toggle('on', rememberView);

    const savedMinLen = Math.max(1, Math.min(50, parseInt(localStorage.getItem('dualclip_min_clip_length') || '1', 10) || 1));
    const minLenInput = document.getElementById('stMinClipLength');
    if (minLenInput) minLenInput.value = savedMinLen;
    updatePresetChips(savedMinLen);

    const ignoreWs = localStorage.getItem('dualclip_ignore_whitespace') !== '0';
    const wsTgl = document.getElementById('stIgnoreWhitespaceToggle');
    if (wsTgl) wsTgl.classList.toggle('on', ignoreWs);
    syncCaptureFiltersToBackend(savedMinLen, ignoreWs);

    const smartShortcuts = localStorage.getItem('dualclip_smart_shortcuts') !== '0';
    const smartTgl = document.getElementById('stSmartShortcutsToggle');
    if (smartTgl) smartTgl.classList.toggle('on', smartShortcuts);
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_smart_shortcuts === 'function') {
      window.pywebview.api.set_smart_shortcuts(smartShortcuts);
    }

    const quickNumberPaste = localStorage.getItem('dualclip_quick_number_paste') === '1';
    if (typeof applyQuickNumberPasteSetting === 'function') {
      applyQuickNumberPasteSetting(quickNumberPaste, false);
    }

    // Plain Copy permanently enabled (toggle removed)
    try { localStorage.setItem('dualclip_plain_copy_shortcut_enabled', '1'); } catch(e) {}
    const plainCopy = true;

    const savedMaxClips = localStorage.getItem('dualclip_max_clips') || '500';
    const maxClipsSel = document.getElementById('stMaxClipsSelect');
    if (maxClipsSel) maxClipsSel.value = savedMaxClips;
    // Re-apply the persisted cap to the backend on boot, mirroring every other
    // capture setting. 'unlimited' maps to 0 (no cap); without this push the
    // backend would silently revert to its last persisted value on restart.
    {
      const maxClipsVal = savedMaxClips === 'unlimited' ? 0 : (parseInt(savedMaxClips, 10) || 500);
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_max_clips === 'function') {
        window.pywebview.api.set_max_clips(maxClipsVal).catch(() => {});
      }
    }

    const ignorePasswords = localStorage.getItem('dualclip_ignore_passwords') !== '0';
    const pwTgl = document.getElementById('stIgnorePasswordsToggle');
    if (pwTgl) pwTgl.classList.toggle('on', ignorePasswords);
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_ignore_passwords === 'function') {
      window.pywebview.api.set_ignore_passwords(ignorePasswords).catch(() => {});
    }

    const captureImagesVal = localStorage.getItem('dualclip_capture_images') !== '0';
    const imgTgl = document.getElementById('stCaptureImagesToggle');
    if (imgTgl) imgTgl.classList.toggle('on', captureImagesVal);
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_capture_images === 'function') {
      window.pywebview.api.set_capture_images(captureImagesVal).catch(() => {});
    }

    const fsGuardOn = (() => { try { return localStorage.getItem('dualclip_suppress_in_fullscreen') === '1'; } catch(e) { return false; } })();
    const fsGuardTgl = document.getElementById('stFullscreenGuardToggle');
    if (fsGuardTgl) fsGuardTgl.classList.toggle('on', fsGuardOn);
    try {
      if (window.DC && window.DC.bridge && typeof window.DC.bridge.set_suppress_in_fullscreen === 'function') {
        window.DC.bridge.set_suppress_in_fullscreen(fsGuardOn).catch(() => {});
      } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_suppress_in_fullscreen === 'function') {
        window.pywebview.api.set_suppress_in_fullscreen(fsGuardOn).catch(() => {});
      }
    } catch (_) {}

    // Also show in All Items removed: auto-routed clips stay in assigned collection (mirror disabled)
    try { localStorage.setItem('dualclip_mirror_in_all', '0'); } catch(e) {}

    const savedZebra = localStorage.getItem('dualclip_zebra_style') || 'off';
    document.documentElement.setAttribute('data-zebra', savedZebra);
    try { changeZebraStyle(savedZebra, false); } catch(e2) {}

    let savedLine = localStorage.getItem('dualclip_line_display') || 'auto';
    if (savedLine === 'full' || !['1', '2', '3', 'auto'].includes(savedLine)) {
      savedLine = 'auto';
      try { localStorage.setItem('dualclip_line_display', 'auto'); } catch(e) {}
    }
    changeLineDisplay(savedLine, false);

    const savedGrouping = localStorage.getItem('dualclip_grouping_mode') || 'time';
    changeGroupingMode(savedGrouping, false);

    const autofocusTgl = document.getElementById('stAutofocusSearchToggle');
    if (autofocusTgl) {
      let afOn = false;
      try { afOn = localStorage.getItem('dualclip_autofocus_search') === '1'; } catch(e) {}
      autofocusTgl.classList.toggle('on', afOn);
    }

    const savedSectionClick = localStorage.getItem('dualclip_section_click_mode') || 'chevron_only';
    changeSectionClickMode(savedSectionClick, false);

    const savedImageDisplay = localStorage.getItem('dualclip_image_display_mode') || 'thumbnail_only';
    changeImageDisplayMode(savedImageDisplay, false);

    let savedThumbSize = localStorage.getItem('dualclip_thumb_size');
    if (!savedThumbSize && window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_thumb_size === 'function') {
      window.pywebview.api.get_thumb_size().then(res => {
        if (res && res.size) setThumbSize(res.size, false);
      }).catch(() => {});
    } else {
      setThumbSize(savedThumbSize || 'sm', false);
    }

    const savedTextPower = localStorage.getItem('dualclip_text_power') || 'full';
    if (typeof changeQuickViewTextPower === 'function') {
      try { changeQuickViewTextPower(savedTextPower); } catch(e) {}
      const tpSel = document.getElementById('stTextPowerSelect');
      if (tpSel) tpSel.value = savedTextPower;
    } else {
      document.documentElement.setAttribute('data-text-power', savedTextPower);
      const tpSel2 = document.getElementById('stTextPowerSelect');
      if (tpSel2) tpSel2.value = savedTextPower;
    }

    // Backward compatibility: legacy stored 'dense' preview -> 'compact' layout preset
    if (localStorage.getItem('dualclip_density_preview') === 'dense' && !localStorage.getItem('dualclip_layout_preset')) {
      try { localStorage.setItem('dualclip_layout_preset', 'compact'); } catch (e) {}
    }
    const savedLayout = localStorage.getItem('dualclip_layout_preset') || 'standard';
    if (typeof changeQuickViewLayoutPreset === 'function') {
      try { changeQuickViewLayoutPreset(savedLayout, true); } catch (e) {}
    } else {
      const savedDensity = localStorage.getItem('dualclip_density_preview') || 'default';
      if (typeof switchDensityPreview === 'function') switchDensityPreview(savedDensity);
    }
    // Cold-start compact: hydrateOnly skips the macro bundle, so re-apply the
    // size + density + bar pieces boot skipped (lines/meta hydrate separately).
    // Skip the resize when RememberWindowSize is ON — C# restores the stored size.
    if (savedLayout === 'compact') {
      try { if (typeof switchDensityPreview === 'function') switchDensityPreview('dense'); } catch (e) {}
      try {
        const hasCustomCompact = localStorage.getItem('dualclip_compact_width');
        if (!hasCustomCompact) {
          if (typeof applyWindowSizePreset === 'function') applyWindowSizePreset('compact');
          else if (typeof window.applyWindowSizePreset === 'function') window.applyWindowSizePreset('compact');
        }
      } catch (e2) {}
      try {
        if (typeof isCollectionsBarHidden !== 'undefined' && !isCollectionsBarHidden && typeof toggleCollectionsBar === 'function') toggleCollectionsBar();
      } catch (e3) {}
      if (typeof renderList === 'function') { try { renderList(); } catch (e4) {} }
      if (typeof renderVirtualWindow === 'function') { try { renderVirtualWindow(); } catch (e5) {} }
    }

    const savedPillStyle = localStorage.getItem('dualclip_pill_style') || 'default';
    if (typeof changePillStyleSetting === 'function') {
      changePillStyleSetting(savedPillStyle, false);
    }

    const savedDragOut = localStorage.getItem('dualclip_drag_out_mode') || 'file';
    changeDragOutMode(savedDragOut, false);

    populateAutoSortCollectionSelect();
    renderAutoSortRulesTable();
    syncAutoSortRulesToBackend();

    const toastsEnabled = localStorage.getItem('dualclip_toasts_enabled') !== '0';
    const toastsTgl = document.getElementById('stToastsToggle');
    if (toastsTgl) toastsTgl.classList.toggle('on', toastsEnabled);

    const recentSearchEnabled = (() => { try { return localStorage.getItem('dualclip_recent_search_enabled') === '1'; } catch(e) { return false; } })();
    const recentSearchTgl = document.getElementById('stRecentSearchToggle');
    if (recentSearchTgl) recentSearchTgl.classList.toggle('on', recentSearchEnabled);

    const ignoreBlocklist = localStorage.getItem('dualclip_ignore_blocklist') !== '0';
    isBlocklistEnabled = ignoreBlocklist;
    const blocklistTgl = document.getElementById('stIgnoreBlocklistToggle');
    if (blocklistTgl) blocklistTgl.classList.toggle('on', ignoreBlocklist);
    renderBlockedAppsList();
    syncBlocklistToBackend();

    const trackStatsEnabled = localStorage.getItem('dualclip_track_stats') !== '0';
    const trackStatsTgl = document.getElementById('stTrackStatsToggle');
    if (trackStatsTgl) trackStatsTgl.classList.toggle('on', trackStatsEnabled);
    const statsTabTgl = document.getElementById('stStatsTabToggle');
    if (statsTabTgl) statsTabTgl.classList.toggle('on', trackStatsEnabled);
    updateStatsTabVisibility(trackStatsEnabled);
    syncTrackStatsToBackend(trackStatsEnabled);

    const restoreClipboard = localStorage.getItem('dualclip_restore_clipboard') === '1';
    const restoreTgl = document.getElementById('stRestoreClipboardToggle');
    if (restoreTgl) restoreTgl.classList.toggle('on', restoreClipboard);
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_restore_clipboard === 'function') {
      window.pywebview.api.set_restore_clipboard(restoreClipboard);
    }

    const preventScreenCapture = localStorage.getItem('dualclip_prevent_screen_capture') === '1';
    const pscTgl = document.getElementById('stPreventScreenCaptureToggle');
    if (pscTgl) pscTgl.classList.toggle('on', preventScreenCapture);
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_prevent_screen_capture === 'function') {
      window.pywebview.api.get_prevent_screen_capture().then(res => {
        if (res && typeof res.enabled === 'boolean') {
          try { localStorage.setItem('dualclip_prevent_screen_capture', res.enabled ? '1' : '0'); } catch(e) {}
          const tgl = document.getElementById('stPreventScreenCaptureToggle');
          if (tgl) tgl.classList.toggle('on', res.enabled);
        }
      }).catch(() => {});
    }

    // Auto-Expire dropdown: sync UI state + push/hydrate from backend
    const savedAutoExpire = localStorage.getItem('dualclip_auto_expire_days') || '0';
    const autoExpireSel = document.getElementById('stAutoExpireSelect');
    if (autoExpireSel) autoExpireSel.value = savedAutoExpire;
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_auto_expire_days === 'function') {
      window.pywebview.api.get_auto_expire_days().then(res => {
        if (res && typeof res.days === 'number') {
          try { localStorage.setItem('dualclip_auto_expire_days', String(res.days)); } catch {}
          const sel = document.getElementById('stAutoExpireSelect');
          if (sel) sel.value = String(res.days);
        }
      }).catch(() => {});
    }

    // Hydrate selection highlight mode
    try {
      if (typeof applySelectionHighlightMode === 'function' && typeof getSelectionHighlightMode === 'function') {
        applySelectionHighlightMode(getSelectionHighlightMode(), false);
      }
    } catch(e) {}

    // Ensure Win+V warning reflects persisted hotkey even before Window & Keys tab is opened
    try { if (typeof syncHotkeyDisplay === 'function') syncHotkeyDisplay(); } catch(e) {}
    try { if (typeof syncAllCustomSelects === 'function') syncAllCustomSelects(); } catch(e) {}
  } catch(e) {}
}

/* ==========================================================================
   CUSTOM POPOVER DROPDOWNS CONTROLLER
   ========================================================================== */

function initCustomSelect(wrap) {
  if (!wrap || wrap.dataset.customSelectInit === 'true') return;
  wrap.dataset.customSelectInit = 'true';

  const btn = wrap.querySelector('.custom-select-btn');
  const menu = wrap.querySelector('.custom-dropdown-menu');
  const label = wrap.querySelector('.custom-select-label');
  const select = wrap.querySelector('select');

  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('open');
    closeAllCustomSelects(menu);
    if (isOpen) {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    } else {
      wrap.classList.remove('drop-up');
      menu.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');

      // Auto-scroll container smoothly if opened dropdown extends below visible area
      requestAnimationFrame(() => {
        try {
          const menuRect = menu.getBoundingClientRect();
          const scrollParent = wrap.closest('.settings-content') || wrap.closest('#settingsView') || document.documentElement;
          const parentRect = scrollParent.getBoundingClientRect ? scrollParent.getBoundingClientRect() : { bottom: window.innerHeight, top: 0 };
          const overflowBelow = menuRect.bottom - (parentRect.bottom || window.innerHeight);
          if (overflowBelow > 0 && typeof scrollParent.scrollBy === 'function') {
            scrollParent.scrollBy({
              top: overflowBelow + 24,
              behavior: 'smooth'
            });
          }
        } catch (err) {}
      });
    }
  });

  const items = menu.querySelectorAll('.opt-item');
  items.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = item.dataset.val;
      items.forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      if (label) {
        label.textContent = item.textContent.trim();
      }
      if (select) {
        select.value = val;
        if (typeof select.onchange === 'function') {
          select.onchange();
        } else {
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
  });
}

function closeAllCustomSelects(exceptMenu = null) {
  document.querySelectorAll('.custom-dropdown-menu.open').forEach(menu => {
    if (menu !== exceptMenu) {
      menu.classList.remove('open');
      const wrap = menu.closest('.custom-select-wrap');
      if (wrap) {
        const btn = wrap.querySelector('.custom-select-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    }
  });
}

function syncCustomDropdown(wrapId, val) {
  if (!wrapId || val === undefined || val === null) return;
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const label = wrap.querySelector('.custom-select-label');
  const opt = wrap.querySelector(`.opt-item[data-val="${val}"]`);
  if (label && opt) label.textContent = opt.textContent.trim();
  wrap.querySelectorAll('.opt-item').forEach(item => {
    item.classList.toggle('selected', item.getAttribute('data-val') === String(val));
  });
  const sel = wrap.querySelector('select');
  if (sel) sel.value = val;
}

function syncAllCustomSelects(root = document) {
  root.querySelectorAll('.custom-select-wrap').forEach(wrap => {
    const sel = wrap.querySelector('select');
    if (!sel) return;
    const selectedOpt = sel.options[sel.selectedIndex] || sel.querySelector(`option[value="${sel.value}"]`) || sel.options[0];
    const label = wrap.querySelector('.custom-select-label');
    if (label && selectedOpt) label.textContent = selectedOpt.textContent.trim();
    wrap.querySelectorAll('.opt-item').forEach(item => {
      item.classList.toggle('selected', item.getAttribute('data-val') === String(sel.value));
    });
  });
}

function rebuildCustomSelect(sel) {
  if (!sel) return;
  let wrap = sel.closest('.custom-select-wrap');
  if (!wrap) {
    if (typeof enhanceAllCustomSelects === 'function') {
      enhanceAllCustomSelects(sel.parentElement || document);
      wrap = sel.closest('.custom-select-wrap');
    }
  }
  if (!wrap) return;
  const menu = wrap.querySelector('.custom-dropdown-menu');
  const label = wrap.querySelector('.custom-select-label');
  const btn = wrap.querySelector('.custom-select-btn');
  if (!menu) return;

  menu.innerHTML = '';
  Array.from(sel.options).forEach(opt => {
    if (opt.disabled && sel.options.length > 1) return;
    const optDiv = document.createElement('div');
    optDiv.className = 'opt-item' + (opt.value === sel.value ? ' selected' : '') + (opt.disabled ? ' disabled' : '');
    optDiv.dataset.val = opt.value;
    optDiv.textContent = opt.textContent;
    menu.appendChild(optDiv);
  });

  const selectedOpt = sel.options[sel.selectedIndex] || sel.options[0];
  if (label && selectedOpt) {
    label.textContent = selectedOpt.textContent;
  } else if (label) {
    label.textContent = '';
  }

  const items = menu.querySelectorAll('.opt-item');
  items.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = item.dataset.val;
      items.forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      if (label) label.textContent = item.textContent.trim();
      if (sel) {
        sel.value = val;
        if (typeof sel.onchange === 'function') {
          sel.onchange();
        } else {
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      menu.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  });
}

function enhanceAllCustomSelects(root = document) {
  root.querySelectorAll('.custom-select-wrap').forEach(wrap => {
    initCustomSelect(wrap);
  });

  const targetSelects = root.querySelectorAll('select.st-select');
  targetSelects.forEach(sel => {
    if (sel.classList.contains('no-custom-select')) return;
    if (sel.closest('.custom-select-wrap') || sel.style.display === 'none') return;

    const wrap = document.createElement('div');
    wrap.className = 'custom-select-wrap';
    if (sel.id) wrap.id = 'wrap_' + sel.id;
    if (sel.style.width) wrap.style.width = sel.style.width;

    const selectedOpt = sel.options[sel.selectedIndex] || sel.options[0];
    const safeText = selectedOpt ? selectedOpt.textContent : '';

    const btn = document.createElement('button');
    btn.className = 'custom-select-btn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `
      <span class="custom-select-label">${typeof escapeHtml === 'function' ? escapeHtml(safeText) : safeText}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
    `;

    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    menu.setAttribute('role', 'menu');

    Array.from(sel.options).forEach(opt => {
      if (opt.disabled) return;
      const optDiv = document.createElement('div');
      optDiv.className = 'opt-item' + (opt.selected ? ' selected' : '');
      optDiv.dataset.val = opt.value;
      optDiv.textContent = opt.textContent;
      menu.appendChild(optDiv);
    });

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    sel.style.display = 'none';
    wrap.appendChild(sel);

    initCustomSelect(wrap);
  });

  syncAllCustomSelects(root);
}

if (typeof window !== 'undefined') {
  window.addEventListener('click', () => {
    closeAllCustomSelects();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllCustomSelects();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      enhanceAllCustomSelects();
    });
  } else {
    setTimeout(enhanceAllCustomSelects, 0);
  }
}


function openSettingsView() {
  if (typeof closeContextMenu === 'function') closeContextMenu();
  if (typeof hideHoverPopover === 'function') hideHoverPopover();
  const mainView = document.getElementById('mainView');
  const settingsView = document.getElementById('settingsView');
  const titlebarMain = document.getElementById('titlebarMain');
  const titlebarSettings = document.getElementById('titlebarSettings');

  if (typeof syncSettingsUiFromStorage === 'function') {
    try { syncSettingsUiFromStorage(); } catch (e) {}
  }
  if (typeof enhanceAllCustomSelects === 'function') {
    try { enhanceAllCustomSelects(); } catch (e) {}
  }

  if (mainView) mainView.style.display = 'none';
  if (settingsView) settingsView.style.display = 'flex';
  if (titlebarMain) titlebarMain.style.display = 'none';
  if (titlebarSettings) titlebarSettings.style.display = 'flex';
  document.body.classList.add('in-settings');
  const gearBtn = document.getElementById('btnSettingsTop');
  if (gearBtn) gearBtn.classList.add('active');
  clearSettingsSearch();
  const targetTab = currentSettingsTab || 'behavior';
  if (document.getElementById(`tabBtn_${targetTab}`)) {
    switchSettingsTab(targetTab);
  } else {
    switchSettingsTab('behavior');
  }
  try { if (typeof refreshStorageStats === 'function') refreshStorageStats(); } catch(e){}
  try { if (typeof loadUsageStats === 'function') loadUsageStats(); } catch(e){}
  try { if (typeof syncSupporterBadge === 'function') syncSupporterBadge(); } catch(e){}
  // Settings opens at user's adjusted/reset size (default 970x730), independent of History.
  // Direct native call — deliberately NOT persisted as the user preset.
  // Saved sizes smaller than the default are ignored so the pane never opens too short to show its first section.
  const SETTINGS_DEFAULT_W = 970;
  const SETTINGS_DEFAULT_H = 730;
  let settingsW = SETTINGS_DEFAULT_W;
  let settingsH = SETTINGS_DEFAULT_H;
  try {
    const sw = parseInt(localStorage.getItem('dualclip_settings_width'), 10);
    const sh = parseInt(localStorage.getItem('dualclip_settings_height'), 10);
    if (!isNaN(sw) && sw >= SETTINGS_DEFAULT_W && !isNaN(sh) && sh >= SETTINGS_DEFAULT_H) {
      settingsW = sw;
      settingsH = sh;
    }
  } catch (_) {}
  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_window_size === 'function') {
      window.pywebview.api.set_window_size(settingsW, settingsH, false, false);
    }
  } catch (_) {}
}

// Track and persist Settings window dimension adjustments across drag-resizing
window.addEventListener('resize', () => {
  if (document.body && document.body.classList.contains('in-settings')) {
    if (window.innerWidth >= 600 && window.innerHeight >= 500) {
      try {
        localStorage.setItem('dualclip_settings_width', window.innerWidth);
        localStorage.setItem('dualclip_settings_height', window.innerHeight);
      } catch (_) {}
    }
  }
});


function closeSettingsView() {
  clearSettingsSearch();
  const mainView = document.getElementById('mainView');
  const settingsView = document.getElementById('settingsView');
  const titlebarMain = document.getElementById('titlebarMain');
  const titlebarSettings = document.getElementById('titlebarSettings');

  if (settingsView) settingsView.style.display = 'none';
  if (mainView) mainView.style.display = 'flex';
  if (titlebarSettings) titlebarSettings.style.display = 'none';
  if (titlebarMain) titlebarMain.style.display = 'flex';
  document.body.classList.remove('in-settings');
  const gearBtn = document.getElementById('btnSettingsTop');
  if (gearBtn) gearBtn.classList.remove('active');

  // Back to History: restore the user's selected History window size.
  try {
    if (typeof applyWindowSizePreset === 'function') {
      let histPreset = 'default';
      try { histPreset = localStorage.getItem('dualclip_size_preset') || 'default'; } catch (_) {}
      window.__deferredSizePreset = null;
      // body no longer has .in-settings, so applyWindowSizePreset issues a persisting
      // resize and clears the native transient flag via the default persist=true.
      applyWindowSizePreset(histPreset);
    }
  } catch (_) {}

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    try {
      if (localStorage.getItem('dualclip_autofocus_search') === '1') {
        searchInput.focus();
        searchInput.select();
      }
    } catch (_) {}
  }
  // Force layout recalculation so mainView and listContainer dimensions are valid
  if (mainView) void mainView.offsetHeight;
  const listContainer = document.getElementById('listContainer');
  if (listContainer) void listContainer.offsetHeight;

  // Single clean re-render in next frame once layout dimensions have settled.
  // renderList (not just renderVirtualWindow) because the deferred renders that ran while
  // Settings was open were skipped entirely — the flat-item geometry has to be rebuilt now
  // that the list is visible and has a real height again.
  requestAnimationFrame(() => {
    if (typeof renderList === 'function') {
      try { renderList(); } catch {}
    } else if (typeof renderVirtualWindow === 'function') {
      try { renderVirtualWindow(); } catch {}
    }
  });
}

function toggleRecentSearchSetting(el) {
  const willBeOn = el ? !el.classList.contains('on') : false;
  if (el) el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_recent_search_enabled', willBeOn ? '1' : '0'); } catch(e) {}
  if (!willBeOn && typeof closeRecentSearchesDropdown === 'function') {
    closeRecentSearchesDropdown();
  }
  if (typeof notifySettingSaved === 'function') notifySettingSaved('row_recent_search');
}
window.toggleRecentSearchSetting = toggleRecentSearchSetting;



function toggleSettingsView() {
  if (document.body.classList.contains('in-settings')) {
    closeSettingsView();
  } else {
    openSettingsView();
  }
}


let currentSettingsTab = 'behavior';


function switchSettingsTab(tabKey) {
  currentSettingsTab = tabKey;
  try { localStorage.setItem('dualclip_settings_tab', tabKey); } catch (e) {}
  document.querySelectorAll('.st-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
    t.setAttribute('tabindex', '-1');
  });
  const activeTab = document.getElementById(`tabBtn_${tabKey}`);
  if (activeTab) {
    activeTab.classList.add('active');
    activeTab.setAttribute('aria-selected', 'true');
    activeTab.setAttribute('tabindex', '0');
  }
  document.querySelectorAll('.settings-content').forEach(c => {
    c.classList.remove('active');
    c.style.display = 'none';
  });
  const activeContent = document.getElementById(`tabContent_${tabKey}`);
  if (activeContent) {
    activeContent.classList.add('active');
    activeContent.style.display = 'flex';
  }
  if (tabKey === 'routing') {
    populateAutoSortCollectionSelect();
    renderAutoSortRulesTable();
    if (typeof renderBlockedAppsList === 'function') {
      renderBlockedAppsList();
    }
    const pscTgl = document.getElementById('stPreventScreenCaptureToggle');
    if (pscTgl && window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_prevent_screen_capture === 'function') {
      window.pywebview.api.get_prevent_screen_capture().then(res => {
        if (res && typeof res.enabled === 'boolean') {
          pscTgl.classList.toggle('on', res.enabled);
          try { localStorage.setItem('dualclip_prevent_screen_capture', res.enabled ? '1' : '0'); } catch(e) {}
        }
      }).catch(() => {});
    }
  }
  if (tabKey === 'collections') {
    if (typeof renderSettingsCollectionsList === 'function') {
      renderSettingsCollectionsList();
    }
  }
  if (tabKey === 'shortcuts') {
    updateShortcutsGuide();
  }
  if (tabKey === 'storage') {
    if (typeof refreshStorageStats === 'function') {
      refreshStorageStats();
    }
    // Hydrate the Usage strip on the same pass so no metric keeps a placeholder
    if (typeof loadUsageStats === 'function') {
      try { loadUsageStats(); } catch {}
    }
  }
  if (tabKey === 'stats') {
    updateStatsTabVisibility();
  }
}

async function onAboutCheckClick() {
  const pill = document.getElementById('aboutStatusPill');
  const btn = document.getElementById('aboutCheckBtn');
  const btnText = document.getElementById('aboutCheckBtnText');
  const last = document.getElementById('aboutLastChecked');
  const banner = document.getElementById('aboutBannerArea');
  if (!btn || !btnText || !banner) return;

  const CURRENT_VERSION = '1.0.0';
  const VERSION_URL = 'https://raw.githubusercontent.com/maazvfx/dualclip-releases/main/version.json';

  function compareVersions(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n,10)||0);
    const pb = String(b).split('.').map(n => parseInt(n,10)||0);
    for (let i=0; i<Math.max(pa.length,pb.length); i++) {
      const da = pa[i]||0, db = pb[i]||0;
      if (da < db) return -1;
      if (da > db) return 1;
    }
    return 0;
  }

  // checking state
  if (pill) {
    pill.style.cssText = 'font-size:10px; font-weight:600; padding:1px 6px; border-radius:999px; margin-left:6px; white-space:nowrap; display:inline-flex; align-items:center; gap:3px; font-family: var(--font-mono); background: var(--tag-bg); color: var(--text-muted); border:1px solid var(--border);';
    pill.textContent = 'Checking...';
  }
  btn.disabled = true;
  btnText.textContent = 'Checking...';
  if (last) last.textContent = 'Checking...';
  banner.textContent = 'Checking...';
  // reset button click to check again by default
  btn.onclick = onAboutCheckClick;

  try {
    const res = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const latest = (data && data.version) ? String(data.version).trim() : '';
    const dl = (data && data.downloadUrl) ? String(data.downloadUrl).trim() : 'https://github.com/maazvfx/dualclip-releases/releases/latest';
    if (!latest) throw new Error('no version');
    const cmp = compareVersions(CURRENT_VERSION, latest);
    if (cmp >= 0) {
      if (pill) pill.textContent = 'up to date';
      btn.disabled = false;
      btnText.textContent = 'Check again';
      if (last) last.textContent = 'just now';
      banner.textContent = 'You\'re on the latest version.';
      setTimeout(() => { banner.textContent = ''; }, 4000);
    } else {
      // H2 fix: validate version as semver and download URL as https allowlist
      const _semverOk = /^\d+\.\d+\.\d+$/.test(latest);
      const safeLatest = _semverOk ? latest : escapeHtml ? escapeHtml(latest) : latest.replace(/[<>"'&]/g, '');
      let safeDl = 'https://github.com/maazvfx/dualclip-releases/releases/latest';
      try { const _u = new URL(dl); if (_u.protocol === 'https:' && (_u.hostname === 'github.com' || _u.hostname.endsWith('.github.com') || _u.hostname === 'raw.githubusercontent.com' || _u.hostname === 'githubusercontent.com')) safeDl = _u.href; } catch {}
      if (pill) {
        pill.style.cssText = 'font-size:10px; font-weight:600; padding:1px 6px; border-radius:999px; margin-left:6px; white-space:nowrap; display:inline-flex; align-items:center; gap:3px; font-family: var(--font-mono); background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); border:1px solid color-mix(in srgb, var(--accent) 28%, transparent);';
        pill.textContent = safeLatest + ' available';
      }
      btn.disabled = false;
      btnText.textContent = 'Download';
      if (last) last.textContent = 'just now';
      banner.textContent = ''; const _a = document.createElement('a'); _a.href = '#'; _a.textContent = 'Download ' + safeLatest; _a.style.cssText = 'color:var(--accent); text-decoration:none; font-weight:600;'; _a.onclick = function(e){ e.preventDefault(); try{ window.open(safeDl, '_blank'); }catch(err){} }; banner.appendChild(_a);
      // make button download directly
      btn.onclick = function() { try { window.open(safeDl, '_blank'); } catch(e) { location.href = safeDl; } };
    }
  } catch (e) {
    if (pill) pill.textContent = 'up to date';
    btn.disabled = false;
    btnText.textContent = 'Check again';
    banner.textContent = 'Could not check. You are on ' + CURRENT_VERSION + '.';
    setTimeout(() => { banner.textContent = ''; }, 4000);
  }
}

function toggleAutoUpdateCheckSetting(el) {
  if (!el) el = document.getElementById('aboutAutoToggle');
  if (!el) return;
  const willBeOn = !el.classList.contains('on');
  el.classList.toggle('on', willBeOn);
  try { localStorage.setItem('dualclip_auto_check_updates', willBeOn ? '1' : '0'); } catch(e) {}
  if (typeof notifySettingSaved === 'function') notifySettingSaved('row_auto_update_check');
  if (willBeOn) { try { runAutoUpdateBackgroundCheck(); } catch(e) {} }
}

async function runAutoUpdateBackgroundCheck() {
  try {
    const CURRENT_VERSION = '1.0.0';
    const VERSION_URL = 'https://raw.githubusercontent.com/maazvfx/dualclip-releases/main/version.json';
    function compareVersions(a, b) {
      const pa = String(a).split('.').map(n => parseInt(n,10)||0);
      const pb = String(b).split('.').map(n => parseInt(n,10)||0);
      for (let i=0; i<Math.max(pa.length,pb.length); i++) {
        const da = pa[i]||0, db = pb[i]||0;
        if (da < db) return -1;
        if (da > db) return 1;
      }
      return 0;
    }
    const res = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const latest = (data && data.version) ? String(data.version).trim() : '';
    const dl = (data && data.downloadUrl) ? String(data.downloadUrl).trim() : 'https://github.com/maazvfx/dualclip-releases/releases/latest';
    if (!latest) return;
    const cmp = compareVersions(CURRENT_VERSION, latest);
    if (cmp < 0) {
      const _semverOk2 = /^\d+\.\d+\.\d+$/.test(latest);
      const safeLatest2 = _semverOk2 ? latest : (typeof escapeHtml === 'function' ? escapeHtml(latest) : latest.replace(/[<>"'&]/g, ''));
      let safeDl2 = 'https://github.com/maazvfx/dualclip-releases/releases/latest';
      try { const _u2 = new URL(dl); if (_u2.protocol === 'https:' && (_u2.hostname === 'github.com' || _u2.hostname.endsWith('.github.com') || _u2.hostname === 'raw.githubusercontent.com' || _u2.hostname === 'githubusercontent.com')) safeDl2 = _u2.href; } catch {}
      const pill = document.getElementById('aboutStatusPill');
      const banner = document.getElementById('aboutBannerArea');
      const btn = document.getElementById('aboutCheckBtn');
      const btnText = document.getElementById('aboutCheckBtnText');
      if (pill) {
        pill.style.cssText = 'font-size:10px; font-weight:600; padding:1px 6px; border-radius:999px; margin-left:6px; white-space:nowrap; display:inline-flex; align-items:center; gap:3px; font-family: var(--font-mono); background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); border:1px solid color-mix(in srgb, var(--accent) 28%, transparent);';
        pill.textContent = safeLatest2 + ' available';
      }
      if (banner) { banner.textContent = ''; const _a2 = document.createElement('a'); _a2.href = '#'; _a2.textContent = 'Download ' + safeLatest2; _a2.style.cssText = 'color:var(--accent); text-decoration:none; font-weight:600;'; _a2.onclick = function(e){ e.preventDefault(); try{ window.open(safeDl2, '_blank'); }catch(err){} }; banner.appendChild(_a2); }
      if (btn && btnText) { btn.disabled = false; btnText.textContent = 'Download'; btn.onclick = function() { try { window.open(safeDl2, '_blank'); } catch(e) { location.href = safeDl2; } }; }
      const last = document.getElementById('aboutLastChecked');
      if (last) last.textContent = 'just now';
    }
  } catch(e) {}
}


let _settingsSearchDebounceTimer = null;

function onSettingsSearch(query, immediate = false) {
  if (_settingsSearchDebounceTimer) {
    clearTimeout(_settingsSearchDebounceTimer);
    _settingsSearchDebounceTimer = null;
  }
  const clearBtn = document.getElementById('settingsSearchClear');
  if (clearBtn) clearBtn.style.display = (query || '').trim() ? 'block' : 'none';

  if (immediate || !(query || '').trim()) {
    executeSettingsSearch(query);
  } else {
    _settingsSearchDebounceTimer = setTimeout(() => {
      executeSettingsSearch(query);
    }, 150);
  }
}

function executeSettingsSearch(query) {
  const q = (query || '').trim().toLowerCase();
  currentSettingsSearchQuery = q;
  const clearBtn = document.getElementById('settingsSearchClear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

  const tabKeys = ['behavior', 'theme', 'window', 'search', 'routing', 'storage', 'shortcuts'];

  // Remove existing badges & empty state
  document.querySelectorAll('.st-tab .st-tab-match-badge').forEach(b => b.remove());
  const existingEmpty = document.getElementById('settingsEmptySearchState');
  if (existingEmpty) existingEmpty.remove();

  if (!q) {
    tabKeys.forEach(key => {
      const tabBtn = document.getElementById(`tabBtn_${key}`);
      if (tabBtn) {
        tabBtn.style.opacity = '1';
        tabBtn.style.pointerEvents = 'auto';
      }
      const tabContent = document.getElementById(`tabContent_${key}`);
      if (tabContent) {
        tabContent.querySelectorAll('.notion-setting-row, .notion-setting-group, .settings-section, .st-row, .st-card-section, .st-section-title, #row_autosort_rules, #row_blocklist_add, .shortcut-category-card, .shortcut-item-row').forEach(el => {
          el.classList.remove('st-search-hidden');
          el.style.opacity = '1';
          el.style.display = el.classList.contains('shortcut-item-row') ? 'flex' : '';
        });
        tabContent.querySelectorAll('table.rules-table tbody tr').forEach(tr => {
          tr.classList.remove('st-search-hidden');
          tr.style.opacity = '1';
          tr.style.display = '';
        });
      }
    });
    return;
  }

  // Build lookup of keywords from index
  const indexLookup = {};
  SETTINGS_SEARCH_INDEX.forEach(item => {
    indexLookup[item.id] = (item.label + ' ' + item.desc + ' ' + item.keywords).toLowerCase();
  });

  const tabMatchCounts = {};
  let firstMatchingTab = null;
  let totalMatches = 0;

  tabKeys.forEach(key => {
    const tabContent = document.getElementById(`tabContent_${key}`);
    let matchCount = 0;
    if (tabContent) {
      // Filter rows
      tabContent.querySelectorAll('.notion-setting-row, .st-row, .st-card-section, #row_autosort_rules, #row_blocklist_add').forEach(row => {
        const rowId = row.id;
        const indexText = rowId && indexLookup[rowId] ? indexLookup[rowId] : '';
        const domText = (row.textContent || '').toLowerCase();
        const matches = indexText.includes(q) || domText.includes(q);

        if (matches) {
          matchCount++;
          row.classList.remove('st-search-hidden');
          row.style.opacity = '1';
          row.style.display = '';
        } else {
          row.classList.add('st-search-hidden');
          row.style.display = 'none';
        }
      });

      // Filter notion setting groups: hide group if all child rows are hidden
      tabContent.querySelectorAll('.notion-setting-group').forEach(group => {
        const rows = group.querySelectorAll('.notion-setting-row');
        if (rows.length > 0) {
          const hasVisible = Array.from(rows).some(r => !r.classList.contains('st-search-hidden') && r.style.display !== 'none');
          group.classList.toggle('st-search-hidden', !hasVisible);
          group.style.display = hasVisible ? '' : 'none';
        }
      });

      // Filter categorized shortcut cards
      tabContent.querySelectorAll('.shortcut-category-card').forEach(card => {
        let cardHasVisible = false;
        card.querySelectorAll('.shortcut-item-row').forEach(item => {
          const itemText = (item.textContent || '').toLowerCase();
          const matches = itemText.includes(q);
          if (matches) {
            matchCount++;
            cardHasVisible = true;
            item.classList.remove('st-search-hidden');
            item.style.display = 'flex';
          } else {
            item.classList.add('st-search-hidden');
            item.style.display = 'none';
          }
        });
        card.classList.toggle('st-search-hidden', !cardHasVisible);
        card.style.display = cardHasVisible ? '' : 'none';
      });

      // Also filter table rows if in routing
      tabContent.querySelectorAll('table.rules-table tbody tr').forEach(tr => {
        const text = (tr.textContent || '').toLowerCase();
        if (text.includes(q)) {
          matchCount++;
          tr.classList.remove('st-search-hidden');
          tr.style.opacity = '1';
          tr.style.display = '';
        } else {
          tr.classList.add('st-search-hidden');
          tr.style.display = 'none';
        }
      });

      // Filter sections: hide if all children in section are hidden
      tabContent.querySelectorAll('.settings-section').forEach(sec => {
        const hasVisible = Array.from(sec.querySelectorAll('.notion-setting-row, .st-row, .shortcut-category-card, tr')).some(r => !r.classList.contains('st-search-hidden') && r.style.display !== 'none');
        sec.classList.toggle('st-search-hidden', !hasVisible);
        sec.style.display = hasVisible ? '' : 'none';
      });
    }

    tabMatchCounts[key] = matchCount;
    totalMatches += matchCount;
    if (matchCount > 0 && !firstMatchingTab) {
      firstMatchingTab = key;
    }

    const tabBtn = document.getElementById(`tabBtn_${key}`);
    if (tabBtn) {
      if (matchCount > 0) {
        tabBtn.style.opacity = '1';
        tabBtn.style.pointerEvents = 'auto';
        const badge = document.createElement('span');
        badge.className = 'st-tab-match-badge';
        badge.textContent = matchCount;
        tabBtn.appendChild(badge);
      } else {
        tabBtn.style.opacity = '0.35';
      }
    }
  });

  if (tabMatchCounts[currentSettingsTab] > 0) {
    switchSettingsTab(currentSettingsTab);
  } else if (firstMatchingTab) {
    switchSettingsTab(firstMatchingTab);
  } else {
    // 0 total matches: render clean empty state inside active tab
    const activeTabContent = document.getElementById(`tabContent_${currentSettingsTab}`) || document.querySelector('.settings-content.active');
    if (activeTabContent) {
      const empty = document.createElement('div');
      empty.id = 'settingsEmptySearchState';
      empty.className = 'settings-empty-search';
      const escapedQuery = (typeof escapeHtml === 'function') ? escapeHtml(query) : query;
      empty.innerHTML = `
        <div class="settings-empty-search-title">No settings match "${escapedQuery}"</div>
        <div style="font-size: 11.5px; color: var(--text-sub);">Try searching for popular settings:</div>
        <div class="settings-search-pills">
          <span class="settings-search-pill" onclick="applySettingsSearchKeyword('blocklist')">Blocklist</span>
          <span class="settings-search-pill" onclick="applySettingsSearchKeyword('theme')">Theme</span>
          <span class="settings-search-pill" onclick="applySettingsSearchKeyword('hotkey')">Shortcut</span>
          <span class="settings-search-pill" onclick="applySettingsSearchKeyword('position')">Window Position</span>
          <span class="settings-search-pill" onclick="applySettingsSearchKeyword('pause')">Pause Capture</span>
          <span class="settings-search-pill" onclick="applySettingsSearchKeyword('rules')">Auto-Routing</span>
        </div>
      `;
      activeTabContent.appendChild(empty);
    }
  }
}


function clearSettingsSearch(focusInput = false) {
  const inp = document.getElementById('settingsSearchInput');
  if (inp) {
    inp.value = '';
    if (focusInput) {
      try { inp.focus(); } catch (e) {}
    } else {
      try { inp.blur(); } catch (e) {}
    }
  }
  onSettingsSearch('');
}


function handleSettingsSearchKeydown(e) {
  if (e.key === 'Escape') {
    const inp = document.getElementById('settingsSearchInput');
    if (inp && inp.value.trim().length > 0) {
      e.preventDefault();
      e.stopPropagation();
      clearSettingsSearch();
    } else {
      closeSettingsView();
    }
  }
}


function applySettingsSearchKeyword(kw) {
  const inp = document.getElementById('settingsSearchInput');
  if (inp) {
    inp.value = kw;
    onSettingsSearch(kw);
    inp.focus();
  }
}


function notifySettingSaved(rowId) {
  // Silent persistence - no visual "Saved" badge or flash per user preference
}


function restoreCurrentTabDefaults() {
  const tab = currentSettingsTab || 'behavior';
  if (tab === 'behavior') {
    // 1. Pause Clipboard Capture: off
    const incognitoTgl = document.getElementById('stIncognitoToggle');
    if (incognitoTgl && incognitoTgl.classList.contains('on')) {
      toggleIncognitoSetting(incognitoTgl);
    }
    // 2. Capture Images & Screenshots: on
    const captureImagesTgl = document.getElementById('stCaptureImagesToggle');
    if (captureImagesTgl && !captureImagesTgl.classList.contains('on')) {
      toggleCaptureImagesSetting(captureImagesTgl);
    }
    // 4. Open on Windows Startup: off
    const autostartTgl = document.getElementById('stAutostartToggle');
    if (autostartTgl && autostartTgl.classList.contains('on')) {
      toggleAutostartSetting(autostartTgl);
    }
    if (typeof showToast === 'function') {
      showToast('Behavior settings restored to default');
    }
  } else if (tab === 'theme') {
    // Theme: dark, Style: linear, Zebra: off, Lines: auto, Image details: thumbnail_only, Thumb size: sm, Hover preview: off, Hover delay: 1000, Hover mode: meta, Size: normal
    switchThemeMode('dark', false);
    changeWindowSizePreset('default', false);
    changeZoomSetting('100', false);
    switchDesignStyle('linear', false);
    changeZebraStyle('off', false);
    changeLineDisplay('auto', false);
    changeImageDisplayMode('thumbnail_only', false);
    setThumbSize('sm', false);
    if (typeof changeQuickViewTextPower === 'function') changeQuickViewTextPower('full');
    else document.documentElement.setAttribute('data-text-power', 'full');
    if (typeof applyOutlineSelectionSetting === 'function') applyOutlineSelectionSetting(false, false);
    if (typeof applySoftenTintSetting === 'function') applySoftenTintSetting(false, false);
    if (typeof applyHoverHighlightSetting === 'function') applyHoverHighlightSetting(false, false);
    if (typeof applyHideWindowBorderSetting === 'function') applyHideWindowBorderSetting(false, false);

    ['row_theme_mode', 'row_zoom', 'row_visual_style', 'row_zebra', 'row_label_style', 'row_line_display', 'row_thumb_size'].forEach(notifySettingSaved);
  } else if (tab === 'window') {
    // Reset hotkey to Ctrl+Shift+V, Double click: paste, Open at: near, Window size: default, Remember size: on
    resetDefaultHotkey();
    const szSel = document.getElementById('stWindowSizePresetSelect');
    if (szSel) szSel.value = 'default';
    if (typeof applyWindowSizePreset === 'function') applyWindowSizePreset('default', false);
    if (typeof applyQuickNumberPasteSetting === 'function') applyQuickNumberPasteSetting(false, false);
    applyWindowPositionSetting('near');
    const posSel = document.getElementById('stWindowPositionSelect');
    if (posSel) posSel.value = 'near';

    applyTrayPositionSetting('center');
    const trayPosSel = document.getElementById('stTrayPositionSelect');
    if (trayPosSel) trayPosSel.value = 'center';

    ['row_hotkey', 'row_double_click', 'row_quick_number_paste', 'row_window_position', 'row_tray_position', 'row_window_size', 'row_remember_window_size'].forEach(notifySettingSaved);
  } else if (tab === 'search') {
    // Grouping: time
    changeGroupingMode('time', false);
    const gmSel = document.getElementById('stGroupingModeSelect');
    if (gmSel) gmSel.value = 'time';

    ['row_grouping_mode'].forEach(notifySettingSaved);
  } else if (tab === 'routing') {
    // Passwords: on, Images: on, Blocklist: on, Mirror in all: on, Screen capture protection: off (default)
    const pwTgl = document.getElementById('stIgnorePasswordsToggle');
    if (pwTgl && !pwTgl.classList.contains('on')) toggleIgnorePasswordsSetting(pwTgl);

    const imgTgl = document.getElementById('stCaptureImagesToggle');
    if (imgTgl && !imgTgl.classList.contains('on')) toggleCaptureImagesSetting(imgTgl);

    const blTgl = document.getElementById('stIgnoreBlocklistToggle');
    if (blTgl && !blTgl.classList.contains('on')) toggleIgnoreBlocklistSetting(blTgl);

    const pscTgl = document.getElementById('stPreventScreenCaptureToggle');
    if (pscTgl && pscTgl.classList.contains('on')) togglePreventScreenCaptureSetting(pscTgl);

    ['row_ignore_passwords', 'row_capture_images', 'row_ignore_blocklist', 'row_prevent_screen_capture'].forEach(notifySettingSaved);
  } else if (tab === 'collections') {
    if (typeof renderSettingsCollectionsList === 'function') {
      renderSettingsCollectionsList();
    }
  } else if (tab === 'storage') {
    // Max clips: 500
    changeMaxClipsSetting('500');
    const mcSel = document.getElementById('stMaxClipsSelect');
    if (mcSel) mcSel.value = '500';
    notifySettingSaved('row_max_clips');
  } else if (tab === 'shortcuts') {
    // Plain-text copy shortcut: on (default)
    const pcTgl = document.getElementById('stTogglePlainCopyShortcut');
    if (pcTgl && !pcTgl.classList.contains('on')) {
      togglePlainCopyShortcutSetting(pcTgl);
    }
    // Direct move hotkeys: clear all assignments back to 'none'
    let savedShortcuts = {};
    try {
      savedShortcuts = JSON.parse(localStorage.getItem('dualclip_direct_col_shortcuts') || '{}');
    } catch (e) {}
    if (Object.keys(savedShortcuts).length > 0) {
      try {
        localStorage.setItem('dualclip_direct_col_shortcuts', JSON.stringify({}));
      } catch (e) {}
      if (typeof renderSettingsCollectionsList === 'function') {
        renderSettingsCollectionsList();
      }
    }
    ['row_toggle_plain_copy_shortcut'].forEach(notifySettingSaved);
  }
}

// Global & Namespace Exposure
window.syncSettingsUiFromStorage = syncSettingsUiFromStorage;
// safeForward removed - modules now export directly to window
window.openSettingsView = openSettingsView;
window.closeSettingsView = closeSettingsView;
window.toggleSettingsView = toggleSettingsView;
window.switchSettingsTab = switchSettingsTab;
window.onSettingsSearch = onSettingsSearch;
window.clearSettingsSearch = clearSettingsSearch;
window.handleSettingsSearchKeydown = handleSettingsSearchKeydown;
window.applySettingsSearchKeyword = applySettingsSearchKeyword;
window.notifySettingSaved = notifySettingSaved;
window.restoreCurrentTabDefaults = restoreCurrentTabDefaults;
window.onAboutCheckClick = onAboutCheckClick;
window.initCustomSelect = initCustomSelect;
window.closeAllCustomSelects = closeAllCustomSelects;
window.syncCustomDropdown = syncCustomDropdown;
window.rebuildCustomSelect = rebuildCustomSelect;




