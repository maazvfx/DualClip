# Agent Skills Catalog — Evaluation & Recommendation

**Date**: 2026-10-05
**Scope**: 9 skills in `C:\Users\Maaz\Documents\AgentSkills\` + 4 named skills in `C:\Users\Maaz\Documents\DualClip_agents_backup\skills\`
**Method**: read every `SKILL.md`, then ground each checklist against the actual repo (WebView2 settings in [MainForm.cs](../../MainForm.cs), SQLite init in [DatabaseService.cs](../../Services/DatabaseService.cs), existing test suite in [DualClip.Tests](../../DualClip.Tests), packaging in [installer/DualClip.iss](../../installer/DualClip.iss)).

---

## 1. Verdict Summary

| Skill | Decision | One-line reason |
|---|---|---|
| `frontend-backend-contract-check` | **ADOPT (top)** | Highest-risk seam in the app; ~1,800-line JSON-RPC dispatcher + 194-line JS contract file with no automated parity gate today. |
| `memory-leak-and-disposable-audit` | **ADOPT (top)** | `ClipboardListener` owns a hidden NativeWindow + `AddClipboardFormatListener`; a leak here silently kills capture. Non-obvious, high blast radius. |
| `webview2-security-audit` | **ADOPT (top, but rewrite)** | The threat model is real (clipboard content is attacker-controlled), but 80% of the checklist is already satisfied — keep only the unchecked items. |
| `installer-and-pre-release-orchestrator` | **ADOPT as release gate** | Version string lives in 3 places (`csproj`, `.iss`, `ui/index.html`) and drifts silently. Highest cheap-win in packaging. |
| `ghost-surface-audit` | **MERGE** into contract check | Same scan surface (RPC handlers + settings keys); the settings half is not covered elsewhere. |
| `dead-code-and-asset-cleaner` | **MERGE** into ghost-surface | Fully subsumed; no independent value. |
| `temp-dev-marker-hunt` | **MERGE** into release gate | 10-line grep; not worth its own skill slot. |
| `privacy-and-vault-gate` | **Slim & defer** | Log-redaction half is cheap and valid; the vault/DPAPI half describes a feature DualClip does not have. |
| `sqlite-production-readiness` | **SKIP** | Every pragma it demands is already set; indexes/limits are already covered by unit tests. |
| `dualclip-workflow` | **SKIP (superseded)** | Describes a docs/knowledge pipeline and `scripts/*.ps1` that no longer exist in the tree. |
| `systematic-debugging` | **KEEP (adopt)** | Only skill with a durable process payoff; stack-specific (WinForms + WebView2 + SQLite). |
| `pre-release-review` | **KEEP, but merge** | Overlaps the orchestrator; keep the 5-axis review, drop the duplicate checklist. |
| `gsap-web-animation` / `agent-motion-graphics` | **SKIP for app; scope to `promo/`** | No GSAP anywhere in `ui/`; the only Remotion/React/Tailwind code is the isolated `promo/` video project. |

**Net result: 13 candidates → 5 skills, 4 of them rewritten.**

---

## 2. Top Priority Skills (grounded)

### 2.1 `frontend-backend-contract-check` — highest ROI
The dispatcher in [MainForm.RpcDispatch.cs](../../MainForm.RpcDispatch.cs) is ~1,800 lines of `case "..."` string matching; the JS side is [ui/js/core/rpc-contracts.js](../../ui/js/core/rpc-contracts.js) (194 lines). [RpcContractInvariantTests.cs](../../DualClip.Tests/RpcContractInvariantTests.cs) already scans all `MainForm*.cs` partials, but it is a *textual* invariant test, not a parity test. A single renamed `case` string produces a silent no-op at runtime, not a build error.

**Keep from the skill**: the action-string ↔ `case` mapping check, the camelCase/PascalCase payload check, and the nullability/missing-key check.
**Change**: make it a *generator/assertion* rather than a human checklist — emit the action list from C# and diff against the JS contract file. Human checklists do not survive 1,800-line dispatchers.
**Merge in**: the UI↔settings half of `ghost-surface-audit` (every `Settings` key in the model must have a control, and vice versa) — [ui/js/core/settings-defaults.js](../../ui/js/core/settings-defaults.js) vs `AppSettings`.

### 2.2 `memory-leak-and-disposable-audit` — highest blast radius
[Services/ClipboardListener.cs](../../Services/ClipboardListener.cs) creates a hidden form/`NativeWindow`, calls `AddClipboardFormatListener(_window.Handle)`, and pairs it with `RemoveClipboardFormatListener` on pause (lines ~303–314). Hot paths that allocate bitmaps/GDI objects for clipboard previews also exist. Failure mode is a *quiet* one: capture stops, no crash, no log. This is exactly the class of bug the checklist is good at, and exactly the class the 238-test suite cannot catch.

**Keep**: Win32 listener add/remove pairing, hidden-window lifetime, `async void` restriction, bitmap/LOH release, timer disposal.
**Change**: add a concrete named-check list for this repo (`ClipboardListener` pause/resume symmetry, tray icon re-creation on Explorer restart, preview bitmap disposal in [preview-lightbox.js](../../ui/js/overlays/preview-lightbox.js)) — the STATE.md milestone about a "lightbox listener leak" is proof this keeps happening.

### 2.3 `webview2-security-audit` — adopt a trimmed version
Already correctly configured in [MainForm.cs:1279-1365](../../MainForm.cs): context menus off, autofill off, password autosave off, `AreDevToolsEnabled = false`, `PermissionRequested` handler, `NewWindowRequested` handler, and virtual-host mappings (`images.example`, `appassets.example`) instead of `file://`. That is most of the skill's checklist, already green.

**Keep only**: (a) navigation boundary — confirm no code path can `Navigate()` to an external origin; (b) postMessage input validation per action (arity/type/bounds); (c) `escapeHtml` discipline — [ui/js/core/namespace.js:481](../../ui/js/core/namespace.js) defines the helper, the audit should grep for every `innerHTML` sink that does not use it.
**Delete**: autofill/devtools/context-menu checks (or keep one line asserting they are still off, as regression guards rather than audit steps).

### 2.4 `installer-and-pre-release-orchestrator` — release gate
Real, currently-unverified drift: `<Version>1.0.0</Version>` in [DualClip.csproj:12](../../DualClip.csproj), `#define MyAppVersion "1.0.0"` in [installer/DualClip.iss:8](../../installer/DualClip.iss), and a hardcoded `1.0.0` in the Settings UI markup. Three sources, zero enforcement. The skill's 9-step ordering is overkill; what matters is: build `-warnaserror` → `node --check` sweep → test count recorded → version parity asserted → `taskkill` before build → installer produced.

**Merge in** `temp-dev-marker-hunt` as step 2 — grep `TODO|FIXME|HACK|console.log|Debug.WriteLine` (currently 0 hits in app source, which is worth asserting, not assuming) and confirm the `DemoDataSeeder` CLI hooks in [Program.cs:63-75](../../Program.cs) are not reachable from the installed binary's normal UI path.

---

## 3. Consolidation Map

```
frontend-backend-contract-check ──┐
ghost-surface-audit ──────────────┼──► ipc-and-settings-contract   (ADOPT)
(dead-code-and-asset-cleaner) ────┘        [dropped as separate]

installer-and-pre-release-orchestrator ──┐
pre-release-review ─────────────────────┼──► release-gate            (ADOPT)
temp-dev-marker-hunt ───────────────────┘        [5-axis review kept]

webview2-security-audit ──► trimmed into security posture section of code-reviewer-equivalent
privacy-and-vault-gate ───► log-redaction + secret-scan bullets only
sqlite-production-readiness ──► DROP (already satisfied)
dualclip-workflow ──────────► DROP (describes deleted scripts/ + docs/knowledge pipeline)
```

---

## 4. Skip List (with reasons)

- **`sqlite-production-readiness`** — [DatabaseService.cs:146](../../Services/DatabaseService.cs) already sets `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`, `auto_vacuum=INCREMENTAL`. Search performance is already covered by `SearchTokenizationTests`, `TagAndNicknameQueryTests`, `GroupCountPaginationTests`. Zero marginal value, real context cost.
- **`dualclip-workflow`** — stale. It mandates `scripts/build-knowledge.ps1` and `docs/knowledge/` generation; both the scripts and the generated docs were removed in this working tree. Adopting it would reintroduce a broken instruction.
- **`gsap-web-animation`** — zero GSAP references in `ui/`. Pure overhead.
- **`agent-motion-graphics`** — only relevant to `promo/` (Remotion 4 + React 19 + Tailwind). If kept, scope it explicitly to that directory so it never fires on app work.
- **`privacy-and-vault-gate` (vault half)** — DualClip has no encrypted vault, no DPAPI usage, no credential storage. Auditing a nonexistent feature is noise. Keep only the two real bullets: never log raw clipboard text, and scan for committed secrets (note `.gitignore` currently allow-lists `.agents/` and `docs/reviews/`).

---

## 5. Placement & Prompting

**Use `.agents/skills/<name>/SKILL.md` — not `.gemini/skills/`.** Reasons:
1. `.agents/skills/` already exists in git history and was deliberately re-tracked in `4dc8231` ("docs: track skills in git").
2. `.gemini/skills/` ties the repo to one vendor; the repo's rules are vendor-neutral ([AGENTS.md](../../AGENTS.md)).
3. **Decision (user-confirmed)**: approved skills go in `.agents/skills/`. The pending uncommitted deletions of `.agents/skills/code-reviewer/` and `.agents/skills/project-cleanup/` are treated as intentional removals — do not restore those two, and write the new skills alongside them.

**Structure per skill** (keep each under ~80 lines — the long ones in the catalog are the ones agents skip):
```
.agents/skills/<name>/SKILL.md
  frontmatter: name + one-sentence description with explicit trigger phrases
  0. When to use / when NOT to use      <- the highest-value section; missing in all 13 candidates
  1. Repo-specific checks (file:line pointers)
  2. Commands to run (build/test/node --check)
  3. Output format + where to file findings (docs/reviews/, one line in docs/STATE.md §2)
```

**Prompting guidance** (add to [AGENTS.md](../../AGENTS.md) rule 4 or as rule 8):
- Skills are *checklists for judgment*, not substitutes for tests. Anything mechanically checkable belongs in `DualClip.Tests/`, not in a skill.
- A skill that requires re-reading a checklist of already-passing items is overhead. Each adopted skill must reference at least one real file path and one real defect class found in `docs/reviews/`.
- Never invoke the release gate without an explicit user request ("build the installer", "ship a release").

---

## 6. Blocking Issue Found While Verifying

`DualClip.Tests/AutoTierInvariantTests.cs:44`, `FormatDetectionInvariantTests.cs:24`, `GroupCountPaginationTests.cs:47`, and `ModeSwitchInvariantTests.cs:35` all `Assert.True(File.Exists(...))` on `DualClip.Tests/js-harness/*.js` — and those six harness files are **deleted in this working tree**. `dotnet test` will fail on those fixtures until the harnesses are restored or the tests are updated. This is independent of the skills question but blocks any clean baseline to measure skills against.