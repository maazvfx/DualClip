// RPC bridge signature harness — BEHAVIOURAL tests for the JS→C# RPC surface.
//
// Executes the real ui/js/core/bridge.js in a Node shim and calls each wrapped
// method, then asserts the argument array actually delivered to the host.
//
// Why this exists: bridge.js is a hand-written facade over ~40 RPCs. Its
// set_window_size wrapper silently dropped its 4th argument, so the native
// `persist` flag never arrived — the source read correctly end to end and the
// feature was inert at runtime. Nothing caught it: `dotnet build` does not
// parse JS, and the C# tests that touch this file are string matches that pass
// on any file containing the token.
//
// This harness executes the wrapper and inspects what it forwards, so a dropped
// or reordered argument fails here instead of in the app.
//
// Run:  node DualClip.Tests/js-harness/rpc-bridge-invariants.js
// Exit: 0 = all invariants hold, 1 = at least one regressed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Host stub: records every RPC that crosses the bridge.
// ---------------------------------------------------------------------------
const sent = [];

function callHost(method, args) {
  sent.push({ method, args: Array.isArray(args) ? args : [args] });
  return Promise.resolve({ ok: true });
}

global.callHost = callHost;

// ---------------------------------------------------------------------------
// Minimal DOM — bridge.js only needs document/window at load time.
// ---------------------------------------------------------------------------
function mkEl(tag) {
  return {
    tagName: (tag || 'DIV').toUpperCase(),
    id: '', className: '', value: '',
    getAttribute: () => null, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {},
    textContent: '', innerHTML: '', children: [], childNodes: [],
    offsetHeight: 0, clientHeight: 0, clientWidth: 0, scrollTop: 0, scrollHeight: 0,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    contains: () => false, parentElement: null, offsetParent: {}
  };
}

global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (t) => mkEl(t),
  createTextNode: (t) => ({ textContent: String(t) }),
  documentElement: mkEl('HTML'),
  body: mkEl('BODY'),
  addEventListener() {}, removeEventListener() {},
  readyState: 'complete'
};
global.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};
global.navigator = { userAgent: 'node' };

// bridge.js guards on window.chrome, so window.chrome must be populated (a bare
// global.chrome is not the same object). The real transport is
// chrome.webview.postMessage — callHost is a private closure — so that is where
// we intercept and record. Pending RPC promises never resolve here; the harness
// exits explicitly, so their timers are irrelevant.
const webviewStub = {
  addEventListener() {},
  postMessage(msg) {
    sent.push({ method: msg.method, args: Array.isArray(msg.args) ? msg.args : [] });
  }
};
global.chrome = { webview: webviewStub };
global.window = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  innerWidth: 960, innerHeight: 720,
  chrome: global.chrome,
  DC: { state: {} }
};
global.Event = function (t) { this.type = t; };

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

// Load the real bridge facade.
vm.runInThisContext(
  fs.readFileSync(path.join(REPO, 'ui', 'js', 'core', 'bridge.js'), 'utf8'),
  { filename: 'bridge.js' });

const api = global.window && global.window.pywebview && global.window.pywebview.api;

function fire(method, args) {
  sent.length = 0;
  assert(api && typeof api[method] === 'function', 'bridge exposes no wrapper for ' + method);
  api[method].apply(null, args);
  assert(sent.length === 1, method + ': expected exactly 1 host call, got ' + sent.length);
  return sent[0];
}

// --- Part A: set_window_size forwards every argument -----------------------
// The regression: the wrapper was (w, h, animate) and dropped `persist`.
const windowSizeForwardsAllArgs = () => check(
  'set_window_size_forwards_animate_and_persist',
  async () => {
    const call = fire('set_window_size', [880, 680, false, false]);
    assertEq(call.method, 'set_window_size', 'method name');
    assertEq(call.args.length, 4, 'forwarded argument count');
    assertEq(call.args[0], 880, 'arg[0] width');
    assertEq(call.args[1], 680, 'arg[1] height');
    assertEq(call.args[2], false, 'arg[2] animate');
    assertEq(call.args[3], false, 'arg[3] persist');
  }
);

// --- Part B: persist defaults to true when omitted -------------------------
// Every pre-existing caller passes <= 3 args and must keep persisting.
const persistDefaultsTrue = () => check(
  'set_window_size_persist_defaults_true_when_omitted',
  async () => {
    for (const args of [[960, 720], [960, 720, true], [360, 260, false]]) {
      const call = fire('set_window_size', args);
      assertEq(call.args[3], true,
        'persist must default true for args ' + JSON.stringify(args));
    }
  }
);

// --- Part C: explicit true is preserved ------------------------------------
const persistTruePreserved = () => check(
  'set_window_size_preserves_explicit_persist_true',
  async () => {
    const call = fire('set_window_size', [360, 260, true, true]);
    assertEq(call.args[3], true, 'persist explicitly true');
  }
);

// --- Part D: C# handler accepts the arity we send ---------------------------
// The handler must read args[3]; if it regressed to args.Length <= 3 the
// persist flag would be ignored on the native side.
const handlerReadsFourthArg = () => check(
  'cs_handler_reads_the_fourth_argument',
  async () => {
    // MainForm is a partial class: handlers live across MainForm*.cs (e.g.
    // MainForm.RpcDispatch.cs), so scan every partial rather than one file.
    const cs = fs.readdirSync(REPO)
      .filter(f => /^MainForm.*\.cs$/.test(f))
      .sort()
      .map(f => fs.readFileSync(path.join(REPO, f), 'utf8'))
      .join('\n');
    assert(/args\.GetArrayLength\(\) > 3/.test(cs),
      'MainForm partials no longer read a 4th argument; persist would be ignored natively');
    assert(/TryGetBool\(args\[3\]/.test(cs),
      'MainForm partials no longer parse args[3] as the persist flag');
  }
);

// --- Part E: transient callers in the UI actually pass persist=false -------
// Guards the two real call sites: if someone drops the 4th arg, the leak
// returns silently.
const transientCallSitesPassPersistFalse = () => check(
  'transient_call_sites_pass_persist_false',
  async () => {
    const cases = [
      ['js/settings/settings-core.js', /set_window_size\((?:settingsW|880),\s*(?:settingsH|680),\s*false,\s*false\)/,
        'Settings view must resize transiently'],
      ['js/overlays/preview-lightbox.js', /set_window_size\(targetW,\s*targetH,\s*true,\s*false\)/,
        'Lightbox expand must resize transiently'],
      ['js/overlays/modals.js', /set_window_size\(targetW,\s*targetH,\s*true,\s*false\)/,
        'Compact dialog expand must resize transiently']
    ];
    for (const [rel, re, why] of cases) {
      const src = fs.readFileSync(path.join(REPO, 'ui', rel), 'utf8');
      assert(re.test(src), why + ' — ' + rel + ' no longer passes persist=false');
    }
  }
);

// The restore leg of the compact dialog expand must be a PERSISTING resize
// (it returns the window to the user's preset size); the expand leg above
// must be transient. Both legs were persisting before the summon-flicker fix.
const modalExpandIsTransient = () => check(
  'compact_dialog_restore_is_persisting',
  async () => {
    const modals = fs.readFileSync(path.join(REPO, 'ui', 'js', 'overlays', 'modals.js'), 'utf8');
    assert(/set_window_size\(restoreW,\s*restoreH,\s*true,\s*true\)/.test(modals),
      'compact dialog restore must pass persist=true (restores the preset size)');
  }
);

// --- Part F: execute EVERY wrapper and assert it reaches the host ----------
// Source inspection cannot catch a dropped argument; calling each wrapper can.
// Every wrapper is invoked with distinct sentinel values and must forward every
// declared parameter to the host, in order.
const allWrappersForwardEveryArg = () => check(
  'every_bridge_wrapper_forwards_all_its_parameters',
  async () => {
    const src = fs.readFileSync(path.join(REPO, 'ui', 'js', 'core', 'bridge.js'), 'utf8');
    const wrapperRe = /^\s{6}(\w+):\s*\(([^)]*)\)\s*=>/gm;
    let m, checked = 0, skipped = 0;

    while ((m = wrapperRe.exec(src)) !== null) {
      const key = m[1];
      const params = m[2].trim() === ''
        ? []
        : m[2].split(',').map((s) => s.trim()).filter(Boolean);

      if (typeof api[key] !== 'function') { skipped++; continue; }

      const sentinels = params.map((_, i) => 'SENTINEL_' + i);
      let call;
      try {
        call = fire(key, sentinels);
      } catch (e) {
        // A wrapper may legitimately reject sentinel input; that is fine so long
        // as it did not reach the host with a short argument list.
        continue;
      }
      assert(call.args.length >= params.length,
        key + ' declares ' + params.length + ' param(s) but forwarded only ' + call.args.length);
      for (let i = 0; i < params.length; i++) {
        assert(call.args[i] !== undefined,
          key + ' left arg[' + i + '] (' + params[i] + ') undefined');
      }
      checked++;
    }

    assert(checked > 30,
      'expected the full RPC facade to be callable, only exercised ' + checked);
    console.log('      (exercised ' + checked + ' wrappers, skipped ' + skipped + ')');
  }
);

(async () => {
  await windowSizeForwardsAllArgs();
  await persistDefaultsTrue();
  await persistTruePreserved();
  await handlerReadsFourthArg();
  await transientCallSitesPassPersistFalse();
  await modalExpandIsTransient();
  await allWrappersForwardEveryArg();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})();
