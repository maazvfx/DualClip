// Auto-tier invariant harness — BEHAVIOURAL tests for TASK-002.
//
// Part A pins getAdaptiveTier() (the pure classifier behind data-line-display="auto").
// Part B pins the dense JS/CSS contract: getRowHeight()'s per-tier buckets must equal
// the min-height rules in ui/css/overlays-modals.css for every (details x tier) pair.
// That duplication drifted once (four defects); this test fails if it drifts again.
//
// Run:  node DualClip.Tests/js-harness/auto-tier-invariants.js
// Exit: 0 = all invariants hold, 1 = at least one regressed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Controllable DOM shim. Unlike the group-count harness (fixed nulls), the
// contract test must flip density / line-display / clip-details per case.
// ---------------------------------------------------------------------------
const htmlAttrs = { 'data-line-display': 'auto', 'data-clip-details': 'app-time' };
const bodyClasses = new Set();
const storage = new Map();

function mkEl(tag) {
  return {
    tagName: tag || 'DIV',
    getAttribute: () => null, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, value: '', textContent: '', innerHTML: '', children: [], childNodes: [],
    appendChild(c) { this.children.push(c); return c; }, removeChild() {},
    querySelector: () => mkEl(), querySelectorAll: () => [],
    closest: () => null, focus() {}, remove() {}, contains: () => false,
    parentElement: null, offsetParent: {}, dataset: {},
    scrollTop: 0, scrollHeight: 0, offsetHeight: 0, clientHeight: 0, clientWidth: 0,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 })
  };
}

const documentElement = mkEl('HTML');
documentElement.getAttribute = (n) => (n in htmlAttrs ? htmlAttrs[n] : null);
documentElement.setAttribute = (n, v) => { htmlAttrs[n] = String(v); };

const body = mkEl('BODY');
body.classList.contains = (c) => bodyClasses.has(c);
body.classList.add = (c) => bodyClasses.add(c);
body.classList.remove = (c) => bodyClasses.delete(c);

global.document = {
  getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [],
  createElement: (t) => mkEl(t), documentElement, body,
  addEventListener() {}, readyState: 'complete'
};
global.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); }
};
global.navigator = { userAgent: 'node' };
global.window = {
  addEventListener() {}, removeEventListener() {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  innerWidth: 680,
  DC: { state: {} },
  pywebview: { api: {} }
};
global.CSS = { escape: (s) => String(s) };

global.sectionClickMode = 'chevron';
global.collapsedGroups = {};

// Helpers render.js calls but does not define (they live in sibling UI modules).
['formatClipForUI', 'sortAllClips', 'applyFilters', 'formatAppDisplayName', 'getFormatTag',
 'updateViewModeButton', 'getEffectiveViewMode', 'changeQuickViewLayoutPreset', 'toggleLivePreview',
 'syncLivePreview', 'notifySettingSaved', 'getZoomScale'
].forEach((n) => { if (typeof global[n] === 'undefined') global[n] = (...a) => a[0]; });

vm.runInThisContext(fs.readFileSync(path.join(REPO, 'ui', 'js', 'core', 'namespace.js'), 'utf8'),
  { filename: 'namespace.js' });
vm.runInThisContext(fs.readFileSync(path.join(REPO, 'ui', 'js', 'list', 'render.js'), 'utf8'),
  { filename: 'render.js' });

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
  assert(actual === expected, what + ': expected ' + expected + ', got ' + actual);
}

const textClip = (text) => ({ is_image: false, text_content: text, preview: text });

// Shim geometry is fixed: usable width = 680 - 120 = 560, avg char = 7.6,
// so charsPerLine = floor(560 / 7.6) = 73. A 100-char clip wraps to 2 lines.
const tier1Clip = textClip('short note');
const tier2Clip = textClip('x'.repeat(100));
const tier3Clip = textClip('y'.repeat(300));
const clipsByTier = { 1: tier1Clip, 2: tier2Clip, 3: tier3Clip };

const tierOf = (clip) => getAdaptiveTier(clip);

const longParagraph = () => check(
  'adaptive_tier_long_text_is_tier_3',
  async () => { assertEq(tierOf(tier3Clip), 3, '300-char paragraph'); }
);

const multiNewline = () => check(
  'adaptive_tier_multi_newline_is_tier_3',
  async () => {
    assertEq(tierOf(textClip('one\ntwo\nthree')), 3, '2+ newlines');
    assertEq(tierOf(textClip('a\n\nb')), 3, 'blank-line separated');
  }
);

const shortAndEmpty = () => check(
  'adaptive_tier_short_empty_image_are_tier_1',
  async () => {
    assertEq(tierOf(tier1Clip), 1, 'short text');
    assertEq(tierOf(textClip('   ')), 1, 'whitespace-only');
    assertEq(tierOf({ is_image: true, text_content: 'x'.repeat(500) }), 1, 'image');
  }
);

const mediumIsTier2 = () => check(
  'adaptive_tier_medium_text_is_tier_2',
  async () => { assertEq(tierOf(tier2Clip), 2, '100-char text at 73 chars/line'); }
);

// --- Part B: dense contract -------------------------------------------------
// JS buckets (render.js dense branch): hidden 24/38/56, visible 30/44/58.
// Tier-1 values were recalibrated from a measured Compact render (layout_debug.log):
// the old 24/30 estimates were 7/17 short of the real border-box height.
const EXPECTED = {
  hidden: { 1: 31, 2: 38, 3: 56 },
  visible: { 1: 47, 2: 44, 3: 58 }
};

function cssMinHeights() {
  const css = fs.readFileSync(path.join(REPO, 'ui', 'css', 'overlays-modals.css'), 'utf8');
  const out = { hidden: {}, visible: {} };
  for (const details of ['hidden', 'visible']) {
    const attr = details === 'hidden'
      ? 'html\\[data-clip-details="hidden"\\]'
      : 'html:not\\(\\[data-clip-details="hidden"\\]\\)';
    for (const tier of [1, 2, 3]) {
      const re = new RegExp(
        attr + '\\s*body\\.density-dense\\[data-line-display="auto"\\]\\s*' +
        '\\.clip-row:has\\(\\.row-text\\.auto-tier-' + tier + '\\)\\s*\\{[^}]*?min-height:\\s*(\\d+)px',
        's');
      const m = css.match(re);
      assert(m, 'missing dense auto min-height rule for ' + details + ' x tier-' + tier);
      out[details][tier] = parseInt(m[1], 10);
    }
  }
  return out;
}

const denseAgreement = () => check(
  'dense_js_buckets_match_css_min_heights',
  async () => {
    bodyClasses.add('density-dense');
    htmlAttrs['data-line-display'] = 'auto';
    try {
      const css = cssMinHeights();
      for (const hidden of [true, false]) {
        htmlAttrs['data-clip-details'] = hidden ? 'hidden' : 'app-time';
        const key = hidden ? 'hidden' : 'visible';
        for (const tier of [1, 2, 3]) {
          const js = getRowHeight(clipsByTier[tier], false);
          assertEq(js, EXPECTED[key][tier], 'JS bucket ' + key + ' tier-' + tier);
          assertEq(css[key][tier], EXPECTED[key][tier], 'CSS min-height ' + key + ' tier-' + tier);
        }
      }
    } finally {
      bodyClasses.delete('density-dense');
    }
  }
);

const tierClampsSane = () => check(
  'auto_tier_clamps_match_tier_number',
  async () => {
    const clipList = fs.readFileSync(path.join(REPO, 'ui', 'css', 'clip-list.css'), 'utf8');
    for (const tier of [1, 2, 3]) {
      const re = new RegExp(
        '\\[data-line-display="auto"\\]\\s*\\.row-text\\.auto-tier-' + tier +
        '\\s*\\{[^}]*?line-clamp:\\s*(\\d+)', 's');
      const m = clipList.match(re);
      assert(m, 'missing auto-tier-' + tier + ' clamp rule in clip-list.css');
      assertEq(parseInt(m[1], 10), tier, 'clip-list.css auto-tier-' + tier + ' clamp');
    }
    const overlays = fs.readFileSync(path.join(REPO, 'ui', 'css', 'overlays-modals.css'), 'utf8');
    for (const tier of [1, 2, 3]) {
      const re = new RegExp(
        'body\\.density-dense\\[data-line-display="auto"\\]\\s*\\.clip-row\\s*\\.row-text\\.auto-tier-' +
        tier + '\\s*\\{[^}]*?-webkit-line-clamp:\\s*(\\d+)', 's');
      const m = overlays.match(re);
      assert(m, 'missing dense auto-tier-' + tier + ' clamp rule in overlays-modals.css');
      assertEq(parseInt(m[1], 10), tier, 'dense auto-tier-' + tier + ' clamp');
    }
  }
);

(async () => {
  await longParagraph();
  await multiNewline();
  await shortAndEmpty();
  await mediumIsTier2();
  await denseAgreement();
  await tierClampsSane();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})();
