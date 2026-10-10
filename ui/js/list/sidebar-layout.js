
function formatSidebarBadgeCount(count) {
  const num = typeof count === 'number' ? count : parseInt(count, 10);
  if (isNaN(num) || num <= 0) return '0';
  if (num > 99) return '99+';
  return String(num);
}
/**
 * DualClip Sidebar Layout Manager
 * Handles switching between Standard single-column view and Sidebar split-pane view,
 * section collapsibles, count visibility toggling, and hierarchical nested collections.
 */

const SYSTEM_RESERVED_IDS = new Set(['all', 'pins', 'most_used', 'favorites', 'all_total', 'all_unorganized', 'transcriptions', 'voice']);

function getSidebarLayoutSetting() {
  if (typeof getSetting === 'function') {
    return getSetting('dualclip_view_layout') || 'standard';
  }
  return localStorage.getItem('dualclip_view_layout') || 'standard';
}

function setSidebarLayoutSetting(layout) {
  if (typeof setSetting === 'function') {
    setSetting('dualclip_view_layout', layout);
  } else {
    try { localStorage.setItem('dualclip_view_layout', layout); } catch(e) {}
  }
}

function toggleSidebarLayout() {
  const current = getSidebarLayoutSetting();
  const next = current === 'sidebar' ? 'standard' : 'sidebar';
  if (next === 'sidebar' && isSidebarBlockedByPreset()) {
    if (typeof showToast === 'function') {
      showToast('Side view needs Standard mode');
    }
    return;
  }
  applySidebarLayout(next);
  if (typeof showToast === 'function') {
      showToast(next === 'sidebar' ? 'Switched to Sidebar view' : 'Switched to Standard view');
  }
}

// Side view is CSS-suppressed under the Compact preset (sidebar-layout.css), so enabling it
// there would report success while changing nothing. Read the preset attribute directly.
function isSidebarBlockedByPreset() {
  try {
    const preset = document.documentElement.getAttribute('data-layout-preset')
      || localStorage.getItem('dualclip_layout_preset');
    return preset === 'compact';
  } catch (_) {
    return false;
  }
}

function applySidebarLayout(layout) {
  setSidebarLayoutSetting(layout);
  const mainView = document.getElementById('mainView');
  const btn = document.getElementById('btnToggleLayout') || document.getElementById('btnToggleLayoutSearch');
  const isSidebar = layout === 'sidebar';

  if (mainView) {
    mainView.classList.toggle('layout-sidebar', isSidebar);
  }

  if (btn) {
    btn.classList.toggle('active', isSidebar);
    const tipText = isSidebar ? 'Switch to Standard View (Compact)' : 'Switch to Sidebar View';
    btn.setAttribute('data-tooltip', tipText);
    btn.removeAttribute('title');
  }

  if (isSidebar) {
    renderSidebarNav();
  }

  if (typeof renderVirtualWindow === 'function') {
    setTimeout(renderVirtualWindow, 50);
  }
}

function isSidebarSectionCollapsed(key) {
  try {
    return localStorage.getItem('dualclip_sidebar_collapse_' + key) === '1';
  } catch(e) { return false; }
}

function toggleSidebarSection(key) {
  const next = !isSidebarSectionCollapsed(key);
  try {
    localStorage.setItem('dualclip_sidebar_collapse_' + key, next ? '1' : '0');
  } catch(e) {}
  const bodyEl = document.getElementById('sidebarSectionBody_' + key);
  const titleEl = document.getElementById('sidebarSectionTitle_' + key);
  if (bodyEl) bodyEl.classList.toggle('collapsed', next);
  if (titleEl) titleEl.classList.toggle('collapsed', next);
}

function isSidebarCountsHidden() {
  try {
    if (typeof getSetting === 'function') {
      const v = getSetting('dualclip_sidebar_hide_counts');
      return v === true || v === '1' || v === 'true';
    }
    return localStorage.getItem('dualclip_sidebar_hide_counts') === '1' || localStorage.getItem('dualclip_sidebar_hide_counts') === 'true';
  } catch { return false; }
}

function toggleSidebarCountsHidden() {
  const next = !isSidebarCountsHidden();
  try {
    if (typeof setSetting === 'function') {
      setSetting('dualclip_sidebar_hide_counts', next);
    } else {
      localStorage.setItem('dualclip_sidebar_hide_counts', next ? '1' : '0');
    }
  } catch {}
  applySidebarCountsVisibility();
  if (typeof showToast === 'function') {
    showToast(next ? 'Clip counts hidden' : 'Clip counts visible');
  }
}

function applySidebarCountsVisibility() {
  const container = document.getElementById('sidebarNav');
  if (!container) return;
  const hidden = isSidebarCountsHidden();
  container.classList.toggle('sidebar-hide-counts', hidden);
  const textEl = document.getElementById('sidebarMenuCountsText');
  if (textEl) {
    textEl.textContent = hidden ? 'Show Clip Counts' : 'Hide Clip Counts';
  }
}

function closeSidebarContextMenu() {}

function openSidebarContextMenu(e) {}

function isColCollapsed(colId) {
  try {
    return localStorage.getItem('dualclip_col_collapsed_' + colId) === '1';
  } catch { return false; }
}

function toggleColCollapsed(colId) {
  const next = !isColCollapsed(colId);
  try {
    localStorage.setItem('dualclip_col_collapsed_' + colId, next ? '1' : '0');
  } catch {}
  renderSidebarNav();
}

let _draggedColId = null;
window._sidebarInternalDragOccurred = false;

function handleSidebarColDragStart(e, colId) {
  _draggedColId = colId;
  window._sidebarInternalDragOccurred = true;
  if (e && e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', colId);
    e.dataTransfer.setData('application/x-dualclip-collection-id', colId);
  }
  const el = document.getElementById('side_col_' + colId);
  if (el) el.classList.add('sidebar-dragging');
}

function isDescendantCol(childId, ancestorId) {
  if (!Array.isArray(customCollections)) return false;
  let cur = customCollections.find(c => c && c.id === childId);
  const visited = new Set();
  while (cur && cur.parentId && !visited.has(cur.id)) {
    visited.add(cur.id);
    if (cur.parentId === ancestorId) return true;
    cur = customCollections.find(c => c && c.id === cur.parentId);
  }
  return false;
}

function isSidebarColDrag(e) {
  if (Array.isArray(window._draggedClipIds) && window._draggedClipIds.length > 0) return false;
  if (_draggedColId) return true;
  if (!e || !e.dataTransfer || !e.dataTransfer.types) return false;
  const types = e.dataTransfer.types;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'application/x-dualclip-collection-id') return true;
  }
  return false;
}

// Distinguishes an external highlighted-text drop from an in-progress folder
// drag. A genuine folder drag is corroborated by ANY of:
//   1. 'application/x-dualclip-collection-id' in types (standard Chromium), or
//   2. the collection id readable via getData (shells that list only text/plain
//      in types but still serve getData on drop), or
//   3. text/plain content EQUAL to the dragged folder id — dragstart aliases
//      the id into text/plain, while shells (WebView2) may strip the custom
//      type from types entirely.
// A stale _draggedColId alone is NOT corroboration: a latched id with foreign
// text content is an external drop and must take add_text_to_collection.
// Events without readable types/payloads return false, keeping the
// _draggedColId fallback working for synthetic/locked-down shells.
function hasExternalTextPayload(e, internalDragId = null) {
  const dt = e && e.dataTransfer;
  const types = dt && dt.types;
  if (types && typeof types.length === 'number') {
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'application/x-dualclip-collection-id') return false;
    }
  }
  let plain = '';
  let html = '';
  let colId = '';
  try {
    if (dt && typeof dt.getData === 'function') {
      plain = dt.getData('text/plain') || '';
      html = dt.getData('text/html') || '';
      colId = dt.getData('application/x-dualclip-collection-id') || '';
    }
  } catch (_) {}
  if (colId) return false;
  if (!types || typeof types.length !== 'number') return false;
  if (internalDragId && plain && plain === internalDragId) return false;
  if (plain && plain.trim()) return true;
  if (html && html.trim()) return true;
  return false;
}

// Settings collection rows tag their drag with this type. Checked via types[] rather than
// getData() because custom types are readable during dragover as well as drop.
function hasSettingsCollectionPayload(e) {
  const types = e && e.dataTransfer && e.dataTransfer.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'application/x-dualclip-settings-collection') return true;
  }
  return false;
}

function handleSidebarColDragOver(e, targetColId) {
  // S9: same gate the pills enforce — a disabled collectionDragDrop accepts no drops.
  try { if (typeof isFeatureEnabled === 'function' && !isFeatureEnabled('collectionDragDrop')) return; } catch (_) {}
  if (isSidebarColDrag(e)) {
    if (!_draggedColId || _draggedColId === targetColId) return;
    if (isDescendantCol(targetColId, _draggedColId)) return;
    if (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }
  } else {
    // External text or clip drag over collection folder
    if (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
  }
  const el = document.getElementById('side_col_' + targetColId);
  if (el && !el.classList.contains('sidebar-drag-over')) {
    el.classList.add('sidebar-drag-over');
  }
}

function handleSidebarColDragLeave(e, targetColId) {
  const el = document.getElementById('side_col_' + targetColId);
  if (el) el.classList.remove('sidebar-drag-over');
}

function handleSidebarColDrop(e, targetColId = null) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  const el = targetColId ? document.getElementById('side_col_' + targetColId) : null;
  if (el) el.classList.remove('sidebar-drag-over');

  // A collection row dragged out of the Settings list carries the collection id in text/plain
  // so its own reorder target can read it. It is not a clip and not text to capture, so stop
  // here — otherwise the id gets saved as a junk clip.
  if (e && e.dataTransfer && hasSettingsCollectionPayload(e)) return;

  // S4: clear the drag globals on drop, not only on dragend — if the dragged
  // node is re-rendered away mid-drag, dragend never fires and the flags latch.
  // Snapshot the id first: the nesting branch below needs it, and it must not
  // depend on dataTransfer being readable (synthetic events, locked-down shells).
  const internalDragId = _draggedColId;
  _draggedColId = null;

  // S9: same gate the pills enforce.
  try {
    if (typeof isFeatureEnabled === 'function' && !isFeatureEnabled('collectionDragDrop')) {
      if (typeof showToast === 'function') showToast('Collection drag & drop is disabled');
      return;
    }
  } catch (_) {}

  // Priority 1: Dragging existing clips onto a collection folder in sidebar
  let ids = [];
  try {
    const batchRaw = e && e.dataTransfer ? e.dataTransfer.getData('application/x-dualclip-ids') : '';
    if (batchRaw) {
      const parsed = JSON.parse(batchRaw);
      if (Array.isArray(parsed)) ids = parsed.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
    }
  } catch (_) {}

  if (ids.length === 0 && e && e.dataTransfer) {
    const clipIdStr = e.dataTransfer.getData('application/x-dualclip-clip-id') || e.dataTransfer.getData('application/x-dualclip-id');
    if (clipIdStr) {
      const clipId = parseInt(clipIdStr, 10);
      if (!isNaN(clipId)) ids = [clipId];
    }
  }

  // Fallback to in-memory tracked clip drag state
  if (ids.length === 0 && Array.isArray(window._draggedClipIds) && window._draggedClipIds.length > 0) {
    ids = window._draggedClipIds.slice();
  }

  if (ids.length > 0 && targetColId && typeof handleCollectionPillDrop === 'function') {
    const colObj = Array.isArray(customCollections) ? customCollections.find(c => c && c.id === targetColId) : null;
    const colName = colObj ? colObj.name : targetColId;
    handleCollectionPillDrop(targetColId, colName, e, ids);
    window._draggedClipIds = null;
    return;
  }

  // Priority 2: Dragging a collection folder into another collection (nesting).
  // An in-progress folder drag (latched id, custom type in types, id served
  // by getData, or text/plain aliasing the dragged id) reliably lands here.
  // Foreign text — even with a stale _draggedColId latched — is external and
  // falls through to Priority 3, which only fires add_text_to_collection.
  if ((internalDragId || isSidebarColDrag(e)) && !hasExternalTextPayload(e, internalDragId)) {
    const draggedId = internalDragId || (e && e.dataTransfer ? e.dataTransfer.getData('application/x-dualclip-collection-id') : null);
    if (!draggedId || draggedId === targetColId) return;
    if (isDescendantCol(targetColId, draggedId)) {
      if (typeof showToast === 'function') showToast('Cannot nest a folder inside its own subfolder');
      return;
    }
    moveCollectionToParent(draggedId, targetColId);
    return;
  }

  // Priority 3: Dropping external highlighted text directly onto a sidebar collection
  let text = '';
  if (e && e.dataTransfer) {
    text = e.dataTransfer.getData('text/plain') || '';
    if (!text) {
      const html = e.dataTransfer.getData('text/html') || '';
      if (html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        text = tmp.textContent || tmp.innerText || '';
      }
    }
  }

  if (text && text.trim()) {
    const colObj = Array.isArray(customCollections) ? customCollections.find(c => c && c.id === targetColId) : null;
    const colName = colObj ? colObj.name : targetColId;
    if (typeof window.callHostChecked === 'function') {
      window.callHostChecked('add_text_to_collection', {
        text: text,
        collection: targetColId,
        favorite: false
      });
    } else if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage({
        id: 0,
        method: 'add_text_to_collection',
        args: [text, targetColId, false]
      });
    }
    if (typeof window.showToast === 'function') {
      window.showToast('Added clip to ' + colName);
    }
  }
}

function handleSidebarRootDragOver(e) {
  try { if (typeof isFeatureEnabled === 'function' && !isFeatureEnabled('collectionDragDrop')) return; } catch (_) {}
  if (!isSidebarColDrag(e)) return;
  if (!_draggedColId) return;
  if (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }
  const titleEl = document.getElementById('sidebarSectionTitle_collections');
  if (titleEl && !titleEl.classList.contains('sidebar-drag-over')) {
    titleEl.classList.add('sidebar-drag-over');
  }
}

function handleSidebarRootDragLeave(e) {
  const titleEl = document.getElementById('sidebarSectionTitle_collections');
  if (titleEl) titleEl.classList.remove('sidebar-drag-over');
}

function handleSidebarRootDrop(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  const titleEl = document.getElementById('sidebarSectionTitle_collections');
  if (titleEl) titleEl.classList.remove('sidebar-drag-over');

  // S4: snapshot the id first, then clear on drop so a missed dragend cannot
  // strand the click guard. Snapshot-before-clear (same as handleSidebarColDrop)
  // keeps root un-nesting working where custom types are stripped from types.
  const rootDragId = _draggedColId;
  _draggedColId = null;

  // Root accepts folder un-nesting only: external text returns here without
  // ever reaching moveCollectionToParent.
  if ((!rootDragId && !isSidebarColDrag(e)) || hasExternalTextPayload(e, rootDragId)) return;
  const draggedId = rootDragId || (e && e.dataTransfer ? e.dataTransfer.getData('application/x-dualclip-collection-id') : null);
  if (!draggedId) return;
  moveCollectionToParent(draggedId, null);
}

function handleSidebarColDragEnd(e) {
  if (_draggedColId) {
    const el = document.getElementById('side_col_' + _draggedColId);
    if (el) el.classList.remove('sidebar-dragging');
  }
  document.querySelectorAll('.sidebar-drag-over').forEach(el => el.classList.remove('sidebar-drag-over'));
  _draggedColId = null;
  setTimeout(() => {
    window._sidebarInternalDragOccurred = false;
  }, 120);
  // S4: the mid-drag render skip below means the tree may be stale after a
  // move — repaint once the drag is fully settled.
  try { if (typeof renderSidebarNav === 'function') setTimeout(renderSidebarNav, 140); } catch (_) {}
}

function moveCollectionToParent(colId, parentId) {
  if (!Array.isArray(customCollections)) return;
  if (!colId || SYSTEM_RESERVED_IDS.has(String(colId).toLowerCase())) return;
  if (parentId && SYSTEM_RESERVED_IDS.has(String(parentId).toLowerCase())) return;
  const col = customCollections.find(c => c && c.id === colId);
  if (!col) return;
  if (parentId && (colId === parentId || isDescendantCol(parentId, colId))) return;
  if (col.parentId === parentId) return;

  const previousParentId = col.parentId || null;
  col.parentId = parentId || null;
  if (typeof saveCustomCollections === 'function') saveCustomCollections();

  const repaint = () => {
    renderSidebarNav();
    if (typeof renderCollectionPills === 'function') renderCollectionPills();
  };

  // The backend rejects reserved ids, self/descendant parents and failed writes with
  // { ok: false }. The optimistic state above must be undone in that case, otherwise the
  // sidebar and localStorage keep a move the database never accepted and it silently
  // reverts on the next launch.
  const rollback = (reason) => {
    col.parentId = previousParentId;
    if (typeof saveCustomCollections === 'function') saveCustomCollections();
    if (typeof showToast === 'function') showToast(`Could not move "${col.name}" — ${reason}`);
    repaint();
  };

  try {
    // Preferred: contract-checked RPC — the only path that reaches SQLite in
    // production WebView2 (window.pywebview.api never exposed
    // set_collection_parent, so the legacy branch below never fired and moves
    // silently reverted on the next hydrate). Requires a live host channel;
    // otherwise fall through to the local-only path, which never rolls back.
    const canUseChecked = (typeof window.callHostChecked === 'function')
      && !!(window.chrome && window.chrome.webview);
    const api = window.pywebview && window.pywebview.api;
    const persistCall = canUseChecked
      ? () => window.callHostChecked('set_collection_parent', { colId: colId, parentId: parentId })
      : (api && typeof api.set_collection_parent === 'function'
        ? () => api.set_collection_parent(colId, parentId)
        : null);
    if (persistCall) {
      const p = persistCall();
      if (p && typeof p.then === 'function') {
        p.then(res => {
          if (res && res.ok === false) {
            rollback('the folder structure was rejected');
            return;
          }
          const parentCol = parentId ? customCollections.find(c => c && c.id === parentId) : null;
          const parentName = parentCol ? parentCol.name : 'top level';
          if (typeof showToast === 'function') {
            showToast(`Moved "${col.name}" into ${parentName}`);
          }
          if (parentId) {
            try { localStorage.setItem('dualclip_col_collapsed_' + parentId, '0'); } catch {}
          }
          repaint();
        }).catch(() => rollback('the database did not respond'));
        return;
      }
    }
  } catch {}

  // No host bridge (e.g. browser preview): nothing can contradict the local state.
  const parentCol = parentId ? customCollections.find(c => c && c.id === parentId) : null;
  const parentName = parentCol ? parentCol.name : 'top level';
  if (typeof showToast === 'function') {
    showToast(`Moved "${col.name}" into ${parentName}`);
  }
  if (parentId) {
    try { localStorage.setItem('dualclip_col_collapsed_' + parentId, '0'); } catch {}
  }
  repaint();
}

function getCollectionRollupCount(colId, memo = new Set()) {
  if (!colId || memo.has(colId)) return 0;
  memo.add(colId);
  let sum = typeof getCollectionClipCount === 'function' ? getCollectionClipCount(colId) : 0;
  if (typeof customCollections !== 'undefined' && Array.isArray(customCollections)) {
    customCollections.forEach(c => {
      if (c && c.parentId === colId && !memo.has(c.id)) {
        sum += getCollectionRollupCount(c.id, memo);
      }
    });
  }
  return sum;
}

// Deepest .sidebar-depth-N rule that exists in sidebar-layout.css. Deeper nodes clamp to
// this indent instead of being dropped: returning '' at the cap silently removed folders
// from the sidebar while they still existed in the database and in ancestor rollups.
const MAX_INDENT_DEPTH = 4;

function renderCollectionTreeNode(col, depth, curCol, visited = new Set()) {
  if (!col || !col.id) return '';
  // Cycle / duplicate guard only. Depth is clamped for display, never used to skip a node.
  if (visited.has(col.id)) return '';
  visited.add(col.id);

  const indentDepth = Math.min(depth, MAX_INDENT_DEPTH);
  const cCount = getCollectionRollupCount(col.id);
  const isAct = curCol === col.id;
  const children = Array.isArray(customCollections) ? customCollections.filter(child => child && child.parentId === col.id && !SYSTEM_RESERVED_IDS.has(String(child.id).toLowerCase())) : [];
  const hasChildren = children.length > 0;
  const collapsed = isColCollapsed(col.id);

  let nodeHtml = `
    <div class="sidebar-nav-item sidebar-depth-${indentDepth} ${isAct ? 'active' : ''}" 
         id="side_col_${escapeHtml(col.id)}" 
         data-col-id="${escapeHtml(col.id)}"
         draggable="true"
         role="button" tabindex="0"
         ondragstart="handleSidebarColDragStart(event, this.dataset.colId)"
         ondragover="handleSidebarColDragOver(event, this.dataset.colId)"
         ondragleave="handleSidebarColDragLeave(event, this.dataset.colId)"
         ondrop="handleSidebarColDrop(event, this.dataset.colId)"
         ondragend="handleSidebarColDragEnd(event)"
         onclick="if (window._sidebarInternalDragOccurred) return; selectCollection(this.dataset.colId);" 
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCollection(this.dataset.colId);}"
         oncontextmenu="event.preventDefault(); openPillMenu(event, this.dataset.colId);">
      <div class="sidebar-nav-item-left">
        ${hasChildren ? `
          <svg class="sidebar-col-chevron ${collapsed ? 'collapsed' : ''}" 
               data-col-id="${escapeHtml(col.id)}"
               onclick="event.stopPropagation(); toggleColCollapsed(this.dataset.colId);" 
               viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        ` : `<span style="width: 12px; display: inline-block;"></span>`}
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <span title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</span>
      </div>
      <span class="sidebar-nav-badge" id="sideBadge_${escapeHtml(col.id)}">${formatSidebarBadgeCount(cCount)}</span>
    </div>
  `;

  if (hasChildren && !collapsed) {
    children.forEach(child => {
      nodeHtml += renderCollectionTreeNode(child, depth + 1, curCol, visited);
    });
  }

  return nodeHtml;
}

function updateSidebarCounts() {
  if (getSidebarLayoutSetting() !== 'sidebar') return;
  const container = document.getElementById('sidebarNav');
  if (!container || typeof getCollectionClipCount !== 'function') return;

  const allEl = document.getElementById('sideBadge_all');
  if (allEl) allEl.textContent = formatSidebarBadgeCount(getCollectionClipCount('all'));

  const favEl = document.getElementById('sideBadge_pins');
  if (favEl) favEl.textContent = formatSidebarBadgeCount(getCollectionClipCount('pins'));

  const muEl = document.getElementById('sideBadge_most_used');
  if (muEl) muEl.textContent = formatSidebarBadgeCount(getCollectionClipCount('most_used'));

  if (typeof customCollections !== 'undefined' && Array.isArray(customCollections)) {
    customCollections.forEach(c => {
      if (!c || !c.id || SYSTEM_RESERVED_IDS.has(String(c.id).toLowerCase())) return;
      const el = document.getElementById(`sideBadge_${c.id}`);
      if (el) el.textContent = formatSidebarBadgeCount(getCollectionRollupCount(c.id));
    });
  }
}

function renderSidebarNav() {
  const container = document.getElementById('sidebarNav');
  if (!container) return;
  // S4: never rebuild the tree mid collection-drag — replacing innerHTML
  // detaches the dragged node, dragend never fires, and the click guard
  // latches on for the life of the window. dragend repaints instead.
  if (_draggedColId) return;

  const curCol = typeof currentCollection !== 'undefined' ? currentCollection : 'all';
  const curType = (typeof activeFilterType !== 'undefined' && activeFilterType) ? activeFilterType : ((typeof filterType !== 'undefined' && filterType) ? filterType : 'all');

  const allCount = typeof getCollectionClipCount === 'function' ? getCollectionClipCount('all') : 0;
  const favCount = typeof getCollectionClipCount === 'function' ? getCollectionClipCount('pins') : 0;
  const mostUsedCount = typeof getCollectionClipCount === 'function' ? getCollectionClipCount('most_used') : 0;

  const viewsCollapsed = isSidebarSectionCollapsed('views');
  const colsCollapsed = isSidebarSectionCollapsed('collections');
  const typesCollapsed = isSidebarSectionCollapsed('types');
  const tagsCollapsed = isSidebarSectionCollapsed('tags');

  let html = `
    <div class="sidebar-section-title collapsible ${viewsCollapsed ? 'collapsed' : ''}" id="sidebarSectionTitle_views" role="button" tabindex="0" aria-expanded="${viewsCollapsed ? 'false' : 'true'}" onclick="toggleSidebarSection('views')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSidebarSection('views');}">
      <div class="sidebar-section-title-left">
        <svg class="sidebar-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
        <span>Views</span>
      </div>
    </div>

    <div id="sidebarSectionBody_views" class="sidebar-section-body ${viewsCollapsed ? 'collapsed' : ''}">
      <div class="sidebar-nav-item ${curCol === 'all' ? 'active' : ''}" role="button" tabindex="0" onclick="selectCollection('all'); if (typeof setFilterType === 'function') setFilterType('all');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCollection('all');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1"></rect></svg>
          <span>All Clips</span>
        </div>
        <span class="sidebar-nav-badge" id="sideBadge_all">${formatSidebarBadgeCount(allCount)}</span>
      </div>

      <div class="sidebar-nav-item ${curCol === 'pins' ? 'active' : ''}" role="button" tabindex="0" onclick="selectCollection('pins');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCollection('pins');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          <span>Favorites</span>
        </div>
        <span class="sidebar-nav-badge" id="sideBadge_pins">${formatSidebarBadgeCount(favCount)}</span>
      </div>

      <div class="sidebar-nav-item ${curCol === 'most_used' ? 'active' : ''}" role="button" tabindex="0" onclick="selectCollection('most_used');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCollection('most_used');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
          <span>Most Used</span>
        </div>
        <span class="sidebar-nav-badge" id="sideBadge_most_used">${formatSidebarBadgeCount(mostUsedCount)}</span>
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section-title collapsible ${colsCollapsed ? 'collapsed' : ''}" 
         id="sidebarSectionTitle_collections" 
         role="button" tabindex="0" aria-expanded="${colsCollapsed ? 'false' : 'true'}"
         onclick="toggleSidebarSection('collections')"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSidebarSection('collections');}"
         ondragover="handleSidebarRootDragOver(event)"
         ondragleave="handleSidebarRootDragLeave(event)"
         ondrop="handleSidebarRootDrop(event)"
         title="Drop here to move collection to top level">
      <div class="sidebar-section-title-left">
        <svg class="sidebar-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
        <span>Collections</span>
      </div>
      <span class="sidebar-section-action" onclick="event.stopPropagation(); openNewCollectionModal()" title="Create new collection">+</span>
    </div>

    <div id="sidebarSectionBody_collections" class="sidebar-section-body ${colsCollapsed ? 'collapsed' : ''}">
      <div id="sidebarDynamicCollections">
  `;

  if (typeof customCollections !== 'undefined' && Array.isArray(customCollections)) {
    // S11: dedupe by id like renderCollectionPills does — a duplicated entry
    // would emit two elements with the same side_col_ id and freeze one badge.
    const seenSidebarIds = new Set();
    const validCols = customCollections.filter(c => {
      if (!c || !c.id || SYSTEM_RESERVED_IDS.has(String(c.id).toLowerCase())) return false;
      if (seenSidebarIds.has(c.id)) return false;
      seenSidebarIds.add(c.id);
      return true;
    });
    const validIdSet = new Set(validCols.map(c => c.id));
    const rootCols = validCols.filter(c => !c.parentId || !validIdSet.has(c.parentId));

    const renderedIds = new Set();
    rootCols.forEach(c => {
      html += renderCollectionTreeNode(c, 0, curCol, renderedIds);
    });
    // F2: a parent cycle (x↔y, self-parent) leaves every member without a root,
    // so the whole component vanished with no error. Surface leftovers flat at
    // top level instead — the renderer's visited guard keeps output finite.
    validCols.forEach(c => {
      if (!renderedIds.has(c.id)) {
        html += renderCollectionTreeNode(c, 0, curCol, renderedIds);
      }
    });
    if (renderedIds.size === 0) {
      html += `<div style="padding: 4px 8px; font-size: 11px; color: var(--text-muted, #71717a); font-style: italic;">No collection yet</div>`;
    }
  }

  html += `
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section-title collapsible ${typesCollapsed ? 'collapsed' : ''}" id="sidebarSectionTitle_types" role="button" tabindex="0" aria-expanded="${typesCollapsed ? 'false' : 'true'}" onclick="toggleSidebarSection('types')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSidebarSection('types');}">
      <div class="sidebar-section-title-left">
        <svg class="sidebar-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
        <span>Filter By Type</span>
      </div>
    </div>

    <div id="sidebarSectionBody_types" class="sidebar-section-body ${typesCollapsed ? 'collapsed' : ''}">
      <div class="sidebar-nav-item ${curType === 'text' ? 'active' : ''}" role="button" tabindex="0" onclick="if (typeof setFilterType === 'function') setFilterType('text');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();if(typeof setFilterType==='function')setFilterType('text');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><line x1="21" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>
          <span>Text Clips</span>
        </div>
      </div>

      <div class="sidebar-nav-item ${curType === 'code' ? 'active' : ''}" role="button" tabindex="0" onclick="if (typeof setFilterType === 'function') setFilterType('code');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();if(typeof setFilterType==='function')setFilterType('code');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
          <span>Code Snippets</span>
        </div>
      </div>

      <div class="sidebar-nav-item ${curType === 'color' ? 'active' : ''}" role="button" tabindex="0" onclick="if (typeof setFilterType === 'function') setFilterType('color');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();if(typeof setFilterType==='function')setFilterType('color');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"></path></svg>
          <span>Color Codes</span>
        </div>
      </div>

      <div class="sidebar-nav-item ${curType === 'image' ? 'active' : ''}" role="button" tabindex="0" onclick="if (typeof setFilterType === 'function') setFilterType('image');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();if(typeof setFilterType==='function')setFilterType('image');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <span>Images</span>
        </div>
      </div>

      <div class="sidebar-nav-item ${curType === 'url' ? 'active' : ''}" role="button" tabindex="0" onclick="if (typeof setFilterType === 'function') setFilterType('url');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();if(typeof setFilterType==='function')setFilterType('url');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          <span>Web Links</span>
        </div>
      </div>

      <div class="sidebar-nav-item ${curType === 'file' ? 'active' : ''}" role="button" tabindex="0" onclick="if (typeof setFilterType === 'function') setFilterType('file');" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();if(typeof setFilterType==='function')setFilterType('file');}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
          <span>Files</span>
        </div>
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section-title collapsible ${tagsCollapsed ? 'collapsed' : ''}" id="sidebarSectionTitle_tags" role="button" tabindex="0" aria-expanded="${tagsCollapsed ? 'false' : 'true'}" onclick="toggleSidebarSection('tags')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSidebarSection('tags');}">
      <div class="sidebar-section-title-left">
        <svg class="sidebar-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
        <span>Tags</span>
      </div>
    </div>

    <div id="sidebarSectionBody_tags" class="sidebar-section-body ${tagsCollapsed ? 'collapsed' : ''}">
      <div id="sidebarDynamicTags">
        ${renderSidebarNavTagsHtml()}
      </div>
    </div>
  `;

  container.innerHTML = html;
  applySidebarCountsVisibility();

  if (typeof maybeRefreshBackendColCounts === 'function') {
    maybeRefreshBackendColCounts();
  }
  refreshSidebarTags();
}

let _cachedSidebarTags = [];
let _sidebarTagsReqId = 0;
let _sidebarTagsInFlight = false;

function refreshSidebarTags() {
  // S7: one unbounded get_all_tags_with_stats per render, no race guard.
  // Skip when a request is already in flight; a monotonic id drops stale
  // late arrivals so an early slow response cannot overwrite newer data.
  if (getSidebarLayoutSetting() !== 'sidebar') return;
  if (_sidebarTagsInFlight) return;
  try {
    const api = window.pywebview && window.pywebview.api;
    if (api && typeof api.get_all_tags_with_stats === 'function') {
      _sidebarTagsInFlight = true;
      const myId = ++_sidebarTagsReqId;
      api.get_all_tags_with_stats().then(res => {
        if (myId !== _sidebarTagsReqId) return;
        _sidebarTagsInFlight = false;
        if (res && res.ok && Array.isArray(res.stats)) {
          const list = res.stats.filter(t => (t.clipCount > 0 || t.ClipCount > 0));
          // S7: keep tags present in the current query even at zero clips,
          // so the active filter can still be toggled off from the sidebar.
          try {
            const si = document.getElementById('searchInput');
            const parsed = (si && typeof parseSearchQuery === 'function') ? parseSearchQuery(si.value || '') : null;
            const have = new Set(list.map(t => String(t.name || t.Name || '').toLowerCase()));
            (parsed && Array.isArray(parsed.opTags) ? parsed.opTags : []).forEach(t => {
              if (!have.has(String(t).toLowerCase())) {
                list.push({ name: t, clipCount: 0 });
                have.add(String(t).toLowerCase());
              }
            });
          } catch (_) {}
          _cachedSidebarTags = list;
          const tagsBody = document.getElementById('sidebarDynamicTags');
          if (tagsBody) {
            tagsBody.innerHTML = renderSidebarNavTagsHtml();
          }
        }
      }).catch(() => { if (myId === _sidebarTagsReqId) _sidebarTagsInFlight = false; });
    }
  } catch { _sidebarTagsInFlight = false; }
}

function renderSidebarNavTagsHtml() {
  if (!_cachedSidebarTags || _cachedSidebarTags.length === 0) {
    return `<div style="padding: 4px 8px; font-size: 11px; color: var(--text-muted, #71717a); font-style: italic;">No tags yet</div>`;
  }

  // S3: membership comes from the parsed tag list, not substring matching —
  // `tag:cat` must not light up inside `tag:category`.
  const searchInput = document.getElementById('searchInput');
  const rawVal = searchInput ? searchInput.value || '' : '';
  const rawSearch = rawVal.toLowerCase();
  let activeSet = null;
  try {
    if (typeof parseSearchQuery === 'function') {
      const parsed = parseSearchQuery(rawVal);
      if (parsed && Array.isArray(parsed.opTags)) {
        activeSet = new Set(parsed.opTags.map(t => String(t).toLowerCase()));
      }
    }
  } catch (_) { activeSet = null; }

  return _cachedSidebarTags.map(tag => {
    const name = tag.name || tag.Name || '';
    const count = tag.clipCount !== undefined ? tag.clipCount : (tag.ClipCount || 0);
    const lower = String(name).toLowerCase();
    const token = `tag:${lower}`;
    const tokenQuoted = `tag:"${lower}"`;
    const isAct = activeSet
      ? activeSet.has(lower)
      : (rawSearch.includes(token) || rawSearch.includes(tokenQuoted));

    // F1: tag name travels via data-attribute, never an inline JS string —
    // a tag like `it's` no longer breaks the handler or injects script.
    return `
      <div class="sidebar-nav-item ${isAct ? 'active' : ''}" role="button" tabindex="0" data-tag="${escapeHtml(name)}" onclick="toggleSidebarTag(this.dataset.tag);" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSidebarTag(this.dataset.tag);}">
        <div class="sidebar-nav-item-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
          <span title="#${escapeHtml(name)}">#${escapeHtml(name)}</span>
        </div>
        <span class="sidebar-nav-badge">${formatSidebarBadgeCount(count)}</span>
      </div>
    `;
  }).join('');
}

function applySidebarSearchValue(newVal) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = newVal;
    const searchClear = document.getElementById('searchClear');
    if (searchClear) searchClear.style.display = newVal ? 'block' : 'none';
    try { searchInput.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    try { searchInput.focus(); } catch (_) {}
  }
  if (typeof loadClipsFromBackend === 'function') {
    try {
      const parsed = (typeof parseSearchQuery === 'function') ? parseSearchQuery(newVal) : null;
      loadClipsFromBackend(parsed && typeof parsed.cleanQuery === 'string' ? parsed.cleanQuery : (newVal || ''));
    } catch (_) {}
  } else if (typeof applyFilters === 'function') {
    try { applyFilters(); } catch (_) {}
  }
  setTimeout(() => {
    const tagsBody = document.getElementById('sidebarDynamicTags');
    if (tagsBody) tagsBody.innerHTML = renderSidebarNavTagsHtml();
  }, 50);
}

function toggleSidebarTag(tagName) {
  const searchInput = document.getElementById('searchInput');
  const raw = searchInput ? searchInput.value || '' : '';
  const needle = String(tagName == null ? '' : tagName).toLowerCase();
  if (!needle) return;
  let parsed = null;
  try { parsed = (typeof parseSearchQuery === 'function') ? parseSearchQuery(raw) : null; } catch (_) { parsed = null; }
  const tags = parsed && Array.isArray(parsed.opTags) ? parsed.opTags.slice() : [];
  const isActive = tags.length > 0
    ? tags.some(t => String(t).toLowerCase() === needle)
    : raw.toLowerCase().includes(`tag:${needle.includes(' ') ? `"${needle}"` : needle}`);
  if (!isActive) {
    if (typeof filterByTag === 'function') filterByTag(tagName);
    setTimeout(() => {
      const tagsBody = document.getElementById('sidebarDynamicTags');
      if (tagsBody) tagsBody.innerHTML = renderSidebarNavTagsHtml();
    }, 50);
    return;
  }
  // S3: remove ONLY the clicked tag. clearTagFilter() strips every tag token,
  // so it runs only when the clicked tag was the last one standing.
  const rest = tags.filter(t => String(t).toLowerCase() !== needle);
  if (rest.length === 0 && tags.length > 0) {
    if (typeof clearTagFilter === 'function') clearTagFilter();
  } else if (tags.length > 0) {
    const base = parsed && typeof parsed.cleanQuery === 'string' ? parsed.cleanQuery : '';
    const tokens = rest.map(t => String(t).includes(' ') ? `tag:"${t}"` : `tag:${t}`);
    applySidebarSearchValue(((base ? base + ' ' : '') + tokens.join(' ')).trim());
  } else {
    if (typeof clearTagFilter === 'function') clearTagFilter();
  }
}
// Early boot init
document.addEventListener('DOMContentLoaded', () => {
  const savedLayout = getSidebarLayoutSetting();
  // A stale 'sidebar' preference must not re-apply under Compact, where the sidebar is hidden.
  if (savedLayout === 'sidebar' && !isSidebarBlockedByPreset()) {
    applySidebarLayout('sidebar');
  }

  const nav = document.getElementById('sidebarNav');
  
  if (nav) {}
});

window.toggleSidebarLayout = toggleSidebarLayout;
window.isSidebarBlockedByPreset = isSidebarBlockedByPreset;
window.applySidebarLayout = applySidebarLayout;
window.renderSidebarNav = renderSidebarNav;
window.updateSidebarCounts = updateSidebarCounts;
window.toggleSidebarSection = toggleSidebarSection;
window.isSidebarSectionCollapsed = isSidebarSectionCollapsed;
window.getSidebarLayoutSetting = getSidebarLayoutSetting;
window.isSidebarCountsHidden = isSidebarCountsHidden;
window.toggleSidebarCountsHidden = toggleSidebarCountsHidden;
window.applySidebarCountsVisibility = applySidebarCountsVisibility;
window.openSidebarContextMenu = openSidebarContextMenu;
window.closeSidebarContextMenu = closeSidebarContextMenu;
window.toggleColCollapsed = toggleColCollapsed;
window.isColCollapsed = isColCollapsed;
window.handleSidebarColDragStart = handleSidebarColDragStart;
window.handleSidebarColDragOver = handleSidebarColDragOver;
window.handleSidebarColDragLeave = handleSidebarColDragLeave;
window.handleSidebarColDrop = handleSidebarColDrop;
window.handleSidebarColDragEnd = handleSidebarColDragEnd;
window.handleSidebarRootDragOver = handleSidebarRootDragOver;
window.handleSidebarRootDragLeave = handleSidebarRootDragLeave;
window.handleSidebarRootDrop = handleSidebarRootDrop;
window.moveCollectionToParent = moveCollectionToParent;
window.refreshSidebarTags = refreshSidebarTags;
window.toggleSidebarTag = toggleSidebarTag;

window.formatSidebarBadgeCount = formatSidebarBadgeCount;
