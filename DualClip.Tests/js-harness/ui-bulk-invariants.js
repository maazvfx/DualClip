// UI-bulk invariant harness — BEHAVIOURAL tests for multi-selection ranges,
// bulk delete/merge, the fuzzy matcher, and unmapped-key safety.
//
// Executes the real ui/js/core/namespace.js, ui/js/list/filters-search.js,
// ui/js/list/render.js, ui/js/keyboard.js and ui/js/list/actions.js in a Node
// DOM shim and drivesstate transitions via the keydown router and the
// context-action entry points.
//
// Scope notes (honest boundaries, not gaps in rigour):
// - J/K vim navigation does not exist in keyboard.js (Arrows only); the suite
//   pins that unmapped letter keys leave the selection untouched.
// - Mouse shift-click/ctrl-click ranges share the anchor logic exercised here
//   through Shift+Arrow/Ctrl+A, but row.onclick itself needs a real DOM row, so
//   it is covered by selection-state equivalence, not direct dispatch.
// - Bulk move-to-collection routes through filters-collections.js (not loaded
//   here); its sidebar-drop routing is already pinned by
//   ui-interaction-invariants.js and SidebarNestedAdversarialTests.
//
// Run:  node DualClip.Tests/js-harness/ui-bulk-invariants.js
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
    focus() {}, blur() {}, select() {}, click() {}, dispatchEvent() {},
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
  querySelectorAll: () => [],
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

// ---------------------------------------------------------------------------
// Recorded side effects.
// ---------------------------------------------------------------------------
const rpcCalls = [];   // chrome.webview.postMessage payloads { method, args }
const toastCalls = []; // showToast messages

global.window = {
  addEventListener() {}, removeEventListener() {},
  innerWidth: 960, innerHeight: 720,
  pywebview: {},
  chrome: { webview: { postMessage: (msg) => { rpcCalls.push(msg); } } }
};
global.showToast = (m) => { toastCalls.push(String(m)); };

// Loaded exactly once. Top-level function/var declarations attach to the
// shared global; each file's let/const stays script-private, which matches
// how the browser loads them as separate classic scripts.
function loadUi() {
  for (const f of [
    ['core', 'namespace.js'],
    ['list', 'filters-search.js'],
    ['list', 'render.js'],
    ['keyboard.js'],
    ['list', 'actions.js']
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
  toastCalls.length = 0;
  storage.clear();
  elements.clear();
  global.window.innerWidth = 960;
  global.window.innerHeight = 720;
  global.window.pywebview = {};
  global.window._draggedClipIds = undefined;
  global.window._lastBackendQuery = undefined;
  global.selectedIndices.clear();
  global.selectedIds.clear();
  global.selectedIndex = -1;
  global.lastAnchorIndex = 0;
  global.contextTargetIndex = -1;
  global.expandedIndex = -1;
  global.currentCollection = 'all';
  global.activeFilterType = 'all';
  global.activeFilterApp = 'all';
  global.activeFilterTime = 'any';
  global.allClips = [];
  global.clips = [];
  setEl('searchInput', { value: '' });
}

function bulkClips() {
  const mk = (id, text) => ({ id, text_content: text, collection: 'all', favorite: false, pinned: false, is_image: false });
  global.allClips = [mk(101, 'first'), mk(102, 'second'), mk(103, 'third'), mk(104, 'fourth'), mk(105, 'fifth')];
  global.clips = global.allClips.slice();
}

function selSet() {
  return Array.from(global.selectedIndices).sort((a, b) => a - b);
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

// --- Part A: Shift+Arrow expands a range from the anchor --------------------
const shiftArrowExpandsRange = () => check(
  'shift_arrow_expands_range_from_anchor',
  async () => {
    reset();
    bulkClips();
    global.selectedIndices.clear();
    global.selectedIndices.add(1);
    global.selectedIndex = 1;
    global.lastAnchorIndex = 1;
    fireKey('ArrowDown', { shiftKey: true });
    fireKey('ArrowDown', { shiftKey: true });
    assertEq(JSON.stringify(selSet()), JSON.stringify([1, 2, 3]), 'range after two Shift+Down');
    assertEq(global.selectedIndex, 3, 'cursor at the range tip');
  }
);

// --- Part B: Shift+ArrowUp grows the range toward the anchor ----------------
const shiftArrowUpGrowsRange = () => check(
  'shift_arrow_up_grows_range_toward_anchor',
  async () => {
    reset();
    bulkClips();
    global.selectedIndices.clear();
    global.selectedIndices.add(3);
    global.selectedIndex = 3;
    global.lastAnchorIndex = 3;
    fireKey('ArrowUp', { shiftKey: true });
    assertEq(JSON.stringify(selSet()), JSON.stringify([2, 3]), 'range after Shift+Up');
    assertEq(global.selectedIndex, 2, 'cursor at the range tip');
  }
);

// --- Part C: Ctrl+A selects every visible clip ------------------------------
const ctrlASelectsAll = () => check(
  'ctrl_a_selects_all_visible_clips',
  async () => {
    reset();
    bulkClips();
    fireKey('a', { ctrlKey: true });
    assertEq(global.selectedIndices.size, 5, 'all five selected');
    assertEq(JSON.stringify(selSet()), JSON.stringify([0, 1, 2, 3, 4]), 'exact full set');
  }
);

// --- Part D: Escape collapses multi-selection, window stays -----------------
const escapeCollapsesMulti = () => check(
  'escape_collapses_multi_selection_without_hiding_window',
  async () => {
    reset();
    bulkClips();
    global.selectedIndices.clear();
    global.selectedIndices.add(1);
    global.selectedIndices.add(2);
    global.selectedIndices.add(3);
    global.selectedIndex = 2;
    global.lastAnchorIndex = 2;
    fireKey('Escape');
    assertEq(JSON.stringify(selSet()), JSON.stringify([2]), 'collapsed to the anchor');
    assertEq(global.selectedIndex, 2, 'cursor on the anchor');
    assert(!rpcCalls.some((c) => c.method === 'hide_window'), 'no window hide');
  }
);

// --- Part E: unmapped letter keys leave the selection alone -----------------
// J/K vim navigation is not implemented (Arrows only); pin that a bare
// letter neither moves the cursor nor hides the window.
const unmappedKeyIsInert = () => check(
  'unmapped_letter_key_leaves_selection_untouched',
  async () => {
    reset();
    bulkClips();
    global.selectedIndices.clear();
    global.selectedIndices.add(2);
    global.selectedIndex = 2;
    global.lastAnchorIndex = 2;
    fireKey('j');
    fireKey('k');
    assertEq(JSON.stringify(selSet()), JSON.stringify([2]), 'selection unchanged');
    assertEq(global.selectedIndex, 2, 'cursor unchanged');
    assert(!rpcCalls.some((c) => c.method === 'hide_window'), 'no window hide');
  }
);

// --- Part F: bulk delete removes the range and re-anchors -------------------
const bulkDeleteReanchors = () => check(
  'bulk_delete_removes_selection_and_reanchors',
  async () => {
    reset();
    bulkClips();
    global.selectedIndices.clear();
    global.selectedIndices.add(1);
    global.selectedIndices.add(2);
    global.selectedIndex = 1;
    global.contextTargetIndex = 1;
    global.contextAction('delete');
    assertEq(JSON.stringify(global.allClips.map((c) => c.id)), JSON.stringify([101, 104, 105]), 'backing store minus deleted');
    assertEq(global.clips.length, 3, 'visible list shrunk');
    assertEq(JSON.stringify(selSet()), JSON.stringify([1]), 'single anchor selection');
    assertEq(global.clips[global.selectedIndex].id, 104, 'anchor is the next surviving clip');
    assert(toastCalls.some((m) => m === 'Deleted 2 clips'), 'delete toast, got: ' + toastCalls.join('|'));
    assert(!rpcCalls.some((c) => c.method === 'hide_window'), 'no window hide');
  }
);

// --- Part G: bulk merge combines text and selects the result ----------------
const bulkMergeCombinesText = () => check(
  'bulk_merge_combines_text_and_selects_result',
  async () => {
    reset();
    global.allClips = [
      { id: 201, text_content: 'AAA', collection: 'all', is_image: false },
      { id: 202, text_content: 'BBB', collection: 'all', is_image: false }
    ];
    global.clips = global.allClips.slice();
    global.selectedIndices.clear();
    global.selectedIndices.add(0);
    global.selectedIndices.add(1);
    global.selectedIndex = 0;
    await global.mergeSelectedClips();
    assertEq(global.allClips.length, 1, 'originals replaced by one merged clip');
    assertEq(global.allClips[0].text_content, 'AAA\n\nBBB', 'merged body');
    assertEq(global.selectedIndices.size, 1, 'single selection on the merged clip');
    assertEq(global.clips[global.selectedIndex].text_content, 'AAA\n\nBBB', 'cursor on the merged clip');
  }
);

// --- Part H: merge skips images with an explicit notice ----------------------
const bulkMergeSkipsImages = () => check(
  'bulk_merge_skips_images_with_notice',
  async () => {
    reset();
    global.allClips = [
      { id: 301, text_content: 'AAA', collection: 'all', is_image: false },
      { id: 302, text_content: 'BBB', collection: 'all', is_image: false },
      { id: 303, text_content: '', collection: 'all', is_image: true }
    ];
    global.clips = global.allClips.slice();
    global.selectedIndices.clear();
    global.selectedIndices.add(0);
    global.selectedIndices.add(1);
    global.selectedIndices.add(2);
    await global.mergeSelectedClips();
    const merged = global.allClips.find((c) => c.text_content === 'AAA\n\nBBB');
    assert(merged, 'merged text clip exists');
    assert(global.allClips.some((c) => c.id === 303), 'image clip survives the merge');
    assert(toastCalls.some((m) => m.indexOf('skipped') >= 0), 'skip notice, got: ' + toastCalls.join('|'));
  }
);

// --- Part I: fuzzy matcher tolerates one typo, rejects the rest -------------
const fuzzyMatcherGrades = () => check(
  'fuzzy_matcher_grades_typo_vs_miss',
  async () => {
    reset();
    const f = global.isFuzzyMatch;
    assertEq(f('hello world', 'helo'), true, 'one typo in a long word');
    assertEq(f('hello world', 'hello'), true, 'exact substring');
    assertEq(f('hello', 'xyz'), false, 'unrelated pattern');
    assertEq(f('hello', 'hz'), false, 'short non-substring rejected');
    assertEq(f('quick brown fox', 'quik brown'), true, 'multi-word with one typo');
    assertEq(f('', 'abc'), false, 'empty haystack');
    assertEq(f('abc', ''), false, 'empty pattern');
  }
);

(async () => {
  await shiftArrowExpandsRange();
  await shiftArrowUpGrowsRange();
  await ctrlASelectsAll();
  await escapeCollapsesMulti();
  await unmappedKeyIsInert();
  await bulkDeleteReanchors();
  await bulkMergeCombinesText();
  await bulkMergeSkipsImages();
  await fuzzyMatcherGrades();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})();
