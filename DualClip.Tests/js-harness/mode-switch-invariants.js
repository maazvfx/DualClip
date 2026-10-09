// Mode-switch invariant harness — BEHAVIOURAL tests for the view-mode flow.
//
// Executes the real ui/js/settings/quick-view-menu.js in a Node DOM shim and
// drives changeQuickViewLayoutPreset() for Standard / Compact / Expanded.
//
// Why this exists: these files are JavaScript and `dotnet build` never parses
// them, so a deleted variable or bad call shipped once as a build reporting
// "0 errors, 0 warnings" while mode switching was completely dead at runtime.
// These tests execute the code, so that class of defect fails loudly.
//
// Run:  node DualClip.Tests/js-harness/mode-switch-invariants.js
// Exit: 0 = all invariants hold, 1 = at least one regressed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// DOM shim. Only what quick-view-menu.js + settings-appearance.js touch.
// ---------------------------------------------------------------------------
const htmlAttrs = {
  'data-layout-preset': 'standard',
  'data-clip-details': 'app-time',
  'data-line-display': 'auto',
  'data-zoom': '100',
  'data-text-power': 'full',
  'data-text-shade': 'standard',
  'data-selection-style': 'solid',
  'data-zebra': 'off'
};
const bodyClasses = new Set();
const storage = new Map();
const elements = new Map();

// Every getElementById that returns null is treated as "absent", which is a
// legitimate state for most optional controls. Tests that need a real element
// register one explicitly via setEl().
function setEl(id, extra) {
  const el = mkEl();
  el.id = id;
  el.value = '';
  Object.assign(el, extra || {});
  elements.set(id, el);
  return el;
}

function mkEl(tag) {
  const el = {
    tagName: (tag || 'DIV').toUpperCase(),
    id: '',
    className: '',
    getAttribute: () => null,
    setAttribute() {}, removeAttribute() {}, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
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
  return el;
}

const documentElement = mkEl('HTML');
documentElement.getAttribute = (n) => (n in htmlAttrs ? htmlAttrs[n] : null);
documentElement.setAttribute = (n, v) => { htmlAttrs[n] = String(v); };
documentElement.removeAttribute = (n) => { delete htmlAttrs[n]; };

const body = mkEl('BODY');
body.classList.contains = (c) => bodyClasses.has(c);
body.classList.add = (c) => bodyClasses.add(c);
body.classList.remove = (c) => bodyClasses.delete(c);

global.document = {
  getElementById: (id) => (elements.has(id) ? elements.get(id) : null),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (t) => mkEl(t),
  createTextNode: (t) => ({ textContent: String(t) }),
  documentElement, body,
  addEventListener() {}, removeEventListener() {},
  readyState: 'complete'
};
global.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); }
};

// ---------------------------------------------------------------------------
// Recorded side effects. Assertions read these instead of trusting that a
// function merely ran — that distinction is what the string-match tests miss.
// ---------------------------------------------------------------------------
const rpcCalls = [];      // { name, args }
const notifyCalls = [];

function stubApi() {
  const rec = (name) => (...args) => { rpcCalls.push({ name, args }); return Promise.resolve({ ok: true }); };
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;          // never look thenable
      return rec(prop);
    },
    has() { return true; }
  });
}

global.window = {
  addEventListener() {}, removeEventListener() {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  innerWidth: 960, innerHeight: 720,
  pywebview: { api: stubApi() },
  DC: { state: {} }
};
global.navigator = { userAgent: 'node' };
global.CSS = { escape: (s) => String(s) };
global.currentZoomLevel = 1.0;
global.currentThumbSize = 'sm';
global.currentLineDisplay = 'auto';

// Sibling-module helpers that quick-view-menu.js / settings-appearance.js call
// but which live elsewhere. Stubbed so absence can't mask a real call.
global.renderList = () => {};
global.renderVirtualWindow = () => {};
global.rebuildCustomSelect = () => {};
global.syncUnifiedClipDetailsSelect = () => {};
global.notifySettingSaved = (id) => { notifyCalls.push(id); };
global.updateViewModeButton = () => {};
global.getEffectiveViewMode = () => htmlAttrs['data-layout-preset'];

// Loaded exactly once. These files use top-level function declarations, so
// re-running them in the same context throws a redeclaration error; state is
// reset between checks instead.
function loadUi() {
  vm.runInThisContext(
    fs.readFileSync(path.join(REPO, 'ui', 'js', 'settings', 'settings-appearance.js'), 'utf8'),
    { filename: 'settings-appearance.js' });
  vm.runInThisContext(
    fs.readFileSync(path.join(REPO, 'ui', 'js', 'settings', 'quick-view-menu.js'), 'utf8'),
    { filename: 'quick-view-menu.js' });
}
loadUi();

function reset() {
  rpcCalls.length = 0;
  notifyCalls.length = 0;
  storage.clear();
  elements.clear();
  bodyClasses.clear();
  for (const k of Object.keys(htmlAttrs)) delete htmlAttrs[k];
  htmlAttrs['data-layout-preset'] = 'standard';
  htmlAttrs['data-clip-details'] = 'app-time';
  htmlAttrs['data-line-display'] = 'auto';
  htmlAttrs['data-zoom'] = '100';
  global.currentZoomLevel = 1.0;
  global.currentThumbSize = 'sm';
  global.currentLineDisplay = 'auto';
}

function lastRpc(name) {
  for (let i = rpcCalls.length - 1; i >= 0; i--) {
    if (rpcCalls[i].name === name) return rpcCalls[i];
  }
  return null;
}
function rpcCount(name) {
  return rpcCalls.filter((c) => c.name === name).length;
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

// --- Part A: the switch must not throw -------------------------------------
// This is the direct regression test for the deleted-`const b` defect: the
// function threw a ReferenceError on its first statement, so nothing worked.
const switchDoesNotThrow = () => check(
  'mode_switch_executes_without_runtime_error',
  async () => {

    for (const mode of ['standard', 'compact', 'standard']) {
      try {
        changeQuickViewLayoutPreset(mode, false, false);
      } catch (e) {
        throw new Error('changeQuickViewLayoutPreset("' + mode + '") threw ' + e.name + ': ' + e.message);
      }
    }
  }
);

// --- Part B: each mode applies its own window size -------------------------
// Presets: standard 970x730, compact 360x260 (Large mode removed).
const EXPECTED_SIZE = {
  standard: [970, 730],
  compact: [360, 260]
};

const sizePerMode = () => check(
  'each_mode_applies_its_documented_window_size',
  async () => {

    for (const mode of Object.keys(EXPECTED_SIZE)) {
      reset();
      changeQuickViewLayoutPreset(mode, false, false);
      const call = lastRpc('set_window_size');
      assert(call, mode + ': expected a set_window_size RPC');
      const [w, h] = EXPECTED_SIZE[mode];
      assertEq(call.args[0], w, mode + ' width');
      assertEq(call.args[1], h, mode + ' height');
    }
  }
);

// --- Part C: sizes must match the C# clamps -------------------------------
// Guards against the two sides drifting: the JS preset table and the
// non-animated RPC path must agree the same request is honoured.
const sizeMatchesCsHandler = () => check(
  'mode_sizes_are_not_clamped_by_cs_handler',
  async () => {

    const cs = fs.readFileSync(path.join(REPO, 'MainForm.cs'), 'utf8');
    const minW = parseInt((cs.match(/MIN_WINDOW_WIDTH = (\d+)/) || [])[1], 10);
    const minH = parseInt((cs.match(/MIN_WINDOW_HEIGHT = (\d+)/) || [])[1], 10);
    assert(minW > 0 && minH > 0, 'could not read MIN_WINDOW_* from MainForm.cs');
    for (const mode of Object.keys(EXPECTED_SIZE)) {
      const [w, h] = EXPECTED_SIZE[mode];
      assert(w >= minW && h >= minH,
        mode + ' (' + w + 'x' + h + ') would be clamped by MIN_WINDOW_* ' + minW + 'x' + minH);
    }
  }
);

// --- Part D: only ONE size RPC per switch ---------------------------------
// The double-dispatch defect sent two set_window_size calls, restarting the
// bounds tween mid-flight.
const singleSizeRpc = () => check(
  'mode_switch_issues_exactly_one_size_rpc',
  async () => {

    for (const mode of ['standard', 'compact']) {
      reset();
      changeQuickViewLayoutPreset(mode, false, true);
      assertEq(rpcCount('set_window_size'), 1, mode + ' set_window_size call count');
    }
  }
);

// --- Part E: user's line setting survives ----------------------------------
// switchDensityPreview() applies densityLineMap (dense -> '1'), which stomped
// the user's choice on every mode switch. TASK-002 requires it to survive.
const lineSettingSurvives = () => check(
  'user_line_display_survives_mode_switch',
  async () => {

    // '3' (fixed three lines) was removed from the product; a stored '3' migrates to 'auto'.
    for (const [userSetting, expectedAfterSwitch] of [['1', '1'], ['2', '2'], ['3', 'auto'], ['auto', 'auto']]) {
      for (const target of ['compact', 'standard']) {
        reset();
        storage.set('dualclip_line_display', userSetting);
        global.currentLineDisplay = userSetting;
        changeQuickViewLayoutPreset(target, false, false);
        assertEq(htmlAttrs['data-line-display'], expectedAfterSwitch,
          'line display after switching to ' + target + ' (user had ' + userSetting + ')');
        assertEq(storage.get('dualclip_line_display'), expectedAfterSwitch,
          'persisted line display after switching to ' + target);
      }
    }
  }
);

// --- Part F: hydrateOnly must stay inert ----------------------------------
// Boot hydration must not fire window RPCs or stomp user settings.
const hydrateIsInert = () => check(
  'hydrate_only_does_not_resize_or_overwrite',
  async () => {

    reset();
    storage.set('dualclip_line_display', '3');
    storage.set('dualclip_clip_details', 'hidden');
    changeQuickViewLayoutPreset('compact', true, false);
    assertEq(rpcCount('set_window_size'), 0, 'set_window_size calls during hydrate');
    assertEq(storage.get('dualclip_clip_details'), 'hidden', 'clip details during hydrate');
  }
);

// --- Part G: metadata preservation & thumb size persistence ------------
const metaPerMode = () => check(
  'compact_always_hidden_standard_restores_preference',
  async () => {
    reset();
    // Standard mode with app-time
    storage.set('dualclip_clip_details', 'app-time');
    storage.set('dualclip_standard_clip_details', 'app-time');
    
    // Switch to compact -> must become 'hidden'
    changeQuickViewLayoutPreset('compact', false, false);
    assertEq(htmlAttrs['data-clip-details'], 'hidden', 'compact forces clip details hidden');

    // Switch back to standard -> must restore 'app-time'
    changeQuickViewLayoutPreset('standard', false, false);
    assertEq(htmlAttrs['data-clip-details'], 'app-time', 'standard restores saved app-time');
    assertEq(storage.get('dualclip_thumb_size'), 'sm', 'thumb size default');
    // Explicit check: user custom thumb sizes survive mode switching
    // 'lg' was removed from the product; it now migrates to 'sm'.
    for (const [userThumb, expectedThumb] of [['sm', 'sm'], ['md', 'md'], ['lg', 'sm']]) {
      for (const target of ['compact', 'standard']) {
        reset();
        storage.set('dualclip_thumb_size', userThumb);
        global.currentThumbSize = userThumb;
        changeQuickViewLayoutPreset(target, false, false);
        assertEq(storage.get('dualclip_thumb_size'), expectedThumb,
          'thumb size after switching to ' + target + ' (user had ' + userThumb + ')');
      }
    }
  }
);

// --- Part H: settings view is never resized by the bundle ------------------
// applyWindowSizePreset suppresses its RPC under .in-settings; the bundle must
// not route around that.
const settingsViewNotResized = () => check(
  'mode_bundle_does_not_resize_while_settings_open',
  async () => {

    reset();
    bodyClasses.add('in-settings');
    try {
      changeQuickViewLayoutPreset('compact', false, false);
      assertEq(rpcCount('set_window_size'), 0, 'set_window_size calls while in-settings');
    } finally {
      bodyClasses.delete('in-settings');
    }
  }
);

(async () => {
  await switchDoesNotThrow();
  await sizePerMode();
  await sizeMatchesCsHandler();
  await singleSizeRpc();
  await lineSettingSurvives();
  await hydrateIsInert();
  await metaPerMode();
  await settingsViewNotResized();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})();
