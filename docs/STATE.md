# DualClip — System State & Active Dashboard

> **Rule**: Keep under 40 lines. Real architectural reference and UX contracts live in [`docs/wiki/INDEX.md`](wiki/INDEX.md). Minor edits stay in Git commits.

---

## 1. Active Focus & Working Status
- **Current Status**: Phase 1 Dead-Code Cleanup & Performance Hardening.
- **Verification Baseline**: 
  - .NET XUnit backend suites: **280/280 passing** (0 failures).
  - Node.js invariant harnesses: **9/9 suites passing** (88+ invariant assertions green).
  - Builds: Clean with 0 warnings, 0 errors.
- **Primary Source of Truth**: [`docs/wiki/INDEX.md`](wiki/INDEX.md)

---

## 2. Future Backlog (v1.1+)
- [ ] Preview Dialog Full-Size / Maximize Mode toggle.
- [ ] System Tray Settings Menu Direct Access.
- [ ] In-App Feedback & Diagnostics Package Export.
- [ ] Cloud & Local LAN multi-device sync (see `docs/plans/IDEAS.md`).

---

## 3. Milestones
- **2026-10-09 | v1.0.0 Release**: Sanitized repository into dual-repo architecture (Curated public release on `DualClip`, private developer vault on `DualClip-Dev`). Single-file portable package and installer built.
