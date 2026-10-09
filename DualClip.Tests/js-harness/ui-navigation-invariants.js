// UI-navigation invariant harness — BEHAVIOURAL tests for search filtering,
// keyboard routing, and modal dialog lifetimes.
//
// Executes the real ui/js/core/namespace.js, ui/js/list/filters-search.js,
// ui/js/list/render.js, ui/js/list/sidebar-layout.js, ui/js/keyboard.js,
// ui/js/overlays/modals.js, ui/js/overlays/preview-lightbox.js and
// ui/js/overlays/context-menus.js in a Node DOM shim and drives their public
// entry points (applyFilters, the keydown router, modal open/close fns).
//
// Why this exists: these files are JavaScript and `dotnet build` never parses
// them, so a broken query operator, a swallowed Escape, or a lost modal-pin
// RPC ships as "0 errors, 0 warnings" while search, navigation or auto-hide
// silently misbehaves at runtime. These tests execute the code, so that class
// of defect fails loudly. This harness documents behaviour only — it fixes
// nothing.
//
// Modal-pin note: the app has no `_modalOpen` JS flag; the documented pin
// mechanism is the `set_modal_open` host RPC (preview-lightbox `notifyModalPin`
// + the modals.js overlay observer), which the C# side turns into its
// `_modalOpen` blur guard. The tests below assert those RPCs fire.
//
// Run:  node DualClip.Tests/js-harness/ui-navigation-invariants.js
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
const keydownListeners = [];
let modalOverlays = [];

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
    focus() {}, blur() {}, select() {}, click() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {},
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

global.document = {
  getElementById: (id) => (elements.has(id) ? elements.get(id) : null),
  querySelector: () => null,
  querySelectorAll: (sel) => (sel === '.modal-overlay' ? modalOverlays : []),
  createElement: (t) => mkEl(t),
  createTextNode: (t) => ({ textContent: String(t) }),
  createDocumentFragment: () => ({ appendChild() {} }),
  documentElement: mkEl('HTML'),
  body: mkEl('BODY'),
  activeElement: null,
  contains: () => false,
  addEventListener(type, fn) { if (type === 'keydown') keydownListeners.push(fn); },
  removeEventListener() {},
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
global.MutationObserver = class { constructor() {} observe() {} disconnect() {} };

// ---------------------------------------------------------------------------
// Recorded side effects.
// ---------------------------------------------------------------------------
const rpcCalls = [];  // chrome.webview.postMessage payloads { method, args }
const pinCalls = [];  // set_modal_open values via pywebview api
const hostCalls = []; // callHost doubles [{ method, args }]
const focusCalls = []; // "id:kind" focus()/select() observations

function focusableEl(id) {
  const el = mkEl('INPUT');
  el.id = id;
  el.focus = () => { focusCalls.push(id + ':focus'); };
  el.blur = () => { focusCalls.push(id + ':blur'); };
  el.select = () => { focusCalls.push(id + ':select'); };
  return el;
}

global.window = {
  addEventListener() {}, removeEventListener() {},
  innerWidth: 960, innerHeight: 720,
  pywebview: {},
  chrome: { webview: { postMessage: (msg) => { rpcCalls.push(msg); } } }
};
global.callHost = (method, args) => { hostCalls.push({ method, args }); };

// Loaded exactly once. Top-level function/var declarations attach to the
// shared global; each file's let/const stays script-private, which matches
// how the browser loads them as separate classic scripts.
function loadUi() {
  for (const f of [
    ['core', 'namespace.js'],
    ['list', 'filters-search.js'],
    ['list', 'render.js'],
    ['list', 'sidebar-layout.js'],
    ['keyboard.js'],
    ['overlays', 'modals.js'],
    ['overlays', 'preview-lightbox.js'],
    ['overlays', 'context-menus.js']
  ]) {
    const parts = f.length === 2 ? ['ui', 'js', f[0], f[1]] : ['ui', 'js', f[0]];
    vm.runInThisContext(
      fs.readFileSync(path.join(REPO, ...parts), 'utf8'),
      { filename: f[f.length - 1] });
  }
}
loadUi();

function fireKey(key, extra) {
  const e = Object.assign({
    key, code: key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    repeat: false, isComposing: false, keyCode: 0, target: null,
    preventDefault() {}, stopPropagation() {}
  }, extra || {});
  for (const fn of keydownListeners) fn(e);
  return e;
}

function reset() {
  rpcCalls.length = 0;
  pinCalls.length = 0;
  hostCalls.length = 0;
  focusCalls.length = 0;
  storage.clear();
  elements.clear();
  modalOverlays = [];
  global.window.innerWidth = 960;
  global.window.innerHeight = 720;
  global.window.pywebview = {};
  global.window._draggedClipIds = undefined;
  global.window._lastBackendQuery = undefined;
  global.window.__dcModalOpenNotified = undefined;
  global.window.__previewAnchorPending = false;
  global.window.__previewAnchor = null;
  global.selectedIndices.clear();
  global.selectedIds.clear();
  global.selectedIndex = -1;
  global.lastAnchorIndex = 0;
  global.contextTargetIndex = -1;
  global.currentCollection = 'all';
  global.activeFilterType = 'all';
  global.activeFilterApp = 'all';
  global.activeFilterTime = 'any';
  global.allClips = [];
  global.clips = [];
  global.collapsedGroups = { today: false, yesterday: false, older: false };
  setEl('searchInput', { value: '' });
}

function searchAllClips() {
  global.allClips = [
    { id: 1, text_content: 'alpha deployment notes', collection: 'work', tags: ['work', 'docs'], is_image: false, src_process: 'notepad', pinned: false, favorite: false, nickname: '', time_group: 'today' },
    { id: 2, text_content: 'beta screenshot', collection: 'work', tags: [], is_image: true, src_process: 'browser', pinned: false, favorite: false, nickname: '', time_group: 'today' },
    { id: 3, text_content: 'alpha retrospective', collection: 'personal', tags: ['personal'], is_image: false, src_process: 'editor', pinned: false, favorite: false, nickname: '', time_group: 'yesterday' },
    { id: 4, text_content: 'https://example.com/alpha-docs', collection: 'web', tags: [], is_image: false, src_process: 'browser', pinned: false, favorite: false, nickname: '', time_group: 'older' },
    { id: 5, text_content: 'gamma planning', collection: 'work', tags: ['work'], is_image: false, src_process: 'notepad', pinned: false, favorite: true, nickname: '', time_group: 'older' }
  ];
}

function setQuery(q) {
  elements.get('searchInput').value = q;
  global.applyFilters();
  return global.clips.map((c) => c.id).sort((a, b) => a - b);
}

function navClips() {
  global.clips = [
    { id: 11, text_content: 'one', collection: 'all' },
    { id: 12, text_content: 'two', collection: 'all' },
    { id: 13, text_content: 'three', collection: 'all' }
  ];
  global.selectedIndices.clear();
  global.selectedIndices.add(0);
  global.selectedIndex = 0;
  global.lastAnchorIndex = 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
function assertIds(actual, expected, what) {
  assertEq(JSON.stringify(actual), JSON.stringify(expected.slice().sort((a, b) => a - b)), what);
}

// --- Part A: incremental queries narrow to exact subsets -------------------
const incrementalSearchNarrows = () => check(
  'incremental_query_returns_exact_match_subsets',
  async () => {
    reset();
    searchAllClips();
    assertIds(setQuery('alpha'), [1, 3, 4], 'query "alpha"');
    assertIds(setQuery('alpha retro'), [3], 'narrowed query "alpha retro"');
    assertIds(setQuery('gamma'), [5], 'query "gamma"');
    assertIds(setQuery('zzz-no-match'), [], 'query with no hits');
  }
);

// --- Part B: tag:/type: prefixes scope without throwing --------------------
const prefixFiltersScope = () => check(
  'tag_and_type_prefixes_scope_results',
  async () => {
    reset();
    searchAllClips();
    assertIds(setQuery('tag:work'), [1, 5], 'tag:work');
    assertIds(setQuery('tag:personal'), [3], 'tag:personal');
    assertIds(setQuery('type:image'), [2], 'type:image');
    assertIds(setQuery('type:text'), [1, 3, 4, 5], 'type:text');
    assertIds(setQuery('alpha tag:work'), [1], 'text + tag: combined');
  }
);

// --- Part C: empty search restores the full list in collection scope --------
const emptySearchRestoresScope = () => check(
  'empty_search_restores_full_list_with_collection_scope',
  async () => {
    reset();
    searchAllClips();
    global.currentCollection = 'work';
    assertIds(setQuery('alpha'), [1], 'scoped query "alpha" in work');
    assertIds(setQuery(''), [1, 2, 5], 'cleared query restores work scope');
    assertEq(global.currentCollection, 'work', 'collection scope intact after clear');
    global.currentCollection = 'all';
    assertIds(setQuery(''), [1, 2, 3, 4, 5], 'cleared query in all restores everything');
  }
);

// --- Part D: ArrowDown increments and single-selects ------------------------
const arrowDownNavigates = () => check(
  'arrow_down_increments_and_single_selects',
  async () => {
    reset();
    navClips();
    fireKey('ArrowDown');
    assertEq(global.selectedIndex, 1, 'index after ArrowDown');
    assertEq(global.selectedIndices.size, 1, 'single selection');
    assert(global.selectedIndices.has(1), 'selected set follows index');
    fireKey('ArrowDown');
    assertEq(global.selectedIndex, 2, 'index after second ArrowDown');
    fireKey('ArrowDown');
    assertEq(global.selectedIndex, 2, 'clamped at the last clip');
  }
);

// --- Part E: ArrowUp decrements and clamps ----------------------------------
const arrowUpNavigates = () => check(
  'arrow_up_decrements_and_clamps_at_first_clip',
  async () => {
    reset();
    navClips();
    global.selectedIndex = 2;
    global.selectedIndices.clear();
    global.selectedIndices.add(2);
    fireKey('ArrowUp');
    assertEq(global.selectedIndex, 1, 'index after ArrowUp');
    fireKey('ArrowUp');
    fireKey('ArrowUp');
    assertEq(global.selectedIndex, 0, 'clamped at the first clip');
    assertEq(global.selectedIndices.size, 1, 'still a single selection');
  }
);

// --- Part F: navigation is header-immune under collapsed groups -------------
// Selection addresses clips by index, so collapsing a group must never trap
// or invalidate the cursor: a full traversal visits every clip exactly once.
const collapsedGroupsDontTrapCursor = () => check(
  'arrow_navigation_ignores_collapsed_headers',
  async () => {
    reset();
    navClips();
    global.toggleGroupCollapse('today');
    assertEq(global.collapsedGroups.today, true, 'group collapsed');
    const visited = [global.selectedIndex];
    fireKey('ArrowDown');
    visited.push(global.selectedIndex);
    fireKey('ArrowDown');
    visited.push(global.selectedIndex);
    assertEq(JSON.stringify(visited), JSON.stringify([0, 1, 2]), 'full traversal order');
    for (const i of visited) {
      assert(Number.isInteger(i) && i >= 0 && i < global.clips.length, 'cursor ' + i + ' addresses a real clip');
    }
    assertEq(global.selectedIndices.size, 1, 'single selection throughout');
  }
);

// --- Part G: Escape closes the context menu, window stays -------------------
const escapeClosesContextMenu = () => check(
  'escape_closes_context_menu_without_hiding_window',
  async () => {
    reset();
    navClips();
    const menu = mkEl('DIV');
    menu.id = 'contextMenu';
    menu.style.display = 'block';
    elements.set('contextMenu', menu);
    global.selectedIndices.clear();
    global.selectedIndices.add(0);
    global.selectedIndex = 0;
    fireKey('Escape');
    assertEq(menu.style.display, 'none', 'context menu closed');
    assert(!rpcCalls.some((c) => c.method === 'hide_window'), 'no window hide');
  }
);

// --- Part H: Escape closes a modal dialog, window stays ---------------------
const escapeClosesRenameModal = () => check(
  'escape_closes_modal_without_hiding_window',
  async () => {
    reset();
    navClips();
    const modal = mkEl('DIV');
    modal.id = 'renameModal';
    modal.style.display = 'flex';
    elements.set('renameModal', modal);
    const ctx = mkEl('DIV');
    ctx.id = 'contextMenu';
    ctx.style.display = 'none';
    elements.set('contextMenu', ctx);
    global.selectedIndices.clear();
    global.selectedIndices.add(0);
    global.selectedIndex = 0;
    fireKey('Escape');
    assertEq(modal.style.display, 'none', 'rename modal closed');
    assert(!rpcCalls.some((c) => c.method === 'hide_window'), 'no window hide');
  }
);

// --- Part I: Escape with nothing open hides the window ----------------------
const escapeHidesIdleWindow = () => check(
  'escape_with_nothing_open_hides_window',
  async () => {
    reset();
    navClips();
    global.selectedIndices.clear();
    global.selectedIndices.add(1);
    global.selectedIndex = 1;
    fireKey('Escape');
    assert(rpcCalls.some((c) => c.method === 'hide_window'), 'hide_window issued');
  }
);

// --- Part J: preview pin notifies the host both ways ------------------------
// This is the JS half of the `_modalOpen` blur guard: open pins, close
// unpins, via the pywebview bridge with a callHost fallback.
const previewPinNotifiesHost = () => check(
  'modal_pin_notifies_host_open_and_close',
  async () => {
    reset();
    global.window.pywebview = { api: { set_modal_open: (open) => { pinCalls.push(open); } } };
    global.notifyModalPin(true);
    global.notifyModalPin(false);
    assertEq(JSON.stringify(pinCalls), JSON.stringify([true, false]), 'pin open then unpin via api');
    global.window.pywebview = {};
    global.notifyModalPin(true);
    const call = hostCalls.find((c) => c.method === 'set_modal_open');
    assert(call, 'callHost fallback used without the api');
    assertEq(JSON.stringify(call.args), JSON.stringify([true]), 'fallback args');
  }
);

// --- Part K: rename modal opens, focuses, and closes cleanly ----------------
const renameModalLifecycle = () => check(
  'rename_modal_opens_focuses_and_closes_cleanly',
  async () => {
    reset();
    const modal = mkEl('DIV');
    modal.id = 'renameModal';
    modal.style.display = 'none';
    elements.set('renameModal', modal);
    const input = focusableEl('renameTitleInput');
    input.value = '';
    elements.set('renameTitleInput', input);
    global.openRenameModal({ id: 11, custom_title: 'Old title' });
    assertEq(modal.style.display, 'flex', 'modal shown');
    assertEq(input.value, 'Old title', 'input prefilled');
    await sleep(70);
    assert(focusCalls.indexOf('renameTitleInput:focus') >= 0, 'input focused on open');
    assert(focusCalls.indexOf('renameTitleInput:select') >= 0, 'input selected on open');
    global.closeRenameModal();
    assertEq(modal.style.display, 'none', 'modal hidden on close');
    focusCalls.length = 0;
    global.openRenameModal({ id: 12, custom_title: '' });
    assertEq(modal.style.display, 'flex', 'modal reopens after close');
    assertEq(input.value, '', 'transient input state reset for the next clip');
  }
);

// --- Part L: preview close restores list focus and clears state -------------
const previewCloseRestoresFocus = () => check(
  'preview_close_restores_list_focus_and_clears_state',
  async () => {
    reset();
    global.window.pywebview = { api: { set_modal_open: (open) => { pinCalls.push(open); } } };
    const container = focusableEl('listContainer');
    container.scrollTop = 0;
    elements.set('listContainer', container);
    global.closePreviewModal(null);
    assert(focusCalls.indexOf('listContainer:focus') >= 0, 'list regains focus on close');
    assertEq(JSON.stringify(pinCalls), JSON.stringify([false]), 'host unpinned on close');
    assertEq(global.window.__previewAnchorPending, false, 'no stale anchor pending flag');
  }
);

(async () => {
  await incrementalSearchNarrows();
  await prefixFiltersScope();
  await emptySearchRestoresScope();
  await arrowDownNavigates();
  await arrowUpNavigates();
  await collapsedGroupsDontTrapCursor();
  await escapeClosesContextMenu();
  await escapeClosesRenameModal();
  await escapeHidesIdleWindow();
  await previewPinNotifiesHost();
  await renameModalLifecycle();
  await previewCloseRestoresFocus();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})();
