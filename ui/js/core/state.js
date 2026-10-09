// --- DualClip State Management & Backend Event Handlers ---

// Forward uncaught JS errors to app.log so blank-screen incidents are diagnosable in release builds
// Enhanced to capture stack + error object (fixes opaque "Script error." in WebView2 file:// context)
window.addEventListener('error', (e) => {
  try {
    const src = e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : '';
    const stack = e.error && e.error.stack ? ` | stack: ${String(e.error.stack).slice(0, 900)}` : '';
    const errName = e.error && e.error.name ? ` [${e.error.name}]` : '';
    const detail = `${e.message || 'unknown error'}${errName}${src}${stack}`;
    // Console only. No backend logging in release builds.
    try { console.error('[DualClip JS Error]', detail, e.error); } catch (_) {}
  } catch (_) {}
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    let reason = '';
    if (e.reason instanceof Error) {
      reason = `${e.reason.name || 'Error'}: ${e.reason.message} | stack: ${String(e.reason.stack || '').slice(0, 900)}`;
    } else {
      reason = String(e.reason);
    }
    try { console.error('[DualClip unhandledrejection]', reason, e.reason); } catch (_) {}
  } catch (_) {}
});

// Optimistic Mutation Shields: prevent in-flight background fetches from clobbering user pin/fav actions
const pendingPinOverrides = new Map();
const pendingFavOverrides = new Map();
if (typeof window !== 'undefined') {
  window.pendingPinOverrides = pendingPinOverrides;
  window.pendingFavOverrides = pendingFavOverrides;
}

// Calculate the date group ('pinned', 'today', 'yesterday', 'older') for a clip
function calcClipTimeGroup(c) {
  if (!c) return 'today';
  if (c.pinned) return 'pinned';
  try {
    const d = new Date(c.last_used_at || c.created_at || Date.now());
    const now = new Date();
    const nd = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((nd - dd) / 86400000);
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    return 'older';
  } catch(e) { return c.time_group || 'today'; }
}
if (typeof window !== 'undefined') {
  window.calcClipTimeGroup = calcClipTimeGroup;
}

function formatClipForUI(c) {
  if (!c) return null;
  const isImg = Boolean(c.is_image);
  const prev = c.preview || (c.text_content ? (typeof safeSlice === 'function' ? safeSlice(c.text_content, 120) : c.text_content.slice(0, 120)) : (isImg ? 'Screenshot Image' : 'Untitled'));
  let srcApp = c.src_process || '';
  let appIcon = c.app_icon || '';
  try {
    if (c.meta_json) {
      const meta = typeof c.meta_json === 'string' ? JSON.parse(c.meta_json) : c.meta_json;
      if (!srcApp && meta.src_process) srcApp = meta.src_process;
      if (!appIcon && meta.app_icon) appIcon = meta.app_icon;
    }
  } catch(e) {}
  if (!srcApp) srcApp = isImg ? 'Image' : 'Clipboard';
  if (appIcon && typeof appIcon === 'string' && appIcon.startsWith('data:image/')) {
    if (String(srcApp).toLowerCase().includes('dualclip') && typeof window !== 'undefined') {
      window.DUALCLIP_APP_ICON = appIcon;
    }
  } else if (!appIcon && String(srcApp).toLowerCase().includes('dualclip') && typeof window !== 'undefined' && window.DUALCLIP_APP_ICON) {
    appIcon = window.DUALCLIP_APP_ICON;
  }

  let thumb = '';
  if (isImg) {
    thumb = c.thumbnail_data || window.SAMPLE_THUMBNAIL_SVG || '';
  } else {
    thumb = c.thumbnail_data || '';
  }

  return {
    id: c.id,
    title: c.title || (isImg ? (srcApp + ' Screenshot') : (typeof safeSlice === 'function' ? safeSlice(prev, 60) : prev.slice(0, 60))),
    track: c.track || 'manual',
    use_count: typeof c.use_count === 'number' ? c.use_count : (parseInt(c.use_count, 10) || 0),
    src_process: srcApp,
    app_icon: appIcon,
    image_path: c.image_path || '',
    is_image: isImg,
    image_data: (c.image_data && !c.image_data.startsWith('file:///')) ? c.image_data : (c.thumbnail_data || (isImg ? (window.SAMPLE_HIGHRES_SVG || '') : '')),
    thumbnail_data: thumb,
    img_dims: c.img_dims || (isImg ? 'Screenshot' : ''),
    img_size: c.img_size || '',
    text_content: c.text_content || (isImg ? '' : prev),
    preview: prev,
    char_count: c.char_count || (c.text_content ? c.text_content.length : 0),
    created_at: c.created_at || new Date().toISOString(),
    last_used_at: c.last_used_at || c.created_at || new Date().toISOString(),
    // Monotonic capture order from the backend. last_used_at only has second precision, so this is
    // the tiebreaker that keeps rapid consecutive captures (Wispr dictation + clipboard restore) in
    // the right slots instead of falling back to the highest id.
    sort_rank: typeof c.sort_rank === 'number' ? c.sort_rank : (parseInt(c.sort_rank, 10) || 0),
    time_group: calcClipTimeGroup(c),
    age_label: (() => {
      try {
        const d = new Date(c.last_used_at || c.created_at || Date.now());
        const now = new Date();
        const diffMs = now - d;
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 0 || diffSec < 60) return 'Just now';
        if (diffSec < 3600) return `${Math.floor(diffSec/60)}m ago`;
        
        const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const dMid = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diffDays = Math.round((nowMid - dMid)/86400000);

        if (diffDays <= 0) {
          const h = Math.floor(diffSec/3600);
          if (h < 6) return `${h}h ago`;
          const hh = String(d.getHours()).padStart(2,'0');
          const mm = String(d.getMinutes()).padStart(2,'0');
          return `${hh}:${mm}`;
        }
        if (diffDays === 1) {
          const hh = d.getHours(); const mm = String(d.getMinutes()).padStart(2,'0');
          const ampm = hh >= 12 ? 'PM' : 'AM'; const h12 = hh % 12 || 12;
          return `Yesterday ${h12}:${mm} ${ampm}`;
        }
        const opts = now.getFullYear() !== d.getFullYear() ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' };
        return d.toLocaleDateString('en-US', opts);
      } catch(e) { return c.age_label || 'Just now'; }
    })(),
    pinned: c.pinned ? 1 : 0,
    // Real tag assignments from clip_tags/tags. Distinct from `nickname`,
    // which is a free-text label and is NOT a reliable tag proxy.
    tags: Array.isArray(c.tags) ? c.tags
        : (typeof c.tags === 'string' && c.tags ? c.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
    favorite: c.favorite ? 1 : 0,
    nickname: c.nickname || '',
    custom_title: c.custom_title || '',
    collection: (() => {
      let assignedCol = c.collection || (isImg ? 'screenshots' : 'all');
      if (assignedCol === 'all' || !c.collection) {
        if (typeof findAutoSortRule === 'function') {
          const matched = findAutoSortRule(srcApp, c.text_content || c.preview || '', c.title || c.src_title || '');
          if (matched) {
            // M8: never resurrect a user-deleted collection; fall back to All
            const tombstoned = (typeof isCollectionTombstoned === 'function') && isCollectionTombstoned(matched.collectionId);
            if (!tombstoned) {
              assignedCol = matched.collectionId;
              if (Array.isArray(customCollections) && !customCollections.some(col => col.id === matched.collectionId)) {
                customCollections.push({ id: matched.collectionId, name: matched.collectionName || matched.collectionId });
                if (typeof saveCustomCollections === 'function') saveCustomCollections();
                if (typeof renderCollectionPills === 'function') renderCollectionPills();
              }
            }
          }
        }
      }
      return assignedCol;
    })(),
    meta_json: typeof c.meta_json === 'string' ? c.meta_json : JSON.stringify(c.meta_json || { src_process: srcApp })
  };
}

var pendingWindowShowLoad = false;

// Guards get_clips races: every loadClipsFromBackend call takes a sequence number
// and stale responses are discarded, so a slow old query can never overwrite the
// results of a newer query (rapid typing, show-path vs debounce-path races).
var clipFetchSeq = 0;

// Infinite scroll pagination: initial fetch loads one page; scrolling near the
// end appends further pages. Reset to offset 0 on every new query/filter.
var clipPageSize = 100; // mirrors SearchConstants.UiPageSize
var hasMoreClips = true;
var isLoadingMoreClips = false;
// Monotonic server-row offset for infinite scroll. Must NOT be derived from
// allClips.length: deleting a loaded clip shrinks that array and would rewind the
// offset, moving every later page boundary and skipping rows. Advances only by the
// number of rows the server actually returned. Reset on every full load.
var clipsLoadedOffset = 0;

function notifyUiReadyOnce() {
  if (hasNotifiedUiReady) return;
  hasNotifiedUiReady = true;
  if (typeof __dcMark === 'function') { try { __dcMark('ui_ready.queued'); } catch (e) {} }
  // Double rAF guarantees layout calculation and initial paint have occurred
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Flush the frontend boot table to app.log first so the marks precede ui_ready.
      if (typeof __dcFlushBootMarks === 'function') { try { __dcFlushBootMarks(); } catch (e) {} }
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.ui_ready === 'function') {
        window.pywebview.api.ui_ready();
      } else if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage({ id: 0, method: 'ui_ready', args: [] });
      }
    });
  });
}


function loadClipsFromBackend(query = null) {
  hasMoreClips = true;
  isLoadingMoreClips = false;
  clipsLoadedOffset = 0;
  

  // Full SQLite Backend Database Loading
  if (!window.pywebview || !window.pywebview.api || typeof window.pywebview.api.get_clips !== 'function') {
    allClips = [];
    hasMoreClips = false;
    selectedIndex = 0;
    selectedIndices.clear();
    lastAnchorIndex = 0;
    pendingWindowShowLoad = false;
    if (typeof applyFilters === 'function') {
      try { applyFilters(); } catch(e) {}
    }
    if (typeof syncLivePreview === 'function') {
      try { syncLivePreview(); } catch(e) {}
    }
    notifyUiReadyOnce();
    return Promise.resolve();
  }

  const inputEl = document.getElementById('searchInput');
  const liveInputVal = inputEl ? inputEl.value.trim() : '';
  const queryStr = (typeof query === 'string')
    ? query
    : ((typeof currentSearchQuery === 'string' && currentSearchQuery) ? currentSearchQuery : liveInputVal);
  if (typeof currentSearchQuery !== 'undefined') {
    currentSearchQuery = queryStr;
  }
  const sortOrder = queryStr
    ? (typeof searchSortMode !== 'undefined' ? searchSortMode : 'default')
    : ((typeof currentCollection !== 'undefined' && currentCollection !== 'all')
        ? (localStorage.getItem('dualclip_collection_sort_order') || 'newest')
        : 'default');

  const myFetch = ++clipFetchSeq;
  if (typeof __dcMark === 'function') { try { __dcMark('loadClips.call seq=' + myFetch); } catch (e) {} }
  var __dcRpcT0 = (typeof __dcT0 === 'function') ? __dcT0() : Date.now();
  // Only real SQLite fetches are dedup-gated; mock/fallback returns skip the gate.
  var __dcIsRealFetch = !!(window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clips === 'function');
  if (__dcIsRealFetch) { try { window.__dcBootRealInFlight = true; } catch (e) {} }
  return window.pywebview.api.get_clips(
    typeof currentCollection !== 'undefined' ? currentCollection : 'all',
    typeof activeFilterType !== 'undefined' ? activeFilterType : 'all',
    typeof activeFilterApp !== 'undefined' ? activeFilterApp : 'all',
    typeof activeFilterTime !== 'undefined' ? activeFilterTime : 'any',
    queryStr,
    sortOrder,
    clipPageSize,
    0,
    typeof isFuzzySearchEnabled !== 'undefined' ? isFuzzySearchEnabled : (typeof getSetting === 'function' ? getSetting('dualclip_fuzzy_search') : false)
  ).then(res => {
    if (myFetch !== clipFetchSeq) return; // stale response — a newer fetch already superseded it
    if (res && res.stale) return; // backend cancelled this sequence; do not overwrite with empty list
    pendingWindowShowLoad = false;
    var __dcList = (res && res.clips && Array.isArray(res.clips)) ? res.clips
      : (res && res.data && Array.isArray(res.data)) ? res.data : null;
    if (res && __dcList) {
      if (typeof res.gen === 'number') { window._lastRenderedGen = res.gen; }
      if (typeof __dcMark === 'function') { try { __dcMark('get_clips.recv n=' + __dcList.length + ' ' + __dcSince(__dcRpcT0) + 'ms'); } catch (e) {} }
      hasMoreClips = __dcList.length >= clipPageSize;
      allClips = __dcList.map(c => {
        const item = formatClipForUI(c);
        if (item && pendingPinOverrides.has(item.id)) {
          const override = pendingPinOverrides.get(item.id);
          if (Date.now() - override.timestamp < 3500) {
            item.pinned = override.pinned;
            if (typeof calcClipTimeGroup === 'function') item.time_group = calcClipTimeGroup(item);
          } else {
            pendingPinOverrides.delete(item.id);
          }
        }
        if (item && pendingFavOverrides.has(item.id)) {
          const override = pendingFavOverrides.get(item.id);
          if (Date.now() - override.timestamp < 3500) {
            item.favorite = override.favorite;
          } else {
            pendingFavOverrides.delete(item.id);
          }
        }
        return item;
      });
      if (Array.isArray(allClips) && typeof customCollections !== 'undefined' && Array.isArray(customCollections)) {
        const knownCols = new Set(customCollections.map(c => c && c.id));
        let addedNewCol = false;
        allClips.forEach(c => {
          if (c && c.collection && c.collection !== 'all' && c.collection !== 'pins' && c.collection !== 'most_used' && c.collection !== 'favorites' && !knownCols.has(c.collection)) {
            customCollections.push({ id: c.collection, name: c.collection });
            knownCols.add(c.collection);
            addedNewCol = true;
          }
        });
        if (addedNewCol) {
          try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch(e) {}
          if (typeof renderCollectionPills === 'function') renderCollectionPills();
        }
      }
      // ORDER CONTRACT: the backend SQLite ranker is the sole authority for search
      // result order. Record the fulfilled query and never re-sort a search
      // response — it renders verbatim. Browsing (empty query) keeps local sort.
      // (Guarded by Frontend_Preserves_Backend_Search_Order.)
      window._lastBackendQuery = String(queryStr || '').toLowerCase();
      if (!queryStr && typeof sortAllClips === 'function') sortAllClips();
      if (typeof __dcMark === 'function') { try { __dcMark('sorted'); } catch (e) {} }
      if (typeof applyFilters === 'function') {
        var __dcAfT0 = (typeof __dcT0 === 'function') ? __dcT0() : Date.now();
        applyFilters();
        if (typeof __dcMark === 'function') { try { __dcMark('applyFilters.done ' + __dcSince(__dcAfT0) + 'ms'); } catch (e) {} }
      }
      if (typeof syncLivePreview === 'function') syncLivePreview();
      if (typeof maybeRefreshBackendColCounts === 'function') { try { maybeRefreshBackendColCounts(true); } catch {} }
      if (typeof renderCollectionPills === 'function') { try { renderCollectionPills(); } catch {} }
      if (typeof updateSidebarCounts === 'function') { try { updateSidebarCounts(); } catch {} }
      if (__dcList.length > 0) {
        window._lastKnownNonEmpty = true;
      } else if (!window._bootReconciled && window._lastKnownNonEmpty) {
        // Boot rendered 0 clips despite previous non-empty state
        var lastClear = window._lastClearAt || 0;
        var fetchStartedAt = __dcRpcT0 || 0;
        if (lastClear < fetchStartedAt) {
          // No intentional clear occurred since this fetch was initiated.
          window._bootReconciled = true;
          setTimeout(function() {
            if (typeof loadClipsFromBackend === 'function') loadClipsFromBackend();
          }, 150);
        } else {
          window._bootReconciled = true;
        }
      }
      try { if (__dcIsRealFetch) { window.__dcBootRealDone = true; window.__dcBootRealInFlight = false; } } catch (e) {}
    }
    if (!res || !__dcList || (res && res.ok === false)) {
      if (!window._bootFetchRetried && (!res || res.error || !res.ok)) {
        window._bootFetchRetried = true;
        setTimeout(() => {
          if (typeof loadClipsFromBackend === 'function') loadClipsFromBackend(queryStr);
        }, 200);
      }
    }
    notifyUiReadyOnce();
    return res;
  }).catch((err) => {
    if (myFetch !== clipFetchSeq) return; // stale failure — never clobber newer data
    pendingWindowShowLoad = false;
    try { if (__dcIsRealFetch) window.__dcBootRealInFlight = false; } catch (e) {}
    if (!window._bootFetchRetried) {
      window._bootFetchRetried = true;
      setTimeout(() => {
        if (typeof loadClipsFromBackend === 'function') loadClipsFromBackend(queryStr);
      }, 200);
    }
    notifyUiReadyOnce();
  });
}

// Infinite scroll: fetch the next page (offset = loaded count) and append it.
// Guarded by isLoadingMoreClips + hasMoreClips + shared clipFetchSeq so fast
// scrolling can never fire duplicate or stale fetches. Failures keep existing clips.
function loadNextClipPage() {
  if (isLoadingMoreClips || !hasMoreClips) return Promise.resolve();
  if (!window.pywebview || !window.pywebview.api || typeof window.pywebview.api.get_clips !== 'function') return Promise.resolve();
  if (!Array.isArray(allClips) || allClips.length === 0) return Promise.resolve();
  isLoadingMoreClips = true;
  const offset = clipsLoadedOffset;
  const inputEl = document.getElementById('searchInput');
  const liveInputVal = inputEl ? inputEl.value.trim() : '';
  const queryStr = (typeof currentSearchQuery === 'string' && currentSearchQuery) ? currentSearchQuery : liveInputVal;
  const sortOrder = queryStr
    ? (typeof searchSortMode !== 'undefined' ? searchSortMode : 'default')
    : ((typeof currentCollection !== 'undefined' && currentCollection !== 'all')
        ? (localStorage.getItem('dualclip_collection_sort_order') || 'newest')
        : 'default');
  const myFetch = ++clipFetchSeq;
  return window.pywebview.api.get_clips(
    typeof currentCollection !== 'undefined' ? currentCollection : 'all',
    typeof activeFilterType !== 'undefined' ? activeFilterType : 'all',
    typeof activeFilterApp !== 'undefined' ? activeFilterApp : 'all',
    typeof activeFilterTime !== 'undefined' ? activeFilterTime : 'any',
    queryStr,
    sortOrder,
    clipPageSize,
    offset,
    typeof isFuzzySearchEnabled !== 'undefined' ? isFuzzySearchEnabled : (typeof getSetting === 'function' ? getSetting('dualclip_fuzzy_search') : false)
  ).then(res => {
    isLoadingMoreClips = false;
    if (myFetch !== clipFetchSeq) return res; // superseded by a newer full load
    var __dcList = (res && res.clips && Array.isArray(res.clips)) ? res.clips
      : (res && res.data && Array.isArray(res.data)) ? res.data : null;
    if (!res || !__dcList) return res;
    // Advance by rows the server returned, not by the de-duplicated survivors, so a
    // concurrent delete can never desynchronise the server window from this offset.
    clipsLoadedOffset += __dcList.length;
    if (__dcList.length < clipPageSize) hasMoreClips = false;
    const seenIds = new Set(allClips.map(c => c && c.id));
    const fresh = __dcList.map(c => {
      const item = formatClipForUI(c);
      if (item && typeof pendingPinOverrides !== 'undefined' && pendingPinOverrides.has(item.id)) {
        const override = pendingPinOverrides.get(item.id);
        if (Date.now() - override.timestamp < 3500) {
          item.pinned = override.pinned;
          if (typeof calcClipTimeGroup === 'function') item.time_group = calcClipTimeGroup(item);
        } else {
          pendingPinOverrides.delete(item.id);
        }
      }
      if (item && typeof pendingFavOverrides !== 'undefined' && pendingFavOverrides.has(item.id)) {
        const override = pendingFavOverrides.get(item.id);
        if (Date.now() - override.timestamp < 3500) {
          item.favorite = override.favorite;
        } else {
          pendingFavOverrides.delete(item.id);
        }
      }
      return item;
    }).filter(item => item && !seenIds.has(item.id));
    if (fresh.length > 0) {
      allClips = allClips.concat(fresh);
      window._lastBackendQuery = String(queryStr || '').toLowerCase();
      if (!queryStr && typeof sortAllClips === 'function') sortAllClips();
      if (typeof applyFilters === 'function') {
        try { applyFilters(); } catch(e) {}
      }
    }
    return res;
  }).catch(() => {
    isLoadingMoreClips = false;
  });
}




function updatePauseStateUI(paused) {
  isCapturePaused = !!paused;
  window.isCapturePaused = isCapturePaused;
  if (!isCapturePaused && pauseTimerId) {
    clearInterval(pauseTimerId);
    pauseTimerId = null;
    pauseRemainingSeconds = 0;
  }
  const toggle = document.getElementById('stIncognitoToggle');
  if (toggle) {
    toggle.classList.toggle('on', isCapturePaused);
  }
  const badge = document.getElementById('pausedIndicator');
  if (badge) {
    badge.style.display = isCapturePaused ? 'inline-block' : 'none';
    if (!isCapturePaused) {
      badge.textContent = 'PAUSED';
    }
  }
}

let pauseTimerId = null;
let pauseRemainingSeconds = 0;
let lastBackgroundAddTs = 0;
let pendingHiddenRender = null;
// Visible-window burst coalescing: if 3+ ClipAdded within 16ms, coalesce applyFilters/renderList to one rAF (keep single-copy instant via one-frame 16ms window)
let _visibleBurstQueue = [];
let _visibleBurstTimer = null;
let _visibleBurstFirstTs = 0;
let _visibleBurstRaf = null;
// Explicit visibility flag pushed from C# on hide/show — primary, with document.hidden fallback for startup race
var _windowVisible = false;
try { if (typeof document !== 'undefined' && document.visibilityState === 'visible') _windowVisible = true; } catch {}
var _lastHiddenAt = 0;
var _needsRefetch = false;
var hiddenRenderDebounceTimer = null;
function scheduleHiddenCoalescedRender() {
  if (hiddenRenderDebounceTimer) clearTimeout(hiddenRenderDebounceTimer);
  hiddenRenderDebounceTimer = setTimeout(() => {
    hiddenRenderDebounceTimer = null;
    pendingHiddenRender = null;
    const c = document.getElementById('listContainer');
    if (c) c.scrollTop = 0;
    selectedIndex = 0;
    selectedIndices.clear();
    if (clips.length > 0) selectedIndices.add(0);
    else if (allClips.length > 0) selectedIndices.add(0);
    lastAnchorIndex = 0;
    if (typeof applyFilters === 'function') { try { applyFilters(); } catch(e){} }
    else if (typeof renderList === 'function') { try { renderList(); } catch(e){} }
    if (typeof syncLivePreview === 'function') { try { syncLivePreview(); } catch(e){} }
  }, 50);
}
function isWindowHidden() {
  // Explicit flag is primary (pushed from C#); fallback to document.hidden for startup before first onWindowShow
  if (typeof _windowVisible === 'boolean') {
    if (!_windowVisible) return true;
    // visible per flag but document may still be hidden during SW/background — trust flag during reveal window
    if (typeof windowShowTimestamp !== 'undefined' && Date.now() - windowShowTimestamp < 300) return false;
    if (typeof document !== 'undefined' && document.hidden) return true;
    return false;
  }
  return !!(typeof document !== 'undefined' && document.hidden);
}
window.setWindowVisibility = function(visible) {
  _windowVisible = !!visible;
  if (!_windowVisible) _lastHiddenAt = Date.now();
};
window.invalidateClips = function() { _needsRefetch = true; };

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}


function toggleIncognitoSetting(el) {
  if (pauseTimerId) {
    clearInterval(pauseTimerId);
    pauseTimerId = null;
    const badge = document.getElementById('pausedIndicator');
    if (badge) badge.textContent = 'PAUSED';
  }
  const nextState = el ? !el.classList.contains('on') : !isCapturePaused;
  const timedSel = document.getElementById('stTimedIncognitoSelect');
  const timedMins = (nextState && timedSel) ? (parseFloat(timedSel.value) || 0) : 0;

  if (nextState && timedMins > 0) {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_timed_incognito === 'function') {
      window.pywebview.api.set_timed_incognito(timedMins)
        .then(res => {
          if (res && res.ok) {
            updatePauseStateUI(true);
            syncPauseStateFromBackend();
            if (typeof showToast === 'function') showToast(`Capture Paused for ${timedMins} minutes`);
          }
        })
        .catch(err => {
          console.error('Failed to set timed incognito:', err);
        });
      return;
    }
  }

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_paused === 'function') {
    window.pywebview.api.set_paused(nextState)
      .then(res => {
        if (res && res.ok) {
          updatePauseStateUI(res.paused);
          try { localStorage.setItem('dualclip_incognito', res.paused ? '1' : '0'); } catch(e) {}
          if (typeof showToast === 'function') showToast(res.paused ? 'Capture Paused' : 'Capture Resumed');
        }
      })
      .catch(err => {
        console.error('Failed to set paused state:', err);
      });
  } else {
    updatePauseStateUI(nextState);
    try { localStorage.setItem('dualclip_incognito', nextState ? '1' : '0'); } catch(e) {}
    if (typeof showToast === 'function') showToast(nextState ? 'Capture Paused (Demo)' : 'Capture Resumed');
  }
}
window._coreToggleIncognito = toggleIncognitoSetting;

function changeTimedIncognito(minsVal) {
  const mins = parseFloat(minsVal) || 0;
  if (isCapturePaused || mins > 0) {
    if (mins > 0) {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_timed_incognito === 'function') {
        window.pywebview.api.set_timed_incognito(mins).then(res => {
          if (res && res.ok) {
            updatePauseStateUI(true);
            syncPauseStateFromBackend();
            if (typeof showToast === 'function') showToast(`Capture Paused for ${mins} minutes`);
          }
        }).catch(() => {});
      }
    } else {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_paused === 'function') {
        window.pywebview.api.set_paused(true).then(res => {
          if (res && res.ok) {
            updatePauseStateUI(true);
            syncPauseStateFromBackend();
            if (typeof showToast === 'function') showToast('Capture Paused');
          }
        }).catch(() => {});
      }
    }
  }
}
window.changeTimedIncognito = changeTimedIncognito;

function syncTimedSelectUI(isTimed, remainingSeconds) {
  const sel = document.getElementById('stTimedIncognitoSelect');
  if (!sel) return;
  if (!isTimed) {
    sel.value = '0';
  } else if (remainingSeconds > 0) {
    const mins = remainingSeconds / 60;
    let target = '5';
    if (mins > 45) target = '60';
    else if (mins > 22.5) target = '30';
    else if (mins > 10) target = '15';
    else target = '5';
    sel.value = target;
  }
  const wrap = sel.closest('.custom-select-wrap');
  if (wrap) {
    const selectedOpt = sel.options[sel.selectedIndex];
    const label = wrap.querySelector('.custom-select-label');
    if (label && selectedOpt) label.textContent = selectedOpt.textContent;
    wrap.querySelectorAll('.opt-item').forEach(i => {
      i.classList.toggle('selected', i.dataset.val === sel.value);
    });
  }
}
window.syncTimedSelectUI = syncTimedSelectUI;

function syncPauseStateFromBackend() {
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_incognito_status === 'function') {
    window.pywebview.api.get_incognito_status().then(res => {
      if (res && res.ok) {
        updatePauseStateUI(res.paused);
        if (res.paused) {
          if (res.is_timed && res.remaining_seconds > 0) {
            pauseRemainingSeconds = Math.round(res.remaining_seconds);
            const badge = document.getElementById('pausedIndicator');
            if (badge) badge.textContent = `PAUSED ${formatTime(pauseRemainingSeconds)}`;
            if (!pauseTimerId) {
              pauseTimerId = setInterval(() => {
                pauseRemainingSeconds--;
                if (pauseRemainingSeconds <= 0) {
                  clearInterval(pauseTimerId);
                  pauseTimerId = null;
                  updatePauseStateUI(false);
                  syncTimedSelectUI(false, 0);
                  if (badge) badge.textContent = 'PAUSED';
                } else {
                  if (badge) badge.textContent = `PAUSED ${formatTime(pauseRemainingSeconds)}`;
                }
              }, 1000);
            }
            syncTimedSelectUI(true, res.remaining_seconds);
          } else {
            if (pauseTimerId) {
              clearInterval(pauseTimerId);
              pauseTimerId = null;
              pauseRemainingSeconds = 0;
            }
            const badge = document.getElementById('pausedIndicator');
            if (badge) badge.textContent = 'PAUSED';
            syncTimedSelectUI(false, 0);
          }
        }
      }
    }).catch(() => {});
  } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_paused === 'function') {
    window.pywebview.api.get_paused().then(res => {
      if (res && res.ok && typeof res.paused === 'boolean') {
        updatePauseStateUI(res.paused);
        if (res.paused) {
          syncTimedSelectUI(false, 0);
        }
      }
    }).catch(() => {});
  }
}

window.onCaptureStateChanged = function(data) {
  if (!data) return;
  updatePauseStateUI(data.paused);
  if (data.paused) {
    if (data.is_timed && data.remaining_seconds > 0) {
      pauseRemainingSeconds = Math.round(data.remaining_seconds);
      const badge = document.getElementById('pausedIndicator');
      if (badge) badge.textContent = `PAUSED ${formatTime(pauseRemainingSeconds)}`;
      if (!pauseTimerId) {
        pauseTimerId = setInterval(() => {
          pauseRemainingSeconds--;
          if (pauseRemainingSeconds <= 0) {
            clearInterval(pauseTimerId);
            pauseTimerId = null;
            updatePauseStateUI(false);
            syncTimedSelectUI(false, 0);
            if (badge) badge.textContent = 'PAUSED';
          } else {
            if (badge) badge.textContent = `PAUSED ${formatTime(pauseRemainingSeconds)}`;
          }
        }, 1000);
      }
      syncTimedSelectUI(true, data.remaining_seconds);
    } else {
      if (pauseTimerId) {
        clearInterval(pauseTimerId);
        pauseTimerId = null;
        pauseRemainingSeconds = 0;
      }
      const badge = document.getElementById('pausedIndicator');
      if (badge) badge.textContent = 'PAUSED';
      syncTimedSelectUI(false, 0);
    }
  } else {
    if (pauseTimerId) {
      clearInterval(pauseTimerId);
      pauseTimerId = null;
      pauseRemainingSeconds = 0;
    }
    const badge = document.getElementById('pausedIndicator');
    if (badge) badge.textContent = 'PAUSED';
  }
};

window.onPauseChanged = function(data) {
  if (data && typeof data.paused === 'boolean') {
    updatePauseStateUI(data.paused);
    if (!data.paused) {
      if (pauseTimerId) {
        clearInterval(pauseTimerId);
        pauseTimerId = null;
        pauseRemainingSeconds = 0;
      }
      const badge = document.getElementById('pausedIndicator');
      if (badge) badge.textContent = 'PAUSED';
    }
  }
};
function sortAllClips() {
  allClips.sort((a, b) => {
    const pDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (pDiff !== 0) return pDiff;
    const timeA = typeof a.last_used_at === 'number' ? a.last_used_at : (Date.parse(a.last_used_at) || 0);
    const timeB = typeof b.last_used_at === 'number' ? b.last_used_at : (Date.parse(b.last_used_at) || 0);
    const timeDiff = timeB - timeA;
    if (timeDiff !== 0) return timeDiff;
    // last_used_at is second-precision, so several captures can share a timestamp. sort_rank is the
    // monotonic capture order the backend assigned; without this tiebreak a freshly inserted clip
    // (higher id) would jump above a clip that was merely bumped in the same second.
    const rankDiff = (b.sort_rank || 0) - (a.sort_rank || 0);
    if (rankDiff !== 0) return rankDiff;
    return (b.id || 0) - (a.id || 0);
  });
}
// ORDER CONTRACT helper: true while the user has a search query typed. Background
// capture/update paths must skip sortAllClips() when this is true — the backend
// SQLite ranker owns search order (see applyFilters; guarded by
// Frontend_Preserves_Backend_Search_Order). The fresh item is already unshifted.
function isSearchQueryActive() {
  try {
    var si = document.getElementById('searchInput');
    return !!(si && si.value && si.value.trim());
  } catch (e) { return false; }
}

window.onClipAdded = function(rawClip) {
  const formatted = formatClipForUI(rawClip);
  // Local content mutation: allClips no longer equals the last backend result set.
  window._lastBackendQuery = null;
  if (formatted.collection !== 'all' && (!rawClip.collection || rawClip.collection === 'all')) {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.move_to_collection === 'function' && formatted.id) {
      window.pywebview.api.move_to_collection(formatted.id, formatted.collection);
    }
  }
  const isHidden = isWindowHidden();
  if (isHidden) {
    allClips = allClips.filter(x => x.id !== formatted.id);
    allClips.unshift(formatted);
    if (!isSearchQueryActive() && typeof sortAllClips === 'function') sortAllClips();
    clips = [formatted, ...clips.filter(c => c.id !== formatted.id)];
    lastBackgroundAddTs = Date.now();
    selectedIndex = 0;
    selectedIndices.clear();
    selectedIndices.add(0);
    lastAnchorIndex = 0;
    scheduleHiddenCoalescedRender();
    if (typeof invalidateBackendColCounts === 'function') { try { invalidateBackendColCounts(); } catch {} }
    return;
  }
  // Capture selection snapshot BEFORE modifying arrays so shift doesn't corrupt target ID
  const userSelectedIds = (selectedIndex > 0 || (selectedIndices && selectedIndices.size > 1)) && typeof snapshotSelectedIds === 'function'
    ? snapshotSelectedIds()
    : null;
  const oldAnchor = selectedIndex;

  // Visible-window burst coalescing: buffer within 16ms window, flush once via rAF
  allClips = allClips.filter(x => x.id !== formatted.id);
  allClips.unshift(formatted);
  if (!isSearchQueryActive() && typeof sortAllClips === 'function') sortAllClips();
  clips = [formatted, ...clips.filter(c => c.id !== formatted.id)];
  // Queue for coalesced render
  _visibleBurstQueue.push(formatted);
  if (_visibleBurstQueue.length === 1) _visibleBurstFirstTs = Date.now();
  if (_visibleBurstTimer) clearTimeout(_visibleBurstTimer);
  if (_visibleBurstRaf) { try { cancelAnimationFrame(_visibleBurstRaf); } catch {} _visibleBurstRaf = null; }
  const isBurst = _visibleBurstQueue.length >= 3 && (Date.now() - _visibleBurstFirstTs <= 16);
  const flushVisible = () => {
    _visibleBurstTimer = null;
    _visibleBurstRaf = null;
    if (_visibleBurstQueue.length === 0) return;
    const burstCount = _visibleBurstQueue.length;
    _visibleBurstQueue = [];
    // Single coalesced render for burst (or single)
    const __anchorContainer = document.getElementById('listContainer');
    const __oldScrollTop = __anchorContainer ? __anchorContainer.scrollTop : 0;
    const __oldTotalH = (typeof lastVirtualTotalH !== 'undefined') ? lastVirtualTotalH : -1;

    if (typeof applyFilters === 'function') applyFilters();
    if (userSelectedIds && userSelectedIds.size > 0 && typeof restoreSelectionByIds === 'function') {
      restoreSelectionByIds(userSelectedIds, oldAnchor);
    } else {
      selectedIndex = 0;
      selectedIndices.clear();
      selectedIndices.add(0);
      lastAnchorIndex = 0;
    }
    if (typeof syncLivePreview === 'function') syncLivePreview();
    if (typeof invalidateBackendColCounts === 'function') { try { invalidateBackendColCounts(); } catch {} }
    const listCont = document.getElementById('listContainer');
    if (listCont) {
      if (__oldScrollTop > 0 && burstCount === 1) {
        const __newTotalH = (typeof lastVirtualTotalH !== 'undefined') ? lastVirtualTotalH : __oldTotalH;
        let __delta = (__oldTotalH >= 0 && __newTotalH >= 0) ? (__newTotalH - __oldTotalH) : 0;
        if (__delta <= 0) {
          try { __delta = (typeof getRowHeight === 'function') ? getRowHeight(formatted, false) : 48; } catch (e) { __delta = 48; }
          if (typeof groupingMode !== 'undefined' && groupingMode !== 'none') __delta += 32;
        }
        listCont.scrollTop = __oldScrollTop + __delta;
      } else {
        listCont.scrollTop = 0;
      }
    }
  };
  if (isBurst) {
    // Burst: coalesce to one rAF after 16ms window
    _visibleBurstTimer = setTimeout(() => {
      _visibleBurstRaf = requestAnimationFrame(flushVisible);
    }, 16);
  } else if (_visibleBurstQueue.length === 1) {
    // Single-copy instant: rAF immediately (one frame) — still coalesces if second arrives before rAF
    _visibleBurstRaf = requestAnimationFrame(flushVisible);
    // Also set fallback 16ms timer to catch late burst
    _visibleBurstTimer = setTimeout(() => {
      if (_visibleBurstQueue.length > 0 && !_visibleBurstRaf) {
        _visibleBurstRaf = requestAnimationFrame(flushVisible);
      }
    }, 16);
  } else {
    // 2 items within 16ms but not yet burst — keep buffering for possible 3rd
    _visibleBurstTimer = setTimeout(() => {
      _visibleBurstRaf = requestAnimationFrame(flushVisible);
    }, 16);
  }
};

window.onClipUpdated = function(rawClip) {
  const formatted = formatClipForUI(rawClip);
  // Local content mutation: allClips no longer equals the last backend result set.
  window._lastBackendQuery = null;
  const isHidden = isWindowHidden();
  try {
    if (typeof window._lastOptimisticPasteId !== 'undefined' && formatted.id === window._lastOptimisticPasteId
        && typeof window._lastOptimisticPasteAt !== 'undefined' && (Date.now() - window._lastOptimisticPasteAt) < 800) {
      const idx = allClips.findIndex(c => c.id === formatted.id);
      if (idx >= 0) Object.assign(allClips[idx], formatted);
      const cIdx = clips.findIndex(c => c.id === formatted.id);
      if (cIdx >= 0) Object.assign(clips[cIdx], formatted);
      if (typeof syncLivePreview === 'function') syncLivePreview();
      return;
    }
  } catch(e) {}
  if (allClips.length > 0 && allClips[0].id === formatted.id) {
    Object.assign(allClips[0], formatted);
    if (isHidden) {
      if (typeof _hasValidHeightCache !== 'undefined' && !_hasValidHeightCache) {
      } else {
        scheduleHiddenCoalescedRender();
      }
    } else {
      // Visible visible update at top — coalesce via same burst path (single rAF)
      _visibleBurstQueue.push(formatted);
      if (_visibleBurstQueue.length === 1) _visibleBurstFirstTs = Date.now();
      if (_visibleBurstTimer) clearTimeout(_visibleBurstTimer);
      if (_visibleBurstRaf) { try { cancelAnimationFrame(_visibleBurstRaf); } catch {} _visibleBurstRaf = null; }
      _visibleBurstTimer = setTimeout(() => {
        _visibleBurstRaf = requestAnimationFrame(() => {
          _visibleBurstTimer = null; _visibleBurstRaf = null;
          if (_visibleBurstQueue.length===0) return;
          _visibleBurstQueue = [];
          if (typeof syncLivePreview === 'function') syncLivePreview();
          // already updated in-place, no full re-render needed
          if (typeof renderVirtualWindow === 'function') try { renderVirtualWindow(); } catch {}
        });
      }, 16);
      if (_visibleBurstQueue.length===1) {
        _visibleBurstRaf = requestAnimationFrame(() => {
          _visibleBurstTimer = null; _visibleBurstRaf = null;
          if (_visibleBurstQueue.length===0) return;
          _visibleBurstQueue = [];
          if (typeof syncLivePreview === 'function') syncLivePreview();
          if (typeof renderVirtualWindow === 'function') try { renderVirtualWindow(); } catch {}
        });
      }
    }
    if (typeof syncLivePreview === 'function') syncLivePreview();
    return;
  }
  const isHidden2 = isHidden;
  if (isHidden2) {
    allClips = allClips.filter(x => x.id !== formatted.id);
    allClips.unshift(formatted);
    if (!isSearchQueryActive() && typeof sortAllClips === 'function') sortAllClips();
    clips = [formatted, ...clips.filter(c => c.id !== formatted.id)];
    selectedIndex = 0;
    selectedIndices.clear();
    selectedIndices.add(0);
    lastAnchorIndex = 0;
    lastBackgroundAddTs = Date.now();
    if (typeof _hasValidHeightCache !== 'undefined' && !_hasValidHeightCache) {
      return;
    }
    scheduleHiddenCoalescedRender();
    return;
  }
  // Capture selection snapshot BEFORE modifying arrays so shift doesn't corrupt target ID
  const userSelectedIds = (selectedIndex > 0 || (selectedIndices && selectedIndices.size > 1)) && typeof snapshotSelectedIds === 'function'
    ? snapshotSelectedIds()
    : null;
  const oldAnchor = selectedIndex;

  // Visible burst coalescing for updated (bump to top)
  allClips = allClips.filter(x => x.id !== formatted.id);
  allClips.unshift(formatted);
  if (!isSearchQueryActive() && typeof sortAllClips === 'function') sortAllClips();
  clips = [formatted, ...clips.filter(c => c.id !== formatted.id)];
  _visibleBurstQueue.push(formatted);
  if (_visibleBurstQueue.length === 1) _visibleBurstFirstTs = Date.now();
  if (_visibleBurstTimer) clearTimeout(_visibleBurstTimer);
  if (_visibleBurstRaf) { try { cancelAnimationFrame(_visibleBurstRaf); } catch {} _visibleBurstRaf = null; }
  const isBurst2 = _visibleBurstQueue.length >= 3 && (Date.now() - _visibleBurstFirstTs <= 16);
  const flushUpd = () => {
    _visibleBurstTimer = null; _visibleBurstRaf = null;
    if (_visibleBurstQueue.length===0) return;
    _visibleBurstQueue = [];

    if (typeof applyFilters === 'function') applyFilters();
    if (userSelectedIds && userSelectedIds.size > 0 && typeof restoreSelectionByIds === 'function') {
      restoreSelectionByIds(userSelectedIds, oldAnchor);
    } else {
      selectedIndex = 0;
      selectedIndices.clear();
      selectedIndices.add(0);
      lastAnchorIndex = 0;
    }
    if (typeof syncLivePreview === 'function') syncLivePreview();
    const listCont = document.getElementById('listContainer');
    if (listCont) listCont.scrollTop = 0;
  };
  if (isBurst2) {
    _visibleBurstTimer = setTimeout(() => { _visibleBurstRaf = requestAnimationFrame(flushUpd); }, 16);
  } else if (_visibleBurstQueue.length === 1) {
    _visibleBurstRaf = requestAnimationFrame(flushUpd);
    _visibleBurstTimer = setTimeout(() => { if (_visibleBurstQueue.length>0 && !_visibleBurstRaf) _visibleBurstRaf = requestAnimationFrame(flushUpd); }, 16);
  } else {
    _visibleBurstTimer = setTimeout(() => { _visibleBurstRaf = requestAnimationFrame(flushUpd); }, 16);
  }
};

window.refreshClips = function(retryCount) {
  var retriesLeft = typeof retryCount === 'number' ? retryCount : 3;
  var prevGen = window._lastRenderedGen || 0;
  if (typeof window.rehydrateCollectionsFromBackend === 'function') {
    try { window.rehydrateCollectionsFromBackend(0, true); } catch (_) {}
  }
  loadClipsFromBackend().then(function(res) {
    if (retriesLeft > 0 && res && typeof res.gen === 'number' && res.gen <= prevGen && prevGen > 0) {
      setTimeout(function() { window.refreshClips(retriesLeft - 1); }, 1000);
    }
  }).catch(function() {
    if (retriesLeft > 0) {
      setTimeout(function() { window.refreshClips(retriesLeft - 1); }, 1000);
    }
  });
};

window.onWindowHide = function() {
  try { _windowVisible = false; _lastHiddenAt = Date.now(); } catch {}
  try {
    document.body.classList.add('suppress-hover');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.querySelectorAll('.tb-btn, button').forEach(b => {
      try { b.blur(); b.classList.add('no-hover'); } catch (_) {}
    });
  } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('dualclip:window-hide')); } catch {}
  try { if (hiddenRenderDebounceTimer) { clearTimeout(hiddenRenderDebounceTimer); hiddenRenderDebounceTimer = null; } } catch {}
  try {
    // Collection memory — default ON (remember), so only reset when explicitly OFF ('0')
    try {
      var rememberCol = true;
      try { rememberCol = localStorage.getItem('dualclip_remember_collection') !== '0'; } catch {}
      if (!rememberCol && typeof currentCollection !== 'undefined' && currentCollection !== 'all') {
        currentCollection = 'all';
        try { if (typeof renderCollectionPills === 'function') renderCollectionPills(); } catch {}
      }
    } catch {}
    // Selection memory — snapshot selected clip ID before reset if enabled
    try {
      const rememberSel = localStorage.getItem('dualclip_remember_selected_clip') !== '0';
      if (rememberSel) {
        let activeId = null;
        if (typeof selectedIndex === 'number' && selectedIndex >= 0 && Array.isArray(clips) && clips[selectedIndex]) {
          activeId = clips[selectedIndex].id;
        } else if (typeof snapshotSelectedIds === 'function') {
          const ids = snapshotSelectedIds();
          if (ids && ids.size > 0) activeId = Array.from(ids)[0];
        }
        if (activeId != null) {
          localStorage.setItem('dualclip_remember_selected_clip_id', String(activeId));
        } else {
          localStorage.removeItem('dualclip_remember_selected_clip_id');
        }
      } else {
        localStorage.removeItem('dualclip_remember_selected_clip_id');
      }
    } catch (_) {}

    // Immediate reset so next Show never paints stale selection/scroll
    selectedIndex = 0;
    expandedIndex = -1;
    selectedIndices.clear();
    if (clips.length > 0) selectedIndices.add(0);
    else if (allClips.length > 0) selectedIndices.add(0);
    lastAnchorIndex = 0;
    var c = document.getElementById('listContainer');
    if (c) c.scrollTop = 0;
    // Session is finished: clear any active search query, filter popups,
    // or temporary expanded states so reopening starts completely fresh.
    try {
      const si = document.getElementById('searchInput');
      if (si) si.value = '';
      const sc = document.getElementById('searchClear');
      if (sc) sc.style.display = 'none';
      if (typeof closeRecentSearchesDropdown === 'function') closeRecentSearchesDropdown();
      const fd = document.getElementById('filterDropdown');
      if (fd) fd.classList.remove('show');
      // View reset — default OFF: dismiss Settings and restore Main History view unless Remember View is enabled
      let rememberView = false;
      try { rememberView = localStorage.getItem('dualclip_remember_view') === '1'; } catch(e) {}
      if (!rememberView) {
        if (typeof closeSettingsView === 'function') {
          closeSettingsView();
        } else {
          const sv = document.getElementById('settingsView');
          if (sv) sv.style.display = 'none';
          const mv = document.getElementById('mainView');
          if (mv) mv.style.display = 'flex';
          const tbm = document.getElementById('titlebarMain');
          const tbs = document.getElementById('titlebarSettings');
          if (tbm) tbm.style.display = 'flex';
          if (tbs) tbs.style.display = 'none';
          document.body.classList.remove('in-settings');
          const gearBtn = document.getElementById('btnSettingsTop');
          if (gearBtn) gearBtn.classList.remove('active');
        }
      }
      if (typeof closeContextMenu === 'function') closeContextMenu();
      if (typeof hideHoverPopover === 'function') hideHoverPopover();
      if (typeof hideGlobalInfoTooltip === 'function') hideGlobalInfoTooltip();
      // Dialog cleanup — hide dismisses EVERY dialog (preview/lightbox plus any
      // modal-overlay), so reopen always lands on the main list. Preset size
      // rides along: closePreviewModal and the modal MutationObserver restore
      // the persisting size while hidden — no paint, no flicker.
      try { if (typeof closePreviewModal === 'function') closePreviewModal(); } catch (e3) {}
      try {
        document.querySelectorAll('.modal-overlay').forEach(function (m) {
          if (m && m.style && m.style.display === 'flex') m.style.display = 'none';
        });
      } catch (e4) {}
    } catch (e2) {}
  } catch (e) {}
};

// Reveal helper: ensures list container opacity is normalized.
window._dcRevealWindow = function() {
  try { const lc = document.getElementById('listContainer'); if (lc && lc.style.opacity === '0') lc.style.opacity = '1'; } catch {}
};

window.onWindowShow = function() {
  try { if (typeof forceWindowFocus === 'function') forceWindowFocus(); } catch (_) {}
  try {
    document.body.classList.add('suppress-hover');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.querySelectorAll('.tb-btn, button').forEach(b => {
      try { b.blur(); b.classList.add('no-hover'); } catch (_) {}
    });
    const clearHoverSuppression = () => {
      document.body.classList.remove('suppress-hover');
      document.querySelectorAll('.no-hover').forEach(b => b.classList.remove('no-hover'));
      window.removeEventListener('pointermove', clearHoverSuppression);
      window.removeEventListener('mousemove', clearHoverSuppression);
    };
    window.addEventListener('pointermove', clearHoverSuppression, { once: true });
    window.addEventListener('mousemove', clearHoverSuppression, { once: true });
  } catch (_) {}
  try { if (typeof checkPendingSupporterPrompt === 'function') checkPendingSupporterPrompt(); } catch(e) {}
  try { if (typeof checkAndTriggerMilestones === 'function') checkAndTriggerMilestones(); } catch(e) {}
  windowShowTimestamp = Date.now();
  _windowVisible = true;
  if (typeof currentSettingsTab !== 'undefined') {
    currentSettingsTab = 'behavior';
  }
  if (typeof blurHideTimer !== 'undefined') clearTimeout(blurHideTimer);
  if (typeof resetDragState === 'function') resetDragState();
  // View restoration & layout recalculation
  try {
    let rememberView = false;
    try { rememberView = localStorage.getItem('dualclip_remember_view') === '1'; } catch(e) {}
    const sv = document.getElementById('settingsView');
    const mv = document.getElementById('mainView');
    const tbs = document.getElementById('titlebarSettings');
    const inSettings = document.body.classList.contains('in-settings') ||
                       (sv && sv.style.display !== 'none') ||
                       (mv && mv.style.display === 'none') ||
                       (tbs && tbs.style.display !== 'none');
    if (inSettings) {
      if (rememberView) {
        // User opted to remember Settings view: force active tab layout reflow before window is revealed
        try {
          const tab = localStorage.getItem('dualclip_settings_tab') || (typeof currentSettingsTab !== 'undefined' ? currentSettingsTab : 'behavior');
          if (typeof switchSettingsTab === 'function') {
            switchSettingsTab(tab);
          } else {
            const pane = document.getElementById('tabContent_' + tab);
            if (pane) { pane.style.display = 'flex'; pane.classList.add('active'); }
          }
          if (sv) sv.style.display = 'flex';
          if (mv) mv.style.display = 'none';
          const tbm = document.getElementById('titlebarMain');
          if (tbm) tbm.style.display = 'none';
          if (tbs) tbs.style.display = 'flex';
          document.body.classList.add('in-settings');
          const gearBtn = document.getElementById('btnSettingsTop');
          if (gearBtn) gearBtn.classList.add('active');
          // Force layout recalculation so flexbox height is valid and non-zero
          if (sv) void sv.offsetHeight;
        } catch(_) {}
      } else {
        // Default: guarantee Settings view is dismissed and main view is visible
        if (typeof closeSettingsView === 'function') {
          closeSettingsView();
        } else {
          if (sv) sv.style.display = 'none';
          if (mv) mv.style.display = 'flex';
          const tbm = document.getElementById('titlebarMain');
          if (tbm) tbm.style.display = 'flex';
          if (tbs) tbs.style.display = 'none';
          document.body.classList.remove('in-settings');
          const gearBtn = document.getElementById('btnSettingsTop');
          if (gearBtn) gearBtn.classList.remove('active');
        }
      }
    }
  } catch(e) {}
  // Collection memory fallback: if Hide's reset was missed (suspend race), ensure All Items when OFF
  try {
    var rememberColShow = true;
    try { rememberColShow = localStorage.getItem('dualclip_remember_collection') !== '0'; } catch {}
    if (!rememberColShow && typeof currentCollection !== 'undefined' && currentCollection !== 'all') {
      currentCollection = 'all';
      try { if (typeof renderCollectionPills === 'function') renderCollectionPills(); } catch {}
    }
  } catch {}
  // Hold-to-cycle guard: if a cycle burst is in progress, don't reset selection or re-render old order (prevents 1→2→1 bounce)
  const isCycling = typeof winCycleCount !== 'undefined' && winCycleCount > 0;
  if (isCycling) {
    if (typeof syncLivePreview === 'function') syncLivePreview();
    return;
  }
  if (typeof winCycleCount !== 'undefined') winCycleCount = 0;
  const hadBackgroundAdd = lastBackgroundAddTs > 0;
  if (hadBackgroundAdd) {
    lastBackgroundAddTs = 0;
    let didHiddenFlush = false;
    // Flush coalesced debounce if burst arrived just before show
    if (hiddenRenderDebounceTimer) {
      clearTimeout(hiddenRenderDebounceTimer);
      hiddenRenderDebounceTimer = null;
      const c = document.getElementById('listContainer');
      if (c) c.scrollTop = 0;
      selectedIndex = 0;
      selectedIndices.clear();
      selectedIndices.add(0);
      lastAnchorIndex = 0;
      if (typeof applyFilters === 'function') { try { applyFilters(); didHiddenFlush = true; } catch(e){} }
      else if (typeof renderList === 'function') { try { renderList(); didHiddenFlush = true; } catch(e){} }
    }
    if (pendingHiddenRender) {
      cancelAnimationFrame(pendingHiddenRender);
      pendingHiddenRender = null;
    }
    // Deferred case: _hasValidHeightCache was false at add time so hidden render never ran — force one layout now with real visible height
    // Also if newest allClips item missing from clips, hidden render was skipped or filtered
    const needsDeferredApply = !didHiddenFlush && (
      (typeof _hasValidHeightCache !== 'undefined' && !_hasValidHeightCache) ||
      (Array.isArray(allClips) && allClips.length>0 && (!Array.isArray(clips) || !clips.some(c=> c && c.id===allClips[0].id)))
    );
    if (needsDeferredApply) {
      const c = document.getElementById('listContainer');
      if (c) c.scrollTop = 0;
      selectedIndex = 0;
      selectedIndices.clear();
      selectedIndices.add(0);
      lastAnchorIndex = 0;
      if (Array.isArray(allClips) && allClips.length>0 && allClips[0] && (!Array.isArray(clips) || !clips.some(x=> x.id===allClips[0].id))) {
        clips = [allClips[0], ...clips.filter(x=> x.id!==allClips[0].id)];
      }
      if (typeof applyFilters === 'function') { try { applyFilters(); } catch(e){} }
      else if (typeof renderList === 'function') { try { renderList(); } catch(e){} }
    } else {
      // Branch A: hidden rendering already did layout — zero layout work on reveal, just ensure selection/scroll at top
      selectedIndex = 0;
      selectedIndices.clear();
      selectedIndices.add(0);
      lastAnchorIndex = 0;
      const listContBg = document.getElementById('listContainer');
      if (listContBg) listContBg.scrollTop = 0;
      try { if (typeof renderVirtualWindow === 'function') renderVirtualWindow(); } catch {}
    }
    syncPauseStateFromBackend();
    if (typeof syncLivePreview === 'function') syncLivePreview();
    const searchInputBg = document.getElementById('searchInput');
    if (searchInputBg) {
      searchInputBg.value = '';
      try {
        if (localStorage.getItem('dualclip_autofocus_search') === '1') {
          searchInputBg.focus();
        } else {
          searchInputBg.blur();
          document.body.focus();
        }
      } catch {}
    }
    const searchClearBg = document.getElementById('searchClear');
    if (searchClearBg) searchClearBg.style.display = 'none';
    if (typeof closeRecentSearchesDropdown === 'function') closeRecentSearchesDropdown();
    // Load clips on show
    loadClipsFromBackend();
    try { window._dcRevealWindow(); } catch {}
    try { if (window.pywebview && window.pywebview.api && window.pywebview.api.window_show_ack) window.pywebview.api.window_show_ack(); else if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({id:0, method:'window_show_ack', args:[]}); } catch {}
    return;
  }
  // Branch B: Ensure clips loaded
  const _loadPromise = loadClipsFromBackend();
  const _applyRestoreSelection = () => {
    try {
      const rememberSel = localStorage.getItem('dualclip_remember_selected_clip') !== '0';
      const savedIdStr = rememberSel ? localStorage.getItem('dualclip_remember_selected_clip_id') : null;
      let restored = false;
      if (savedIdStr != null && !hadBackgroundAdd) {
        const savedId = parseInt(savedIdStr, 10);
        if (!isNaN(savedId) && Array.isArray(clips) && clips.length > 0) {
          const matchIdx = clips.findIndex(c => c && c.id === savedId);
          if (matchIdx >= 0) {
            if (typeof restoreSelectionByIds === 'function') {
              restoreSelectionByIds(new Set([savedId]), 0);
            } else {
              selectedIndex = matchIdx;
              selectedIndices.clear();
              selectedIndices.add(matchIdx);
              lastAnchorIndex = matchIdx;
            }
            if (typeof scrollIndexIntoView === 'function') {
              scrollIndexIntoView(selectedIndex);
            }
            restored = true;
          }
        }
      }
      if (!restored) {
        selectedIndex = 0;
        selectedIndices.clear();
        if (clips.length > 0) selectedIndices.add(0);
        else if (allClips.length > 0) selectedIndices.add(0);
        lastAnchorIndex = 0;
        const listCont = document.getElementById('listContainer');
        if (listCont) listCont.scrollTop = 0;
      }
    } catch (_) {}
  };

  if (_loadPromise && typeof _loadPromise.then === 'function') {
    _loadPromise.then(() => {
      _applyRestoreSelection();
      try { if (typeof syncLivePreview === 'function') syncLivePreview(); } catch (_) {}
    }).catch(() => {});
  }

  if (true) {
    _applyRestoreSelection();
    pendingWindowShowLoad = false;
    try {
      if (typeof applyFilters === 'function') applyFilters();
      else if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
    } catch {}
    syncPauseStateFromBackend();
    if (typeof syncLivePreview === 'function') syncLivePreview();
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = '';
      try {
        if (localStorage.getItem('dualclip_autofocus_search') === '1') {
          requestAnimationFrame(() => { try { searchInput.focus(); } catch(e){} });
        } else {
          searchInput.blur();
          document.body.focus();
        }
      } catch(e) {}
    }
    const searchClear = document.getElementById('searchClear');
    if (searchClear) searchClear.style.display = 'none';
    if (typeof closeRecentSearchesDropdown === 'function') closeRecentSearchesDropdown();
    try { window._dcRevealWindow(); } catch {}
    try { if (window.pywebview && window.pywebview.api && window.pywebview.api.window_show_ack) window.pywebview.api.window_show_ack(); else if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({id:0, method:'window_show_ack', args:[]}); } catch {}
    _needsRefetch = false;
    return;
  }
  // Refetch needed (extended sleep >5min or external DB change)
  _needsRefetch = false;
  selectedIndex = 0;
  selectedIndices.clear();
  selectedIndices.add(0);
  lastAnchorIndex = 0;
  const listCont = document.getElementById('listContainer');
  if (listCont) listCont.scrollTop = 0;
  pendingWindowShowLoad = true;
  syncPauseStateFromBackend();
  var _wslP = loadClipsFromBackend();
  function _wslAck() {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        try { window._dcRevealWindow(); } catch {}
        try { if (window.pywebview && window.pywebview.api && window.pywebview.api.window_show_ack) window.pywebview.api.window_show_ack(); else if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({id:0, method:'window_show_ack', args:[]}); } catch {}
      });
    });
  }
  if (_wslP && typeof _wslP.then === 'function') {
    _wslP.then(function(){ _wslAck(); }).catch(function(){ _wslAck(); });
  } else {
    _wslAck();
  }
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '';
    try {
      if (localStorage.getItem('dualclip_autofocus_search') === '1') {
        requestAnimationFrame(() => { try { searchInput.focus(); } catch(e){} });
      } else {
        searchInput.blur();
        document.body.focus();
      }
    } catch(e) {}
  }
  const searchClear = document.getElementById('searchClear');
  if (searchClear) searchClear.style.display = 'none';
  if (typeof closeRecentSearchesDropdown === 'function') closeRecentSearchesDropdown();
  try { if (typeof checkPendingSupporterPrompt === 'function') checkPendingSupporterPrompt(); } catch(e) {}
  try { if (typeof checkAndTriggerMilestones === 'function') checkAndTriggerMilestones(); } catch(e) {}
};

function checkOnboardingTip() {
  try {
    const seen = localStorage.getItem('dualclip_onboarding_done') === '1' || localStorage.getItem('dualclip_seen_onboarding_tip') === '1';
    const bar = document.getElementById('onboardingTip') || document.getElementById('onboardingTipBar');
    if (bar) {
      bar.style.display = seen ? 'none' : 'flex';
    }
  } catch (e) {}
}

function dismissOnboardingTip() {
  try {
    localStorage.setItem('dualclip_onboarding_done', '1');
    localStorage.setItem('dualclip_seen_onboarding_tip', '1');
  } catch (e) {}
  const bar = document.getElementById('onboardingTip') || document.getElementById('onboardingTipBar');
  if (bar) {
    bar.style.display = 'none';
  }
}

// Check onboarding on initial paint
setTimeout(checkOnboardingTip, 200);

// Global & Namespace Exposure
window.formatClipForUI = formatClipForUI;
window.notifyUiReadyOnce = notifyUiReadyOnce;
window.loadClipsFromBackend = loadClipsFromBackend;
window.loadNextClipPage = loadNextClipPage;
window.updatePauseStateUI = updatePauseStateUI;
window.toggleIncognitoSetting = toggleIncognitoSetting;
window.syncPauseStateFromBackend = syncPauseStateFromBackend;
window.checkOnboardingTip = checkOnboardingTip;
window.dismissOnboardingTip = dismissOnboardingTip;

window.DC = window.DC || {};
window.DC.state = Object.assign(window.DC.state || {}, {
  formatClipForUI,
  notifyUiReadyOnce,
  loadClipsFromBackend,
  updatePauseStateUI,
  toggleIncognitoSetting,
  syncPauseStateFromBackend
});
