// UI-interaction invariant harness — BEHAVIOURAL tests for drag-and-drop,
// context-menu/selection, and sidebar collapse flows.
//
// Executes the real ui/js/core/namespace.js, ui/js/list/sidebar-layout.js,
// ui/js/list/render.js and ui/js/overlays/context-menus.js in a Node DOM shim
// and drives their public handlers with synthetic events.
//
// Why this exists: these files are JavaScript and `dotnet build` never parses
// them, so a priority-ordering slip in a drop handler or a clamping regression
// in menu positioning ships as "0 errors, 0 warnings" while the UI silently
// misbehaves at runtime. These tests execute the code, so that class of
// defect fails loudly. This harness documents behaviour only — it fixes
// nothing.
//
// Run:  node DualClip.Tests/js-harness/ui-interaction-invariants.js
// Exit: 0 = all invariants hold, 1 = at least one regressed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// DOM shim. Only what the loaded modules touch.
// ---------------------------------------------------------------------------
const storage = new Map();
const elements = new Map();

function mkCls() {
  const s = new Set();
  return {
    add: (c) => { s.add(c); },
    remove: (c) => { s.delete(c); },
    toggle: (c, f) => {
      if (f === undefined) { if (s.has(c)) s.delete(c); else s.add(c); }
      else if (f) s.add(c); else s.delete(c);
    },
    contains: (c) => s.has(c)
  };
}

function mkEl(tag) {
  return {
    tagName: (tag || 'DIV').toUpperCase(),
    id: '',
    className: '',
    getAttribute: () => null,
    setAttribute() {}, removeAttribute() {}, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {},
    classList: mkCls(),
    style: {}, dataset: {},
    value: '', textContent: '', innerHTML: '', innerText: '',
    children: [], childNodes: [],
    offsetHeight: 0, offsetWidth: 0, clientHeight: 0, clientWidth: 0,
    scrollTop: 0, scrollHeight: 0,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    contains: () => false, parentElement: null, offsetParent: {}
  };
}

function setEl(id, extra) {
  const el = mkEl();
  el.id = id;
  Object.assign(el, extra || {});
  elements.set(id, el);
  return el;
}

// Clip rows for document.querySelectorAll('.clip-row').
let clipRows = [];
function makeClipRow(idx) {
  const attrs = {};
  const el = mkEl('DIV');
  el.idx = idx;
  el.attrs = attrs;
  el.getAttribute = (n) => ((n === 'data-idx' || n === 'data-index') ? String(el.idx) : null);
  el.setAttribute = (k, v) => { attrs[k] = String(v); };
  return el;
}

// Context-menu element stubs. querySelector caches one stub per selector so
// tests can read back the disabled/label state the code applied.
function menuItemStub() {
  const span = { innerText: '' };
  return {
    classList: mkCls(),
    style: {},
    attrs: {},
    span,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    querySelector: () => span
  };
}

function makeMenuStub(width, height) {
  const items = new Map();
  const menu = mkEl('DIV');
  menu.id = 'contextMenu';
  menu.offsetWidth = width;
  menu.offsetHeight = height;
  menu.querySelector = (sel) => {
    if (!items.has(sel)) items.set(sel, menuItemStub());
    return items.get(sel);
  };
  menu.querySelectorAll = () => [];
  menu.items = items;
  return menu;
}

function labelStub() {
  return {
    innerText: '',
    style: { display: '' },
    attrs: {},
    classList: mkCls(),
    setAttribute(k, v) { this.attrs[k] = String(v); }
  };
}

global.document = {
  getElementById: (id) => (elements.has(id) ? elements.get(id) : null),
  querySelector: () => null,
  querySelectorAll: (sel) => (sel === '.clip-row' ? clipRows : []),
  createElement: (t) => mkEl(t),
  createTextNode: (t) => ({ textContent: String(t) }),
  createDocumentFragment: () => ({ appendChild() {} }),
  documentElement: mkEl('HTML'),
  body: mkEl('BODY'),
  addEventListener() {}, removeEventListener() {},
  readyState: 'complete'
};
global.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); }
};
global.getComputedStyle = () => ({ display: 'none' });
global.CSS = { escape: (s) => String(s) };
global.requestAnimationFrame = () => 0;
global.navigator = { userAgent: 'node' };

// ---------------------------------------------------------------------------
// Recorded side effects.
// ---------------------------------------------------------------------------
const rpcCalls = [];   // chrome.webview.postMessage payloads { method, args }
const pillCalls = [];  // handleCollectionPillDrop doubles { targetColId, colName, ids }
const toastCalls = []; // showToast messages
let renderNavCalls = 0;

global.window = {
  addEventListener() {}, removeEventListener() {},
  innerWidth: 960, innerHeight: 720,
  pywebview: {},
  showToast: undefined,
  chrome: { webview: { postMessage: (msg) => { rpcCalls.push(msg); } } }
};
global.showToast = (m) => { toastCalls.push(String(m)); };

// Test double for filters-collections.js (not loaded: 1500+ lines of filter
// state). The sidebar calls it positionally; the double records the routing.
global.handleCollectionPillDrop = (targetColId, colName, e, ids) => {
  pillCalls.push({ targetColId, colName, ids: Array.isArray(ids) ? ids.slice() : ids });
};

// Loaded exactly once. Top-level function/var declarations attach to the
// shared global; each file's let/const stays script-private, which matches
// how the browser loads them as separate classic scripts.
function loadUi() {
  for (const f of [
    ['core', 'namespace.js'],
    ['list', 'sidebar-layout.js'],
    ['list', 'render.js'],
    ['overlays', 'context-menus.js']
  ]) {
    vm.runInThisContext(
      fs.readFileSync(path.join(REPO, 'ui', 'js', f[0], f[1]), 'utf8'),
      { filename: f[1] });
  }
}
loadUi();

// renderSidebarNav is real (sidebar-layout.js) and needs a full sidebar DOM;
// tests that toggle collapse count calls instead of rendering.
const realRenderSidebarNav = global.renderSidebarNav;
global.renderSidebarNav = () => { renderNavCalls++; };

function reset() {
  rpcCalls.length = 0;
  pillCalls.length = 0;
  toastCalls.length = 0;
  renderNavCalls = 0;
  storage.clear();
  elements.clear();
  clipRows = [];
  global.window.innerWidth = 960;
  global.window.innerHeight = 720;
  global.window._draggedClipIds = undefined;
  global.window._sidebarInternalDragOccurred = false;
  global.window.callHostChecked = undefined;
  global.selectedIndices.clear();
  global.selectedIndex = -1;
  global.lastAnchorIndex = 0;
  global.contextTargetIndex = -1;
  global.clips = [];
  global.customCollections = [];
  global.collapsedGroups = { today: false, yesterday: false, older: false };
}

function testClips() {
  global.clips = [
    { id: 11, text_content: 'alpha', type_name: 'Text', collection: 'all', favorite: false, pinned: false },
    { id: 12, text_content: 'beta', type_name: 'Text', collection: 'all', favorite: true, pinned: false },
    { id: 13, text_content: 'https://example.com/x', type_name: 'Web Link', collection: 'web', favorite: false, pinned: false }
  ];
}

function testCollections() {
  global.customCollections = [
    { id: 'parent_col', name: 'Parent', parentId: null },
    { id: 'child_col', name: 'Child', parentId: 'parent_col' },
    { id: 'sibling_col', name: 'Sibling', parentId: null }
  ];
}

function textDropEvent(text) {
  return {
    preventDefault() {}, stopPropagation() {},
    dataTransfer: {
      types: ['text/plain'],
      getData: (fmt) => (fmt === 'text/plain' ? text : '')
    }
  };
}

function installMenu(width, height) {
  const menu = makeMenuStub(width, height);
  elements.set('contextMenu', menu);
  for (const id of ['ctxTransformMenu', 'ctxCopyPlain', 'ctxOpenUrl', 'ctxCleanUrl',
    'ctxCopyLabel', 'ctxPasteLabel', 'ctxPreviewLabel', 'ctxFavoriteLabel',
    'ctxPinLabel', 'ctxNicknameLabel', 'ctxRenameLabel']) {
    elements.set(id, labelStub());
  }
  const merge = menuItemStub();
  merge.style.display = 'none';
  elements.set('ctxMergeClips', merge);
  elements.set('ctxRenameItem', menuItemStub());
  elements.set('ctxPasteDelete', menuItemStub());
  clipRows = [makeClipRow(0), makeClipRow(1), makeClipRow(2)];
  return menu;
}

function menuEvt(x, y) {
  return { preventDefault() {}, clientX: x, clientY: y };
}

// ---------------------------------------------------------------------------
const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push({ name, ok: true }); console.log('PASS ' + name); })
    .catch((e) => {
      results.push({ name, ok: false, msg: e.message });
      console.log('FAIL ' + name + ': ' + e.message);
    });
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(actual, expected, what) {
  assert(actual === expected, what + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// --- Part A: text drop onto a nested child never reparents -----------------
const textDropPreservesNesting = () => check(
  'text_drop_onto_nested_child_preserves_parent_id',
  async () => {
    reset();
    testCollections();
    global.handleSidebarColDrop(textDropEvent('Sample dropped text'), 'child_col');
    assertEq(global.customCollections.find((c) => c.id === 'child_col').parentId, 'parent_col', 'child parentId');
    assertEq(global.customCollections.find((c) => c.id === 'sibling_col').parentId, null, 'sibling parentId');
    assertEq(global.customCollections.find((c) => c.id === 'parent_col').parentId, null, 'parent parentId');
    const rpc = rpcCalls.find((c) => c.method === 'add_text_to_collection');
    assert(rpc, 'expected an add_text_to_collection RPC');
    assertEq(rpc.args[0], 'Sample dropped text', 'dropped text');
    assertEq(rpc.args[1], 'child_col', 'target collection');
  }
);

// --- Part B: stale folder-drag flag must not hijack a later text drop ------
// A folder drag whose dragend never fired latches _draggedColId; the next
// external text drop must still add text, not move the stale folder.
const staleDragFlagTextDrop = () => check(
  'stale_folder_drag_flag_does_not_hijack_text_drop',
  async () => {
    reset();
    testCollections();
    const latch = { preventDefault() {}, dataTransfer: { setData() {}, getData: () => '' } };
    global.handleSidebarColDragStart(latch, 'sibling_col');
    global.handleSidebarColDrop(textDropEvent('Latched-drag text drop'), 'child_col');
    assertEq(global.customCollections.find((c) => c.id === 'sibling_col').parentId, null, 'stale folder stays put');
    assertEq(global.customCollections.find((c) => c.id === 'child_col').parentId, 'parent_col', 'child stays nested');
    const rpc = rpcCalls.find((c) => c.method === 'add_text_to_collection');
    assert(rpc, 'expected the text to be added despite the stale flag');
    assertEq(rpc.args[0], 'Latched-drag text drop', 'dropped text');
    assert(!toastCalls.some((m) => m.indexOf('Moved') === 0), 'no folder-move toast, got: ' + toastCalls.join('|'));
  }
);

// --- Part C: clip batch drop routes to pills without reparenting -----------
const clipDropRoutesToPills = () => check(
  'clip_batch_drop_routes_to_pills_without_reparenting',
  async () => {
    reset();
    testCollections();
    const e = {
      preventDefault() {}, stopPropagation() {},
      dataTransfer: {
        types: ['application/x-dualclip-ids'],
        getData: (fmt) => (fmt === 'application/x-dualclip-ids' ? JSON.stringify([101, 102, 'bad', 103]) : '')
      }
    };
    global.handleSidebarColDrop(e, 'child_col');
    assertEq(pillCalls.length, 1, 'pill drop call count');
    assertEq(pillCalls[0].targetColId, 'child_col', 'pill target');
    assertEq(JSON.stringify(pillCalls[0].ids), JSON.stringify([101, 102, 103]), 'parsed ids (bad filtered)');
    assertEq(global.customCollections.find((c) => c.id === 'child_col').parentId, 'parent_col', 'child stays nested');
  }
);

// --- Part D: valid folder-into-folder move reparents -----------------------
const validFolderMoveReparents = () => check(
  'folder_drop_with_collection_id_reparents',
  async () => {
    reset();
    testCollections();
    const start = { dataTransfer: { setData() {}, getData: () => '' } };
    global.handleSidebarColDragStart(start, 'sibling_col');
    const e = {
      preventDefault() {}, stopPropagation() {},
      dataTransfer: {
        types: ['application/x-dualclip-collection-id', 'text/plain'],
        getData: (fmt) => (fmt === 'application/x-dualclip-collection-id' ? 'sibling_col' : 'sibling_col')
      }
    };
    global.handleSidebarColDrop(e, 'child_col');
    assertEq(global.customCollections.find((c) => c.id === 'sibling_col').parentId, 'child_col', 'sibling reparented');
    assertEq(pillCalls.length, 0, 'no pill routing for a folder move');
  }
);

// --- Part E: folder-into-descendant is blocked -----------------------------
const descendantMoveBlocked = () => check(
  'folder_drop_into_own_descendant_is_blocked',
  async () => {
    reset();
    testCollections();
    const start = { dataTransfer: { setData() {}, getData: () => '' } };
    global.handleSidebarColDragStart(start, 'parent_col');
    const e = {
      preventDefault() {}, stopPropagation() {},
      dataTransfer: {
        types: ['application/x-dualclip-collection-id'],
        getData: (fmt) => (fmt === 'application/x-dualclip-collection-id' ? 'parent_col' : '')
      }
    };
    global.handleSidebarColDrop(e, 'child_col');
    assertEq(global.customCollections.find((c) => c.id === 'parent_col').parentId, null, 'parent stays at top');
    assert(toastCalls.length > 0, 'expected a cannot-nest warning toast');
    assertEq(global.customCollections.find((c) => c.id === 'child_col').parentId, 'parent_col', 'child stays nested');
  }
);

// --- Part F: text onto the sidebar root never un-nests ---------------------
const rootTextDropIsInert = () => check(
  'text_drop_on_sidebar_root_never_moves_folders',
  async () => {
    reset();
    testCollections();
    const start = { dataTransfer: { setData() {}, getData: () => '' } };
    global.handleSidebarColDragStart(start, 'sibling_col');
    global.handleSidebarRootDrop(textDropEvent('Root area text'));
    assertEq(global.customCollections.find((c) => c.id === 'sibling_col').parentId, null, 'sibling stays at top');
    assertEq(global.customCollections.find((c) => c.id === 'child_col').parentId, 'parent_col', 'child stays nested');
  }
);

// --- Part G: single-selection context menu keeps batch actions off ---------
const singleSelectionMenu = () => check(
  'single_selection_menu_enables_single_only_actions',
  async () => {
    reset();
    testClips();
    const menu = installMenu(220, 200);
    global.selectedIndices.add(0);
    global.selectedIndex = 0;
    global.openContextMenu(menuEvt(100, 100), 0);
    const item = (sel) => menu.querySelector(sel);
    assert(!item('[onclick="contextAction(\'preview\')"]').classList.contains('disabled'), 'preview enabled');
    // rename resolves via getElementById('ctxRenameItem') first, so read that element.
    assert(!elements.get('ctxRenameItem').classList.contains('disabled'), 'rename enabled');
    assert(!item('[onclick="contextAction(\'paste\')"]').classList.contains('disabled'), 'paste enabled');
    assertEq(item('[onclick="contextAction(\'preview\')"]').attrs['aria-disabled'], 'false', 'preview aria');
    assertEq(item('[onclick="contextAction(\'delete\')"]').span.innerText, 'Delete Clip', 'delete label');
    assertEq(elements.get('ctxMergeClips').style.display, 'none', 'merge hidden for single');
    assertEq(elements.get('ctxCopyLabel').innerText, 'Copy', 'copy label stays singular');
  }
);

// --- Part H: multi-selection disables single-only batch actions ------------
const multiSelectionMenu = () => check(
  'multi_selection_menu_disables_single_only_actions',
  async () => {
    reset();
    testClips();
    const menu = installMenu(220, 200);
    global.selectedIndices.add(0);
    global.selectedIndices.add(1);
    global.selectedIndices.add(2);
    global.selectedIndex = 1;
    global.openContextMenu(menuEvt(100, 100), 1);
    const item = (sel) => menu.querySelector(sel);
    assert(item('[onclick="contextAction(\'preview\')"]').classList.contains('disabled'), 'preview disabled');
    // rename resolves via getElementById('ctxRenameItem') first, so read that element.
    assert(elements.get('ctxRenameItem').classList.contains('disabled'), 'rename disabled');
    assert(item('[onclick="contextAction(\'paste\')"]').classList.contains('disabled'), 'paste disabled');
    assertEq(item('[onclick="contextAction(\'delete\')"]').span.innerText, 'Delete Clips', 'delete label plural');
    assertEq(elements.get('ctxMergeClips').style.display, 'flex', 'merge shown for multi');
    assertEq(elements.get('ctxCopyLabel').innerText, 'Copy Clips', 'copy label plural');
    assertEq(elements.get('ctxFavoriteLabel').innerText, 'Remove from Favorites', 'fav aggregate mixed follows target (1 of 3)');
  }
);

// --- Part I: right-click on an unselected row resets to that row -----------
const unselectedRowClickResets = () => check(
  'menu_on_unselected_row_resets_selection_to_that_row',
  async () => {
    reset();
    testClips();
    installMenu(220, 200);
    global.selectedIndices.add(0);
    global.selectedIndices.add(2);
    global.selectedIndex = 2;
    global.openContextMenu(menuEvt(100, 100), 1);
    assertEq(global.selectedIndices.size, 1, 'selection size after reset');
    assert(global.selectedIndices.has(1), 'selection is the clicked row');
    assertEq(global.selectedIndex, 1, 'selectedIndex follows the click');
  }
);

// --- Part J: Compact-mode menu stays inside the 360x260 viewport -----------
const compactMenuClamped = () => check(
  'compact_menu_never_exceeds_viewport',
  async () => {
    reset();
    testClips();
    global.window.innerWidth = 360;
    global.window.innerHeight = 260;
    const menu = installMenu(220, 200);
    global.selectedIndices.add(0);
    global.openContextMenu(menuEvt(350, 250), 0);
    const left = parseInt(menu.style.left, 10);
    const top = parseInt(menu.style.top, 10);
    assert(left >= 10 && left + 220 <= 360 - 10, 'horizontal clamp, left=' + left);
    assert(top >= 10 && top + 200 <= 260 - 10, 'vertical clamp, top=' + top);
    assertEq(menu.style.left, '130px', 'clamped left');
    assertEq(menu.style.top, '50px', 'clamped top');
  }
);

// --- Part K: submenu flips left near the Compact right edge ----------------
const submenuFlipsInCompact = () => check(
  'submenu_opens_left_near_compact_right_edge',
  async () => {
    reset();
    global.window.innerWidth = 360;
    global.window.innerHeight = 260;
    const sub = { offsetWidth: 190, offsetHeight: 250, style: {} };
    const itemEl = {
      classList: mkCls(),
      style: {},
      addEventListener() {},
      querySelector: (sel) => (sel.indexOf('submenu') >= 0 ? sub : null),
      getBoundingClientRect: () => ({ left: 200, right: 350, top: 100, bottom: 120 })
    };
    global.positionSubmenu(itemEl);
    assert(itemEl.classList.contains('open-left'), 'submenu flips left');
    assertEq(sub.style.top, '-92px', 'submenu vertical clamp');
    assertEq(sub.style.display, '', 'probe display restored');
  }
);

// --- Part L: group collapse flips state and persists -----------------------
const groupCollapsePersists = () => check(
  'group_collapse_flips_state_and_persists',
  async () => {
    reset();
    global.toggleGroupCollapse('today');
    assertEq(global.collapsedGroups.today, true, 'collapsed after first toggle');
    assertEq(JSON.parse(storage.get('dualclip_collapsed_groups')).today, true, 'persisted collapse');
    global.toggleGroupCollapse('today');
    assertEq(global.collapsedGroups.today, false, 'expanded after second toggle');
    assertEq(JSON.parse(storage.get('dualclip_collapsed_groups')).today, false, 'persisted expand');
  }
);

// --- Part M: group collapse preserves a valid selection --------------------
const groupCollapseKeepsSelection = () => check(
  'group_collapse_preserves_valid_selection_indices',
  async () => {
    reset();
    testClips();
    global.selectedIndices.add(0);
    global.selectedIndices.add(2);
    global.selectedIndex = 0;
    global.lastAnchorIndex = 0;
    global.toggleGroupCollapse('older');
    assertEq(global.selectedIndices.size, 2, 'selection size survives toggle');
    assert(global.selectedIndices.has(0) && global.selectedIndices.has(2), 'same indices selected');
    assertEq(global.selectedIndex, 0, 'selectedIndex survives toggle');
    for (const i of global.selectedIndices) {
      assert(i >= 0 && i < global.clips.length, 'index ' + i + ' still in bounds');
    }
  }
);

// --- Part N: group toggle executes instantly without transient animation ---
const groupToggleRevealClass = () => check(
  'group_toggle_executes_instantly_without_animation_delay',
  async () => {
    reset();
    const container = mkEl('DIV');
    container.id = 'listContainer';
    elements.set('listContainer', container);
    global.toggleGroupCollapse('today');
    assert(!container.classList.contains('group-toggling'), 'no animation class delay after toggle');
    assertEq(global.collapsedGroups.today, true, 'state flipped alongside the DOM update');
  }
);

// --- Part O: sidebar section collapse syncs storage and DOM -----------------
const sectionCollapseSyncsDom = () => check(
  'section_collapse_syncs_storage_and_dom',
  async () => {
    reset();
    const bodyEl = mkEl('DIV');
    const titleEl = mkEl('DIV');
    elements.set('sidebarSectionBody_collections', bodyEl);
    elements.set('sidebarSectionTitle_collections', titleEl);
    global.toggleSidebarSection('collections');
    assertEq(storage.get('dualclip_sidebar_collapse_collections'), '1', 'stored collapsed');
    assert(bodyEl.classList.contains('collapsed'), 'body collapsed class');
    assert(titleEl.classList.contains('collapsed'), 'title collapsed class');
    global.toggleSidebarSection('collections');
    assertEq(storage.get('dualclip_sidebar_collapse_collections'), '0', 'stored expanded');
    assert(!bodyEl.classList.contains('collapsed'), 'body class removed');
    assert(!titleEl.classList.contains('collapsed'), 'title class removed');
  }
);

// --- Part P: collection-folder collapse repaints instead of going stale -----
const folderCollapseRepaints = () => check(
  'folder_collapse_triggers_sidebar_repaint',
  async () => {
    reset();
    const before = renderNavCalls;
    global.toggleColCollapsed('child_col');
    assertEq(storage.get('dualclip_col_collapsed_child_col'), '1', 'folder collapse persisted');
    assertEq(renderNavCalls, before + 1, 'sidebar repaint requested');
  }
);

// --- Part Q: stripped-types folder drag still nests -------------------------
// Shells (WebView2) may strip the custom collection-id type from `types`,
// leaving text/plain aliasing the folder id. That is still an internal drag
// and must nest — not add the id as a junk text clip.
const strippedTypesFolderDragNests = () => check(
  'stripped_types_folder_drag_still_nests',
  async () => {
    reset();
    testCollections();
    const start = { dataTransfer: { setData() {}, getData: () => '' } };
    global.handleSidebarColDragStart(start, 'sibling_col');
    const e = {
      preventDefault() {}, stopPropagation() {},
      dataTransfer: {
        types: ['text/plain'],
        getData: (fmt) => (fmt === 'text/plain' ? 'sibling_col' : '')
      }
    };
    global.handleSidebarColDrop(e, 'child_col');
    assertEq(global.customCollections.find((c) => c.id === 'sibling_col').parentId, 'child_col', 'sibling nested');
    assertEq(pillCalls.length, 0, 'no pill routing for a folder move');
    assert(!rpcCalls.some((c) => c.method === 'add_text_to_collection'), 'no junk text clip from the folder id');
  }
);

// --- Part R: folder moves persist through set_collection_parent ------------
// The production bug: the move applied locally but never reached SQLite, so
// the next hydrate reset the folder to the top level. The checked RPC must
// fire for both nesting and un-nesting.
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const movePersistsViaBridge = () => check(
  'folder_move_persists_via_set_collection_parent',
  async () => {
    reset();
    testCollections();
    const checkedCalls = [];
    global.window.callHostChecked = (method, args) => {
      checkedCalls.push({ method, args });
      return Promise.resolve({ ok: true });
    };
    try {
      global.moveCollectionToParent('sibling_col', 'child_col');
      assertEq(global.customCollections.find((c) => c.id === 'sibling_col').parentId, 'child_col', 'optimistic nest');
      await tick();
      const persists = checkedCalls.filter((c) => c.method === 'set_collection_parent');
      assertEq(persists.length, 1, 'one persist call');
      assertEq(JSON.stringify(persists[0].args), JSON.stringify({ colId: 'sibling_col', parentId: 'child_col' }), 'persist args');
      global.moveCollectionToParent('child_col', null);
      await tick();
      const unnest = checkedCalls.filter((c) => c.method === 'set_collection_parent');
      assertEq(unnest.length, 2, 'un-nest also persists');
      assertEq(JSON.stringify(unnest[1].args), JSON.stringify({ colId: 'child_col', parentId: null }), 'un-nest args');
      assertEq(global.customCollections.find((c) => c.id === 'sibling_col').parentId, 'child_col', 'nest survives the round-trip');
    } finally {
      global.window.callHostChecked = undefined;
    }
  }
);

// --- Part S: backend rejection rolls the optimistic move back --------------
const rejectedMoveRollsBack = () => check(
  'rejected_folder_move_rolls_back_optimistic_state',
  async () => {
    reset();
    testCollections();
    global.window.callHostChecked = () => Promise.resolve({ ok: false });
    try {
      global.moveCollectionToParent('sibling_col', 'child_col');
      await tick();
      assertEq(global.customCollections.find((c) => c.id === 'sibling_col').parentId, null, 'optimistic nest undone');
      assert(toastCalls.some((m) => m.indexOf('Could not move') === 0), 'rejection toast, got: ' + toastCalls.join('|'));
    } finally {
      global.window.callHostChecked = undefined;
    }
  }
);

(async () => {
  await textDropPreservesNesting();
  await staleDragFlagTextDrop();
  await clipDropRoutesToPills();
  await validFolderMoveReparents();
  await descendantMoveBlocked();
  await rootTextDropIsInert();
  await singleSelectionMenu();
  await multiSelectionMenu();
  await unselectedRowClickResets();
  await compactMenuClamped();
  await submenuFlipsInCompact();
  await groupCollapsePersists();
  await groupCollapseKeepsSelection();
  await groupToggleRevealClass();
  await sectionCollapseSyncsDom();
  await folderCollapseRepaints();
  await strippedTypesFolderDragNests();
  await movePersistsViaBridge();
  await rejectedMoveRollsBack();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})();
