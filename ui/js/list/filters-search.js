// --- DualClip Filters & Search Logic (split from filters.js) ---
// --- DualClip Collections, Filters & Search Logic ---

// Filter menu — single source for dropdown options (was hard-coded in index.html)
// Edit these arrays → both HTML and app update; HTML is fallback only
const FILTER_TYPE_DEFS = [
  { id: 'all',   label: 'All' },
  { id: 'text',  label: 'Text' },
  { id: 'code',  label: 'Code' },
  { id: 'color', label: 'Colors' },
  { id: 'image', label: 'Images' },
  { id: 'url',   label: 'Web Links' },
  { id: 'file',  label: 'Files' },
];
const FILTER_TIME_DEFS = [
  { id: 'any',       label: 'Any Time' },
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'older',     label: 'Older' },
];
function renderFilterOptionGrids() {
  try {
    const typeGrid = document.getElementById('filterTypeGrid');
    if (typeGrid) {
      typeGrid.innerHTML = FILTER_TYPE_DEFS.map((o, i) =>
        `<span class="f-opt${i===0?' selected':''}" onclick="setFilterType('${o.id}', this)">${o.label}</span>`
      ).join('');
    }
    const timeGrid = document.getElementById('filterTimeGrid');
    if (timeGrid) {
      timeGrid.innerHTML = FILTER_TIME_DEFS.map((o, i) =>
        `<span class="f-opt${i===0?' selected':''}" onclick="setFilterTime('${o.id}', this)">${o.label}</span>`
      ).join('');
    }
  } catch(e) {}
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderFilterOptionGrids);
} else {
  renderFilterOptionGrids();
}

function toggleFilterDropdown() {
  const el = document.getElementById('filterDropdown');
  if (el) {
    el.classList.toggle('show');
    if (el.classList.contains('show')) {
      if (typeof refreshSourceAppFilterOptions === 'function') refreshSourceAppFilterOptions();
      if (typeof refreshFilterTagsOptions === 'function') refreshFilterTagsOptions();
    }
  }
}

function closeFilterDropdown() {
  const el = document.getElementById('filterDropdown');
  if (el) el.classList.remove('show');
}

// Prototype 1:1 active-filter indicator: lights up the top-bar Filter button
// while any of type/app/time/favorite-boost/tag filters is non-default; neutral otherwise
function updateFilterBtnState() {
  try {
    const btn = document.getElementById('btnFilters');
    if (!btn) return;
    const typeActive = (typeof activeFilterType !== 'undefined' && activeFilterType !== 'all');
    const appActive = (typeof activeFilterApp !== 'undefined' && activeFilterApp !== 'all');
    const timeActive = (typeof activeFilterTime !== 'undefined' && activeFilterTime !== 'any');
    const favActive = (typeof searchBoostFavorites !== 'undefined' && !!searchBoostFavorites);
    const recentActive = (typeof searchSortMode !== 'undefined' && searchSortMode === 'recent');
    const fuzzyActive = (typeof isFuzzySearchEnabled !== 'undefined' && !!isFuzzySearchEnabled);

    const searchInput = document.getElementById('searchInput');
    const rawInput = searchInput ? searchInput.value.trim() : '';
    let tagActive = false;
    if (typeof parseSearchQuery === 'function') {
      const parsed = parseSearchQuery(rawInput);
      tagActive = !!(parsed && ((parsed.opTags && parsed.opTags.length) || parsed.opNick));
    }

    const isFiltered = typeActive || appActive || timeActive || favActive || recentActive || fuzzyActive || tagActive;
    btn.classList.toggle('filter-active', isFiltered);
    btn.classList.toggle('has-active-filters', isFiltered);
  } catch (e) {}
}

function setFilterType(type, el) {
  try { clearTimeout(searchDebounceTimer); searchSeq++; } catch(e) {}
  if (activeFilterType === type && type !== 'all') {
    activeFilterType = 'all';
  } else {
    activeFilterType = type;
  }
  const typeGrid = document.getElementById('filterTypeGrid') || (el && el.parentElement);
  if (typeGrid) {
    typeGrid.querySelectorAll('.f-opt').forEach(opt => {
      const onclickAttr = opt.getAttribute('onclick') || '';
      if (onclickAttr.includes(`'${activeFilterType}'`)) opt.classList.add('selected');
      else opt.classList.remove('selected');
    });
  }
  updateFilterBtnState();
  if (typeof loadClipsFromBackend === 'function') {
    loadClipsFromBackend();
  } else {
    applyFilters();
  }
}

function setFilterTime(time, el) {
  try { clearTimeout(searchDebounceTimer); searchSeq++; } catch(e) {}
  if (activeFilterTime === time && time !== 'any') {
    activeFilterTime = 'any';
  } else {
    activeFilterTime = time;
  }
  const timeGrid = document.querySelector('#filterDropdown .filter-options-grid:has(span[onclick*="setFilterTime"])') 
    || document.getElementById('filterTimeGrid')
    || (el && el.parentElement);
  if (timeGrid) {
    timeGrid.querySelectorAll('.f-opt').forEach(opt => {
      const onclickAttr = opt.getAttribute('onclick') || '';
      if (onclickAttr.includes(`'${activeFilterTime}'`)) opt.classList.add('selected');
      else opt.classList.remove('selected');
    });
  }
  updateFilterBtnState();
  if (typeof loadClipsFromBackend === 'function') {
    loadClipsFromBackend();
  } else {
    applyFilters();
  }
}

let searchSortMode = 'relevance';
let searchBoostFavorites = false;
let isFuzzySearchEnabled = typeof getSetting === 'function' ? getSetting('dualclip_fuzzy_search') : (localStorage.getItem('dualclip_fuzzy_search') === '1');
(function syncFuzzyChipState() {
  const chip = document.getElementById('optFuzzySearch');
  if (chip) chip.classList.toggle('selected', isFuzzySearchEnabled);
})();

// Sync the filter-dropdown toggle visual with the persisted state
try {
  const optFuzzy = document.getElementById('optFuzzySearch');
  if (optFuzzy) optFuzzy.classList.toggle('selected', isFuzzySearchEnabled);
} catch(e) {}

function toggleRecentSort(el) {
  searchSortMode = (searchSortMode === 'recent') ? 'relevance' : 'recent';
  const recentOpt = el || document.getElementById('optSortRecent');
  if (recentOpt) {
    recentOpt.classList.toggle('selected', searchSortMode === 'recent');
  }
  updateFilterBtnState();
  if (typeof currentSearchQuery === 'string' && currentSearchQuery.trim().length > 0 && typeof loadClipsFromBackend === 'function') {
    loadClipsFromBackend(currentSearchQuery);
  } else if (typeof applyFilters === 'function') {
    applyFilters();
  }
}

function setSearchSortMode(mode, el) {
  searchSortMode = mode;
  const recentOpt = el || document.getElementById('optSortRecent');
  if (recentOpt) {
    recentOpt.classList.toggle('selected', mode === 'recent');
  }
  updateFilterBtnState();
  if (typeof currentSearchQuery === 'string' && currentSearchQuery.trim().length > 0 && typeof loadClipsFromBackend === 'function') {
    loadClipsFromBackend(currentSearchQuery);
  } else if (typeof applyFilters === 'function') {
    applyFilters();
  }
}

function toggleFavoritesBoost(el) {
  searchBoostFavorites = !searchBoostFavorites;
  if (el) {
    el.classList.toggle('selected', searchBoostFavorites);
  }
  updateFilterBtnState();
  if (typeof applyFilters === 'function') applyFilters();
}

function toggleFuzzySearch(el) {
  isFuzzySearchEnabled = !isFuzzySearchEnabled;
  try {
    if (typeof setSetting === 'function') {
      setSetting('dualclip_fuzzy_search', isFuzzySearchEnabled);
    } else {
      localStorage.setItem('dualclip_fuzzy_search', isFuzzySearchEnabled ? '1' : '0');
    }
  } catch(e) {}
  if (el) {
    el.classList.toggle('selected', isFuzzySearchEnabled);
  }
  // Fuzzy matching is backend-owned (get_clips arg 8): re-fetch when a query is
  // active so the toggle takes effect immediately; browsing order is unaffected.
  const searchInput = document.getElementById('searchInput');
  const val = searchInput ? searchInput.value.trim() : '';
  if (val && typeof loadClipsFromBackend === 'function') {
    const parsed = parseSearchQuery(val);
    loadClipsFromBackend(parsed.cleanQuery || '');
  } else if (typeof applyFilters === 'function') applyFilters();
}

function isWithinOneTypo(a, b) {
  if (a === b) return true;
  if (!a || !b) return (b || '').length <= 1 && (a || '').length <= 1;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let first = -1;
    for (let k = 0; k < a.length; k++) { if (a[k] !== b[k]) { first = k; break; } }
    if (first < 0) return true;
    let subst = true;
    for (let k = first + 1; k < a.length; k++) { if (a[k] !== b[k]) { subst = false; break; } }
    if (subst) return true;
    if (first + 1 < a.length && a[first] === b[first + 1] && a[first + 1] === b[first]) {
      for (let k = first + 2; k < a.length; k++) { if (a[k] !== b[k]) return false; }
      return true;
    }
    return false;
  }
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let i = 0, j = 0, diff = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] !== longer[j]) {
      diff++;
      if (diff > 1) return false;
      j++;
    } else { i++; j++; }
  }
  diff += (longer.length - j);
  return diff <= 1;
}

function tokenizeHaystack(hay) {
  return hay.split(/[\s\-\/.,;:_\#()\[\]{}"'!?|*+=<>@\\]+/).filter(Boolean);
}

function isFuzzyMatch(str, pattern) {
  if (!str || !pattern) return false;
  str = str.toLowerCase(); pattern = pattern.toLowerCase().trim();
  if (!pattern) return false;
  if (str.includes(pattern)) return true;

  // Multi-word: every query word must match (short words exact, longer words allow 1 typo).
  const qWords = pattern.split(/\s+/).filter(Boolean);
  if (qWords.length > 1) {
    if (!qWords.some(w => w.length >= 4)) return false;
    const tokens = tokenizeHaystack(str);
    return qWords.every(qw => {
      if (str.includes(qw)) return true;
      if (qw.length < 4) return false;
      return tokens.some(t => Math.abs(t.length - qw.length) <= 1 && isWithinOneTypo(qw, t));
    });
  }

  if (pattern.length < 4) return false;

  // Single-word: 1-typo (Damerau) against haystack tokens.
  const words = tokenizeHaystack(str);
  for (const word of words) {
    if (Math.abs(word.length - pattern.length) <= 1) {
      if (isWithinOneTypo(pattern, word)) return true;
    }
  }
  return false;
}

function onFilterAppChange(val) {
  try { clearTimeout(searchDebounceTimer); searchSeq++; } catch(e) {}
  activeFilterApp = (val || 'all').trim() || 'all';
  const sel = document.getElementById('filterAppSelect');
  if (sel && sel.value !== activeFilterApp) {
    sel.value = activeFilterApp;
  }
  if (typeof syncCustomDropdown === 'function') {
    syncCustomDropdown('wrap_filterAppSelect', activeFilterApp);
  } else if (typeof window.syncCustomDropdown === 'function') {
    window.syncCustomDropdown('wrap_filterAppSelect', activeFilterApp);
  }
  updateFilterBtnState();
  if (typeof loadClipsFromBackend === 'function') {
    loadClipsFromBackend();
  } else if (typeof applyFilters === 'function') {
    applyFilters();
  }
}

let sourceAppRefreshSeq = 0;

function refreshSourceAppFilterOptions() {
  const sel = document.getElementById('filterAppSelect');
  if (!sel) return;
  const prevVal = sel.value || activeFilterApp || 'all';
  const mySeq = ++sourceAppRefreshSeq;

  const placeholders = new Set(['clipboard', 'image', 'unknown', 'manual entry', 'all', 'system', 'idle']);

  const sanitizeList = (arr) => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const result = [];
    arr.forEach(raw => {
      if (!raw || typeof raw !== 'string') return;
      const clean = raw.trim();
      const key = clean.toLowerCase();
      if (!clean || placeholders.has(key) || seen.has(key)) return;
      seen.add(key);
      result.push(clean);
    });
    return result;
  };

  const collectFromAllClips = () => {
    const list = [];
    const srcClips = (typeof window.allClips !== 'undefined' && Array.isArray(window.allClips))
      ? window.allClips
      : (typeof allClips !== 'undefined' && Array.isArray(allClips) ? allClips : []);
    if (Array.isArray(srcClips)) {
      srcClips.forEach(c => {
        let proc = '';
        try {
          if (c && c.src_process) proc = c.src_process;
          else if (c && c.Process) proc = c.Process;
          else if (c && c.meta_json) {
            const meta = typeof c.meta_json === 'string' ? JSON.parse(c.meta_json) : c.meta_json;
            proc = (meta && meta.src_process) || '';
          }
        } catch(e) {}
        if (proc) list.push(proc);
      });
    }
    return sanitizeList(list);
  };

  const rebuild = () => {
    const clipApps = collectFromAllClips();
    clipApps.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const current = prevVal;
    sel.innerHTML = '';
    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = 'All Applications';
    sel.appendChild(optAll);

    clipApps.forEach(proc => {
      const opt = document.createElement('option');
      opt.value = proc;
      opt.textContent = proc.replace(/\.exe$/i, '');
      sel.appendChild(opt);
    });

    const hasCurrent = Array.from(sel.options).some(o => o.value === current);
    if (hasCurrent) {
      sel.value = current;
    } else if (current && current !== 'all') {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current.replace(/\.exe$/i, '');
      sel.appendChild(opt);
      sel.value = current;
    } else {
      sel.value = 'all';
    }
    activeFilterApp = sel.value || 'all';
    if (typeof updateFilterBtnState === 'function') updateFilterBtnState();
    if (typeof rebuildCustomSelect === 'function') {
      rebuildCustomSelect(sel);
    } else if (typeof window.rebuildCustomSelect === 'function') {
      window.rebuildCustomSelect(sel);
    }
  };

  rebuild();
}

function clearTagFilter() {
  try { clearTimeout(searchDebounceTimer); searchSeq++; } catch (e) {}
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    const raw = searchInput.value;
    const updated = raw.replace(/(?:tag|tags|nick|nickname):(?:"[^"]*"|'[^']*'|\S+)/gi, '').replace(/\s+/g, ' ').trim();
    searchInput.value = updated;
    const searchClear = document.getElementById('searchClear');
    if (searchClear) searchClear.style.display = updated ? 'block' : 'none';
  }
  const tagSel = document.getElementById('filterTagSelect');
  if (tagSel) tagSel.value = 'all';
  if (typeof syncCustomDropdown === 'function') {
    syncCustomDropdown('wrap_filterTagSelect', 'all');
  } else if (typeof window.syncCustomDropdown === 'function') {
    window.syncCustomDropdown('wrap_filterTagSelect', 'all');
  }
  updateFilterBtnState();
  if (typeof loadClipsFromBackend === 'function') {
    const raw = searchInput ? searchInput.value.trim() : '';
    const parsed = parseSearchQuery(raw);
    loadClipsFromBackend(parsed.cleanQuery || '');
  } else if (typeof applyFilters === 'function') {
    applyFilters();
  }
}

function onFilterTagChange(val) {
  if (!val || val === 'all') {
    clearTagFilter();
  } else {
    if (typeof filterByTag === 'function') filterByTag(val);
  }
  if (typeof syncCustomDropdown === 'function') {
    syncCustomDropdown('wrap_filterTagSelect', val || 'all');
  } else if (typeof window.syncCustomDropdown === 'function') {
    window.syncCustomDropdown('wrap_filterTagSelect', val || 'all');
  }
}

function refreshFilterTagsOptions() {
  const section = document.getElementById('filterTagsSection');
  const sel = document.getElementById('filterTagSelect');
  if (!section || !sel) return;

  const stats = (typeof getTagStats === 'function') ? getTagStats() : [];
  if (stats.length === 0) {
    section.style.display = 'none';
    sel.innerHTML = '<option value="all">All Tags</option>';
    sel.value = 'all';
    if (typeof rebuildCustomSelect === 'function') {
      rebuildCustomSelect(sel);
    } else if (typeof window.rebuildCustomSelect === 'function') {
      window.rebuildCustomSelect(sel);
    }
    return;
  }

  const searchInput = document.getElementById('searchInput');
  const raw = searchInput ? searchInput.value.trim() : '';
  const parsed = parseSearchQuery(raw);
  const activeTag = ((parsed.opTags && parsed.opTags.length) ? parsed.opTags[0] : (parsed.opNick || '')).toLowerCase();

  sel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = 'all';
  optAll.textContent = 'All Tags';
  sel.appendChild(optAll);

  stats.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.displayName;
    opt.textContent = `${item.displayName} (${item.count})`;
    sel.appendChild(opt);
  });

  if (activeTag) {
    const match = Array.from(sel.options).find(o => o.value.toLowerCase() === activeTag);
    if (match) sel.value = match.value;
    else sel.value = 'all';
  } else {
    sel.value = 'all';
  }

  if (typeof rebuildCustomSelect === 'function') {
    rebuildCustomSelect(sel);
  } else if (typeof window.rebuildCustomSelect === 'function') {
    window.rebuildCustomSelect(sel);
  }

  section.style.display = 'block';
}

function resetAllFilters() {
  // Cancel pending debounce — the reset supersedes any in-flight typing.
  try { clearTimeout(searchDebounceTimer); searchSeq++; } catch (e) {}
  activeFilterType = 'all';
  activeFilterApp = 'all';
  activeFilterTime = 'any';
  searchSortMode = 'relevance';
  searchBoostFavorites = false;
  isFuzzySearchEnabled = false;
  try {
    if (typeof setSetting === 'function') {
      setSetting('dualclip_fuzzy_search', false);
    } else {
      localStorage.setItem('dualclip_fuzzy_search', '0');
    }
  } catch (e) {}
  const appSel = document.getElementById('filterAppSelect');
  if (appSel) appSel.value = 'all';
  if (typeof syncCustomDropdown === 'function') {
    syncCustomDropdown('wrap_filterAppSelect', 'all');
  } else if (typeof window.syncCustomDropdown === 'function') {
    window.syncCustomDropdown('wrap_filterAppSelect', 'all');
  }
  const tagSel = document.getElementById('filterTagSelect');
  if (tagSel) tagSel.value = 'all';
  if (typeof syncCustomDropdown === 'function') {
    syncCustomDropdown('wrap_filterTagSelect', 'all');
  } else if (typeof window.syncCustomDropdown === 'function') {
    window.syncCustomDropdown('wrap_filterTagSelect', 'all');
  }
  const searchInp = document.getElementById('searchInput');
  if (searchInp) searchInp.value = '';
  document.querySelectorAll('.f-opt').forEach(el => {
    if (el.innerText.toLowerCase().includes('all') || el.innerText.toLowerCase().includes('any')) el.classList.add('selected');
    else el.classList.remove('selected');
  });
  const fDropdown = document.getElementById('filterDropdown');
  if (fDropdown) fDropdown.classList.remove('show');
  updateFilterBtnState();
  if (typeof loadClipsFromBackend === 'function') {
    loadClipsFromBackend();
  } else {
    applyFilters();
  }
}

function parseSearchQuery(raw) {
  const text = (raw || '').trim();
  if (!text) {
    return { cleanQuery: '', opFrom: null, opType: null, opPinned: null, opFav: null, opNick: null, opTags: [] };
  }

  if (!isFeatureEnabled('advancedFilters')) {
    return { cleanQuery: text, opFrom: null, opType: null, opPinned: null, opFav: null, opNick: null, opTags: [] };
  }

  const tokens = text.split(/\s+/);
  const remaining = [];
  let opFrom = null;
  let opType = null;
  let opPinned = null;
  let opFav = null;
  let opNick = null;
  const opTags = [];

  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower.startsWith('from:')) {
      opFrom = lower.slice(5).trim();
    } else if (lower.startsWith('type:')) {
      opType = lower.slice(5).trim();
    } else if (lower.startsWith('pinned:')) {
      const v = lower.slice(7);
      opPinned = (v === 'yes' || v === '1' || v === 'true');
    } else if (lower.startsWith('fav:') || lower.startsWith('favorite:')) {
      const v = lower.includes(':') ? lower.split(':')[1] : '';
      opFav = (v === 'yes' || v === '1' || v === 'true');
    } else if (lower.startsWith('tag:') || lower.startsWith('tags:')) {
      const colonIdx = lower.indexOf(':');
      let val = lower.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      const parts = val.split(/[,，]/).map(x => x.trim()).filter(Boolean);
      parts.forEach(p => { if (!opTags.includes(p)) opTags.push(p); });
    } else if (lower.startsWith('nick:') || lower.startsWith('nickname:')) {
      const colonIdx = lower.indexOf(':');
      let val = lower.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      opNick = val;
    } else {
      remaining.push(t);
    }
  }

  return {
    cleanQuery: remaining.join(' ').trim(),
    opFrom,
    opType,
    opPinned,
    opFav,
    opNick,
    opTags
  };
}

/**
 * Normalized, lowercased tag list for a clip, sourced from the real
 * clip_tags/tags assignments delivered by the backend as `tags`.
 * Falls back to an empty list — never to the nickname column, which is a
 * free-text label and would produce false positives.
 */
function normalizeClipTags(c) {
  if (!c) return [];
  const raw = c.tags;
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw) {
    list = raw.split(/[,，]/);
  }
  return list
    .map(t => String(t == null ? '' : t).trim().toLowerCase())
    .filter(Boolean);
}

function isRecentSearchEnabled() {
  try {
    const val = localStorage.getItem('dualclip_recent_search_enabled');
    return val === null ? true : val === '1';
  } catch (e) {
    return true;
  }
}

function getRecentSearches() {
  try {
    const raw = localStorage.getItem('dualclip_recent_searches');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    return [];
  }
}

function saveRecentSearch(term) {
  if (!isRecentSearchEnabled()) return;
  const clean = (term || '').trim();
  if (!clean || clean.length < 2) return;
  try {
    let list = getRecentSearches();
    list = list.filter(item => item.toLowerCase() !== clean.toLowerCase());
    list.unshift(clean);
    if (list.length > 6) list = list.slice(0, 6);
    localStorage.setItem('dualclip_recent_searches', JSON.stringify(list));
  } catch(e) {}
}

function deleteRecentSearch(term, e) {
  if (e) e.stopPropagation();
  try {
    let list = getRecentSearches();
    list = list.filter(item => item.toLowerCase() !== term.toLowerCase());
    localStorage.setItem('dualclip_recent_searches', JSON.stringify(list));
    renderRecentSearches();
  } catch(e) {}
}

function clearAllRecentSearches(e) {
  if (e) e.stopPropagation();
  try {
    localStorage.removeItem('dualclip_recent_searches');
    closeRecentSearchesDropdown();
  } catch(e) {}
}

function selectRecentSearch(term) {
  // Cancel pending debounce — the explicit selection supersedes any in-flight typing.
  try { clearTimeout(searchDebounceTimer); searchSeq++; } catch (e) {}
  const input = document.getElementById('searchInput');
  if (input) {
    input.value = term;
    input.focus();
    applyFilters();
    if (typeof loadClipsFromBackend === 'function') {
      const parsed = parseSearchQuery(term);
      loadClipsFromBackend(parsed.cleanQuery || '');
    }
  }
  closeRecentSearchesDropdown();
}

function renderRecentSearches() {
  const dropdown = document.getElementById('recentSearchesDropdown');
  if (!dropdown) return;
  if (!isRecentSearchEnabled()) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    return;
  }
  const list = getRecentSearches();
  if (list.length === 0) {
    dropdown.innerHTML = `
      <div class="recent-search-header">
        <span>Recent Searches</span>
      </div>
      <div style="padding: 10px 14px; font-size: 11.5px; color: var(--text-sub); text-align: center;">No recent searches</div>
    `;
    dropdown.style.display = 'block';
    return;
  }

  let html = `
    <div class="recent-search-header">
      <span>Recent Searches</span>
      <span class="recent-search-clear-all">Clear all</span>
    </div>
  `;

  list.forEach(term => {
    const safeTerm = escapeHtml(term);
    html += `
      <div class="recent-search-item" data-recent-search-term="${safeTerm}">
        <div class="recent-search-term">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>${safeTerm}</span>
        </div>
        <span class="recent-search-delete" title="Remove from recent searches">✕</span>
      </div>
    `;
  });

  dropdown.innerHTML = html;
  dropdown.style.display = 'block';

  const clearAllEl = dropdown.querySelector('.recent-search-clear-all');
  if (clearAllEl) {
    clearAllEl.addEventListener('click', (e) => clearAllRecentSearches(e));
  }

  dropdown.querySelectorAll('.recent-search-item').forEach(item => {
    const term = item.getAttribute('data-recent-search-term') ?? '';
    item.addEventListener('click', () => selectRecentSearch(term));
    const deleteEl = item.querySelector('.recent-search-delete');
    if (deleteEl) {
      deleteEl.addEventListener('click', (e) => deleteRecentSearch(term, e));
    }
  });
}

function toggleRecentSearchesDropdown(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const dropdown = document.getElementById('recentSearchesDropdown');
  if (!dropdown) return;
  const isVisible = dropdown.style.display === 'block';
  if (isVisible) {
    closeRecentSearchesDropdown();
  } else {
    // If filter dropdown is open, close it first
    if (typeof closeFilterDropdown === 'function') {
      try { closeFilterDropdown(); } catch (_) {}
    }
    renderRecentSearches();
    const btn = document.getElementById('btnRecentSearches');
    if (btn) btn.classList.add('active');
  }
}

function closeRecentSearchesDropdown() {
  const dropdown = document.getElementById('recentSearchesDropdown');
  if (dropdown) dropdown.style.display = 'none';
  const btn = document.getElementById('btnRecentSearches');
  if (btn) btn.classList.remove('active');
}

// Subtle match counter next to the search input — visible only while a query is active
function updateSearchResultCount() {
  const el = document.getElementById('searchResultCount');
  if (!el) return;
  const searchInput = document.getElementById('searchInput');
  const query = searchInput ? searchInput.value.trim() : '';
  if (!query) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  const n = clips.length;
  // Same page-capped truth problem as the group headers: while further pages
  // remain, n is the number LOADED, not the number that matches. Mark it instead of
  // presenting a page size as a total.
  const partial = (typeof hasMoreClips !== 'undefined' && hasMoreClips);
  const shown = partial ? (n + '+') : String(n);
  el.textContent = (n === 1 && !partial) ? '1 result' : `${shown} result${n === 1 ? '' : 's'}`;
  if (partial) el.title = `${n} loaded — more may match; scroll to load the rest`;
  else el.removeAttribute('title');
  el.style.display = '';
}

// Empty-state escape hatch (scoping rule 3): user explicitly widens a zero-hit
// scoped search to All Clips. Query stays in the box; scope badge follows.
function searchEverywhereFromEmpty() {
  try {
    if (typeof selectCollection === 'function') selectCollection('all');
    else {
      currentCollection = 'all';
      if (typeof updateSearchScopeBadge === 'function') updateSearchScopeBadge();
      if (typeof applyFilters === 'function') applyFilters();
    }
  } catch (e) {}
}
window.searchEverywhereFromEmpty = searchEverywhereFromEmpty;

function applyFilters() {
  if (typeof __dcMark === 'function') { try { __dcMark('applyFilters.start'); } catch (e) {} }
  // Capture the current selection by clip ID BEFORE filtering/sorting — indices
  // shift on re-filter, search, collection-switch, background captures, etc.
  if (typeof syncSelectedIds === 'function') syncSelectedIds();

  const searchInput = document.getElementById('searchInput');
  const rawInput = searchInput ? searchInput.value.trim() : '';
  const searchClear = document.getElementById('searchClear');
  if (searchClear) searchClear.style.display = rawInput ? 'block' : 'none';

  const { cleanQuery, opFrom, opType, opPinned, opFav, opNick, opTags } = parseSearchQuery(rawInput);
  const q = cleanQuery.toLowerCase();

  let mirrorInAll = true;
  try { mirrorInAll = localStorage.getItem('dualclip_mirror_in_all') !== '0'; } catch (_) {}

  clips = allClips.filter(c => {
    // Collection scope always applies — even while searching (prevents global leak when pill says Favorites/Work)
    if ((currentCollection === 'pins' || currentCollection === 'favorites') && !c.favorite) return false;
    if (currentCollection === 'most_used') {
      // Must mirror the backend predicate exactly (use_count >= 1), otherwise
      // offset-based pagination desynchronises between the two layers.
      const usage = typeof c.use_count === 'number' ? c.use_count : (parseInt(c.use_count, 10) || 0);
      if (usage < 1) return false;
    }
    if (currentCollection === 'all') {
      // Rule: searching on All Clips is always database-wide, even when the
      // mirror-in-All browsing preference is off. Browsing keeps the preference.
      if (!mirrorInAll && !q && c.collection && c.collection !== 'all') return false;
    }
    if (currentCollection !== 'all' && currentCollection !== 'pins' && currentCollection !== 'favorites' && currentCollection !== 'most_used' && (c.collection || '').toLowerCase() !== currentCollection.toLowerCase()) return false;

    const tag = c.is_image ? 'IMAGE' : getFormatTag(c.text_content || c.preview || '');
    if (activeFilterType !== 'all' && activeFilterType.toUpperCase() !== tag) return false;

    let app = (c.src_process || '').toLowerCase();
    if (!app) {
      try {
        const meta = typeof c.meta_json === 'string' ? JSON.parse(c.meta_json) : c.meta_json;
        app = (meta && meta.src_process ? meta.src_process : '').toLowerCase();
      } catch(e) {}
    }
    if (activeFilterApp !== 'all' && !app.includes(activeFilterApp.toLowerCase())) return false;

    if (activeFilterTime !== 'any' && c.time_group !== activeFilterTime) return false;

    // Advanced search filter operators
    if (opFrom) {
      const proc = (c.src_process || app || '').toLowerCase();
      if (!proc.includes(opFrom)) return false;
    }
    if (opType) {
      if (opType === 'image' && !c.is_image) return false;
      if (opType === 'text' && c.is_image) return false;
      if (opType === 'code' && tag !== 'CODE') return false;
      if (opType === 'url' && tag !== 'URL' && c.collection !== 'web') return false;
      if (opType === 'json' && tag !== 'JSON') return false;
      if (opType === 'md' && tag !== 'MD') return false;
    }
    if (opPinned !== null && (!!c.pinned !== opPinned)) return false;
    if (opFav !== null && (!!c.favorite !== opFav)) return false;
    if (opTags && opTags.length > 0) {
      // tag:/tags: match real tag assignments. The nickname column is a
      // free-text label and must not be used as a tag proxy.
      const clipTags = normalizeClipTags(c);
      const allTagsMatch = opTags.every(reqTag => {
        const reqLow = reqTag.toLowerCase();
        return clipTags.some(t => t === reqLow || t.includes(reqLow));
      });
      if (!allTagsMatch) return false;
    } else if (opNick) {
      // nick:/nickname: is the explicit operator for the nickname label.
      const nickLow = (c.nickname || '').toLowerCase();
      if (!nickLow.includes(opNick)) return false;
    }

    const backendFresh = !!q && String(window._lastBackendQuery || '').toLowerCase() === q;
    if (q && !backendFresh) {
      const title = (c.title || '').toLowerCase();
      const text = (c.text_content || '').toLowerCase();
      const prev = (c.preview || '').toLowerCase();
      const nick = (c.nickname || '').toLowerCase();
      const directMatch = title.includes(q) || text.includes(q) || prev.includes(q) || app.includes(q) || nick.includes(q);
      if (!directMatch) {
        if (!isFuzzySearchEnabled) return false;
        const fuzzyMatch = isFuzzyMatch(text, q) || isFuzzyMatch(prev, q) || isFuzzyMatch(title, q) || isFuzzyMatch(nick, q);
        if (!fuzzyMatch) return false;
      }
    }
    return true;
  });

  if (!q) {
    sortClipsForBrowsing();
  } else {
    // F1: Wire searchSortMode ('relevance' vs 'recent') and searchBoostFavorites
    clips.sort((a, b) => {
      // Pinned items stay at top
      const pDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pDiff !== 0) return pDiff;

      // Boost favorites if enabled
      if (searchBoostFavorites) {
        const fDiff = (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
        if (fDiff !== 0) return fDiff;
      }

      if (searchSortMode === 'recent') {
        const timeA = typeof a.last_used_at === 'number' ? a.last_used_at : (Date.parse(a.last_used_at) || 0);
        const timeB = typeof b.last_used_at === 'number' ? b.last_used_at : (Date.parse(b.last_used_at) || 0);
        if (timeB !== timeA) return timeB - timeA;
        return (b.sort_rank || 0) - (a.sort_rank || 0) || (b.id || 0) - (a.id || 0);
      }

      // Default 'relevance': exact prefix/exact title match first, then recency
      const aTitle = (a.title || a.text_content || a.preview || '').toLowerCase();
      const bTitle = (b.title || b.text_content || b.preview || '').toLowerCase();
      const aStarts = aTitle.startsWith(q) ? 1 : 0;
      const bStarts = bTitle.startsWith(q) ? 1 : 0;
      if (bStarts !== aStarts) return bStarts - aStarts;

      const timeA = typeof a.last_used_at === 'number' ? a.last_used_at : (Date.parse(a.last_used_at) || 0);
      const timeB = typeof b.last_used_at === 'number' ? b.last_used_at : (Date.parse(b.last_used_at) || 0);
      if (timeB !== timeA) return timeB - timeA;
      return (b.sort_rank || 0) - (a.sort_rank || 0) || (b.id || 0) - (a.id || 0);
    });
  }

  renderActivePills();
  updateSearchResultCount();
  updateFilterBtnState();
  const isSearching = !!rawInput;
  if (isSearching) {
    if (clips.length > 0) {
      const currentSelectedId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
      const matchedIdx = currentSelectedId != null ? clips.findIndex(c => c && c.id === currentSelectedId) : -1;
      if (matchedIdx >= 0) {
        selectedIndex = matchedIdx;
        selectedIndices.clear();
        selectedIndices.add(matchedIdx);
        lastAnchorIndex = matchedIdx;
      } else {
        selectedIndex = 0;
        selectedIndices.clear();
        selectedIndices.add(0);
        lastAnchorIndex = 0;
        selectedIds.clear();
        if (clips[0] && clips[0].id != null) selectedIds.add(clips[0].id);
      }
    } else {
      selectedIndex = -1;
      selectedIndices.clear();
      lastAnchorIndex = -1;
      selectedIds.clear();
    }
    if (typeof syncLivePreview === 'function') syncLivePreview();
  } else {
    if (typeof revalidateSelectionFromIds === 'function') revalidateSelectionFromIds();
  }
  if (typeof renderList === 'function') renderList();
  if (typeof updateSidebarCounts === 'function') {
    try { updateSidebarCounts(); } catch(e) {}
  }
}

function sortClipsForBrowsing() {
  if (currentCollection === 'most_used') {
    clips.sort((a, b) => {
      const aUsage = a.use_count || a.paste_count || a.copy_count || 0;
      const bUsage = b.use_count || b.paste_count || b.copy_count || 0;
      if (bUsage !== aUsage) return bUsage - aUsage;
      const timeA = typeof a.last_used_at === 'number' ? a.last_used_at : (Date.parse(a.last_used_at) || 0);
      const timeB = typeof b.last_used_at === 'number' ? b.last_used_at : (Date.parse(b.last_used_at) || 0);
      if (timeB !== timeA) return timeB - timeA;
      return (b.sort_rank || 0) - (a.sort_rank || 0) || (b.id || 0) - (a.id || 0);
    });
    return;
  }

  // For user collections (not "All Items"), apply collection sort order
  const colSortMode = (currentCollection !== 'all')
    ? (localStorage.getItem('dualclip_collection_sort_order') || 'newest')
    : 'default';

  // Pinned items always appear at the top
  // If searchBoostFavorites is enabled, favorited clips follow pinned clips
  // Then sort by recency/alpha
  clips.sort((a, b) => {
    if (colSortMode === 'oldest') {
      const timeA = typeof a.last_used_at === 'number' ? a.last_used_at : (Date.parse(a.last_used_at) || 0);
      const timeB = typeof b.last_used_at === 'number' ? b.last_used_at : (Date.parse(b.last_used_at) || 0);
      if (timeA !== timeB) return timeA - timeB;
      return (a.sort_rank || 0) - (b.sort_rank || 0) || (a.id || 0) - (b.id || 0);
    }
    if (colSortMode === 'alpha') {
      const textA = (a.title || a.text_content || a.preview || '').toLowerCase();
      const textB = (b.title || b.text_content || b.preview || '').toLowerCase();
      return textA.localeCompare(textB);
    }

    const pDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (pDiff !== 0) return pDiff;

    if (searchBoostFavorites) {
      const fDiff = (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
      if (fDiff !== 0) return fDiff;
    }

    const timeA = typeof a.last_used_at === 'number' ? a.last_used_at : (Date.parse(a.last_used_at) || 0);
    const timeB = typeof b.last_used_at === 'number' ? b.last_used_at : (Date.parse(b.last_used_at) || 0);
    if (timeB !== timeA) return timeB - timeA;
    // Same-second tiebreak: keep the backend's monotonic capture order (Wispr dictation stays below
    // the clipboard item that was restored immediately after it).
    return (b.sort_rank || 0) - (a.sort_rank || 0) || (b.id || 0) - (a.id || 0);
  });
}

function renderActivePills() {
  const bar = document.getElementById('activePillsBar');
  const list = document.getElementById('pillList');
  if (!bar || !list) return;
  list.innerHTML = '';
  let hasFilters = false;

  if (activeFilterType !== 'all') {
    hasFilters = true;
    list.innerHTML += `<span class="filter-pill">Type: ${activeFilterType.toUpperCase()} <span class="pill-close" onclick="setFilterType('all', document.querySelector('.f-opt'));">✕</span></span>`;
  }
  if (activeFilterApp !== 'all') {
    hasFilters = true;
    list.innerHTML += `<span class="filter-pill">App: ${escapeHtml(activeFilterApp)} <span class="pill-close" onclick="onFilterAppChange('all');">✕</span></span>`;
  }
  if (activeFilterTime && activeFilterTime !== 'any') {
    hasFilters = true;
    const timeLabels = {
      today: 'Today',
      yesterday: 'Yesterday',
      older: 'Older'
    };
    const label = timeLabels[activeFilterTime] || activeFilterTime;
    list.innerHTML += `<span class="filter-pill">🕒 ${label} <span class="pill-close" onclick="setFilterTime('any');">✕</span></span>`;
  }

  const searchInput = document.getElementById('searchInput');
  const rawInput = searchInput ? searchInput.value.trim() : '';
  if (typeof parseSearchQuery === 'function') {
    const parsed = parseSearchQuery(rawInput);
    if (parsed && parsed.opTags && parsed.opTags.length) {
      hasFilters = true;
      const pillTags = escapeHtml(parsed.opTags.join(', '));
      list.innerHTML += `<span class="filter-pill">🏷️ Tag: ${pillTags} <span class="pill-close" onclick="clearTagFilter();">✕</span></span>`;
    } else if (parsed && parsed.opNick) {
      hasFilters = true;
      list.innerHTML += `<span class="filter-pill">🏷️ Nickname: ${escapeHtml(parsed.opNick)} <span class="pill-close" onclick="clearTagFilter();">✕</span></span>`;
    }
  }

  bar.classList.toggle('show', hasFilters);
}

function cancelRecentSearchCapture() {
  try { if (recentSearchSaveTimer) { clearTimeout(recentSearchSaveTimer); recentSearchSaveTimer = null; } } catch (e) {}
}

function clearSearch() {
  // Cancel any pending debounced search so a stale query can never fire after clear.
  try { clearTimeout(searchDebounceTimer); searchSeq++; } catch (e) {}
  // The query the user just abandoned must not be remembered 2s later.
  cancelRecentSearchCapture();
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  const searchClear = document.getElementById('searchClear');
  if (searchClear) searchClear.style.display = 'none';
  closeRecentSearchesDropdown();
  expandedIndex = -1;
  applyFilters();
  if (typeof loadClipsFromBackend === 'function') {
    loadClipsFromBackend('');
  }
}

function getFormatTag(text) {
  if (!text) return 'TEXT';
  const fullTrimmed = text.trim();
  if (!fullTrimmed) return 'TEXT';

  // 0. Windows Absolute File/Folder Paths (Single or Multi-line list)
  const lines = fullTrimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every(l => /^(?:[a-zA-Z]:[\\\/]|\\\\[^\\\/]+[\\\/][^\\\/]+)/.test(l))) {
    return 'FILE';
  }

  // 1. URLs
  if (/^(https?:\/\/|www\.)[^\s/$.?#].[^\s]*$/i.test(fullTrimmed)) return 'URL';

  // 2. Color Hex / RGB / RGBA / HSL
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(fullTrimmed) ||
      /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+%?)?\s*\)$/i.test(fullTrimmed) ||
      /^hsla?\(\s*\d+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+%?)?\s*\)$/i.test(fullTrimmed)) {
    return 'COLOR';
  }

  // 3. JSON (Strict parse on full document - O(n) native parse, no ReDoS danger)
  if (/^[\{\[][\s\S]*[\}\]]$/.test(fullTrimmed)) {
    try { JSON.parse(fullTrimmed); return 'JSON'; } catch(e) {}
  }

  // Cap regex matching window to 2KB to prevent ReDoS and avoid scroll-jank on large clips
  const sample = fullTrimmed.length > 2048 ? fullTrimmed.slice(0, 2048).trim() : fullTrimmed;

  // 4. Markdown with fenced code blocks (```) or prominent doc headers
  if (/(?:^|\n)```[a-zA-Z0-9_-]*\s*\n/.test(sample)) {
    return 'MD';
  }

  // 5. Shebangs (Bash, Shell, Python, Node, Perl, Ruby, etc.)
  if (/^#!\s*\/(?:usr\/)?(?:bin|local\/bin)\/(?:env\s+)?(?:bash|sh|zsh|python|python3|node|perl|ruby)/m.test(sample)) {
    return 'CODE';
  }

  // 6. PowerShell scripts & PascalCase cmdlets (e.g. Get-ChildItem, param(, $PSScriptRoot)
  if (/(?:^|[\s"'`(=])(?:\$(?:PSScriptRoot|PSVersionTable|args|true|false|null|_)\b|param\s*\()/i.test(sample) ||
      /(?:^|[\s"'`(=])(?:Get|Set|New|Remove|Invoke|Start|Stop|Test|Add|Clear|Export|Import)-[A-Z][\w]*\b/.test(sample)) {
    return 'CODE';
  }

  // 7. SQL Queries (Single & Multi-line)
  if (/\b(?:SELECT\b[\s\S]*?\bFROM|INSERT\s+INTO|UPDATE\s+[\w.]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|DATABASE))\b/i.test(sample)) {
    return 'CODE';
  }

  // 8. C# / Java / C++ / TypeScript / Rust / Go method signatures & language constructs
  if (/\b(?:(?:public|private|protected|internal|static|async|override|virtual|sealed|abstract)\s+)+(?:class|interface|struct|enum|record|void|Task|ValueTask|int|string|bool|var|let|const|async\b|[\w<>[\],]+)\s+[\w$]+\s*(?:<[^>]+>)?\s*\(/i.test(sample)) {
    return 'CODE';
  }

  // 9. Keywords, Declarations & Imports (JS, TS, C#, Python, C++, Go, Rust, PHP, Kotlin, Swift)
  if (/(?:^|\s)(?:using\s+[A-Z][\w.]*\s*;|#include\s*[<"][^>"]+[>"]|package\s+[\w.]+\s*;|import\s+(?:[\w{},*\s]+from\s+)?['"][^'"]+['"]|import\s+[\w.*]+|namespace\s+[\w.]+|def\s+\w+\s*\(|fn\s+\w+\s*\(|func\s+\w+\s*\(|func\s*\([^)]*\)\s*\w+|let\s+mut\s+\w+|const\s+\w+\s*[:=]|let\s+\w+\s*[:=]|var\s+\w+\s*[:=]|export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface)|class\s+\w+(?:\s+extends|\s+implements|\s*\{)|interface\s+\w+[\s<\{]|enum\s+\w+[\s\{])/m.test(sample)) {
    return 'CODE';
  }

  // 10. HTML / XML / JSX elements
  if (/^<!DOCTYPE\s+html|<(?:html|head|body|div|span|p|a|table|tr|td|th|ul|ol|li|script|style|template|svg|form|input|button|h[1-6]|Fragment)[\s>]/i.test(sample) || /<\/[a-z][\w-]*>$/i.test(sample)) {
    return 'CODE';
  }

  // 11. CSS / SCSS style rules
  if (/(?:^|\n)\s*(?:@media|@keyframes|[:.#]?[a-zA-Z0-9_>-]+(?:\s*,\s*[:.#]?[a-zA-Z0-9_>-]+)*)\s*\{\s*[\s\S]*?(?:[\w-]+\s*:\s*[^;{}]+;|\})/m.test(sample)) {
    return 'CODE';
  }

  // 12. General code structures (balanced blocks, control flows, arrow functions)
  if (/(?:if|for|while|switch|catch)\s*\([^)]+\)\s*\{|=>\s*\{|\bconsole\.(?:log|error|warn)\(|Console\.WriteLine\(|System\.out\.println\(|print\([^)]*\)/.test(sample)) {
    return 'CODE';
  }

  // 13. Markdown headings & list markers (placed after code so # comments in Python/Shell aren't mislabeled as MD)
  if (/^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|```)/m.test(sample)) return 'MD';

  return 'TEXT';
}

let searchDebounceTimer = null;
let recentSearchSaveTimer = null;
let searchSeq = 0;
const searchInputEl = document.getElementById('searchInput');
if (searchInputEl) {
  searchInputEl.addEventListener('click', () => {
    if (!searchInputEl.value.trim()) {
      renderRecentSearches();
    }
  });

  searchInputEl.addEventListener('input', () => {
    closeRecentSearchesDropdown();
    expandedIndex = -1;
    selectedIds.clear();
    applyFilters();

    clearTimeout(searchDebounceTimer);
    const mySeq = ++searchSeq;
    searchDebounceTimer = setTimeout(() => {
      if (mySeq !== searchSeq) return; // stale debounce — backend race guard
      const val = searchInputEl.value.trim();
      if (typeof loadClipsFromBackend === 'function') {
        const parsed = parseSearchQuery(val);
        loadClipsFromBackend(parsed.cleanQuery || '');
      }
    }, 280);

    // Recent-search capture is deliberately stricter than the live search debounce:
    //  - 2000ms of no typing, so a half-typed word is not remembered
    //  - cancelled when the box is cleared / emptied / abandoned (see cancelRecentSearchCapture)
    //  - skipped when the search matched nothing, because a typo is not worth remembering
    // Live search above still runs at 280ms, so results appear while typing.
    clearTimeout(recentSearchSaveTimer);
    recentSearchSaveTimer = setTimeout(() => {
      const val = searchInputEl.value.trim();
      if (val.length < 2) return;
      if (typeof isWindowHidden === 'function' && isWindowHidden()) return;
      const hasResults = Array.isArray(clips) && clips.length > 0;
      if (!hasResults) return;
      saveRecentSearch(val);
    }, 2000);
  });

  searchInputEl.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Backspace' && searchInputEl.value === '' && currentCollection !== 'all') {
      e.preventDefault();
      resetScopeToAll();
      return;
    }
    if (e.key === 'Enter') {
      const val = searchInputEl.value.trim();
      if (val.length >= 2) {
        saveRecentSearch(val);
      }
      cancelRecentSearchCapture();
      closeRecentSearchesDropdown();
    } else if (e.key === 'Escape') {
      const recentDd = document.getElementById('recentSearchesDropdown');
      const isRecentOpen = recentDd && (recentDd.style.display === 'block' || recentDd.classList.contains('show'));
      if (isRecentOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeRecentSearchesDropdown();
        return;
      }
      const filterDd = document.getElementById('filterDropdown');
      const isFilterOpen = filterDd && filterDd.classList.contains('show');
      if (isFilterOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeFilterDropdown();
        return;
      }
      if (searchInputEl.value.trim().length > 0) {
        e.preventDefault();
        e.stopPropagation();
        clearSearch();
        try { searchInputEl.blur(); } catch {}
        return;
      }
      if (document.activeElement === searchInputEl) {
        e.preventDefault();
        e.stopPropagation();
        try { searchInputEl.blur(); } catch {}
        return;
      }
      if (typeof hideWindow === 'function') {
        hideWindow();
      }
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // When empty & idle: let user drag from anywhere in search row with default arrow
  searchInputEl.addEventListener('input', () => {
    if (searchInputEl.value.trim().length > 0) {
      searchInputEl.classList.add('typing');
    } else {
      searchInputEl.classList.remove('typing');
    }
  });

  searchInputEl.addEventListener('pointerdown', (e) => {
    // If empty and left-clicked, allow dragging to reposition window
    if (e.button === 0 && !searchInputEl.value.trim()) {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.start_drag === 'function') {
        window.pywebview.api.start_drag();
      } else if (typeof callHost === 'function') {
        callHost('start_drag', []);
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      closeRecentSearchesDropdown();
    }
  });
}


// Global & Namespace Exposure for Filters & Search
window.toggleRecentSort = toggleRecentSort;
window.setSearchSortMode = setSearchSortMode;
window.toggleFavoritesBoost = toggleFavoritesBoost;
window.toggleFuzzySearch = toggleFuzzySearch;
window.toggleFilterDropdown = toggleFilterDropdown;
window.setFilterType = setFilterType;
window.setFilterTime = setFilterTime;
window.onFilterAppChange = onFilterAppChange;
window.refreshSourceAppFilterOptions = refreshSourceAppFilterOptions;
window.resetAllFilters = resetAllFilters;
window.applyFilters = applyFilters;
window.sortClipsForBrowsing = sortClipsForBrowsing;
window.renderActivePills = renderActivePills;
window.updateSearchResultCount = updateSearchResultCount;
window.clearSearch = clearSearch;
window.getFormatTag = getFormatTag;
window.parseSearchQuery = parseSearchQuery;
window.isRecentSearchEnabled = isRecentSearchEnabled;
window.getRecentSearches = getRecentSearches;
window.saveRecentSearch = saveRecentSearch;
window.deleteRecentSearch = deleteRecentSearch;
window.clearAllRecentSearches = clearAllRecentSearches;
window.selectRecentSearch = selectRecentSearch;
window.renderRecentSearches = renderRecentSearches;
window.closeRecentSearchesDropdown = closeRecentSearchesDropdown;
window.toggleRecentSearchesDropdown = toggleRecentSearchesDropdown;


// Auto-refresh source-app filter when apps may have changed (startup, window show)
try {
  const scheduleRefresh = () => { try { setTimeout(() => { if (typeof refreshSourceAppFilterOptions === 'function') refreshSourceAppFilterOptions(); }, 300); } catch(_){} };
  document.addEventListener('DOMContentLoaded', scheduleRefresh);
  window.addEventListener('pywebviewready', scheduleRefresh);
  // Also refresh after window is shown (covers tray toggle)
  const _origOnWindowShow = window.onWindowShow;
  // Defer wiring until after state.js defines it; poll briefly
  setTimeout(() => {
    if (typeof window.onWindowShow === 'function') {
      const orig = window.onWindowShow;
      window.onWindowShow = function() { try { orig.apply(this, arguments); } catch(e){} try { refreshSourceAppFilterOptions(); } catch(_){} };
    }
  }, 500);
  // Also when a new clip arrives with a new src_process
  const _origOnClipAdded = window.onClipAdded;
  setTimeout(() => {
    if (typeof window.onClipAdded === 'function') {
      const origAdd = window.onClipAdded;
      window.onClipAdded = function(raw) { try { origAdd(raw); } catch(e){} try { refreshSourceAppFilterOptions(); } catch(_){} };
    }
  }, 600);
} catch(e) {}


window.clearTagFilter = clearTagFilter;
window.refreshFilterTagsOptions = refreshFilterTagsOptions;
window.onFilterTagChange = onFilterTagChange;
window.closeFilterDropdown = closeFilterDropdown;

window.DC = window.DC || {};
window.DC.filtersSearch = {
  isRecentSearchEnabled,
  toggleFilterDropdown,
  closeFilterDropdown,
  setFilterType,
  setFilterTime,
  onFilterAppChange,
  onFilterTagChange,
  refreshSourceAppFilterOptions,
  refreshFilterTagsOptions,
  resetAllFilters,
  applyFilters,
  renderActivePills,
  clearSearch,
  clearTagFilter,
  getFormatTag,
  parseSearchQuery,
  getRecentSearches,
  saveRecentSearch,
  deleteRecentSearch,
  clearAllRecentSearches,
  selectRecentSearch,
  renderRecentSearches,
  closeRecentSearchesDropdown,
  toggleRecentSearchesDropdown,
  updateFilterBtnState,
  toggleRecentSort,
  setSearchSortMode,
  toggleFavoritesBoost,
  toggleFuzzySearch
};
