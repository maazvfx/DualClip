// Group-count overflow invariant harness — BEHAVIOURAL tests for ui/js/list/render.js.
//
// Covers the shipped fix for docs/reviews/group-header-count-bugs.md F1/F12: a group
// whose run reaches the end of the loaded page window must render "N+", not a bare
// page-capped number that reads like an exact total.
//
// WHY THIS IS ONLY PARTIAL COVERAGE — read before trusting it:
// The resolution half of the fix (which group is "open") lives inside renderList(),
// which is not reachable from a test. Driving it requires state.js globals
// (clipPageSize, allClips, hasMoreClips) *and* a DOM deep enough to satisfy the
// virtualiser; it was attempted and abandoned. loadNextClipPage-style page fetches are
// tested for real in pagination-invariants.js; renderList() is not. The overflow
// *rendering* below is genuine behavioural coverage. The resolution logic is guarded
// only by a SOURCE-TEXT assertion in GroupCountPaginationTests.cs, and that gap is
// recorded in responses/RESPONSE-001.md.
//
// Run:  node DualClip.Tests/js-harness/group-count-invariants.js
// Exit: 0 = all invariants hold, 1 = at least one regressed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// DOM shim. createHeaderElement builds a detached header and assigns innerHTML,
// which is exactly what we want to assert on — so elements record what is written.
// ---------------------------------------------------------------------------
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
    scrollTop: 0, scrollHeight: 0, offsetHeight: 0, clientHeight: 0,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 })
  };
}

global.document = {
  getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [],
  createElement: (t) => mkEl(t), documentElement: mkEl(), body: mkEl(),
  addEventListener() {}, readyState: 'complete'
};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.navigator = { userAgent: 'node' };
global.window = {
  addEventListener() {}, removeEventListener() {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  DC: { state: {} },
  pywebview: { api: {} }
};
global.CSS = { escape: (s) => String(s) };

// Helpers render.js calls but does not define (they live in sibling UI modules).
['formatClipForUI', 'sortAllClips', 'applyFilters', 'formatAppDisplayName', 'getFormatTag',
 'updateViewModeButton', 'getEffectiveViewMode', 'changeQuickViewLayoutPreset', 'toggleLivePreview',
 'syncLivePreview', 'notifySettingSaved', 'getZoomScale'
].forEach((n) => { if (typeof global[n] === 'undefined') global[n] = (...a) => a[0]; });

global.sectionClickMode = 'chevron';
global.collapsedGroups = {};

// Load the real escapeHtml (defined in core/namespace.js) rather than a stub — the
// escaping invariant below is only meaningful against the genuine implementation.
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
    .catch((e) => { results.push({ name, ok: false, msg: e.message }); console.log('FAIL ' + name + ': ' + e.message); });
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function headerFor(count, countOverflow) {
  const h = createHeaderElement({ grpKey: 'today', title: 'Today', count: count, countOverflow: countOverflow, height: 32 });
  return h.innerHTML;
}

// The headline defect: a page-capped count must never render as a bare integer.
const overflowRendersPlus = () => check(
  'truncated_group_renders_plus_suffix',
  async () => {
    const html = headerFor(100, true);
    assert(/group-count[^>]*>100\+</.test(html),
      'expected the group count to render "100+", got: ' + html.slice(html.indexOf('group-count') - 20, html.indexOf('group-count') + 60));
  }
);

// The complement: a complete group must NOT gain a misleading "+".
const completeGroupHasNoPlus = () => check(
  'complete_group_renders_bare_count',
  async () => {
    const html = headerFor(171, false);
    assert(/group-count[^>]*>171</.test(html), 'expected a bare 171 for a complete group');
    assert(!/>\d+\+</.test(html), 'a complete group must not render a "+"');
  }
);

const overflowExplainsItself = () => check(
  'truncated_group_explains_via_title',
  async () => {
    const html = headerFor(100, true);
    const m = html.match(/class="group-count" title="([^"]*)"/);
    assert(m, 'truncated group must carry a title attribute');
    assert(/more may exist|scroll to load/i.test(m[1]),
      'title should tell the user the count is partial, got: ' + m[1]);
  }
);

const completeGroupHasNoTooltip = () => check(
  'complete_group_has_no_partial_explanation',
  async () => {
    const html = headerFor(171, false);
    const m = html.match(/class="group-count" title="([^"]*)"/);
    assert(m, 'group count should still render a title attribute');
    assert(m[1] === '', 'a complete group must not claim to be partial, got: ' + JSON.stringify(m[1]));
  }
);

// Small counts must be untouched — this is the overwhelmingly common case and must
// not regress into carrying a stray marker.
const smallCountsUnaffected = () => check(
  'small_counts_render_plain',
  async () => {
    const html = headerFor(1, false);
    assert(/group-count[^>]*>1</.test(html), 'a single clip must render as "1"');
  }
);

const groupTitleStillEscaped = () => check(
  'group_title_is_still_escaped',
  async () => {
    // createHeaderElement uppercases and escapes the title; a regression there would
    // be an injection vector, so pin it while we are in this function.
    const h = createHeaderElement({ grpKey: 'x', title: '<img src=x>', count: 3, countOverflow: false, height: 32 });
    assert(!/<img/i.test(h.innerHTML), 'group title must be HTML-escaped');
  }
);

(async () => {
  await overflowRendersPlus();
  await completeGroupHasNoPlus();
  await overflowExplainsItself();
  await completeGroupHasNoTooltip();
  await smallCountsUnaffected();
  await groupTitleStillEscaped();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})();
