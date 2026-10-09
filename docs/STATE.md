# DualClip — System State & Active Dashboard

> **Rule**: Keep under 40 lines. Real architectural reference and UX contracts live in [`docs/wiki/INDEX.md`](wiki/INDEX.md). Minor edits stay in Git commits.

---

## 1. Active Focus & Working Status
- **Current Status**: All core subsystems stable and verified.
- **Verification Baseline**: 
  - .NET XUnit backend suites: **268/268 passing** (0 failures).
  - Node.js invariant harnesses: **9/9 suites passing** (88+ invariant assertions green).
  - Builds: Debug & Release clean with 0 warnings (`-warnaserror`).
- **Primary Source of Truth**: [`docs/wiki/INDEX.md`](wiki/INDEX.md)

---

## 2. Priority Backlog
- [ ] Preview Dialog Full-Size / Maximize Mode toggle.
- [ ] System Tray Settings Menu Direct Access.
- [ ] In-App Feedback & Diagnostics Package Export.
- [ ] Pre-release checklist: Toggle `DEV_HOT_RELOAD = false` in `ui/js/keyboard.js`.

---

## 3. Milestones
- **2026-10-09 | Karpathy LLM-Wiki Overhaul**: Consolidated all technical domain knowledge into 9 modular guides in `docs/wiki/`. Archived 20+ stale audit files. Micro-logging replaced by clean Git snapshots.
