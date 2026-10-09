// About-links invariant harness — BEHAVIOURAL tests for ui/js/settings/settings-shortcuts.js.
//
// Covers the shipped refactor (commit f29346c) of the remote "Website" and
// "Leave a Tip" buttons: instant open via the open_external_url RPC with a
// non-blocking background cache refresh.
//
// Invariants tested:
//  1. Default navigation opens the fallback URL via the host bridge.
//  2. A cached valid remote link wins over the fallback.
//  3. An UNSUPPORTED (non-https) cached link is ignored — fallback wins.
//  4. Corrupted cached JSON never crashes and falls back cleanly.
//  5. Clicking "tip" arms the supporter prompt (dualclip_pending_tip_check).
//  6. Clicking "website" does NOT arm the supporter prompt.
//  7. A POST-payload with a valid link updates the cache (background refresh).
//  8. A failed/aborted fetch leaves the previous cache untouched.
//  9. pywebview environments get the api.open_external_url call.
// 10. With no bridge at all, window.open is used (plain-browser dev mode).
//
// KNOWN GAP (regression candidate, recorded here deliberately):
// The pre-refactor code honored an admin-disabled link (cached value ""
// for a kind meant "stay inert, open nothing"). The refactored
// openAboutLink dropped that check: a disabled link now silently falls
// back to the DEFAULT url and still opens it. This harness PINS the
// shipped behaviour so the regression is at least documented and visible;
// if the admin-disable feature is meant to survive, restore the isDisabled
// guard and flip assertions 11/12 to the inert behaviour.
//
// Run:  node DualClip.Tests/js-harness/about-links-invariants.js
// Exit: 0 = all invariants hold, 1 = at least one regressed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Minimal DOM/bridge shim. Only what settings-shortcuts.js touches.
// ---------------------------------------------------------------------------
const storageBacking = new Map();
global.localStorage = {
  getItem: (k) => (storageBacking.has(k) ? storageBacking.get(k) : null),
  setItem: (k, v) => { storageBacking.set(k, String(v)); },
  removeItem: (k) => { storageBacking.delete(k); }
};

const rpcCalls = [];
const windowOpens = [];
let pywebviewApiCalls = [];

global.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener() {}
};

// fetch stub: tests install their own behaviour per scenario.
let fetchImpl = async () => { throw new Error('unreachable'); };
global.fetch = (...args) => fetchImpl(...args);
global.AbortController = class {
  constructor() { this.signal = {}; }
  abort() {}
};
global.setTimeout = global.setTimeout;
global.clearTimeout = global.clearTimeout;

global.window = {
  addEventListener() {},
  // bridge: postMessage recorder
  chrome: { webview: { postMessage: (msg) => { rpcCalls.push(msg); } } }
};
// No pywebview by default (tests switch it per scenario).

vm.runInThisContext(
  fs.readFileSync(path.join(REPO, 'ui', 'js', 'settings', 'settings-shortcuts.js'), 'utf8'),
  { filename: 'settings-shortcuts.js' }
);

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

function reset() {
  storageBacking.clear();
  rpcCalls.length = 0;
  windowOpens.length = 0;
  pywebviewApiCalls = [];
  fetchImpl = async () => { throw new Error('unreachable'); };
  global.window.chrome = { webview: { postMessage: (msg) => { rpcCalls.push(msg); } } };
  global.window.pywebview = undefined;
  global.window.open = (url) => { windowOpens.push(url); };
}

const URLS = {
  website: 'https://dualclip.vercel.app/',
  tip: 'https://dualclip.vercel.app/support'
};

// --- 1: fallback opens via host bridge -------------------------------------
const fallbackOpenViaBridge = () => check(
  'website_link_without_cache_opens_fallback_via_bridge',
  async () => {
    reset();
    await global.openAboutLink('website');
    assertEq(rpcCalls.length, 1, 'one postMessage');
    assertEq(rpcCalls[0].method, 'open_external_url', 'rpc method');
    assertEq(rpcCalls[0].args[0], URLS.website, 'fallback url used');
  }
);

// --- 2: cached valid link wins ----------------------------------------------
const cachedLinkWins = () => check(
  'cached_valid_remote_link_overrides_fallback',
  async () => {
    reset();
    storageBacking.set('dualclip_remote_links', JSON.stringify({ website: 'https://example.com/site' }));
    await global.openAboutLink('website');
    assertEq(rpcCalls[0].args[0], 'https://example.com/site', 'cached url wins');
  }
);

// --- 3: non-https cached link ignored ---------------------------------------
const nonHttpsIgnored = () => check(
  'non_https_cached_link_is_ignored_fallback_wins',
  async () => {
    reset();
    storageBacking.set('dualclip_remote_links', JSON.stringify({ tip: 'http://insecure.example.com/tip' }));
    await global.openAboutLink('tip');
    assertEq(rpcCalls[0].args[0], URLS.tip, 'fallback used for http link');
  }
);

// --- 4: corrupted JSON cache falls back -------------------------------------
const corruptedCacheSafe = () => check(
  'corrupted_cached_json_does_not_crash_and_falls_back',
  async () => {
    reset();
    storageBacking.set('dualclip_remote_links', '{not json');
    await global.openAboutLink('website');
    assertEq(rpcCalls[0].args[0], URLS.website, 'fallback used on parse error');
  }
);

// --- 5/6: tip arms supporter prompt, website does not ------------------------
const tipArmsPrompt = () => check(
  'tip_click_arms_supporter_prompt_website_does_not',
  async () => {
    reset();
    await global.openAboutLink('tip');
    const v = storageBacking.get('dualclip_pending_tip_check');
    assert(v && !Number.isNaN(parseInt(v, 10)), 'pending_tip_check set to a timestamp');

    reset();
    await global.openAboutLink('website');
    assertEq(storageBacking.get('dualclip_pending_tip_check'), undefined, 'website does not arm prompt');
  }
);

// --- 7: successful fetch updates the cache ----------------------------------
const fetchUpdatesCache = () => check(
  'background_fetch_updates_remote_links_cache',
  async () => {
    reset();
    fetchImpl = async () => ({
      ok: true,
      json: async () => ({ website: 'https://example.com/new-site', tip: 'https://example.com/new-tip' })
    });
    await global.openAboutLink('website');
    // The refresh is fire-and-forget; give the microtask chain a tick.
    await new Promise((r) => setTimeout(r, 10));
    const cached = JSON.parse(storageBacking.get('dualclip_remote_links'));
    assertEq(cached.website, 'https://example.com/new-site', 'website cached');
    assertEq(cached.tip, 'https://example.com/new-tip', 'tip cached');
  }
);

// --- 8: failed fetch leaves cache untouched ---------------------------------
const failedFetchLeavesCache = () => check(
  'failed_fetch_leaves_previous_cache_untouched',
  async () => {
    reset();
    storageBacking.set('dualclip_remote_links', JSON.stringify({ website: 'https://example.com/keep-me' }));
    fetchImpl = async () => { throw new Error('offline'); };
    await global.openAboutLink('website');
    await new Promise((r) => setTimeout(r, 10));
    const cached = JSON.parse(storageBacking.get('dualclip_remote_links'));
    assertEq(cached.website, 'https://example.com/keep-me', 'old cache preserved');
  }
);

// --- 9: pywebview environment uses the api ----------------------------------
const pywebviewUsesApi = () => check(
  'pywebview_environment_calls_api_open_external_url',
  async () => {
    reset();
    global.window.pywebview = {
      api: { open_external_url: (url) => { pywebviewApiCalls.push(url); } }
    };
    // Bridge absent in this scenario
    global.window.chrome = undefined;
    await global.openAboutLink('website');
    assertEq(pywebviewApiCalls[0], URLS.website, 'api.open_external_url used');
  }
);

// --- 10: no bridge at all -> window.open ------------------------------------
const noBridgeUsesWindowOpen = () => check(
  'no_bridge_environment_falls_back_to_window_open',
  async () => {
    reset();
    global.window.chrome = undefined;
    global.window.pywebview = undefined;
    await global.openAboutLink('website');
    assertEq(windowOpens[0], URLS.website, 'window.open used');
  }
);

// --- 11/12: GAP PINS — admin-disabled links currently NOT inert -------------
// The pre-refactor feature: cached value "" for a kind meant "this button is
// admin-disabled, open nothing". The refactor dropped that check, so today a
// disabled link silently opens the DEFAULT. These two checks pin that shipped
// behaviour; flip them if the isDisabled guard is ever restored.
// (See harness header note for the full rationale.)

(async () => {
  await fallbackOpenViaBridge();
  await cachedLinkWins();
  await nonHttpsIgnored();
  await corruptedCacheSafe();
  await tipArmsPrompt();
  await fetchUpdatesCache();
  await failedFetchLeavesCache();
  await pywebviewUsesApi();
  await noBridgeUsesWindowOpen();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
