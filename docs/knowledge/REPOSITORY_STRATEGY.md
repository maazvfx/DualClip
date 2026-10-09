# DualClip Repository Architecture & Dual-Repo Strategy

## Overview for AI Agents & Developers

DualClip uses a **2-Stage Dual-Repository Strategy** on GitHub to separate development/experimental history from clean, professional production releases.

---

## 🏛️ The Two Repositories

### 1. 🔒 `maazvfx/DualClip-Dev` (Private Development & Vault Repository)
- **Visibility**: Strictly **Private**.
- **Purpose**:
  - Contains the **full, unabridged git history**, all milestone iterations, audit trails, and experimental branches.
  - Serves as the **master knowledge vault** storing legacy notes, detailed bug investigations, prompt handoffs (`docs/prompt.md`), audit archives (`docs/archive/`), and historical backups.
  - Acts as the safety net: nothing is ever permanently discarded or squashed here.

### 2. 🚀 `maazvfx/DualClip` (Curated Production / Public Repository)
- **Visibility**: Main repository.
- **Purpose**:
  - Serves as the **clean, flattened, professional release repository**.
  - Contains only active, production-ready code, live UI assets, and official user/architecture documentation (`docs/wiki/` and `docs/knowledge/`).
  - Contains **zero build artifacts, zero binaries (`*.exe`, `*.zip`, `dist/`), and zero local editor/agent configs** (`.obsidian`, `.freebuff`, `.cursor`, `.vscode`).

---

## 🔄 Workflow for AI Agents

1. **Daily Development & Experiments**:
   - All code edits, commits, and intermediate task milestones are pushed to `dev`:
     ```bash
     git push dev master
     ```
2. **Curated Milestone & Release Publishing**:
   - When a major milestone is tested, verified, and ready for release, the clean state can be published to `origin` (`DualClip`):
     ```bash
     git push origin master
     ```
3. **Safety Guarantee**:
   - Never worry about losing context or past work: if a past function, design idea, or audit report is needed, it is always preserved in `DualClip-Dev`.
