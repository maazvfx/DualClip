# Full Automated Testing & Verification Report (Frontend & Backend, A-to-Z)

**Date:** 2026-10-09
**Scope snapshot:** commit `f29346c` (snapshot taken before edits); base lineage `6db05cc` → `f2d8c1c`
**Mission source:** [prompt.md](../prompt.md)

---

## 1. Executive Summary

| Metric                  | Result                          |
|-------------------------|---------------------------------|
| Overall health          | **GREEN**                       |
| C# tests (dotnet)       | **280 / 280 passed** (was 268 pre-mission) |
| Node harnesses          | **10 / 10 PASS, 99 invariants** |
| New tests added         | **13** (12 behavioral/structural C# + 9-assertion new harness) |
| Bugs found              | **1 functional regression** (admin-disabled links) + 1 minor config inconsistency |
| Fixes applied in code   | 0 (risk-free behavior change deferred; see §5) |
| Blocking issues         | **None** — release-ready for current scope |
| Suite runtime           | ~35 s C# + <10 s Node          |

**Verdict:** DualClip passes the full A-to-Z sweep. The codebase shows unusually mature test architecture (real-SQLite behavioral tests, real-JS-in-Node harnesses, source-level structural guards with explicit documented gaps). One regression was found in the just-refactored about-links flow and is documented + pinned by tests; fixing it is a one-line decision, not a defect hunt.

---

## 2. Backend Test Breakdown (.NET / C# — 280 tests)

**Run:** `dotnet test DualClip.Tests/DualClip.Tests.csproj` — Passed! 280/280, 0 warnings, 0 errors (~34 s).

| Subsystem / module             | Test class(es)                          | Status |
|--------------------------------|------------------------------------------|--------|
| **Clipboard capture — text**   | AddTextToCollectionTests                  | PASS   |
| **Clipboard capture — images** | RichTextCaptureTests, GifCaptureTests, SvgVectorCaptureTests | PASS |
| **Clipboard capture — file drops** | FileDropCaptureTests, OversizedDropNotificationTests | PASS |
| **Categorization / routing / auto-tier** | AutoTierInvariantTests, AutoSortPatternTests | PASS |
| **SQLite storage & retention** | MaxClipsEnforcementTests, DataLifecycleInvariantTests, ClearHistoryScopeTests, ClearOnLockTests | PASS |
| **Deduplication (content_hash)** | DeduplicationTests                      | PASS   |
| **Search / FTS / query perf**  | SearchScopeTests, SearchTokenizationTests, TagAndNicknameQueryTests | PASS |
| **Hotkeys & window lifecycle** | WindowPlacementTests, WindowSizePolicyTests, SidebarLayoutTests | PASS |
| **JSON-RPC bridge contract** (C#↔JS) | RpcContractInvariantTests (5-way drift guard both directions) | PASS |
| **Numbered quick paste**       | QuickNumberPasteTests                    | PASS   |
| **Rename / custom titles**     | ClipRenameTests                          | PASS   |
| **Export / Import ordering**   | ExportImportOrderingTests                | PASS   |
| **Adversarial sidebar nesting**| SidebarNestedAdversarialTests            | PASS   |
| **Package / build validation** | PackageValidationTests, UiStaticInvariantTests | PASS |
| **URL clean-up**               | UrlCleanerTests                          | PASS   |
| **Group-count / pagination**   | GroupCountPaginationTests                | PASS   |
| **Security guard (URL scheme whitelist) — NEW** | OpenExternalUrlGuardTests (4/4) | PASS |
| **Stress & edge — NEW**        | StressAndEdgeTests (8/8)                 | PASS   |

**Security posture verified:**
- `open_external_url` RPC handler scheme-whitelists to `http`/`https` ONLY — no `file:`, `javascript:`, or custom-scheme passthrough (new structural guards pin this against silent removal).
- Password-manager vault suppression (`IgnorePasswords`) covered behaviorally for Bitwarden / KeePass / 1Password / title-heuristic cases in DataLifecycleInvariantTests.
- Blocklist & screen-capture protection present in routing tab restore logic; FTS5 index available.

---

## 3. Frontend Test Breakdown (Node.js harnesses — 10 files, 99 invariants)

**Run:** `node DualClip.Tests/js-harness/<name>.js` per file, all exit 0.

| Harness file                          | Invariants | Status |
|---------------------------------------|-----------:|--------|
| about-links-invariants.js (**NEW**)   | 9/9        | PASS   |
| auto-tier-invariants.js               | 6/6        | PASS   |
| format-detection-invariants.js        | 15/15      | PASS   |
| group-count-invariants.js             | 6/6        | PASS   |
| mode-switch-invariants.js             | 8/8        | PASS   |
| pagination-invariants.js              | 7/7        | PASS   |
| rpc-bridge-invariants.js              | 7/7        | PASS   |
| ui-bulk-invariants.js                 | 9/9        | PASS   |
| ui-interaction-invariants.js          | 19/19      | PASS   |
| ui-navigation-invariants.js           | 12/12      | PASS   |

**Coverage highlights of the NEW `about-links-invariants.js`:** pins the full `openAboutLink` pipeline end-to-end — fallback URL via bridge, cached-remote-link override without blocking, `http` cached links ignored (https enforced), corrupted-JSON local cache safety, tip-vs-website supporter prompt arming, background fetch success/failure isolation, and the full `pywebview`-bridge fallback chain (chrome.webview → pywebview.api → window.open).

**Previously identified blind spots (still valid, tracked):**
- `mode-switch-invariants.js` pywebview stub returns `{ok:true}` without `details`, so the harness cannot see the `syncQuickViewMenuValues()` localStorage-stomp that reports "clip details revert on Compact→Standard" — the bug has been live-confirmed by the user; proposed fix in `ui/js/settings/quick-view-menu.js` lines 325–347 remains **NOT applied** (needs product decision; the bug is cosmetic-only, not data-loss).
- Escape-hierarchy audit (Layer-1 transient sweep) remains analysis-only at the user's direction.

---

## 4. Edge Case & Stress Results

**Stress/edge suite (`StressAndEdgeTests.cs`) — all PASS against real SQLite files:**

| Scenario | Result |
|----------|--------|
| 50× same-content rapid burst (screenshot tool simulation) | Dedupes to 1 row, IDs stable throughout |
| 100 distinct clips inserted back-to-back (zero sleep) | All 100 preserved, newest-first order intact, zero duplicates |
| Bump-oldest-after-churn | Existing row reused (no duplicate), freshness order respected |
| **1 MB text payload** with needle inside | Stored, FTS-searchable, retrievable with exact id match |
| 2000-line file-drop import simulation | Imported cleanly (0 skipped, 0 dupes), paginated read returns the search-engine's consistent clamped max (500) |
| Long-but-legitimate URL (~1600 chars) | Preserved by `UrlCleaner.CleanUrl`, no corruption |
| WAL durability under simulated crash (no checkpoint) | Row survives clean reopen and re-read via new `DatabaseService` |
| Two parallel isolated test DBs | Zero cross-pollution between instances |

**Edge findings worth noting for users:**
- `SearchConstants.MaxClampedLimit = 500` — the search engine deliberately clamps any request to 500 rows; anything larger must page via `offset`. This is a **designed** performance guard, not a bug.
- Preview-stomping / settings reconciliation bug (clip-details revert) remains the **one known user-visible issue**, tracked with a proposed fix in `quick-view-menu.js`.

---

## 5. Issues & Fixes Applied

### 5.1 Regression found: admin-disabled about-links now open defaults (REGRESSION, fix deferred)
- **Pre-refactor behaviour:** if a remote `links.json` set `""` for a kind, that click was intentionally **inert** (admin-disabled button, nothing opens).
- **Post-refactor (`f29346c`):** the `isDisabled` check was dropped. An admin-disabled link now silently falls back to the **default URL** and opens it.
- **Impact:** cosmetic / minor-experience only (no security, no data loss, no crash). The owner's remote links file currently doesn't use the `""` disable convention, so no user is affected today.
- **Why no code change:** this is a product decision, not an obvious omission — the "instant open" refactor simplified the flow; restoring `isDisabled` is a one-line revert inside `openAboutLink`. **Deferred rather than fixed** because flipping behavior invisibly during a verification mission is worse than documenting it.
- **Mitigation shipped:** the new `about-links-invariants.js` harness *documents* the shipped behavior in its header and pins all nine other invariants so nothing else regresses while a decision is pending.

### 5.2 Config mismatch: `dualclip_remote_links` default is `'[]'` (array) but the code always stores a JSON object
- A cosmetic inconsistency — `openAboutLink` never reads the value as an array; defaults are never consulted for this key.
- Risk of a future maintainer assuming array shape. One-line fix: change `def: '[]'` → `def: '{}'` in `ui/js/core/settings-defaults.js:110`. **Deferred with a note; low priority.**

### 5.3 No fixes were forced into production code in this mission
The verification revealed no test-blocking defects. All shipped fixes were additive tests/harnesses:
- New `DualClip.Tests/js-harness/about-links-invariants.js` (9 invariants, first-run green).
- New `DualClip.Tests/OpenExternalUrlGuardTests.cs` (4 guard facts, first-run green).
- New `DualClip.Tests/StressAndEdgeTests.cs` (8 stress/edge facts, first-run green).
Total net-new tests: **21 executions across 3 files**, all green.

---

## 6. Final Recommendation: **RELEASE-READY (Current Scope)**

**Sign-off:** The automated evidence supports a green light for the current scoped feature set. Test infrastructure is unusual for a solo project — real behavioral coverage against real SQLite, real JS executed in Node, adversarial sub-system tests, and an RPC contract drift-guard in BOTH directions.

**Recommended next steps (priority order):**
1. **Decide** whether "admin-disabled about-links" is still a supported feature; either restore the `isDisabled` guard in `ui/js/settings/settings-shortcuts.js` or remove the concept from the remote links spec. Flip the pinned harness assertions if the guard returns.
2. **Apply** the quick-view-menu preserve-guard fix (one-line, in `ui/js/settings/quick-view-menu.js` ~line 325–347) to eliminate the clip-details revert; extend `mode-switch-invariants.js` with a `details`-returning stub so the bug cannot come back silently.
3. Change `dualclip_remote_links` default from `'[]'` → `'{}'` in `settings-defaults.js:110`.
4. For public release of the Main repo: run the agreed squash plan before pushing public (Main's git history contains `C:\Users\Maaz\Documents\AgentSkills\…` strings in old commits; the tip itself is clean).
5. Run `scripts/check-docs-freshness.ps1` after any doc edits (was passing clean pre-mission).
