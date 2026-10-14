// --- DualClip RPC Contracts & Checked Invocation ---
// Enforces named parameter contracts for JSON-RPC messages between WebView and C# Host.
// Prevents accidental positional array drift between caller and callee.

(function () {
  'use strict';

  var RpcContracts = {
    get_clips: { args: ['collection', 'filterType', 'filterApp', 'filterTime', 'query', 'sort', 'limit', 'offset', 'fuzzyEnabled'], defaults: { collection: 'all', filterType: 'all', filterApp: 'all', filterTime: 'any', query: '', sort: 'default', limit: 100, offset: 0, fuzzyEnabled: false } },
    // Window & Viewport
    hide_window: { args: [] },
    window_show_ack: { args: [] },
    center_window: { args: [] },
    set_window_pos: { args: ['x', 'y'] },
    start_drag: { args: [] },
    // Optional 3rd/4th args: animate (bool), persist (bool, default true).
    set_window_size: { args: ['w', 'h'], optional: ['animate', 'persist'] },
    resize_window: { args: ['w', 'h'], optional: ['animate', 'persist'] },
    start_resize: { args: ['direction'], defaults: { direction: 'bottom-right' } },
    reset_window_size: { args: [], optional: ['layout'] },
    set_pinned: { args: ['pinned'] },
    set_modal_open: { args: ['open'] },
    get_pinned: { args: [] },
    open_external_url: { args: ['url'] },
    set_show_taskbar: { args: ['show'] },
    ui_ready: { args: [] },
    write_debug_log: { args: ['message'] },

    // Clips & Content
    get_clip: { args: ['id'] },
    get_clip_text: { args: ['id'] },
    paste_clip: { args: ['id', 'stayOpen'] },
    paste_delete: { args: ['id'] },
    paste_text: { args: ['text'] },
    copy_clip: { args: ['id'] },
    set_clipboard_text: { args: ['text'] },
    paste_multi: { args: ['ids', 'stayOpen'] },
    delete_clip: { args: ['id'] },
    set_custom_title: { args: ['id', 'title'] },
    set_nickname: { args: ['id', 'nickname'] },
    update_clip: { args: ['id', 'newText'] },
    add_clip: { args: ['text'] },
    add_text_to_collection: { args: ['text', 'collection', 'favorite'] },
    restore_clip: { args: ['snapshot'] },
    toggle_pin: { args: ['id'] },
    toggle_favorite: { args: ['id'] },
    get_clip_temp_file: { args: ['clipId'] },
    start_file_drag: { args: ['clipId', 'mode'] },
    // R1: the C# handler reads 8 positional params, not 2. Params 2-4 default to TRUE in
    // MainForm.RpcDispatch.cs (keepStarred/deleteUnpinned/deleteImages), so omitting them
    // still purges images. Listed as optional so the registry stops under-documenting the
    // params that decide what actually gets deleted.
    clear_history: { args: ['includePinned', 'excludedProcesses'], optional: ['keepStarred', 'deleteUnpinned', 'deleteImages', 'colPinned', 'colStarred', 'delCols'], defaults: { includePinned: false, excludedProcesses: [] } },

    // Collections
    rename_collection: { args: ['id', 'newName'] },
    move_to_collection: { args: ['id', 'col'] },
    merge_collection: { args: ['sourceCol', 'targetCol'] },
    clear_collection: { args: ['colId'] },
    delete_clips_in_collection: { args: ['colId'] },
    get_collections: { args: [] },
    get_collection_counts: { args: [] },
    get_clear_stats: { args: [] },
    save_collection: { args: ['id', 'name', 'pinned', 'sortOrder', 'parentId'] },
    set_collection_parent: { args: ['colId', 'parentId'] },
    delete_collection_def: { args: ['id', 'deleteClips'] },
    reassign_collection: { args: ['fromId', 'toId'] },
    migrate_collection_keys: { args: ['pairs'] },
    export_clips: { args: ['scope'] },
    import_into_collection: { args: ['collection'] },
    import_dropped_package: { args: ['filePath'] },
    import_package_base64: { args: ['fileName', 'base64'] },

    // Tags
    set_tags_for_clip: { args: ['clipId', 'tagsList'] },
    get_tags_for_clip: { args: ['clipId'] },
    batch_add_tags: { args: ['clipIds', 'tagsList'] },
    batch_remove_tags: { args: ['clipIds', 'tagsList'] },
    get_tag_stats: { args: ['tagName'], defaults: { tagName: '' } },
    get_all_tags_with_stats: { args: ['tagName'], defaults: { tagName: '' } },
    get_suggested_tags: { args: ['limit'], defaults: { limit: 10 } },
    rename_tag: { args: ['oldName', 'newName'] },
    delete_tag: { args: ['tagName'] },

    // Settings & State
    set_autostart: { args: ['enable'] },
    get_autostart: { args: [] }, // no caller — UI reads the dualclip_autostart localStorage mirror (see B2)
    set_start_hidden: { args: ['hidden'] },
    get_start_hidden: { args: [] },
    set_hotkey: { args: ['win', 'ctrl', 'alt', 'shift', 'vk'] },
    get_hotkey: { args: [] },
    set_ignore_passwords: { args: ['ign'] },
    get_ignore_passwords: { args: [] },
    set_capture_images: { args: ['cap'] },
    get_capture_images: { args: [] },
    set_capture_filters: { args: ['minLen', 'ignoreWs'] },
    get_capture_filters: { args: [] },
    set_blocklist: { args: ['enable', 'apps'] },
    get_blocklist: { args: [] },
    set_double_copy_override: { args: ['enabled'] },
    get_double_copy_override: { args: [] },
    browse_application: { args: [] },
    get_running_apps: { args: [] },
    set_auto_sort_rules: { args: ['rules'] },
    get_auto_sort_rules: { args: [] },
    set_suppress_in_fullscreen: { args: ['enabled'] },
    get_suppress_in_fullscreen: { args: [] },
    set_max_clips: { args: ['max'] },
    get_storage_stats: { args: [] },
    get_usage_stats: { args: [] },
    reset_usage_stats: { args: [] },
    set_supporter_status: { args: ['isSupporter'] },
    get_supporter_status: { args: [] },
    get_paused: { args: [] },
    set_paused: { args: ['paused'] },
    set_timed_incognito: { args: ['minutes'] },
    get_incognito_status: { args: [] },
    set_theme_color: { args: ['col'] },
    set_tray_theme: { args: ['thm'] },
    set_smart_shortcuts: { args: ['sc'] },
    get_smart_shortcuts: { args: [] },
    set_window_position_mode: { args: ['mode'] },
    get_window_position_mode: { args: [] },
    set_tray_position_mode: { args: ['mode'] },
    get_tray_position_mode: { args: [] },
    set_live_preview: { args: ['lp'] },
    get_live_preview: { args: [] },
    set_remember_window_size: { args: ['remember'] },
    get_remember_window_size: { args: [] },
    set_track_stats: { args: ['ts'] },
    set_restore_clipboard: { args: ['rc'] },
    get_restore_clipboard: { args: [] },
    set_prevent_screen_capture: { args: ['enabled'] },
    get_prevent_screen_capture: { args: [] },
    set_auto_expire_days: { args: ['days'] },
    get_auto_expire_days: { args: [] },

    // B1: set/get_notify_oversized_clips and set/get_clear_on_lock(_scope) were removed.
    // They modelled AppSettings.ClearOnLock/ClearOnLockScope/NotifyOversizedClips, all of
    // which the backend implemented and acted on, but the hand-built Settings screen never
    // grew a control for any of them - so they were reachable only by hand-editing
    // settings.json. Removed rather than wired up, per the keep-it-minimal decision.
    set_quick_number_paste: { args: ['enable'] },
    get_quick_number_paste: { args: [] },
    set_line_display: { args: ['mode'] },
    get_line_display: { args: [] },
    set_thumb_size: { args: ['size'] },
    get_thumb_size: { args: [] },
    set_clip_details: { args: ['details'] },
    get_clip_details: { args: [] },
    set_layout_preset: { args: ['preset'] },
    get_layout_preset: { args: [] },
  };

  /**
   * Build positional argument array from named arguments object according to contract.
   * @param {string} method
   * @param {Object} namedArgs
   * @returns {Array} positional argument list
   */
  function buildRpcArgs(method, namedArgs) {
    var contract = RpcContracts[method];
    if (!contract || !Array.isArray(contract.args)) {
      if (Array.isArray(namedArgs)) return namedArgs;
      return [];
    }
    var result = [];
    var defaults = contract.defaults || {};
    for (var i = 0; i < contract.args.length; i++) {
      var argName = contract.args[i];
      if (namedArgs && namedArgs[argName] !== undefined) {
        result.push(namedArgs[argName]);
      } else if (defaults[argName] !== undefined) {
        result.push(defaults[argName]);
      } else {
        result.push(null);
      }
    }
    return result;
  }

  /**
   * Safe checked caller that transforms named arguments into positional contract args.
   * @param {string} method
   * @param {Object|Array} namedOrPositionalArgs
   * @returns {Promise}
   */
  function callHostChecked(method, namedOrPositionalArgs) {
    var positionalArgs;
    if (Array.isArray(namedOrPositionalArgs)) {
      positionalArgs = namedOrPositionalArgs;
    } else if (namedOrPositionalArgs && typeof namedOrPositionalArgs === 'object') {
      positionalArgs = buildRpcArgs(method, namedOrPositionalArgs);
    } else {
      positionalArgs = [];
    }

    var caller = (typeof window.callHost === 'function') ? window.callHost : (window.DC && window.DC.bridge && typeof window.DC.bridge.callHost === 'function' ? window.DC.bridge.callHost : null);
    if (caller) {
      return caller(method, positionalArgs);
    }
    return Promise.resolve({ ok: false, error: 'Host bridge not available' });
  }

  window.RpcContracts = RpcContracts;
  window.buildRpcArgs = buildRpcArgs;
  window.callHostChecked = callHostChecked;
})();
