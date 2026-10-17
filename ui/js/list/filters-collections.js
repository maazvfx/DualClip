// --- DualClip Collections Logic (split from filters.js) ---
function saveCustomCollections() {
  try {
    localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections));
  } catch(e) {}
}

// Single resolver: never show a raw col_<id> in the UI.
function resolveCollectionDisplayName(colId) {
  try {
    if (!colId || colId === 'all') return 'All Clips';
    if (colId === 'pins' || colId === 'favorites') return 'Favorites';
    if (colId === 'most_used') return 'Most Used';
    let colls = Array.isArray(customCollections) ? customCollections : [];
    if (colls.length === 0) {
      try {
        const raw = localStorage.getItem('dualclip_custom_collections');
        if (raw) colls = JSON.parse(raw);
      } catch (e) {}
    }
    if (Array.isArray(colls)) {
      const found = colls.find(c => c && c.id === colId);
      if (found && found.name) return found.name;
    }
  } catch (e) {}
  if (typeof colId === 'string' && colId.startsWith('col_')) {
    const cleaned = colId.replace(/^col_\d+_?/, '').replace(/^col_/, '');
    return cleaned || 'Collection';
  }
  return colId;
}
window.resolveCollectionDisplayName = resolveCollectionDisplayName;
window.getCollectionDisplayName = resolveCollectionDisplayName;

// Tombstones for deleted collection ids (M8): prevents auto-sort rules from
// silently resurrecting a collection the user deleted.
function getDeletedCollectionTombstones() {
  try {
    const raw = JSON.parse(localStorage.getItem('dualclip_deleted_collections') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
function isCollectionTombstoned(id) {
  if (!id) return false;
  try { return getDeletedCollectionTombstones().indexOf(id) !== -1; } catch { return false; }
}
function addDeletedCollectionTombstone(id) {
  if (!id) return;
  try {
    const list = getDeletedCollectionTombstones();
    if (list.indexOf(id) === -1) {
      list.push(id);
      localStorage.setItem('dualclip_deleted_collections', JSON.stringify(list.slice(-50)));
    }
  } catch {}
}
function clearDeletedCollectionTombstone(id) {
  if (!id) return;
  try {
    localStorage.setItem('dualclip_deleted_collections', JSON.stringify(getDeletedCollectionTombstones().filter(x => x !== id)));
  } catch {}
}
window.getDeletedCollectionTombstones = getDeletedCollectionTombstones;
window.isCollectionTombstoned = isCollectionTombstoned;
window.addDeletedCollectionTombstone = addDeletedCollectionTombstone;
window.clearDeletedCollectionTombstone = clearDeletedCollectionTombstone;

// Backend-sourced pill counts (M7, D4): cached map from get_collection_counts,
// refreshed at most every 15s or immediately on mutation.
let _backendColCounts = null;
let _backendTotals = null;
let _backendColCountsAt = 0;

function maybeRefreshBackendColCounts(force = false) {
  try {
    if (!force && Date.now() - _backendColCountsAt < 15000) return;
    _backendColCountsAt = Date.now();
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.get_collection_counts === 'function') {
      api.get_collection_counts().then(res => {
        if (res && res.ok) {
          if (res.counts && typeof res.counts === 'object') _backendColCounts = res.counts;
          if (res.totals && typeof res.totals === 'object') _backendTotals = res.totals;
          if (typeof renderCollectionPills === 'function') { try { renderCollectionPills(); } catch {} }
          if (typeof updateSidebarCounts === 'function') { try { updateSidebarCounts(); } catch {} }
        }
      }).catch(() => {});
    }
  } catch {}
}

function invalidateBackendColCounts() {
  _backendColCountsAt = 0;
  maybeRefreshBackendColCounts(true);
}

function getCollectionClipCount(colId) {
  // Authoritative backend SQLite counts win for both system and custom buckets
  if (colId === 'all') {
    let mirrorInAll = true;
    try { mirrorInAll = localStorage.getItem('dualclip_mirror_in_all') !== '0'; } catch (_) {}
    const targetKey = mirrorInAll ? 'all_total' : 'all_unorganized';
    if (_backendTotals && Object.prototype.hasOwnProperty.call(_backendTotals, targetKey)) {
      const n = parseInt(_backendTotals[targetKey], 10);
      if (!isNaN(n)) return n;
    }
    if (_backendColCounts && Object.prototype.hasOwnProperty.call(_backendColCounts, targetKey)) {
      const n = parseInt(_backendColCounts[targetKey], 10);
      if (!isNaN(n)) return n;
    }
    if (_backendTotals && Object.prototype.hasOwnProperty.call(_backendTotals, 'all')) {
      const n = parseInt(_backendTotals['all'], 10);
      if (!isNaN(n)) return n;
    }
    if (_backendColCounts && Object.prototype.hasOwnProperty.call(_backendColCounts, 'all')) {
      const n = parseInt(_backendColCounts['all'], 10);
      if (!isNaN(n)) return n;
    }
  } else if (colId === 'pins' || colId === 'favorites') {
    if (_backendTotals && Object.prototype.hasOwnProperty.call(_backendTotals, 'pins')) {
      const n = parseInt(_backendTotals['pins'], 10);
      if (!isNaN(n)) return n;
    }
    if (_backendColCounts && Object.prototype.hasOwnProperty.call(_backendColCounts, 'pins')) {
      const n = parseInt(_backendColCounts['pins'], 10);
      if (!isNaN(n)) return n;
    }
  } else if (colId === 'most_used') {
    if (_backendTotals && Object.prototype.hasOwnProperty.call(_backendTotals, 'most_used')) {
      const n = parseInt(_backendTotals['most_used'], 10);
      if (!isNaN(n)) return n;
    }
    if (_backendColCounts && Object.prototype.hasOwnProperty.call(_backendColCounts, 'most_used')) {
      const n = parseInt(_backendColCounts['most_used'], 10);
      if (!isNaN(n)) return n;
    }
  } else if (_backendColCounts && Object.prototype.hasOwnProperty.call(_backendColCounts, colId)) {
    const n = parseInt(_backendColCounts[colId], 10);
    if (!isNaN(n)) return n;
  }

  // Fallback if backend counts not loaded yet
  if (!Array.isArray(allClips)) return 0;
  if (colId === 'all') {
    let mirrorInAll = true;
    try { mirrorInAll = localStorage.getItem('dualclip_mirror_in_all') !== '0'; } catch (_) {}
    if (!mirrorInAll) {
      return allClips.filter(c => c && (!c.collection || c.collection === 'all')).length;
    }
    return allClips.length;
  }
  if (colId === 'pins') return allClips.filter(c => c && !!c.favorite).length;
  if (colId === 'most_used') {
    // Canonical: use_count >= 1 (matches backend Search.cs most_used filter)
    return allClips.filter(c => {
      const usage = c.use_count || c.paste_count || c.copy_count || (c.meta && c.meta.use_count) || 0;
      return usage >= 1;
    }).length;
  }
  return allClips.filter(c => c && c.collection === colId).length;
}

function handleCollectionPillDrop(targetColId, colDisplayName, e, precomputedIds = null) {
  if (!isFeatureEnabled('collectionDragDrop')) {
    if (typeof showToast === 'function') showToast('Collection drag & drop is disabled');
    return;
  }
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  
  // Clean up any hover styling on pills
  document.querySelectorAll('.col-pill.drop-target-hover').forEach(p => p.classList.remove('drop-target-hover'));

  // 1. Extract clip IDs from precomputedIds, dataTransfer or tracked drag state
  let ids = Array.isArray(precomputedIds) ? precomputedIds.slice() : [];
  if (ids.length === 0) {
    try {
      const batchRaw = e && e.dataTransfer ? e.dataTransfer.getData('application/x-dualclip-ids') : '';
      if (batchRaw) {
        const parsed = JSON.parse(batchRaw);
        if (Array.isArray(parsed)) ids = parsed.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
      }
    } catch (_) {}
  }

  if (ids.length === 0) {
    const clipIdStr = e.dataTransfer ? (e.dataTransfer.getData('application/x-dualclip-clip-id') || e.dataTransfer.getData('application/x-dualclip-id')) : null;
    if (clipIdStr) {
      const clipId = parseInt(clipIdStr, 10);
      if (!isNaN(clipId)) ids = [clipId];
    }
  }

  // Fallback to in-memory tracked drag state
  if (ids.length === 0 && Array.isArray(window._draggedClipIds) && window._draggedClipIds.length > 0) {
    ids = window._draggedClipIds.slice();
  }

  if (ids.length === 0) return;
  window._internalDropOccurred = true;

  // 2. Edge Case: No-op if dropped onto the currently active collection pill
  if (targetColId === currentCollection) {
    if (typeof showToast === 'function') {
      showToast(`Already in ${colDisplayName}`);
    }
    return;
  }

  // 3. Edge Case: If dropped onto "Favorites" (pill_pins), handle by starring
  if (targetColId === 'pins') {
    const prevFavoriteStates = new Map();
    let newlyStarredCount = 0;
    const favCalls = [];
    ids.forEach(id => {
      const c = Array.isArray(allClips) ? allClips.find(x => x && x.id === id) : null;
      if (c) {
        prevFavoriteStates.set(id, !!c.favorite);
        if (!c.favorite) {
          c.favorite = true;
          newlyStarredCount++;
          if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.toggle_favorite === 'function') {
            try {
              const p = window.pywebview.api.toggle_favorite(id);
              if (p && typeof p.then === 'function') favCalls.push(p);
            } catch (_) {}
          }
        }
      }
    });

    if (newlyStarredCount === 0) {
      if (typeof showToast === 'function') showToast('Already in Favorites');
      return;
    }

    const refreshFavs = () => {
      renderCollectionPills();
      if (typeof applyFilters === 'function') applyFilters();
    };

    const revertFavs = () => {
      prevFavoriteStates.forEach((wasFav, id) => {
        const c = Array.isArray(allClips) ? allClips.find(x => x && x.id === id) : null;
        if (c) c.favorite = wasFav;
      });
      refreshFavs();
      if (typeof showToast === 'function') showToast("Couldn't save — reverted");
    };

    const finishFavs = () => {
      refreshFavs();
      const toastMsg = newlyStarredCount === 1 ? 'Added clip to Favorites' : `Added ${newlyStarredCount} clips to Favorites`;
      if (typeof showToast === 'function') {
        showToast(toastMsg, {
          duration: 4000,
          actionLabel: 'Undo',
          onAction: () => {
            prevFavoriteStates.forEach((wasFav, id) => {
              const c = Array.isArray(allClips) ? allClips.find(x => x && x.id === id) : null;
              if (c && c.favorite !== wasFav) {
                c.favorite = wasFav;
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.toggle_favorite === 'function') {
                  try { window.pywebview.api.toggle_favorite(id); } catch (_) {}
                }
              }
            });
            renderCollectionPills();
            if (typeof applyFilters === 'function') applyFilters();
            showToast(newlyStarredCount === 1 ? 'Favorites undone' : `${newlyStarredCount} favorites undone`, { duration: 2000 });
          }
        });
      }
    };

    if (favCalls.length > 0) {
      Promise.all(favCalls).then(results => {
        const failed = results.some(r => !r || r.ok === false);
        if (failed) revertFavs();
        else finishFavs();
      }).catch(() => revertFavs());
    } else {
      finishFavs();
    }
    return;
  }

  // 4. Standard Collection Move (All Items or Custom Collection)
  const prevCollections = new Map();
  let movedCount = 0;
  ids.forEach(id => {
    const c = Array.isArray(allClips) ? allClips.find(x => x && x.id === id) : null;
    if (c) {
      const oldCol = c.collection || 'all';
      if (oldCol !== targetColId) {
        prevCollections.set(id, oldCol);
        c.collection = targetColId;
        movedCount++;
      }
    }
  });

  if (movedCount === 0) {
    if (typeof showToast === 'function') {
      showToast(`Already in ${colDisplayName}`);
    }
    return;
  }

  // Read-your-write: confirm the SQLite writes before declaring success, then
  // reconcile from the backend so the next pill switch reads committed state.
  const refreshAfterMove = () => {
    renderCollectionPills();
    if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch {} }
    else if (typeof applyFilters === 'function') applyFilters();
  };
  const undoMove = (done) => {
    if (Array.isArray(allClips)) {
      allClips.forEach(x => {
        if (x && prevCollections.has(x.id)) {
          x.collection = prevCollections.get(x.id);
        }
      });
    }
    const undoCalls = [];
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.move_to_collection === 'function') {
      prevCollections.forEach((prevCol, id) => {
        try {
          const p = window.pywebview.api.move_to_collection(id, prevCol);
          if (p && typeof p.then === 'function') undoCalls.push(p);
        } catch (_) {}
      });
    }
    const finishUndo = () => {
      refreshAfterMove();
      showToast(movedCount === 1 ? 'Move undone' : `${movedCount} moves undone`, { duration: 2000 });
      if (typeof done === 'function') { try { done(); } catch {} }
    };
    const failUndo = () => {
      if (Array.isArray(allClips)) {
        allClips.forEach(x => {
          if (x && prevCollections.has(x.id)) {
            x.collection = targetColId;
          }
        });
      }
      refreshAfterMove();
      showToast("Couldn't undo — reloaded", { duration: 2000 });
      if (typeof done === 'function') { try { done(); } catch {} }
    };
    if (undoCalls.length > 0) {
      Promise.all(undoCalls).then(results => {
        const failed = results.some(r => !r || r.ok === false);
        if (failed) failUndo();
        else finishUndo();
      }).catch(failUndo);
    } else {
      finishUndo();
    }
  };
  const moveMsg = movedCount === 1 ? `Moved clip to ${colDisplayName}` : `Moved ${movedCount} clips to ${colDisplayName}`;
  const confirmMove = (failed) => {
    if (failed) {
      // Roll back the optimistic paint; backend never confirmed the write
      if (Array.isArray(allClips)) {
        allClips.forEach(x => {
          if (x && prevCollections.has(x.id)) {
            x.collection = prevCollections.get(x.id);
          }
        });
      }
      refreshAfterMove();
      if (typeof showToast === 'function') showToast("Couldn't save the move — reverted");
      return;
    }
    refreshAfterMove();
    if (typeof showToast === 'function') {
      showToast(moveMsg, { duration: 4000, actionLabel: 'Undo', onAction: () => undoMove() });
    }
  };

  const moveCalls = [];
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.move_to_collection === 'function') {
    prevCollections.forEach((_, id) => {
      try {
        const p = window.pywebview.api.move_to_collection(id, targetColId);
        if (p && typeof p.then === 'function') moveCalls.push(p);
      } catch (_) {}
    });
  }
  if (moveCalls.length > 0) {
    Promise.all(moveCalls).then(results => {
      confirmMove(results.some(r => !r || r.ok === false));
    }).catch(() => confirmMove(true));
  } else {
    // No backend channel (e.g. preview harness): keep the optimistic paint only
    renderCollectionPills();
    if (typeof applyFilters === 'function') applyFilters();
    if (typeof showToast === 'function') {
      showToast(moveMsg, { duration: 4000, actionLabel: 'Undo', onAction: () => undoMove() });
    }
  }
}

function setupPillDropListeners(pill, targetColId, colDisplayName) {
  if (!pill || pill._dndBound) return;
  pill._dndBound = true;

  pill.addEventListener('dragenter', (e) => {
    if (!isFeatureEnabled('collectionDragDrop')) return;
    if (pill.classList.contains('add-btn')) return;
    if (isPillReorderDrag(e)) {
      if (!pill._reorderColId) return;
      e.preventDefault();
      updateReorderIndicator(pill, e);
      return;
    }
    e.preventDefault();
    pill.classList.add('drop-target-hover');
  });

  pill.addEventListener('dragover', (e) => {
    if (!isFeatureEnabled('collectionDragDrop')) return;
    if (pill.classList.contains('add-btn')) return;
    if (isPillReorderDrag(e)) {
      if (!pill._reorderColId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      updateReorderIndicator(pill, e);
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    pill.classList.add('drop-target-hover');
  });

  pill.addEventListener('dragleave', (e) => {
    if (!pill.contains(e.relatedTarget)) {
      pill.classList.remove('drop-target-hover');
      pill.classList.remove('drop-reorder-before', 'drop-reorder-after');
    }
  });

  pill.addEventListener('drop', (e) => {
    if (!isFeatureEnabled('collectionDragDrop')) return;
    if (pill.classList.contains('add-btn')) return;
    if (isPillReorderDrag(e)) {
      if (!pill._reorderColId) return;
      e.preventDefault();
      clearReorderIndicators();
      pill.classList.remove('drop-target-hover');
      handlePillReorder(pill, pill._reorderColId, e);
      return;
    }
    pill.classList.remove('drop-target-hover');
    handleCollectionPillDrop(targetColId, colDisplayName, e);
  });
}

// Collection pill reordering (drag pills to rearrange; order persists via customCollections array)
const PILL_REORDER_MIME = 'application/x-dualclip-collection';
function isPillReorderDrag(e) {
  try {
    const t = e.dataTransfer ? e.dataTransfer.types : null;
    if (!t) return false;
    for (let i = 0; i < t.length; i++) {
      if (String(t[i]).toLowerCase() === PILL_REORDER_MIME) return true;
    }
  } catch {}
  return false;
}
function clearReorderIndicators() {
  try {
    document.querySelectorAll('.col-pill.drop-reorder-before, .col-pill.drop-reorder-after')
      .forEach(p => p.classList.remove('drop-reorder-before', 'drop-reorder-after'));
  } catch {}
}
function updateReorderIndicator(pill, e) {
  clearReorderIndicators();
  pill.classList.remove('drop-target-hover');
  let after = false;
  try {
    const r = pill.getBoundingClientRect();
    after = (e.clientX - r.left) > r.width / 2;
  } catch {}
  pill.classList.add(after ? 'drop-reorder-after' : 'drop-reorder-before');
}
function handlePillReorder(targetPill, targetColId, e) {
  let srcId = '';
  try { srcId = e.dataTransfer ? e.dataTransfer.getData(PILL_REORDER_MIME) : ''; } catch {}
  if (!srcId || srcId === targetColId) return;
  if (!Array.isArray(customCollections)) return;
  const from = customCollections.findIndex(c => c && c.id === srcId);
  if (from < 0) return;
  let after = false;
  try {
    const r = targetPill.getBoundingClientRect();
    after = (e.clientX - r.left) > r.width / 2;
  } catch {}
  const moved = customCollections.splice(from, 1)[0];
  let idx = customCollections.findIndex(c => c && c.id === targetColId);
  if (idx < 0) { customCollections.splice(from, 0, moved); return; }
  if (after) idx += 1;
  customCollections.splice(idx, 0, moved);
  saveCustomCollections();
  renderCollectionPills();
}
function setupPillReorderSource(pill, colId) {
  if (!pill || pill._reorderBound) return;
  pill._reorderBound = true;
  pill._reorderColId = colId;
  try { pill.draggable = true; } catch {}
  pill.addEventListener('dragstart', (e) => {
    if (e.target && (e.target.closest('.pill-options-btn') || e.target.closest('.pill-menu-trigger'))) {
      e.preventDefault();
      return;
    }
    if (!isFeatureEnabled('collectionDragDrop')) { try { e.preventDefault(); } catch {} return; }
    try {
      if (e.dataTransfer) {
        e.dataTransfer.setData(PILL_REORDER_MIME, colId);
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setDragImage(pill, pill.offsetWidth / 2, pill.offsetHeight / 2); } catch {}
      }
    } catch {}
    pill.classList.add('dragging-reorder');
    try { pill.style.willChange = 'transform, opacity'; } catch {}
  });
  pill.addEventListener('dragend', () => {
    pill.classList.remove('dragging-reorder');
    clearReorderIndicators();
    document.querySelectorAll('.col-pill.drop-target-hover').forEach(p => p.classList.remove('drop-target-hover'));
  });
}

function updateCollectionCountsUI() {
  const pillAll = document.getElementById('pill_all');
  if (pillAll) {
    pillAll.innerHTML = `All Clips`;
    setupPillDropListeners(pillAll, 'all', 'All Clips');
  }
  const pillPins = document.getElementById('pill_pins');
  if (pillPins) {
    pillPins.innerHTML = `Favorites`;
    setupPillDropListeners(pillPins, 'pins', 'Favorites');
  }
  const pillMostUsed = document.getElementById('pill_most_used');
  if (pillMostUsed) {
    pillMostUsed.innerHTML = `Most Used`;
    setupPillDropListeners(pillMostUsed, 'most_used', 'Most Used');
  }

  const bar = document.getElementById('collectionsBar');
  if (bar && !bar._dndBound) {
    bar._dndBound = true;
    bar.addEventListener('dragover', (e) => {
      const pill = e.target.closest('.col-pill:not(.add-btn)');
      if (pill) e.preventDefault();
    });
    bar.addEventListener('dragleave', (e) => {
      if (!bar.contains(e.relatedTarget)) {
        document.querySelectorAll('.col-pill.drop-target-hover').forEach(p => p.classList.remove('drop-target-hover'));
      }
    });
  }
}

let activePillMenuColId = null;

function closePillMenu() {
  const menu = document.getElementById('pillContextMenu');
  if (menu) {
    menu.style.display = 'none';
    menu.classList.remove('from-bottom-bar');
  }
  if (activePillMenuColId) {
    const pill = document.getElementById(`pill_${activePillMenuColId}`);
    if (pill) {
      const btn = pill.querySelector('.pill-options-btn');
      if (btn) btn.classList.remove('active');
    }
    activePillMenuColId = null;
  }
  if (window.__pendingPillsRender) {
    window.__pendingPillsRender = false;
    renderCollectionPills();
  }
}

function openPillMenu(event, colId) {
  if (event) {
    event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  const isRightClick = !!(event && (event.type === 'contextmenu' || event.button === 2));
  if (!isRightClick && activePillMenuColId === colId) {
    closePillMenu();
    return;
  }
  closePillMenu();
  if (typeof closeContextMenu === 'function') closeContextMenu();

  const menu = document.getElementById('pillContextMenu');
  if (!menu) return;

  window.__pillMenuOpenedAt = Date.now();
  window._lastMenuOpenedAt = Date.now();

  const pillEl = document.getElementById(`pill_${colId}`);
  let btn = null;
  if (event && event.target && event.target.closest) {
    btn = event.target.closest('.pill-options-btn') || event.target.closest('.pill-menu-trigger');
    if (!btn) btn = event.target.closest('.col-pill');
  }
  if (!btn && pillEl) {
    btn = pillEl;
  }
  if (!btn) btn = (event && event.currentTarget) ? event.currentTarget : document.body;

  activePillMenuColId = colId;
  if (btn && btn.classList) btn.classList.add('active');

  const targetCol = Array.isArray(customCollections) ? customCollections.find(c => c && c.id === colId) : null;
  const pinText = document.getElementById('pillMenuPinText');
  if (pinText) {
    pinText.textContent = (targetCol && targetCol.pinned) ? 'Unpin Collection' : 'Pin Collection';
  }

  const unnestRow = document.getElementById('pillMenuUnnestRow');
  if (unnestRow) {
    unnestRow.style.display = (targetCol && targetCol.parentId) ? '' : 'none';
  }

  // Option A: hide "Merge into..." unless 2+ custom collections exist —
  // with fewer, merging into All is identical to deleting the collection.
  try {
    const mergeRow = document.getElementById('pillMenuMergeRow');
    if (mergeRow) {
      const customCount = Array.isArray(customCollections) ? customCollections.filter(c => c && c.id).length : 0;
      mergeRow.style.display = customCount >= 2 ? '' : 'none';
    }
  } catch {}

  // Clear any stale constraint from a previous open so naturalHeight
  // always measures the full menu, never a previously-capped height.
  menu.style.maxHeight = '';
  menu.style.overflowY = '';
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  menu.classList.add('visible');

  const rect = btn.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 200;
  const naturalHeight = menu.offsetHeight || 200;
  const margin = 8, gap = 6;
  const vw = window.innerWidth, vh = window.innerHeight;

  const isFromSidebar = !!(event && (
    (event.target && event.target.closest && (event.target.closest('#sidebarNav') || event.target.closest('.sidebar-nav-item'))) ||
    (rect.width === 0 && rect.height === 0)
  ));

  if (isFromSidebar) {
    let clientX = (event && typeof event.clientX === 'number' && event.clientX > 0) ? event.clientX : (rect.right || 180);
    let clientY = (event && typeof event.clientY === 'number' && event.clientY > 0) ? event.clientY : (rect.top || 100);

    let left = clientX;
    let top = clientY;
    if (left + menuWidth > vw - margin) left = Math.max(margin, vw - menuWidth - margin);
    if (top + naturalHeight > vh - margin) top = Math.max(margin, vh - naturalHeight - margin);

    menu.classList.remove('from-bottom-bar');
    menu.style.bottom = 'auto';
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.maxHeight = `${Math.round(vh - margin * 2)}px`;
    menu.style.overflowY = naturalHeight > (vh - margin * 2) ? 'auto' : '';
  } else {
    // Bottom-bar pills ALWAYS open UPWARDS
    let left = rect.left + (rect.width / 2) - (menuWidth / 2);
    if (left < margin) left = margin;
    if (left + menuWidth > vw - margin) left = Math.max(margin, vw - menuWidth - margin);

    const spaceAbove = Math.max(0, rect.top - margin);
    const menuH = Math.min(naturalHeight, Math.max(120, spaceAbove - gap));

    menu.classList.add('from-bottom-bar');
    menu.style.top = 'auto';
    menu.style.bottom = `${Math.round(vh - rect.top + gap)}px`;
    menu.style.maxHeight = `${Math.round(menuH)}px`;
    menu.style.overflowY = menuH < naturalHeight ? 'auto' : '';
    menu.style.left = `${Math.round(left)}px`;
  }

  menu.style.visibility = '';
}

function triggerPillUnnest() {
  const colId = activePillMenuColId;
  closePillMenu();
  if (!colId || !Array.isArray(customCollections)) return;
  const col = customCollections.find(c => c && c.id === colId);
  if (!col) return;
  const previousParentId = col.parentId || null;
  col.parentId = null;
  saveCustomCollections();

  const repaint = () => {
    if (typeof renderCollectionPills === 'function') renderCollectionPills();
    if (typeof renderSidebarNav === 'function') renderSidebarNav();
  };
  const rollback = (reason) => {
    col.parentId = previousParentId;
    saveCustomCollections();
    if (typeof showToast === 'function') showToast(`Could not move "${col.name}" — ${reason}`);
    repaint();
  };

  try {
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.set_collection_parent === 'function') {
      api.set_collection_parent(colId, null).then(res => {
        if (res && res.ok === false) {
          rollback('the folder structure was rejected');
          return;
        }
        if (typeof showToast === 'function') showToast(`Moved "${col.name}" to top level`);
        repaint();
      }).catch(() => rollback('the database did not respond'));
      return;
    }
  } catch {}

  repaint();
  if (typeof showToast === 'function') showToast(`Moved "${col.name}" to top level`);
}
window.triggerPillUnnest = triggerPillUnnest;

function triggerPillTogglePin() {
  const colId = activePillMenuColId;
  closePillMenu();
  if (!colId || !Array.isArray(customCollections)) return;
  const targetCol = customCollections.find(c => c && c.id === colId);
  if (targetCol) {
    targetCol.pinned = !targetCol.pinned;
    try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch(e) {}
    // S10: pinned ordering lived in localStorage only and was lost whenever
    // definitions rehydrated from SQLite. Mirror it (with the parent intact).
    try {
      const api = window.pywebview && window.pywebview.api;
      if (api && typeof api.save_collection === 'function') {
        const order = customCollections.findIndex(c => c && c.id === colId);
        api.save_collection(colId, targetCol.name || colId, !!targetCol.pinned, order < 0 ? 0 : order, targetCol.parentId || null);
      }
    } catch {}
    renderCollectionPills();
    if (typeof notifySettingSaved === 'function') {
      notifySettingSaved(targetCol.pinned ? 'Collection pinned to front' : 'Collection unpinned');
    }
  }
}
window.triggerPillTogglePin = triggerPillTogglePin;

function triggerPillRename() {
  const colId = activePillMenuColId;
  closePillMenu();
  if (colId) promptRenameCollection(colId);
}

function triggerPillClear() {
  const colId = activePillMenuColId;
  closePillMenu();
  if (!colId) return;
  const target = customCollections.find(c => c.id === colId);
  const colName = target ? target.name : colId;

  if (confirm(`Are you sure you want to clear all clips in "${colName}"?`)) {
    // Backend-driven clear (C1): pinned/favorite clips are kept by the backend,
    // so refresh from the backend instead of filtering memory (which would diverge).
    const finishClear = () => {
      renderCollectionPills();
      if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch {} }
      else if (typeof applyFilters === 'function') applyFilters();
      if (typeof showToast === 'function') showToast(`Cleared clips in ${colName}`);
    };
    const api = window.pywebview && window.pywebview.api;
    if (api) {
      const call = (typeof api.delete_clips_in_collection === 'function')
        ? api.delete_clips_in_collection(colId)
        : ((typeof api.clear_collection === 'function') ? api.clear_collection(colId) : null);
      if (call && typeof call.then === 'function') {
        call.then((res) => {
          if (res && res.ok === false && !res.canceled) {
            if (typeof showToast === 'function') showToast(res.error ? 'Clear failed: ' + res.error : 'Clear history failed', 'error');
            if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch {} }
            return;
          }
          finishClear();
        }).catch(() => {
          if (typeof showToast === 'function') showToast('Clear history failed', 'error');
          if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch {} }
        });
        return;
      }
    }
    finishClear();
  }
}
window.triggerPillClear = triggerPillClear;

function triggerPillDelete() {
  const colId = activePillMenuColId;
  closePillMenu();
  if (colId) promptDeleteCollection(colId);
}

function triggerPillAutoSortMapping() {
  const colId = activePillMenuColId;
  closePillMenu();
  if (!colId) return;
  if (typeof openSettingsView === 'function') openSettingsView();
  if (typeof switchSettingsTab === 'function') switchSettingsTab('routing');
  if (typeof populateAutoSortCollectionSelect === 'function') {
    populateAutoSortCollectionSelect(colId);
  }
  const procInput = document.getElementById('newRuleProcess');
  if (procInput) {
    setTimeout(() => procInput.focus(), 150);
  }
}

function triggerPillMerge() {
  const colId = activePillMenuColId;
  closePillMenu();
  if (colId) openMergeCollectionModal(colId);
}
window.triggerPillMerge = triggerPillMerge;

let pendingMergeSourceColId = null;
function openMergeCollectionModal(colId) {
  if (!colId) return;
  if (!Array.isArray(customCollections) || customCollections.length === 0) {
    try {
      const raw = localStorage.getItem('dualclip_custom_collections');
      if (raw) customCollections = JSON.parse(raw);
    } catch(e) {}
  }
  const target = Array.isArray(customCollections) ? customCollections.find(c => c && c.id === colId) : null;
  const sourceName = target ? target.name : colId;
  pendingMergeSourceColId = colId;

  const nameEl = document.getElementById('mergeSourceCollectionName');
  if (nameEl) nameEl.textContent = sourceName;

  const selectEl = document.getElementById('mergeTargetCollectionSelect');
  const otherColls = Array.isArray(customCollections)
    ? customCollections.filter(c => c && c.id !== colId && c.id !== 'all')
    : [];

  if (selectEl) {
    selectEl.innerHTML = '';
    if (otherColls.length === 0) {
      const optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = 'No other collections available';
      optNone.disabled = true;
      optNone.selected = true;
      selectEl.appendChild(optNone);
      selectEl.value = '';
    } else {
      otherColls.forEach((c, idx) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        if (idx === 0) opt.selected = true;
        selectEl.appendChild(opt);
      });
      selectEl.value = otherColls[0].id;
    }

    // The select is custom-skinned: refresh the visible dropdown from the new options
    try {
      if (typeof rebuildCustomSelect === 'function') rebuildCustomSelect(selectEl);
      else if (typeof window.rebuildCustomSelect === 'function') window.rebuildCustomSelect(selectEl);
      if (typeof syncAllCustomSelects === 'function') syncAllCustomSelects();
      else if (typeof window.syncAllCustomSelects === 'function') window.syncAllCustomSelects();
    } catch (e) {}
  }

  const modal = document.getElementById('mergeCollectionModal');
  if (modal) modal.style.display = 'flex';
}

function closeMergeCollectionModal(event) {
  if (event && event.target && event.target.id !== 'mergeCollectionModal' && !event.target.classList.contains('close')) return;
  const modal = document.getElementById('mergeCollectionModal');
  if (modal) modal.style.display = 'none';
  pendingMergeSourceColId = null;
}

function executeMergeCollection() {
  const sourceColId = pendingMergeSourceColId;
  const selectEl = document.getElementById('mergeTargetCollectionSelect');
  let targetColId = selectEl ? selectEl.value : '';
  if (!sourceColId) return;

  // Validate destination
  if (!targetColId || targetColId === sourceColId) {
    if (typeof showToast === 'function') {
      showToast(!targetColId ? 'No destination collection available' : 'Cannot merge a collection into itself');
    }
    return;
  }

  const sourceTarget = Array.isArray(customCollections) ? customCollections.find(c => c && c.id === sourceColId) : null;
  const sourceName = sourceTarget ? sourceTarget.name : sourceColId;
  const destTarget = Array.isArray(customCollections) ? customCollections.find(c => c && c.id === targetColId) : null;
  const destName = destTarget ? destTarget.name : (targetColId === 'all' ? 'All Clips' : targetColId);

  // Optimistic in-memory move (id-keyed; backend reassigns database-wide)
  if (Array.isArray(allClips)) {
    allClips.forEach(c => {
      if (c && c.collection === sourceColId) {
        c.collection = targetColId;
      }
    });
  }
  if (Array.isArray(clips)) {
    clips.forEach(c => {
      if (c && c.collection === sourceColId) {
        c.collection = targetColId;
      }
    });
  }

  // Remove source collection from custom collections
  customCollections = customCollections.filter(c => c && c.id !== sourceColId);
  saveCustomCollections();
  addDeletedCollectionTombstone(sourceColId);

  // Single id-based backend merge (D1): reassigns ALL rows + deletes the definition
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.merge_collection === 'function') {
    try {
      const p = window.pywebview.api.merge_collection(sourceColId, targetColId);
      if (p && typeof p.then === 'function') {
        p.then((res) => {
          if (res && res.ok === false && typeof showToast === 'function') {
            showToast('Merge did not save — reloading');
          }
          if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch {} }
        }).catch(() => {
          if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch {} }
        });
      }
    } catch {}
  }

  // If currently on the merged collection, switch to the destination collection
  if (currentCollection === sourceColId) {
    selectCollection(targetColId);
  } else {
    if (typeof applyFilters === 'function') applyFilters();
  }
  // Always re-render pills: the source pill must disappear even on the
  // selectCollection path (which only toggles active states, never rebuilds).
  renderCollectionPills();

  const modal = document.getElementById('mergeCollectionModal');
  if (modal) modal.style.display = 'none';
  pendingMergeSourceColId = null;

  if (typeof showToast === 'function') showToast(`Merged "${sourceName}" into "${destName}"`);
}

let pendingRenameColId = null;

function promptRenameCollection(colId) {
  if (!colId) return;
  const target = customCollections.find(c => c.id === colId);
  if (!target) return;

  pendingRenameColId = colId;
  const modal = document.getElementById('renameCollectionModal');
  const input = document.getElementById('renameCollectionInput');
  if (modal && input) {
    input.value = target.name;
    modal.style.display = 'flex';
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  } else {
    const newName = prompt('Enter new name for collection:', target.name);
    if (newName && newName.trim() && newName.trim() !== target.name) {
      applyRenameCollection(colId, newName.trim());
    }
  }
}

function closeRenameCollectionModal(event) {
  if (event && event.target && event.target.id !== 'renameCollectionModal' && !event.target.classList.contains('close')) return;
  const modal = document.getElementById('renameCollectionModal');
  if (modal) modal.style.display = 'none';
  pendingRenameColId = null;
}

function handleRenameCollectionKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    executeRenameCollection();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeRenameCollectionModal();
  }
}

function executeRenameCollection() {
  const colId = pendingRenameColId;
  if (!colId) return;
  const target = customCollections.find(c => c.id === colId);
  if (!target) return;

  const input = document.getElementById('renameCollectionInput');
  const newName = input ? input.value.trim() : '';
  if (!newName) {
    if (typeof showCollectionNameError === 'function') showCollectionNameError();
    else if (typeof showToast === 'function') showToast('Please enter a collection name');
    if (input) input.focus();
    return;
  }

  const oldName = target.name;
  if (newName !== oldName) {
    applyRenameCollection(colId, newName);
  }

  const modal = document.getElementById('renameCollectionModal');
  if (modal) modal.style.display = 'none';
  pendingRenameColId = null;
}

function applyRenameCollection(colId, trimmed) {
  const target = customCollections.find(c => c.id === colId);
  if (!target) return;
  target.name = trimmed;
  saveCustomCollections();
  clearDeletedCollectionTombstone(colId);

  // D1: rename relabels the definition only — membership already keys by id,
  // so clip rows are never touched.
  const api = window.pywebview && window.pywebview.api;
  if (api && typeof api.rename_collection === 'function') {
    try { api.rename_collection(colId, trimmed); } catch {}
  }
  if (api && typeof api.save_collection === 'function') {
    try {
      const order = customCollections.findIndex(c => c && c.id === colId);
      api.save_collection(colId, trimmed, !!target.pinned, order < 0 ? 0 : order, target.parentId || null);
    } catch {}
  }

  renderCollectionPills();
  if (typeof renderSidebarNav === 'function') renderSidebarNav();
  updateSearchScopeBadge();
  if (typeof applyFilters === 'function') applyFilters();
}

function renderCollectionPills() {
  const menu = document.getElementById('pillContextMenu');
  if (menu && menu.style.display !== 'none' && activePillMenuColId) {
    window.__pendingPillsRender = true;
    return;
  }
  updateCollectionCountsUI();
  try { if (typeof maybeRefreshBackendColCounts === 'function') maybeRefreshBackendColCounts(); } catch {}
  const container = document.getElementById('dynamicCollectionPills');
  if (!container) return;
  if (!Array.isArray(customCollections)) customCollections = [];
  // dedupe by id and scrub system reserved buckets
  const SYSTEM_RESERVED_IDS = new Set(['all', 'pins', 'most_used', 'favorites', 'all_total', 'all_unorganized', 'transcriptions', 'voice']);
  const seenIds = new Set();
  const deduped = [];
  customCollections.forEach(c => {
    if (c && c.id && !seenIds.has(c.id) && !SYSTEM_RESERVED_IDS.has(String(c.id).toLowerCase())) {
      seenIds.add(c.id);
      deduped.push(c);
    }
  });
  if (deduped.length !== customCollections.length) {
    customCollections = deduped;
    try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch(e) {}
  }
  container.innerHTML = '';

  // Sort pinned collections to front (consistent display order helper for pills and 1..9 shortcuts, audit K5)
  function getSortedVisibleCustomCollections() {
    if (!Array.isArray(customCollections)) return [];
    return [...customCollections].sort((a, b) => {
      const aPin = !!(a && a.pinned);
      const bPin = !!(b && b.pinned);
      if (aPin !== bPin) return aPin ? -1 : 1;
      return 0;
    });
  }
  window.getSortedVisibleCustomCollections = getSortedVisibleCustomCollections;

  const sortedCollections = getSortedVisibleCustomCollections();

  sortedCollections.filter(c => c && c.id).forEach(c => {
    const count = getCollectionClipCount(c.id);
    const pill = document.createElement('span');
    pill.className = 'col-pill' + (currentCollection === c.id ? ' active' : '') + (c.pinned ? ' pinned-pill' : '');
    pill.id = `pill_${c.id}`;
    pill.title = `${escapeHtml(c.name)}${c.pinned ? ' (Pinned)' : ''} • Right-click for options`;
    pill.innerHTML = `
      <span class="pill-name">${escapeHtml(c.name)}</span>
      <span class="pill-menu-trigger pill-options-btn" title="Collection options" draggable="false" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); event.preventDefault(); openPillMenu(event, '${c.id}')">⋮</span>
    `;
    pill.onclick = (e) => {
      if (e && e.button !== 0) return;
      selectCollection(c.id);
    };
    pill.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPillMenu(e, c.id);
    };

    // Drag-and-drop drop target handlers
    setupPillDropListeners(pill, c.id, c.name || c.id);
    // Pill reorder source (drag pill to rearrange; pinned-first grouping preserved)
    setupPillReorderSource(pill, c.id);

    container.appendChild(pill);
  });

  if (typeof renderSettingsCollectionsList === 'function') {
    renderSettingsCollectionsList();
  }
  if (typeof renderSidebarNav === 'function') {
    renderSidebarNav();
  }
}

function renderContextCollectionMenu() {
  const container = document.getElementById('ctxDynamicCollections') || document.getElementById('ctxCollectionList');
  if (!container) return;
  container.innerHTML = '';

  const sub = document.getElementById('ctxCollectionsSubmenu');
  if (sub) {
    sub.style.overflowY = (Array.isArray(customCollections) && customCollections.length > 5) ? 'auto' : 'hidden';
  }

  customCollections.forEach(c => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = `<span>${escapeHtml(c.name)}</span>`;
    item.onclick = () => {
      if (typeof moveToCollection === 'function') moveToCollection(c.id);
    };
    container.appendChild(item);
  });
}

function openNewCollectionModal() {
  const modal = document.getElementById('newCollectionModal');
  const input = document.getElementById('newCollectionInput');
  if (modal && input) {
    input.value = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);
  }
}

function closeNewCollectionModal(event) {
  if (event && event.target && event.target.id !== 'newCollectionModal' && !event.target.classList.contains('close')) return;
  const modal = document.getElementById('newCollectionModal');
  if (modal) modal.style.display = 'none';
  const sel = document.getElementById('newRuleCollection');
  if (sel && sel.value === '__create_new__') {
    const collections = typeof getAllAvailableCollections === 'function' ? getAllAvailableCollections().filter(c => c && c.id !== '__create_new__') : [];
    if (collections.length > 0) sel.value = collections[0].id;
    else sel.value = '';
  }
}

function handleNewCollectionKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    submitNewCollection();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeNewCollectionModal();
  }
}

function submitNewCollection() {
  const input = document.getElementById('newCollectionInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) {
    if (typeof showCollectionNameError === 'function') showCollectionNameError();
    else if (typeof showToast === 'function') showToast('Please enter a collection name');
    input.focus();
    return;
  }

  const id = 'col_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
  customCollections.push({ id, name });
  saveCustomCollections();
  clearDeletedCollectionTombstone(id);
  // Mirror the definition to the backend (H5) so it survives localStorage loss
  try {
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.save_collection === 'function') {
      api.save_collection(id, name, false, customCollections.length - 1, null);
    }
  } catch {}
  renderCollectionPills();
  closeNewCollectionModal();
  selectCollection(id);
  if (typeof populateAutoSortCollectionSelect === 'function') {
    populateAutoSortCollectionSelect(id);
  }
}

let pendingDeleteCollectionId = null;

function promptDeleteCollection(colId) {
  if (!colId) return;
  const target = customCollections.find(c => c.id === colId);
  if (!target) return;

  pendingDeleteCollectionId = colId;
  const nameEl = document.getElementById('deleteCollectionModalName');
  if (nameEl) nameEl.textContent = `"${target.name}"`;

  const withClipsEl = document.getElementById('deleteCollectionWithClips');
  if (withClipsEl) withClipsEl.checked = true;
  updateDeleteCollectionDialogText();

  const modal = document.getElementById('deleteCollectionModal');
  if (modal) {
    modal.style.display = 'flex';
  } else {
    // Fallback if modal element is not in DOM
    if (window.confirm(`Delete collection "${target.name}" and all clips inside it?\n\nUncheck the dialog option to keep clips in All Clips instead.`)) {
      executeDeleteCollection();
    }
  }
}

function updateDeleteCollectionDialogText() {
  const withClips = document.getElementById('deleteCollectionWithClips');
  const checked = withClips ? withClips.checked : true;
  const countEl = document.getElementById('deleteCollectionClipCount');
  let count = 0;
  try {
    if (pendingDeleteCollectionId && typeof getCollectionClipCount === 'function') count = getCollectionClipCount(pendingDeleteCollectionId) || 0;
    else if (Array.isArray(allClips) && pendingDeleteCollectionId) count = allClips.filter(c => c && c.collection === pendingDeleteCollectionId).length;
  } catch (_) {}
  if (countEl) countEl.textContent = count === 1 ? '1 clip' : `${count} clips`;
  const desc = document.getElementById('deleteCollectionModalDesc');
  if (desc) {
    if (checked) desc.innerHTML = 'This will <strong>permanently delete</strong> the collection and its clips.';
    else desc.innerHTML = 'Clips will stay safe and move back to <strong>All Clips</strong>.';
  }
}

function onDeleteCollectionWithClipsChanged() {
  updateDeleteCollectionDialogText();
}

function closeDeleteCollectionModal(event) {
  if (event && event.target && event.target.id !== 'deleteCollectionModal') return;
  const modal = document.getElementById('deleteCollectionModal');
  if (modal) modal.style.display = 'none';
  pendingDeleteCollectionId = null;
}

function executeDeleteCollection() {
  const colId = pendingDeleteCollectionId;
  if (!colId) return;

  const withClipsEl = document.getElementById('deleteCollectionWithClips');
  const deleteWithClips = withClipsEl ? withClipsEl.checked : true;

  const target = customCollections.find(c => c.id === colId);
  const name = target ? target.name : 'Collection';
  customCollections = customCollections.filter(c => c.id !== colId);
  saveCustomCollections();
  addDeletedCollectionTombstone(colId);

  // Delete path removes clips + definition; keep path reassigns to 'all'. Reload so DB is source of truth.
  const finishDelete = () => {
    renderCollectionPills();
    if (currentCollection === colId) {
      selectCollection('all');
    } else {
      updateSearchScopeBadge();
      if (typeof applyFilters === 'function') applyFilters();
    }
    if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch {} }
  };
  const reportDeleteError = (err) => {
    if (typeof showToast === 'function') showToast(err || "Couldn't delete collection - reloaded", { duration: 2500 });
    finishDelete();
  };
  const api = window.pywebview && window.pywebview.api;
  if (deleteWithClips) {
    if (api && typeof api.delete_collection_def === 'function') {
      try {
        api.delete_collection_def(colId, true).then((res) => {
          if (res && res.ok === false) { reportDeleteError(res.error); return; }
          if (Array.isArray(allClips)) allClips = allClips.filter(c => !(c && c.collection === colId));
          if (Array.isArray(clips)) clips = clips.filter(c => !(c && c.collection === colId));
          finishDelete();
        }).catch(() => reportDeleteError());
        const modal = document.getElementById('deleteCollectionModal');
        if (modal) modal.style.display = 'none';
        pendingDeleteCollectionId = null;
        return;
      } catch {}
    }
    if (Array.isArray(allClips)) allClips = allClips.filter(c => !(c && c.collection === colId));
    if (Array.isArray(clips)) clips = clips.filter(c => !(c && c.collection === colId));
    finishDelete();
    const modal = document.getElementById('deleteCollectionModal');
    if (modal) modal.style.display = 'none';
    pendingDeleteCollectionId = null;
    return;
  }
  if (api && typeof api.reassign_collection === 'function') {
    try {
      api.reassign_collection(colId, 'all').then(() => {
        try {
          if (typeof api.delete_collection_def === 'function') api.delete_collection_def(colId);
        } catch {}
        // Optimistic in-memory move for instant paint; reload reconciles
        if (Array.isArray(allClips)) {
          allClips.forEach(c => { if (c && c.collection === colId) c.collection = 'all'; });
        }
        if (Array.isArray(clips)) {
          clips.forEach(c => { if (c && c.collection === colId) c.collection = 'all'; });
        }
        finishDelete();
      }).catch(finishDelete);
      const modal = document.getElementById('deleteCollectionModal');
      if (modal) modal.style.display = 'none';
      pendingDeleteCollectionId = null;
      return;
    } catch {}
  }

  // Fallback when the backend is unreachable: page-local reassignment
  if (Array.isArray(allClips)) {
    allClips.forEach(c => {
      if (c && c.collection === colId) {
        c.collection = 'all';
        if (api && typeof api.move_to_collection === 'function') {
          try { api.move_to_collection(c.id, 'all'); } catch (_) {}
        }
      }
    });
  }
  if (Array.isArray(clips)) {
    clips.forEach(c => {
      if (c && c.collection === colId) c.collection = 'all';
    });
  }

  finishDelete();

  const modal = document.getElementById('deleteCollectionModal');
  if (modal) modal.style.display = 'none';
  pendingDeleteCollectionId = null;
}

function deleteCollection(colId) {
  promptDeleteCollection(colId);
}

function updateSearchScopeBadge() {
  const badge = document.getElementById('scopeBadge');
  const badgeText = document.getElementById('scopeBadgeText');
  const input = document.getElementById('searchInput');
  if (!badge) return;

  if (!currentCollection || currentCollection === 'all') {
    badge.style.display = 'none';
    if (input) input.placeholder = 'Search clipboard history...';
  } else if (currentCollection === 'pins') {
    badge.style.display = 'inline-flex';
    if (badgeText) badgeText.textContent = 'Favorites';
    if (input) input.placeholder = 'Search in Favorites...';
  } else if (currentCollection === 'most_used') {
    badge.style.display = 'inline-flex';
    if (badgeText) badgeText.textContent = 'Most Used';
    if (input) input.placeholder = 'Search in Most Used...';
  } else {
    const col = Array.isArray(customCollections) ? customCollections.find(c => c.id === currentCollection) : null;
    if (!col) {
      // Unknown/deleted id (e.g. stale selection after a merge): fall back to All
      // instead of showing a raw col_<id> in the search bar.
      currentCollection = 'all';
      badge.style.display = 'none';
      if (input) input.placeholder = 'Search clipboard history...';
      return;
    }
    badge.style.display = 'inline-flex';
    if (badgeText) badgeText.textContent = col.name;
    if (input) input.placeholder = `Search in ${col.name}...`;
  }
}

function resetScopeToAll(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  selectCollection('all');
  const input = document.getElementById('searchInput');
  if (input) input.focus();
}

function selectCollection(colId) {
  // S5: reject ids with no definition — otherwise the user gets an empty list
  // with no row highlighted and no way back except a manual reset.
  const knownSidebarId = colId === 'all' || colId === 'pins' || colId === 'most_used'
    || (Array.isArray(customCollections) && customCollections.some(c => c && c.id === colId));
  if (!knownSidebarId) {
    if (typeof showToast === 'function') showToast('That collection no longer exists — showing All Clips');
    if (colId !== 'all') { selectCollection('all'); return; }
  }
  currentCollection = colId;
  document.querySelectorAll('.col-pill').forEach(p => p.classList.remove('active'));
  const activePill = document.getElementById(`pill_${colId}`);
  if (activePill) activePill.classList.add('active');

  if (typeof renderSidebarNav === 'function') {
    renderSidebarNav();
  }

  updateSearchScopeBadge();
  expandedIndex = -1;

  // Single authoritative render: backend is source of truth, frontend applyFilters is redundant double-pop
  if (typeof loadClipsFromBackend === 'function' && window.chrome && window.chrome.webview && window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clips === 'function') {
    loadClipsFromBackend();
  } else if (typeof applyFilters === 'function') {
    applyFilters();
  }
}

// Global & Namespace Exposure for Collections
window.promptRenameCollection = promptRenameCollection;
window.closeRenameCollectionModal = closeRenameCollectionModal;
window.handleRenameCollectionKeydown = handleRenameCollectionKeydown;
window.executeRenameCollection = executeRenameCollection;
window.updateSearchScopeBadge = updateSearchScopeBadge;
window.resetScopeToAll = resetScopeToAll;
window.saveCustomCollections = saveCustomCollections;
window.renderCollectionPills = renderCollectionPills;
window.renderContextCollectionMenu = renderContextCollectionMenu;
window.openNewCollectionModal = openNewCollectionModal;
window.closeNewCollectionModal = closeNewCollectionModal;
window.handleNewCollectionKeydown = handleNewCollectionKeydown;
window.submitNewCollection = submitNewCollection;
window.deleteCollection = deleteCollection;
window.promptDeleteCollection = promptDeleteCollection;
window.closeDeleteCollectionModal = closeDeleteCollectionModal;
window.executeDeleteCollection = executeDeleteCollection;
window.onDeleteCollectionWithClipsChanged = onDeleteCollectionWithClipsChanged;
window.updateDeleteCollectionDialogText = updateDeleteCollectionDialogText;
window.selectCollection = selectCollection;
window.openPillMenu = openPillMenu;
window.closePillMenu = closePillMenu;
window.triggerPillRename = triggerPillRename;
window.triggerPillClear = triggerPillClear;
window.triggerPillDelete = triggerPillDelete;
window.triggerPillMerge = triggerPillMerge;
window.triggerPillAutoSortMapping = triggerPillAutoSortMapping;
window.openMergeCollectionModal = openMergeCollectionModal;
window.closeMergeCollectionModal = closeMergeCollectionModal;
window.executeMergeCollection = executeMergeCollection;
window.invalidateBackendColCounts = invalidateBackendColCounts;
window.maybeRefreshBackendColCounts = maybeRefreshBackendColCounts;

window.DC = window.DC || {};
window.DC.filtersCollections = {
  promptRenameCollection,
  closeRenameCollectionModal,
  handleRenameCollectionKeydown,
  executeRenameCollection,
  updateSearchScopeBadge,
  resetScopeToAll,
  saveCustomCollections,
  getCollectionClipCount,
  invalidateBackendColCounts,
  maybeRefreshBackendColCounts,
  renderCollectionPills,
  renderContextCollectionMenu,
  openNewCollectionModal,
  closeNewCollectionModal,
  handleNewCollectionKeydown,
  submitNewCollection,
  deleteCollection,
  promptDeleteCollection,
  closeDeleteCollectionModal,
  executeDeleteCollection,
  onDeleteCollectionWithClipsChanged,
  updateDeleteCollectionDialogText,
  selectCollection,
  openPillMenu,
  closePillMenu,
  triggerPillRename,
  triggerPillClear,
  triggerPillDelete,
  triggerPillMerge,
  triggerPillAutoSortMapping,
  openMergeCollectionModal,
  closeMergeCollectionModal,
  executeMergeCollection
};
