// Pagination invariant harness — BEHAVIOURAL tests for ui/js/core/state.js.
//
// Loads the REAL state.js into a DOM shim (vm.runInThisContext, so top-level `var`
// declarations become true globals) and drives loadNextClipPage() against a mocked
// get_clips, recording the `offset` argument the code actually sends to SQLite.
//
// Why this exists instead of a source-text assertion: the defect these cover
// (docs/reviews/group-header-count-bugs.md F10) was an *arithmetic* error. Asserting
// that the source no longer contains "allClips.length" would pass just as happily
// while the offset was still wrong. Only executing the code catches that.
//
// Run:  node DualClip.Tests/js-harness/pagination-invariants.js
// Exit: 0 = all invariants hold, 1 = at least one regressed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STATE_JS = path.resolve(__dirname, '..', '..', 'ui', 'js', 'core', 'state.js');

// ---------------------------------------------------------------------------
// Minimal DOM shim. state.js is written for a WebView2 document; it only needs
// these surfaces to load and to run a page fetch.
// ---------------------------------------------------------------------------
function mkEl() {
  return {
    getAttribute: () => null, setAttribute: () => {}, addEventListener: () => {},
    removeEventListener: () => {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, value: '', textContent: '', innerHTML: '', children: [],
    appendChild() {}, removeChild() {}, querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus() {}, remove() {}, contains: () => false, parentElement: null,
    scrollTop: 0, scrollHeight: 0, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 })
  };
}

let getClipsCalls = [];      // records every offset the code sends
let nextPageRows = [];       // rows the mocked server will return

global.document = {
  getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [],
  createElement: () => mkEl(), documentElement: mkEl(), body: mkEl(),
  addEventListener: () => {}, readyState: 'complete'
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.navigator = { userAgent: 'node' };
global.window = {
  addEventListener: () => {}, removeEventListener: () => {},
  getComputedStyle: () => ({}), DC: { state: {} },
  pywebview: {
    api: {
      // Argument order mirrors the real call: collection, type, app, time, query,
      // sortOrder, pageSize, OFFSET, fuzzy.
      get_clips: function () {
        const args = Array.prototype.slice.call(arguments);
        getClipsCalls.push(args[7]);
        return Promise.resolve({ clips: nextPageRows.slice() });
      }
    }
  }
};

// Helpers state.js calls but does not define (they live in other UI modules).
global.formatClipForUI = (c) => c;
global.sortAllClips = () => {};
global.applyFilters = () => {};
global.calcClipTimeGroup = () => 'today';

vm.runInThisContext(fs.readFileSync(STATE_JS, 'utf8'), { filename: 'state.js' });

// ---------------------------------------------------------------------------
// Test plumbing
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

function makeRows(startId, count) {
  return Array.from({ length: count }, (_, i) => ({ id: startId + i, text_content: 'x' }));
}

function reset(opts) {
  opts = opts || {};
  getClipsCalls = [];
  nextPageRows = opts.nextPage || [];
  allClips = opts.loaded || [];
  hasMoreClips = opts.hasMore !== undefined ? opts.hasMore : true;
  isLoadingMoreClips = false;
  clipsLoadedOffset = opts.offset || 0;
  clipFetchSeq = 0;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

// F10 regression. Under the old `offset = allClips.length`, deleting a loaded clip
// shrank allClips and rewound the offset, moving every later page boundary and
// skipping rows. The monotonic counter must ignore local deletes entirely.
const offsetSurvivesDelete = () => check(
  'offset_is_monotonic_across_local_delete',
  async () => {
    reset({ loaded: makeRows(1, 100), hasMore: true, offset: 100, nextPage: makeRows(101, 100) });
    await loadNextClipPage();
    assert(getClipsCalls[0] === 100, 'first page offset should be 100, got ' + getClipsCalls[0]);

    // User deletes one clip that is already loaded. allClips shrinks...
    const before = allClips.length;
    allClips = allClips.filter((c) => c.id !== 50);
    assert(allClips.length === before - 1, 'delete should shrink allClips by exactly 1');

    nextPageRows = makeRows(201, 100);
    await loadNextClipPage();
    // ...but the offset must still be 200, because SQLite's window never moved.
    assert(getClipsCalls[1] === 200,
      'offset after delete must stay 200 (monotonic), got ' + getClipsCalls[1] +
      ' — this is the allClips.length regression');
  }
);

// The offset must advance by what the SERVER returned, not by how many rows
// survived de-duplication. Otherwise a re-served row silently stalls pagination.
const offsetAdvancesByServerRows = () => check(
  'offset_advances_by_server_rows_not_deduped',
  async () => {
    reset({ loaded: makeRows(1, 100), hasMore: true, offset: 100, nextPage: makeRows(1, 100) });
    const before = allClips.length;
    await loadNextClipPage();
    assert(allClips.length === before, 'all duplicates should append nothing');
    assert(clipsLoadedOffset === 200,
      'offset must advance by the 100 rows the server sent even though 0 were new, got ' + clipsLoadedOffset);
  }
);

const shortPageClearsHasMore = () => check(
  'short_page_clears_hasMoreClips',
  async () => {
    reset({ loaded: makeRows(1, 100), hasMore: true, offset: 100, nextPage: makeRows(101, 71) });
    await loadNextClipPage();
    assert(hasMoreClips === false, 'a 71-row page is the last page; hasMoreClips must be false');
    assert(allClips.length === 171, 'expected 171 loaded clips, got ' + allClips.length);
  }
);

const fullPageKeepsHasMore = () => check(
  'full_page_keeps_hasMoreClips',
  async () => {
    reset({ loaded: makeRows(1, 100), hasMore: true, offset: 100, nextPage: makeRows(101, 100) });
    await loadNextClipPage();
    assert(hasMoreClips === true, 'a full page means there may be more');
    assert(allClips.length === 200, 'expected 200 loaded clips, got ' + allClips.length);
  }
);

// An exact page-size multiple costs one wasted fetch (documented as F11). Assert the
// CURRENT behaviour so a future optimisation is a deliberate, visible change.
const exactMultipleCostsOneFetch = () => check(
  'exact_page_multiple_allows_one_extra_fetch',
  async () => {
    reset({ loaded: makeRows(1, 100), hasMore: true, offset: 100, nextPage: [] });
    assert(hasMoreClips === true, 'hasMoreClips is set from length >= pageSize, so exactly 100 implies true');
    await loadNextClipPage();
    assert(hasMoreClips === false, 'the follow-up empty page must clear the flag');
  }
);

const firstPageStartsAtZero = () => check(
  'first_page_starts_at_zero',
  async () => {
    reset({ loaded: makeRows(1, 100), hasMore: true, offset: 0, nextPage: [] });
    await loadNextClipPage();
    assert(getClipsCalls[0] === 0, 'first page offset must be 0, got ' + getClipsCalls[0]);
  }
);

// loadClipsFromBackend resets the counter, so a new query can never inherit a stale
// offset from the previous one.
const fullLoadResetsOffset = () => check(
  'full_load_resets_offset',
  async () => {
    reset({ loaded: [], hasMore: false, offset: 640 });
    loadClipsFromBackend(null);
    assert(clipsLoadedOffset === 0, 'a full load must reset clipsLoadedOffset to 0, got ' + clipsLoadedOffset);
    assert(hasMoreClips === true, 'a full load must re-arm hasMoreClips');
  }
);

// ---------------------------------------------------------------------------
(async () => {
  await offsetSurvivesDelete();
  await offsetAdvancesByServerRows();
  await shortPageClearsHasMore();
  await fullPageKeepsHasMore();
  await exactMultipleCostsOneFetch();
  await firstPageStartsAtZero();
  await fullLoadResetsOffset();

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log('SUMMARY ' + (results.length - failed) + '/' + results.length + ' invariants hold');
  process.exit(failed === 0 ? 0 : 1);
})();
