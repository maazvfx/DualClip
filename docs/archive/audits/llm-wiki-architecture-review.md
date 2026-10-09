# Review: Karpathy LLM Wiki Alignment & Architecture Review

* **Date**: 2026-10-05
* **Reviewer**: Peer Agent (External Reviewer)
* **Status**: Resolved / Implemented

---

## 1. Summary of Feedback
The reviewer evaluated the initial handoff implementation against Karpathy's 3-layer LLM Wiki specification:
1. **Strengths Identified**:
   - `docs/STATE.md` handoff board (Active Focus -> Reviewer Findings -> Batched Tweaks -> Recently Resolved) capped at 60 lines.
   - Read-first / update-last discipline with proof of verification.
   - 8–10 item batching policy for micro-tweaks to prevent noise.
2. **Gaps & Criticisms**:
   - **Compounding Knowledge Layer**: Removing `ARCHITECTURE.md` and `CODEMAP.md` stripped the deep architectural knowledge that agents need to route symbols without searching, and broke links in `README.md`.
   - **Linter Missing**: Removing `check-docs-freshness.ps1` eliminated the automated "Lint" check from Karpathy's model.
   - **Git Tracking**: `docs/` being completely gitignored meant handoff state didn't follow agents into git worktrees or branches.

---

## 2. Actions Taken & Verification
1. **Consolidated Knowledge Layer**: Placed [`ARCHITECTURE.md`](../knowledge/ARCHITECTURE.md) and [`CODEMAP.md`](../knowledge/CODEMAP.md) into `docs/knowledge/`, keeping the repository root clutter-free while preserving the entire architectural knowledge base.
2. **Fixed README Documentation Links**: Updated `README.md` to point directly to `docs/knowledge/ARCHITECTURE.md` and `docs/knowledge/CODEMAP.md`, eliminating dead links.
3. **Restored & Updated Linter**: Brought back [`scripts/check-docs-freshness.ps1`](../../scripts/check-docs-freshness.ps1) and pointed its CODEMAP check to `docs/knowledge/CODEMAP.md`.
4. **Enabled Git Tracking for Knowledge**: Updated [`.gitignore`](../../.gitignore) so `docs/STATE.md`, `docs/QUEUE.md`, `docs/DECISIONS.md`, and hand-written files in `docs/knowledge/` (`ARCHITECTURE.md`, `CODEMAP.md`, `EXTERNAL_REVIEWER_SYNC.md`), `docs/reviews/`, `docs/plans/`, and `docs/archive/` are all tracked by Git, while volatile machine-generated outputs remain local.
