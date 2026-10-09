/**
 * DualClip Settings Defaults & Single Source of Truth (SSOT)
 * Centralizes all default values, types, and persistence accessors.
 *
 * All settings defaults must be defined here. No inline defaults or scattered fallbacks.
 */

const SETTING_DEFAULTS = Object.freeze({
  // Search & Filters
  dualclip_autofocus_search: { def: false, type: 'bool' },
  dualclip_fuzzy_search: { def: false, type: 'bool' },
  dualclip_boost_starred: { def: false, type: 'bool' },
  dualclip_recent_search_enabled: { def: true, type: 'bool' },
  dualclip_recent_searches: { def: '[]', type: 'string' },
  dualclip_recent_tags: { def: '[]', type: 'string' },

  // Appearance, Theme & Styling
  dualclip_theme: { def: 'dark', type: 'enum', values: ['dark', 'light'] },
  dualclip_zoom: { def: '100', type: 'enum', values: ['90', '100', '110', '125'] },
  dualclip_zoom_preset: { def: '100', type: 'string' },
  dualclip_density_preview: { def: 'default', type: 'enum', values: ['default', 'dense'] },
  dualclip_line_display: { def: 'auto', type: 'enum', values: ['1', '2', '3', 'auto'] },
  dualclip_clip_details: { def: 'hidden', type: 'enum', values: ['app-time', 'time-only', 'icon-only', 'hidden'] },
  dualclip_thumb_size: { def: 'sm', type: 'enum', values: ['sm', 'md'] },
  dualclip_image_display_mode: { def: 'thumbnail_only', type: 'enum', values: ['thumbnail_only', 'with_info'] },
  dualclip_selection_outline: { def: false, type: 'bool' },
  dualclip_selection_style: { def: 'border', type: 'enum', values: ['border', 'solid'] },
  dualclip_soften_tint: { def: false, type: 'bool' },
  dualclip_row_hover_highlight: { def: false, type: 'bool' },
  dualclip_hide_window_border: { def: false, type: 'bool' },
  dualclip_visual_style: { def: 'linear', type: 'enum', values: ['linear', 'notion', 'nord', 'geist', 'raycast', 'paper', 'crisp'] },
  dualclip_visual_style_dark: { def: 'linear', type: 'string' },
  dualclip_visual_style_light: { def: 'paper', type: 'string' },
  dualclip_pill_style: { def: 'default', type: 'enum', values: ['default', 'subtle', 'outline'] },
  dualclip_zebra_style: { def: 'off', type: 'enum', values: ['off', 'subtle', 'striped'] },
  dualclip_grouping_mode: { def: 'time', type: 'enum', values: ['time', 'date', 'app', 'format', 'priority', 'none'] },
  dualclip_section_click_mode: { def: 'chevron_only', type: 'enum', values: ['chevron_only', 'full_row'] },
  dualclip_app_source_display: { def: 'both', type: 'enum', values: ['both', 'icon_only', 'name_only', 'hidden'] },
  dualclip_label_style: { def: 'pill', type: 'enum', values: ['pill', 'gray', 'plain'] },
  dualclip_text_power: { def: 'full', type: 'enum', values: ['full', 'soft', 'dim'] },
  dualclip_show_use_count_badge: { def: false, type: 'bool' },

  // Window Layout & Sizing
  dualclip_view_layout: { def: 'standard', type: 'enum', values: ['standard', 'sidebar'] },
  dualclip_layout_preset: { def: 'standard', type: 'enum', values: ['standard', 'compact'] },
  dualclip_size_preset: { def: 'default', type: 'enum', values: ['default', 'compact'] },
  dualclip_window_position: { def: 'near', type: 'enum', values: ['near', 'near_above', 'center', 'last'] },
  dualclip_tray_position: { def: 'center', type: 'enum', values: ['center', 'top_left', 'corner', 'near', 'last'] },
  dualclip_remember_window_size: { def: false, type: 'bool' },
  dualclip_preview_width: { def: 420, type: 'int' },
  dualclip_sidebar_hide_counts: { def: false, type: 'bool' },

  // Collections & Organization
  dualclip_remember_collection: { def: true, type: 'bool' },
  dualclip_collection_sort_order: { def: 'newest', type: 'enum', values: ['newest', 'oldest', 'alpha', 'most_used'] },
  dualclip_custom_collections: { def: '[]', type: 'string' },
  dualclip_collapsed_groups: { def: '[]', type: 'string' },
  dualclip_bottom_bar_hidden: { def: false, type: 'bool' },
  dualclip_direct_col_shortcuts: { def: true, type: 'bool' },
  dualclip_mirror_in_all: { def: false, type: 'bool' },
  dualclip_autosort_rules: { def: '[]', type: 'string' },

  // Capture Behavior & Filtering
  dualclip_track_stats: { def: true, type: 'bool' },
  dualclip_capture_images: { def: true, type: 'bool' },
  
  dualclip_enable_syntax_highlighting: { def: false, type: 'bool' },
  dualclip_ignore_passwords: { def: true, type: 'bool' },
  dualclip_ignore_whitespace: { def: true, type: 'bool' },
  dualclip_ignore_blocklist: { def: true, type: 'bool' },
  dualclip_blocked_apps: { def: '[]', type: 'string' },
  dualclip_max_clips: { def: 500, type: 'int' },
  dualclip_min_clip_length: { def: 1, type: 'int' },
  dualclip_auto_expire_days: { def: 0, type: 'int' },
  dualclip_incognito: { def: false, type: 'bool' },

  // General & System Integration
  dualclip_autostart: { def: false, type: 'bool' },
  dualclip_start_hidden: { def: false, type: 'bool' },
  dualclip_show_taskbar: { def: false, type: 'bool' },
  dualclip_restore_clipboard: { def: false, type: 'bool' },
  dualclip_remember_view: { def: false, type: 'bool' },
  dualclip_smart_shortcuts: { def: true, type: 'bool' },
  dualclip_quick_number_paste: { def: false, type: 'bool' },
  dualclip_toasts_enabled: { def: true, type: 'bool' },
  dualclip_auto_check_updates: { def: false, type: 'bool' },
  dualclip_prevent_screen_capture: { def: false, type: 'bool' },
  dualclip_is_supporter: { def: false, type: 'bool' },
  dualclip_hotkey_cfg: { def: '', type: 'string' },

  // Interaction & Shortcuts
  dualclip_drag_out_mode: { def: 'file', type: 'enum', values: ['file', 'text'] },
  dualclip_plain_copy_shortcut_enabled: { def: true, type: 'bool' },
  dualclip_live_preview_enabled: { def: false, type: 'bool' },
  dualclip_hover_preview_enabled: { def: true, type: 'bool' },
  dualclip_hover_mode: { def: 'full', type: 'enum', values: ['full', 'preview_only', 'off'] },
  dualclip_hover_delay: { def: 200, type: 'int' },

  // UI State & Transitions
  dualclip_settings_tab: { def: 'general', type: 'string' },
  dualclip_onboarding_done: { def: true, type: 'bool' },
  dualclip_seen_onboarding_tip: { def: true, type: 'bool' },
  dualclip_meta_before_dense: { def: 'app-time', type: 'string' },
  dualclip_thumb_before_dense: { def: 'sm', type: 'string' },
  dualclip_imgmode_before_dense: { def: 'thumbnail_only', type: 'string' },

  // Internal State & Security Registers (audit S-P3)
  dualclip_deleted_collections: { def: '[]', type: 'string' },
  dualclip_colkey_migrated: { def: false, type: 'bool' },
  dualclip_remote_links: { def: '[]', type: 'string' },
  dualclip_suppress_in_fullscreen: { def: false, type: 'bool' },
  dualclip_used_marker: { def: '', type: 'string' }
});

function getSetting(key) {
  const meta = SETTING_DEFAULTS[key];
  if (!meta) {
    return localStorage.getItem(key);
  }

  const raw = localStorage.getItem(key);
  if (raw === null || typeof raw === 'undefined') {
    return meta.def;
  }

  switch (meta.type) {
    case 'bool':
      return raw === '1' || raw === 'true';
    case 'int': {
      const parsed = parseInt(raw, 10);
      return Number.isNaN(parsed) ? meta.def : parsed;
    }
    case 'enum':
      return (meta.values && meta.values.includes(raw)) ? raw : meta.def;
    default:
      return raw;
  }
}

function setSetting(key, value) {
  const meta = SETTING_DEFAULTS[key];
  let serialized;

  if (meta && meta.type === 'bool') {
    serialized = Boolean(value) ? '1' : '0';
  } else if (typeof value === 'object' && value !== null) {
    serialized = JSON.stringify(value);
  } else {
    serialized = String(value);
  }

  try {
    localStorage.setItem(key, serialized);
  } catch (e) {
    console.error('Failed to persist setting', key, e);
  }
  return serialized;
}

window.SETTING_DEFAULTS = SETTING_DEFAULTS;
window.getSetting = getSetting;
window.setSetting = setSetting;
