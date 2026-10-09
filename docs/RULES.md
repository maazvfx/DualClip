# DualClip — Core Rules & Standards

## 🚨 Core Guardrails & Execution

1. 🛑 **App Launch & Build Hygiene**:
   - Never launch `DualClip.exe` automatically unless explicitly requested.
   - Always terminate running instances (`taskkill /F /IM DualClip.exe 2>$null`) before compiling C#.
2. 🛡️ **Zero Warnings & Fast Builds**:
   - C# builds must compile with 0 errors and 0 warnings (`-warnaserror`).
   - Use `dotnet build --no-restore` for fast sub-second builds.
   - JavaScript code must pass syntax check (`node --check`).
3. 🎨 **UI Protection (Ask-First)**:
   - During backend, service, or bug-fix tasks, NEVER silently modify UI styles, colors, borders, margins, or typography without asking first.
4. 🎯 **Surgical Changes & Secondary Issues**:
   - Focus strictly on the assigned task.
   - If secondary bugs or side issues are encountered:
     - If trivial and directly blocking the fix, resolve it cleanly within the same pass.
     - If distinct or non-blocking, inform the user immediately and note it down in `docs/QUEUE.md` or `docs/notes/` for later instead of expanding scope silently.
5. 📋 **Mandatory Planning Gate (>6 Files)**:
   - If a change spans >6 files or requires active codebase exploration, write a step-by-step implementation plan in `docs/plans/<task>.md` before touching code.
6. ⚡ **Targeted Reading**:
   - Inspect specific functions or line ranges (`file:lines`) instead of loading giant multi-thousand-line files into context.
7. 🧪 **Targeted & Release-Only Testing Protocol**:
   - **No Full Test Suite Runs**: Never run the full test suite during routine development loops to avoid slow build times. Full suite runs are reserved strictly for final release validation.
   - **Subsystem-Targeted Verification**: When implementing or fixing a feature/bug, run only the single targeted test file (C# xUnit or JS harness) directly relevant to that subsystem.
   - **Catch & Auto-Fix**: Run the targeted test immediately upon completion to catch regressions early and resolve them automatically before finalizing.


---

## 💾 Autonomous Git Management

1. 🤖 **Zero Manual Git for the User**:
   - The AI manages Git automatically in the background (local commits only; never `git push` unless explicitly asked).
   - The user does not need to handle branching, commits, or staging.
2. 📦 **Milestone & Task Snapshots**:
   - Auto-commit at the end of each completed task, batch, or prototype iteration once verified.
   - Avoid noisy micro-commits on every single-line edit; batch logical changes cleanly.
3. 🛡️ **Destructive Action Protection**:
   - Never run destructive commands (`git reset --hard` or `git checkout --`) without explicit user permission.
   - Always prefer forward fixes over discarding working state.

---

## 🖥️ Desktop & WebView2 Architecture

1. 💡 **WinForms UI Thread Safety**:
   - DualClip is a WinForms application. Always dispatch UI mutations to the WinForms UI thread using `Control.Invoke` or `Control.BeginInvoke` on `MainForm` or target controls (never WPF `Dispatcher`).
2. 🔄 **Frontend Live Reload Sync**:
   - WebView2 serves frontend assets from the build output directory (`bin\...`).
   - When modifying HTML, CSS, or JS, ensure files are synced to the build output directory so that pressing `Ctrl+R` instantly updates the running app without a full C# rebuild.

---

## 🧪 Sandbox & Reference Codebase

1. 🧪 **Laboratory First (`sandbox_app/`)**:
   - Test complex native Windows clipboard hooks, interop, or database routines in isolation before integrating into production.
2. 📂 **Read-Only Reference (`backup/`)**:
   - Inspect `backup/` strictly as a read-only guide for syntax and logic. Write new code fresh without copy-pasting legacy debt.
3. 🎨 **Optional UI Previews (`prototypes/`)**:
   - Use `prototypes/` for quick standalone previews or throwaway component experiments when explicitly needed.

---

## 📦 Task Batching & Queue Policy

1. 🧠 **AI-Managed Batching (`docs/QUEUE.md`)**:
   - Queue small tasks, cosmetic tweaks, or non-blocking issues in `docs/QUEUE.md`.
   - Autonomously batch and solve related items in a single pass to save time, roundtrips, and context.

---

## 📁 Workspace & Documentation Hygiene

1. 🧹 **Clean Root Standard**:
   - Root is strictly for source code and project configs. All docs and plans live under `docs/`.
2. 📄 **On-Demand Documentation Only**:
   - Do NOT edit documentation files (`CODEMAP.md`, `STATE.md`, `RULES.md`) during normal coding loops unless explicitly requested on demand.

---

## 👥 Multi-Agent & Verification Safety

1. 🛑 **Collision Halt**:
   - If unexpected external edits, uncommitted changes, or file conflicts are detected, stop immediately and notify the user before modifying.
2. 🔍 **Verify Before Reporting**:
   - Always verify code state and findings with live files and real commands rather than relying on memory or assumptions.
3. 🔄 **External Agent / Reviewer Report Protocol**:
   - When the user pastes reports or findings from peer agents (OpenCode, Freebuff, Web AI), never blindly accept or apply code edits.
   - Inspect the codebase at the cited `file:line` to classify findings (Valid Bug vs False Positive/Outdated).
   - Provide a 1–2 sentence assessment with recommendations before implementing any fixes.




