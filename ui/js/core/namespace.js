// --- DualClip Core Namespace & Shared State ---
window.DC = window.DC || {};

// --- Cold-start frontend timing (pairs with C# StartupProfiler) ---
// Marks record ms since page-script start; the table is flushed to app.log once
// at ui_ready via log_action (critical=true so it always lands, ~1 line/launch).
// Recording stops after ui_ready, so steady-state filtering never accumulates.
var __dcBootT0 = (typeof window.__dcHeadT0 === 'number') ? window.__dcHeadT0
  : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
var __dcBootMarks = [];
var __dcBootFlushed = false;
function __dcT0() {
  try { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  catch (e) { return Date.now(); }
}
function __dcSince(t0) {
  try {
    var t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return Math.round((t - t0) * 10) / 10;
  } catch (e) { return 0; }
}
function __dcMark(name) {
  try {
    if (__dcBootFlushed) return;
    var t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    __dcBootMarks.push([String(name), Math.round((t - __dcBootT0) * 10) / 10]);
  } catch (e) {}
}
function __dcFlushBootMarks() {
  try {
    if (__dcBootFlushed || __dcBootMarks.length === 0) return;
    __dcBootFlushed = true;
    var parts = [], prev = 0, i, d;
    for (i = 0; i < __dcBootMarks.length; i++) {
      d = Math.round((__dcBootMarks[i][1] - prev) * 10) / 10;
      parts.push(__dcBootMarks[i][0] + '=+' + d + 'ms');
      prev = __dcBootMarks[i][1];
    }
    var detail = 'frontend boot (ms since page start, total ' + __dcBootMarks[__dcBootMarks.length - 1][1] + 'ms): ' + parts.join(' | ');    __dcBootMarks = [];
  } catch (e) {}
}


function logLayoutDebug(msg) {
  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.write_debug_log === 'function') {
      window.pywebview.api.write_debug_log(msg);
    } else if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage({ id: 0, method: 'write_debug_log', args: [msg] });
    }
  } catch {}
}
window.logLayoutDebug = logLayoutDebug;
const DEFAULT_THUMBNAIL_SVG = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='92' height='56' viewBox='0 0 92 56'%3E%3Crect width='92' height='56' fill='%23121520' rx='6'/%3E%3Cpath d='M10 44l20-22 15 15 22-26 15 33z' fill='%232563eb' opacity='0.7'/%3E%3Ccircle cx='30' cy='18' r='7' fill='%2360a5fa'/%3E%3C/svg%3E";
const DEFAULT_HIGHRES_SVG = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='360' viewBox='0 0 600 360'%3E%3Crect width='600' height='360' fill='%230e111a' rx='10'/%3E%3Cpath d='M50 300l140-160 100 110 160-190 100 240z' fill='%232563eb' opacity='0.75'/%3E%3Ccircle cx='200' cy='110' r='40' fill='%2360a5fa'/%3E%3Ctext x='300' y='335' font-family='sans-serif' font-size='16' fill='%2394a3b8' text-anchor='middle'%3EDesktop Screenshot Capture • 1920 × 1080%3C/text%3E%3C/svg%3E";
window.SAMPLE_THUMBNAIL_SVG = DEFAULT_THUMBNAIL_SVG;
window.SAMPLE_HIGHRES_SVG = DEFAULT_HIGHRES_SVG;

function sanitizeImageSrc(src) {
  if (!src || typeof src !== 'string') return '';
  const trimmed = src.trim();
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('file:///') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('ui/') ||
    trimmed.startsWith('assets/')
  ) {
    return trimmed
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  return '';
}
window.sanitizeImageSrc = sanitizeImageSrc;

// Shared mutable data arrays and sets
var allClips = [];
var clips = [];
var selectedIndex = -1;
var selectedIndices = new Set();
var lastAnchorIndex = 0;
var expandedIndex = -1;
// Permanent ID-based selection source-of-truth. Survives re-filtering, re-sorting
// and background clipboard captures where indices silently shift.
var selectedIds = new Set();

// Capture the CURRENT index-based selection into selectedIds. Call before any
// operation that will re-filter / re-sort / rebuild the `clips` array.
function syncSelectedIds() {
  selectedIds.clear();
  try {
    if (selectedIndices && selectedIndices.size > 0) {
      selectedIndices.forEach(i => { if (clips[i] && clips[i].id != null) selectedIds.add(clips[i].id); });
    }
    if (selectedIds.size === 0 && selectedIndex >= 0 && clips[selectedIndex] && clips[selectedIndex].id != null) {
      selectedIds.add(clips[selectedIndex].id);
    }
  } catch(e) {}
}

// Rebuild the index-based selection from selectedIds against the CURRENT `clips`.
// Items filtered out / deleted / moved out of view are dropped; if nothing remains
// visible, clamp to the nearest index (mirrors restoreSelectionByIds fallback).
function revalidateSelectionFromIds() {
  selectedIndices.clear();
  let first = -1;
  try {
    if (selectedIds && selectedIds.size > 0) {
      selectedIds.forEach(id => {
        const idx = clips.findIndex(c => c && c.id === id);
        if (idx >= 0) { selectedIndices.add(idx); if (first === -1 || idx < first) first = idx; }
      });
    }
  } catch(e) {}
  if (selectedIndices.size > 0) {
    selectedIndex = first;
    lastAnchorIndex = first;
  } else if (clips.length > 0) {
    selectedIndex = Math.min(Math.max(0, lastAnchorIndex), clips.length - 1);
    selectedIndices.add(selectedIndex);
  } else {
    selectedIndex = -1;
    lastAnchorIndex = 0;
  }
  try { if (typeof syncLivePreview === 'function') syncLivePreview(); } catch(e) {}
}

// Selection helpers — ID-based preservation survives sort/filter (fixes stale-index after pin/fav/move)
function snapshotSelectedIds() {
  const ids = new Set();
  try {
    selectedIndices.forEach(i => { if (clips[i] && clips[i].id != null) ids.add(clips[i].id); });
    if (ids.size === 0 && selectedIndex >= 0 && clips[selectedIndex]) ids.add(clips[selectedIndex].id);
  } catch(e) {}
  return ids;
}
function restoreSelectionByIds(ids, fallbackAnchorIdx = 0) {
  selectedIndices.clear();
  let first = -1;
  if (ids && ids.size > 0) {
    ids.forEach(id => {
      const idx = clips.findIndex(c => c && c.id === id);
      if (idx >= 0) { selectedIndices.add(idx); if (first === -1 || idx < first) first = idx; }
    });
  }
  if (selectedIndices.size > 0) {
    selectedIndex = first;
    lastAnchorIndex = first;
  } else {
    // No remaining visible selected — clamp to nearest (handles move-to-other-collection vanishing)
    if (clips.length === 0) { selectedIndex = -1; lastAnchorIndex = 0; }
    else { selectedIndex = Math.min(Math.max(0, fallbackAnchorIdx), clips.length - 1); selectedIndices.add(selectedIndex); lastAnchorIndex = selectedIndex; }
  }
  try { if (typeof syncLivePreview === 'function') syncLivePreview(); } catch(e) {}
}
var currentCollection = 'all';
var currentFlatItems = [];
var currentPreviewClip = null;

// Filters and search state
var activeFilterType = 'all';
var activeFilterApp = 'all';
var activeFilterTime = 'any';
var contextTargetIndex = -1;

// UI View & Feature Flags
var hasNotifiedUiReady = false;
var isCapturePaused = false;
var isGroupedView = true;
var isWindowPinned = false;
var isHoverPreviewEnabled = false;
try {
  if (localStorage.getItem('dualclip_hover_preview_enabled') === '1') {
    isHoverPreviewEnabled = true;
  }
} catch(e) {}

// Feature Bisection Switches (all ON by default)
var FEATURES_ENABLED = {
  inlineEditor: true,
  nicknameModal: true,
  advancedFilters: true,
  collectionDragDrop: true,
  multiSelect: true,
  dragOut: true
};

function isFeatureEnabled(name) {
  return !!FEATURES_ENABLED[name];
}

// Persistent Section Collapse State (Default: all expanded)
var collapsedGroups = { today: false, yesterday: false, older: false };
try {
  const savedGroups = localStorage.getItem('dualclip_collapsed_groups');
  if (savedGroups) {
    const parsed = JSON.parse(savedGroups);
    if (parsed && typeof parsed === 'object') {
      collapsedGroups = Object.assign({ today: false, yesterday: false, older: false }, parsed);
    }
  }
} catch(e) {
  collapsedGroups = { today: false, yesterday: false, older: false };
}

// Interaction & Display State
var hoverPreviewDelayMs = 1000;
var hoverCardMode = 'meta';
var imageDisplayMode = 'thumbnail_only';
var hoverTimer = null;
var currentZebraStyle = 'off';
var currentLineDisplay = 'auto';
var groupingMode = 'date';
var sectionClickMode = 'chevron_only';
var currentThumbSize = 'sm';

try {
  hoverPreviewDelayMs = parseInt(localStorage.getItem('dualclip_hover_delay') || '1000', 10);
  hoverCardMode = localStorage.getItem('dualclip_hover_mode') || 'meta';
  imageDisplayMode = localStorage.getItem('dualclip_image_display_mode') || 'thumbnail_only';
  currentZebraStyle = localStorage.getItem('dualclip_zebra_style') || 'off';
  currentLineDisplay = localStorage.getItem('dualclip_line_display') || 'auto';
  if (currentLineDisplay === 'full' || !['1', '2', '3', 'auto'].includes(currentLineDisplay)) {
    currentLineDisplay = 'auto';
    try { localStorage.setItem('dualclip_line_display', 'auto'); } catch(e) {}
  }
  groupingMode = localStorage.getItem('dualclip_grouping_mode') || 'date';
  isGroupedView = groupingMode !== 'none';
  sectionClickMode = localStorage.getItem('dualclip_section_click_mode') || 'chevron_only';
  currentThumbSize = localStorage.getItem('dualclip_thumb_size') || 'sm';
} catch(e) {}

// Zoom & Window Dimensions
var currentZoomLevel = 1.0;
var currentBaseWidth = 970;
var currentBaseHeight = 730;

// Collections — 100% clean slate for fresh installs: zero third-party presets.
// Bottom bar shows static pills (All Items / Favorites / Most Used, in index.html)
// plus dynamic pills from customCollections. No built-in dynamic pills.
var customCollections = [];
const PROTOTYPE_COLLECTIONS = [];
// Retired demo pills from the old seed — stripped from existing installs on load.
const RETIRED_DEMO_COLLECTION_IDS = ['code', 'links', 'notes', 'terminal', 'images', 'snippets', 'work', 'personal', 'dev', 'web', 'screenshots'];
const RESERVED_COLLECTION_IDS = ['all', 'pins', 'most_used'];
try {
  const savedColls = localStorage.getItem('dualclip_custom_collections');
  let tombstones = new Set();
  try {
    const rawTomb = JSON.parse(localStorage.getItem('dualclip_deleted_collections') || '[]');
    if (Array.isArray(rawTomb)) tombstones = new Set(rawTomb);
  } catch (_) {}

  const SYSTEM_RESERVED_IDS = new Set(['all', 'pins', 'most_used', 'favorites', 'all_total', 'all_unorganized', 'transcriptions', 'voice']);
  if (savedColls) {
    customCollections = JSON.parse(savedColls);
    customCollections = customCollections.filter(c => c && !RETIRED_DEMO_COLLECTION_IDS.includes(c.id) && !tombstones.has(c.id) && !SYSTEM_RESERVED_IDS.has(String(c.id).toLowerCase()));
    try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch (_) {}
  } else {
    customCollections = [];
  }
  if (!Array.isArray(customCollections)) customCollections = [];
} catch(e) {
  customCollections = [];
}

// H5/D3: rehydrate collection definitions from the backend mirror when the local
// cache is empty, synthesize placeholders for orphan membership groups, and run the
// one-time name→id membership sweep (Step 9). Retries until the bridge is ready.
window.__collectionsHydrated = false;
function rehydrateCollectionsFromBackend(attempt, force) {
  if (window.__collectionsHydrated && !force) return;
  attempt = attempt || 0;
  let api = null;
  try { api = window.pywebview && window.pywebview.api ? window.pywebview.api : null; } catch (e) { api = null; }
  if (!api || typeof api.get_collections !== 'function') {
    if (attempt < 20) { try { setTimeout(() => rehydrateCollectionsFromBackend(attempt + 1, force), 500); } catch (e) {} }
    return;
  }
  try {
    let tombstones = new Set();
    try {
      const rawTomb = JSON.parse(localStorage.getItem('dualclip_deleted_collections') || '[]');
      if (Array.isArray(rawTomb)) tombstones = new Set(rawTomb);
    } catch (_) {}

    const SYSTEM_RESERVED_IDS = new Set(['all', 'pins', 'most_used', 'favorites', 'all_total', 'all_unorganized', 'transcriptions', 'voice']);
    api.get_collections().then(res => {
      try {
        if (res && res.ok && Array.isArray(res.collections)) {
          if (force) {
            // When forced (e.g. after a package import), clear tombstones for any collections that exist in the imported DB
            res.collections.forEach(d => {
              if (d && d.id && tombstones.has(d.id)) {
                tombstones.delete(d.id);
                try {
                  const rawList = JSON.parse(localStorage.getItem('dualclip_deleted_collections') || '[]');
                  if (Array.isArray(rawList)) {
                    localStorage.setItem('dualclip_deleted_collections', JSON.stringify(rawList.filter(x => x !== d.id)));
                  }
                } catch (_) {}
              }
            });
          }

          const dbDefs = res.collections.filter(d => d && d.id && !tombstones.has(d.id) && !SYSTEM_RESERVED_IDS.has(String(d.id).toLowerCase()));
          const localIds = new Set(customCollections.map(c => c && c.id));
          if (localIds.size === 0 && dbDefs.length > 0) {
            customCollections = dbDefs.map(d => ({ id: d.id, name: d.name || d.id, pinned: !!d.pinned, parentId: d.parentId || null }));
            try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch (e) {}
            if (typeof renderCollectionPills === 'function') { try { renderCollectionPills(); } catch (e) {} }
          } else {
            // Merge in any DB collections that local doesn't have yet (bidirectional sync)
            let updated = false;
            dbDefs.forEach(d => {
              if (d && d.id && !localIds.has(d.id)) {
                customCollections.push({ id: d.id, name: d.name || d.id, pinned: !!d.pinned, parentId: d.parentId || null });
                localIds.add(d.id);
                updated = true;
              } else if (d && d.id) {
                const existing = customCollections.find(c => c && c.id === d.id);
                if (existing && d.parentId !== undefined && existing.parentId !== d.parentId) {
                  existing.parentId = d.parentId || null;
                  updated = true;
                }
              }
            });
            if (updated) {
              try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch (e) {}
              if (typeof renderCollectionPills === 'function') { try { renderCollectionPills(); } catch (e) {} }
            }
            // Mirror any local-only definitions up so the DB stays complete.
            // S2: pass the local parent through — omitting it would write parent_id = NULL
            // and silently un-nest the folder on the next hydrate.
            customCollections.forEach((c, idx) => {
              if (c && c.id && !tombstones.has(c.id) && !dbDefs.some(d => d.id === c.id) && api && typeof api.save_collection === 'function') {
                try { api.save_collection(c.id, c.name || c.id, !!c.pinned, idx, c.parentId || null); } catch (e) {}
              }
            });
          }
        }
      } catch (e) {}
      // Orphan membership groups: clips referencing an id with no definition
      try {
        if (api && typeof api.get_collection_counts === 'function') {
          api.get_collection_counts().then(cres => {
            try {
              if (cres && cres.ok && cres.counts) {
                const known = new Set(customCollections.map(c => c && c.id));
                let added = false;
                Object.keys(cres.counts).forEach(colId => {
                  if (!colId || known.has(colId)) return;
                  if (force && tombstones.has(colId)) {
                    tombstones.delete(colId);
                    try {
                      const rawList = JSON.parse(localStorage.getItem('dualclip_deleted_collections') || '[]');
                      if (Array.isArray(rawList)) {
                        localStorage.setItem('dualclip_deleted_collections', JSON.stringify(rawList.filter(x => x !== colId)));
                      }
                    } catch (_) {}
                  } else if (tombstones.has(colId)) {
                    if (typeof api.reassign_collection === 'function') {
                      try { api.reassign_collection(colId, 'all'); } catch (_) {}
                    }
                    return;
                  }
                  const low = String(colId).toLowerCase();
                  if (RESERVED_COLLECTION_IDS.indexOf(low) !== -1) return;
                  if (RETIRED_DEMO_COLLECTION_IDS.indexOf(colId) !== -1) return;
                  customCollections.push({ id: colId, name: colId });
                  known.add(colId);
                  added = true;
                  try { if (typeof api.save_collection === 'function') api.save_collection(colId, colId, false, customCollections.length - 1, null); } catch (e) {}
                });
                if (added) {
                  try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch (e) {}
                  if (typeof renderCollectionPills === 'function') { try { renderCollectionPills(); } catch (e) {} }
                }
              }
            } catch (e) {}
          }).catch(() => {});
        }
      } catch (e) {}
      // One-time name→id sweep (Step 9): gated in localStorage, never touches user_version
      try {
        if (!localStorage.getItem('dualclip_colkey_migrated') && customCollections.length > 0 && typeof api.migrate_collection_keys === 'function') {
          const pairs = customCollections.filter(c => c && c.id && c.name && c.id !== c.name).map(c => ({ id: c.id, name: c.name }));
          if (pairs.length > 0) {
            api.migrate_collection_keys(pairs).then(() => {
              try { localStorage.setItem('dualclip_colkey_migrated', '1'); } catch (e) {}
            }).catch(() => {});
          } else {
            try { localStorage.setItem('dualclip_colkey_migrated', '1'); } catch (e) {}
          }
        }
      } catch (e) {}
      // S5: the selected collection may no longer exist (package import swapped
      // the DB, forced tombstone sweep, corrupted cache). Bounce to All Clips
      // instead of showing an empty list with no active row.
      try {
        const cur = (typeof currentCollection !== 'undefined') ? currentCollection : 'all';
        const known = cur === 'all' || cur === 'pins' || cur === 'most_used'
          || (Array.isArray(customCollections) && customCollections.some(c => c && c.id === cur));
        if (!known && typeof selectCollection === 'function') {
          try { selectCollection('all'); } catch (_) {}
          if (typeof showToast === 'function') showToast('That collection no longer exists — showing All Clips');
        }
      } catch (_) {}
      window.__collectionsHydrated = true;
    }).catch(() => {
      if (attempt < 20) { try { setTimeout(() => rehydrateCollectionsFromBackend(attempt + 1), 500); } catch (e) {} }
    });
  } catch (e) {}
}
if (typeof window !== 'undefined') {
  window.rehydrateCollectionsFromBackend = rehydrateCollectionsFromBackend;
}
try { setTimeout(() => rehydrateCollectionsFromBackend(0), 1500); } catch (e) {}

// Auto-Sort Rules — clean slate for fresh installs: zero presets
const DEFAULT_AUTO_SORT_RULES = [];
var autoSortRules = [];
try {
  const savedRules = localStorage.getItem('dualclip_autosort_rules');
  if (savedRules) {
    autoSortRules = JSON.parse(savedRules);
  }
  if (!Array.isArray(autoSortRules) || autoSortRules.length === 0) {
    autoSortRules = [...DEFAULT_AUTO_SORT_RULES];
    try { localStorage.setItem('dualclip_autosort_rules', JSON.stringify(autoSortRules)); } catch (_) {}
  }
  // One-time purge of retired seeded rule (rule_wispr / Wispr Flow Helper.exe):
  try {
    const before = autoSortRules.length;
    autoSortRules = autoSortRules.filter(r => !(r && ((r.id === 'rule_wispr') || (r.process && String(r.process).toLowerCase().includes('wispr')))));
    if (autoSortRules.length !== before) localStorage.setItem('dualclip_autosort_rules', JSON.stringify(autoSortRules));
  } catch (_) {}
} catch(e) {
  autoSortRules = [...DEFAULT_AUTO_SORT_RULES];
}

// Custom Application Blocklist
var blockedApps = [];
var isBlocklistEnabled = true;
try {
  isBlocklistEnabled = localStorage.getItem('dualclip_ignore_blocklist') !== '0';
  const savedBlocked = localStorage.getItem('dualclip_blocked_apps');
  if (savedBlocked) {
    blockedApps = JSON.parse(savedBlocked);
    if (!Array.isArray(blockedApps)) blockedApps = [];
  } else {
    blockedApps = [];
  }
} catch(e) {
  blockedApps = [];
  isBlocklistEnabled = true;
}

// Persistent Bottom Collections Bar State
var isCollectionsBarHidden = false;
try {
  isCollectionsBarHidden = localStorage.getItem('dualclip_bottom_bar_hidden') === 'true';
} catch(e) {}

// Hotkey Recording State
var isRecordingHotkey = false;
var hotkeyAbortHandler = null;

// Window Dragging State
var isWindowDragging = false;
var dragStartScreenX = 0, dragStartScreenY = 0;
var dragStartWinX = 0, dragStartWinY = 0;

// Blur Auto-Hide Timers
var blurHideTimer = null;
var windowShowTimestamp = 0;

// Universal HTML Escape Utility (attribute & DOM safe)
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

// Surrogate-safe slice: never cuts a UTF-16 surrogate pair in half (prevents broken  glyphs)
function safeSlice(str, n) {
  if (typeof str !== 'string' || str.length <= n) return str || '';
  let cut = n;
  const code = str.charCodeAt(cut - 1);
  if (code >= 0xD800 && code <= 0xDBFF) cut -= 1;
  return str.slice(0, cut);
}
window.safeSlice = safeSlice;

// Selection helpers — global exposure so any module can snapshot/restore by ID
window.syncSelectedIds = syncSelectedIds;
window.revalidateSelectionFromIds = revalidateSelectionFromIds;

// Expose state container on window.DC
window.DC.state = {
  get allClips() { return allClips; },
  set allClips(v) { allClips = v; },
  get clips() { return clips; },
  set clips(v) { clips = v; },
  get selectedIndex() { return selectedIndex; },
  set selectedIndex(v) { selectedIndex = v; },
  get selectedIndices() { return selectedIndices; },
  get selectedIds() { return selectedIds; },
  get currentCollection() { return currentCollection; },
  set currentCollection(v) { currentCollection = v; },
  get customCollections() { return customCollections; },
  set customCollections(v) { customCollections = v; },
  get isCapturePaused() { return isCapturePaused; },
  set isCapturePaused(v) { isCapturePaused = v; },
  get isWindowPinned() { return isWindowPinned; },
  set isWindowPinned(v) { isWindowPinned = v; }
};

try { if (typeof __dcMark === 'function') __dcMark('scripts.ns.parsed'); } catch (e) {}
