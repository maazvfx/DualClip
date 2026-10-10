# DualClip — System State & Active Dashboard

> **Rule**: Keep under 40 lines. Real architectural reference and UX contracts live in [`docs/wiki/INDEX.md`](wiki/INDEX.md). Minor edits stay in Git commits.

---

## 1. Active Focus & Working Status
- **Current Status**: All Dead-Code Cleanup & Performance Hardening phases complete.
- **Verification Baseline**: 
  - .NET XUnit backend suites: **280/280 passing** (100% green, 0 failures).
  - Node.js invariant harnesses: **9/9 suites passing** (88+ assertions green).
  - Builds: Clean with 0 warnings, 0 errors across Debug and Release.
  - Active execution: `DualClip.exe` running Release build.
- **Primary Source of Truth**: [`docs/wiki/INDEX.md`](wiki/INDEX.md) and [`docs/plans/phase-2-3-cleanup.md`](plans/phase-2-3-cleanup.md)

---

## 2. Future Backlog (v1.1+)
- [ ] Preview Dialog Full-Size / Maximize Mode toggle.
- [ ] System Tray Settings Menu Direct Access.
- [ ] In-App Feedback & Diagnostics Package Export.
- [ ] Cloud & Local LAN multi-device sync (see `docs/plans/IDEAS.md`).

---

## 3. Milestones
- **2026-10-10 | Dead-Code Cleanup & Stability Hardening**: Successfully completed Phase 0 disk/git compression, Phase 1 dead code pruning, Phase 2-3 bridge fixes, search index completion, and window resize handle fix. All 280 tests verified passing.
- **2026-10-09 | v1.0.0 Release**: Sanitized repository into dual-repo architecture (Curated public release on `DualClip`, private developer vault on `DualClip-Dev`). Single-file portable package and installer built.
