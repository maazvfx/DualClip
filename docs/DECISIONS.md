# DualClip — Architectural Decision Records (ADRs)

> **Rule**: Append-only. Never rewrite or delete historical decisions. If a decision changes, add a new ADR that explicitly supersedes the older one.

---

### ADR-001: Multi-Agent Wiki Handoff & Batching Workflow
* **Date**: 2026-10-05
* **Status**: Accepted
* **Context**: Multiple AI agents (Reviewers, Critics, Managers, Fixers) collaborate across separate sessions and chat windows without manual copy-pasting of context.
* **Decision**:
  1. Use `docs/STATE.md` as the live whiteboard snapshot (under 100 lines) detailing active focus, reviewer findings, next steps, and verified results.
  2. Implement an 8–10 item batching threshold for minor cosmetic or small user tweaks to eliminate logging noise.
  3. Keep `docs/plans/` for detailed multi-step task journals, `docs/audits/` for reviews/investigations, and `docs/archive/` for completed plans and audits.
  4. Perform periodic maintenance and pruning when the active state file or archive exceeds size thresholds.
* **Consequences**: Fast agent onboarding, zero context loss between agent sessions, and clean logs without micro-entry noise.

---

### ADR-002: Tiered Milestone Testing Strategy
* **Date**: 2026-10-05
* **Status**: Accepted
* **Context**: Running full test suites on every turn is time-consuming and slows down rapid development.
* **Decision**:
  1. **Daily Development**: Never run test suites automatically. Only compile with 0 warnings (`dotnet build -warnaserror`) and check JS (`node --check`).
  2. **Milestones**: Run only targeted core/smoke tests relevant to the specific feature being completed.
  3. **Release Gate**: Run the full test suite only when preparing a major release or when explicitly requested by the user.
* **Consequences**: Faster development turnaround, zero test-induced lag, while preserving full release reliability.
