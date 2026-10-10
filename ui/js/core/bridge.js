// --- WebView2 / C# Bridge Adapter ---
(function() {
  // Monotonically increasing rpcId initialized with timestamp offset to prevent cross-reload RPC collisions
  let rpcId = Math.floor((Date.now() % 10000000) * 100);
  const pendingCalls = new Map();

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
      let msg = event.data;
      if (typeof msg === 'string') {
        try { msg = JSON.parse(msg); } catch(e) {}
      }
      if (msg && msg.__rpc_response_id !== undefined) {
        const resolve = pendingCalls.get(msg.__rpc_response_id);
        if (resolve) {
          pendingCalls.delete(msg.__rpc_response_id);
          resolve(msg.result);
        }
      } else if (msg && msg.event) {
        if (msg.event === 'onClipAdded' && typeof window.onClipAdded === 'function') {
          window.onClipAdded(msg.data);
        } else if (msg.event === 'onClipUpdated' && typeof window.onClipUpdated === 'function') {
          window.onClipUpdated(msg.data);
        } else if (msg.event === 'refreshClips') {
          window._lastClearAt = Date.now();
          if (typeof window.refreshClips === 'function') {
            window.refreshClips();
          }
        } else if (msg.event === 'onWindowShow' && typeof window.onWindowShow === 'function') {
          if (typeof window.setWindowVisibility === 'function') window.setWindowVisibility(true);
          window.onWindowShow();
        } else if (msg.event === 'onWindowHide' && typeof window.onWindowHide === 'function') {
          if (typeof window.setWindowVisibility === 'function') window.setWindowVisibility(false);
          window.onWindowHide();
        } else if (msg.event === 'onCaptureStateChanged' && typeof window.onCaptureStateChanged === 'function') {
          window.onCaptureStateChanged(msg.data);
        } else if (msg.event === 'onPauseChanged' && typeof window.onPauseChanged === 'function') {
          window.onPauseChanged(msg.data);
        } else if (msg.event === 'onCycleNext' && typeof window.onCycleNext === 'function') {
          window.onCycleNext();
        } else if (msg.event === 'onWinReleased' && typeof window.onWinReleased === 'function') {
          window.onWinReleased();
        } else if (msg.event === 'onToast') {
          if (msg.data && msg.data.message && typeof window.showToast === 'function') {
            window.showToast(msg.data.message);
          }
        } else if (msg.event === 'onDropZoneShow') {
          if (typeof window.onDropZoneShow === 'function') window.onDropZoneShow();
        } else if (msg.event === 'onDropZoneHide') {
          if (typeof window.onDropZoneHide === 'function') window.onDropZoneHide();
        } else if (msg.event === 'refreshStorageStats') {
          if (typeof window.refreshStorageStats === 'function') window.refreshStorageStats();
        }
      }
    });
  }

  function callHost(method, args, timeoutMs) {
    return new Promise((resolve) => {
      if (!window.chrome || !window.chrome.webview) {
        resolve({ ok: false, error: 'WebView2 not available' });
        return;
      }
      const id = ++rpcId;
      const isDialogMethod = ['browse_application', 'export_clips', 'import_into_collection', 'import_dropped_package', 'import_package_base64', 'clear_history', 'clear_collection', 'delete_clips_in_collection'].includes(method);
      const limit = typeof timeoutMs === 'number' ? timeoutMs : (isDialogMethod ? 120000 : 8000);
      const timer = setTimeout(() => {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          resolve({ ok: false, error: 'RPC timeout: ' + method });
        }
      }, limit);
      pendingCalls.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      window.chrome.webview.postMessage({
        id: id,
        method: method,
        args: args || []
      });
    });
  }

  window.pywebview = {
    api: {
      get_clips: (collection, filterType, filterApp, filterTime, query, sort, limit, offset, fuzzy) => {
        if (typeof callHostChecked === 'function') {
          return callHostChecked('get_clips', {
            collection: collection,
            filterType: filterType,
            filterApp: filterApp,
            filterTime: filterTime,
            query: query,
            sort: sort,
            limit: limit,
            offset: offset,
            fuzzyEnabled: fuzzy
          });
        }
        return callHost('get_clips', [collection, filterType, filterApp, filterTime, query, sort, limit, offset, fuzzy]);
      },
      paste_clip: (id, stayOpen) => callHost('paste_clip', [id, !!stayOpen]),
      paste_delete: (id) => callHost('paste_delete', [id]),
      paste_text: (text) => callHost('paste_text', [text]),
      copy_clip: (id) => callHost('copy_clip', [id]),
      set_clipboard_text: (text) => callHost('set_clipboard_text', [text]),
      paste_multi: (ids, stayOpen) => callHost('paste_multi', [ids, !!stayOpen]),
      delete_clip: (id) => callHost('delete_clip', [id]),
      set_custom_title: (id, title) => callHost('set_custom_title', [id, title]),
      set_nickname: (id, nickname) => callHost('set_nickname', [id, nickname]),
      update_clip: (id, newText) => callHost('update_clip', [id, newText]),
      add_clip: (text) => callHost('add_clip', [text]),
      restore_clip: (snapshot) => callHost('restore_clip', [snapshot]),
      toggle_pin: (id) => callHost('toggle_pin', [id]),
      toggle_favorite: (id) => callHost('toggle_favorite', [id]),
      hide_window: () => callHost('hide_window', []),
      window_show_ack: () => callHost('window_show_ack', []),
      set_pinned: (pinned) => callHost('set_pinned', [pinned]),
      set_modal_open: (open) => callHost('set_modal_open', [!!open]),
      get_pinned: () => callHost('get_pinned', []),
      set_window_pos: (x, y) => callHost('set_window_pos', [x, y]),
      center_window: () => callHost('center_window', []),
      start_drag: () => callHost('start_drag', []),
      // persist defaults to true when omitted; transient callers (Settings, lightbox)
      // pass false so their size never overwrites the remembered window size.
      set_window_size: (w, h, animate, persist) => callHost('set_window_size', [w, h, !!animate, persist !== false]),
      resize_window: (w, h) => callHost('resize_window', [w, h]),
      start_resize: (direction) => callHost('start_resize', [direction || 'bottom-right']),
      // Optional layout arg ('compact' | 'standard'); empty string = native
      // falls back to the mirrored size, then the Standard preset.
      reset_window_size: (layout) => callHost('reset_window_size', [layout || '']),
      set_clip_details: (details) => callHost('set_clip_details', [details || 'hidden']),
      get_clip_details: () => callHost('get_clip_details', []),
      set_layout_preset: (preset) => callHost('set_layout_preset', [preset || 'standard']),
      get_layout_preset: () => callHost('get_layout_preset', []),
      set_show_taskbar: (show) => callHost('set_show_taskbar', [show]),
      set_autostart: (enable) => callHost('set_autostart', [enable]),
      set_start_hidden: (enable) => callHost('set_start_hidden', [enable]),
      get_start_hidden: () => callHost('get_start_hidden', []),
      set_paused: (paused) => callHost('set_paused', [paused]),
      set_timed_incognito: (minutes) => callHost('set_timed_incognito', [minutes]),
      get_paused: () => callHost('get_paused', []),
      clear_history: (includePinned, excludedCols, keepStarred, deleteUnpinned, deleteImages, colPinned, colStarred, deleteCols) => callHost('clear_history', [
        includePinned,
        excludedCols || [],
        typeof keepStarred === 'boolean' ? keepStarred : true,
        typeof deleteUnpinned === 'boolean' ? deleteUnpinned : true,
        typeof deleteImages === 'boolean' ? deleteImages : true,
        Array.isArray(colPinned) ? colPinned : [],
        Array.isArray(colStarred) ? colStarred : [],
        Array.isArray(deleteCols) ? deleteCols : []
      ]),
      rename_collection: (id, newName) => callHost('rename_collection', [id, newName]),
      move_to_collection: (id, col) => callHost('move_to_collection', [id, col]),
      merge_collection: (sourceCol, targetCol) => callHost('merge_collection', [sourceCol, targetCol]),
      clear_collection: (colId) => callHost('clear_collection', [colId]),
      delete_clips_in_collection: (colId) => callHost('delete_clips_in_collection', [colId]),
      get_collections: () => callHost('get_collections', []),
      get_collection_counts: () => callHost('get_collection_counts', []),
      get_clear_stats: () => callHost('get_clear_stats', []),
      save_collection: (id, name, pinned, sortOrder, parentId = null) => callHost('save_collection', [id, name, !!pinned, sortOrder | 0, parentId || null]),
      set_collection_parent: (colId, parentId) => callHost('set_collection_parent', [colId, parentId || null]),
      delete_collection_def: (id, deleteClips) => callHost('delete_collection_def', deleteClips ? [id, true] : [id]),
      reassign_collection: (fromId, toId) => callHost('reassign_collection', [fromId, toId]),
      migrate_collection_keys: (pairs) => callHost('migrate_collection_keys', [pairs]),
      set_ignore_passwords: (ignore) => callHost('set_ignore_passwords', [ignore]),
      get_ignore_passwords: () => callHost('get_ignore_passwords', []),
      set_capture_images: (capture) => callHost('set_capture_images', [capture]),
      get_capture_images: () => callHost('get_capture_images', []),
      set_capture_filters: (minLen, ignoreWhitespace) => callHost('set_capture_filters', [minLen, ignoreWhitespace]),
      get_capture_filters: () => callHost('get_capture_filters', []),
      set_max_clips: (maxClips) => callHost('set_max_clips', [maxClips]),
      get_hotkey: () => callHost('get_hotkey', []),
      set_hotkey: (win, ctrl, alt, shift, vk) => callHost('set_hotkey', [win, ctrl, alt, shift, vk]),
      set_auto_sort_rules: (rules) => callHost('set_auto_sort_rules', [rules]),
      get_auto_sort_rules: () => callHost('get_auto_sort_rules', []),
      set_suppress_in_fullscreen: (enabled) => callHost('set_suppress_in_fullscreen', [!!enabled]),
      get_suppress_in_fullscreen: () => callHost('get_suppress_in_fullscreen', []),
      set_theme_color: (colorHex) => callHost('set_theme_color', [colorHex]),
      set_tray_theme: (theme) => callHost('set_tray_theme', [theme]),
      set_smart_shortcuts: (enabled) => callHost('set_smart_shortcuts', [enabled]),
      get_smart_shortcuts: () => callHost('get_smart_shortcuts', []),
      get_running_apps: () => callHost('get_running_apps', []),
      set_blocklist: (enable, apps) => callHost('set_blocklist', [enable, apps]),
      get_blocklist: () => callHost('get_blocklist', []),

      browse_application: () => callHost('browse_application', []),
       get_clip_temp_file: (clipId) => callHost('get_clip_temp_file', [clipId]),
       export_clips: (scope) => callHost('export_clips', [scope]),
       import_into_collection: (collection) => callHost('import_into_collection', [collection]),
        start_file_drag: (clipId, mode) => callHost('start_file_drag', [clipId, mode]),
        set_window_position_mode: (mode) => callHost('set_window_position_mode', [mode]),
       get_window_position_mode: () => callHost('get_window_position_mode', []),
       set_tray_position_mode: (mode) => callHost('set_tray_position_mode', [mode]),
       get_tray_position_mode: () => callHost('get_tray_position_mode', []),
        set_remember_window_size: (remember) => callHost('set_remember_window_size', [remember]),
        get_remember_window_size: () => callHost('get_remember_window_size', []),
       get_usage_stats: () => callHost('get_usage_stats', []),
       get_storage_stats: () => callHost('get_storage_stats', []),
       reset_usage_stats: () => callHost('reset_usage_stats', []),
      set_track_stats: (enabled) => callHost('set_track_stats', [enabled]),
      set_restore_clipboard: (enabled) => callHost('set_restore_clipboard', [enabled]),
      get_restore_clipboard: () => callHost('get_restore_clipboard', []),
      set_prevent_screen_capture: (enabled) => callHost('set_prevent_screen_capture', [enabled]),
      get_prevent_screen_capture: () => callHost('get_prevent_screen_capture', []),
      ui_ready: () => callHost('ui_ready', []),
      get_clip: (id) => callHost('get_clip', [id]),
      get_clip_text: (id) => callHost('get_clip_text', [id]),
      set_auto_expire_days: (days) => callHost('set_auto_expire_days', [days]),
      get_auto_expire_days: () => callHost('get_auto_expire_days', []),
      // Tagging RPCs
      set_tags_for_clip: (id, tags) => callHost('set_tags_for_clip', [id, tags]),
      get_tags_for_clip: (id) => callHost('get_tags_for_clip', [id]),
      batch_add_tags: (clipIds, tags) => callHost('batch_add_tags', [clipIds, tags]),
      batch_remove_tags: (clipIds, tags) => callHost('batch_remove_tags', [clipIds, tags]),
      get_tag_stats: (tagName) => callHost('get_tag_stats', [tagName]),
      get_all_tags_with_stats: () => callHost('get_tag_stats', []),
      get_suggested_tags: (limit) => callHost('get_suggested_tags', [limit || 10]),
      rename_tag: (oldName, newName) => callHost('rename_tag', [oldName, newName]),
      delete_tag: (tagName) => callHost('delete_tag', [tagName]),
      // Supporter Recognition RPCs
      set_supporter_status: (isSupporter) => callHost('set_supporter_status', [isSupporter]),
      get_supporter_status: () => callHost('get_supporter_status', []),
      // Live Preview RPCs (TASK-002: ViewMode mirror deleted; layout preset lives in localStorage)
      set_live_preview: (enabled) => callHost('set_live_preview', [enabled]),
      get_live_preview: () => callHost('get_live_preview', []),
      
      set_quick_number_paste: (enabled) => callHost('set_quick_number_paste', [!!enabled]),
      get_quick_number_paste: () => callHost('get_quick_number_paste', []),
      set_line_display: (mode) => callHost('set_line_display', [mode]),
      get_line_display: () => callHost('get_line_display', []),
    }
  };


  // Expose bridge helper on window and DC namespace
  window.callHost = callHost;
  window.DC = window.DC || {};
  window.DC.bridge = {
    callHost,
    pendingCalls
  };

  window.addEventListener('error', function(event) {
    try {
      const msg = event.message || 'Unknown error';
      const file = event.filename || '';
      const line = event.lineno || 0;
      const col = event.colno || 0;
      const stack = (event.error && event.error.stack) ? event.error.stack : '';
      console.error(`[JS Error] ${msg} at ${file}:${line}:${col}`, stack);
    } catch {}
  });

  window.addEventListener('unhandledrejection', function(event) {
    try {
      const reason = event.reason;
      console.error('[Unhandled Rejection]', reason);
    } catch {}
  });

  // Trigger ready event
  setTimeout(() => {
    window.dispatchEvent(new Event('pywebviewready'));
  }, 50);
  try { if (typeof __dcMark === 'function') __dcMark('scripts.bridge.ready'); } catch (e) {}
})();
