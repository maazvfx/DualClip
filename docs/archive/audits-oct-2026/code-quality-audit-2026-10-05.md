# Code Quality Audit

**Date**: 2026-10-05
**Scope**: whole codebase — `MainForm*.cs`, `Services/`, `Models/`, `ui/js/`, `ui/css/`
**Status**: Fix status added 2026-10-06. Q1 was already fixed in `65a948b`; Q2 fixed; Q3–Q5 open.
**Method**: automated signals first, then every candidate read by hand before being reported.

---

## Summary

The codebase is in better shape than its size suggests. There is no leftover debug logging, no
TODO/FIXME markers, consistent line endings, and no SQL injection — all verified below.

Five quality problems were confirmed. One is a genuine correctness risk, not just tidiness.

| # | Issue | Severity | Status |
|---|---|---|---|
| Q1 | Import silently drops folders — return value discarded, exceptions swallowed | **High** | fixed in `65a948b` (`failedCollections`); this table was never updated |
| Q2 | `escapeHtml` defined twice with different behaviour | Medium | **fixed** — nested copy deleted, global used |
| Q3 | 172 empty `catch` blocks, no way to tell benign from dangerous | Medium | open |
| Q4 | `MainForm.cs` is 3,471 lines | Low | open — `MainForm` is now `partial`; see §5 |
| Q5 | Dead code cannot be reliably detected with current tooling | Tooling gap |

---

## Q1 — Import can silently lose folders (High)

This is the one finding that is a correctness problem rather than a smell.

**The return value is thrown away.** On the import path:

```csharp
// MainForm.cs:3161
_db.SaveCollection(finalId, cName, cPinned, cOrder, cParent);
```

The RPC path does the opposite, and checks:

```csharp
// MainForm.RpcDispatch.cs:798
bool sok = _db.SaveCollection(saveId, saveName, savePinned, saveOrder, parentId);
```

So the same operation is verified in one place and unverified in the other. `SaveCollection`
returns `false` for a folder it refuses — a reserved id, a self-parent, a parent cycle, an empty
name — and on the import path that refusal is invisible.

**The whole step is wrapped in a bare `catch { }`.** The collections block (MainForm.cs ~3086-3170)
ends in an empty catch, as does each inner guard. Any exception thrown part-way through — a
malformed entry, a database lock — aborts the rest of the folder import with nothing logged and
nothing shown.

**Combined effect:** import a package, get a success toast, and some folders are simply not there.
The user's clips still arrive, but they land in no folder, because the clip-to-folder link is
resolved against collections that were never written.

This is the same failure mode the export review just fixed on the write side — but the read side
still reports success unconditionally.

**Suggested fix:** capture the return value, count failures, and surface them in the existing
import result toast (the handler already returns `imported/deduped/skipped`). Narrow the bare catch
so it distinguishes a malformed entry (skip that entry) from a failure of the whole step (tell the
user).

---

## Q2 — `escapeHtml` exists twice, and the copies differ (Medium) — FIXED

**Fixed**: the nested copy in `ui/js/overlays/tooltips-toasts.js` is deleted; the file now uses the
canonical global from `ui/js/core/namespace.js:482`, which `index.html:1891` loads first. Both call
sites inside that closure pass clip text (`previewText`, always a string), so the divergent falsy
handling — `0` and `false` rendered as empty by the old copy — was unreachable there anyway. A comment
at the deletion site records why the shadow existed and why the global is safe to rely on.

Original finding, for the record:

Two definitions, both live:

```js
// ui/js/core/namespace.js:481  — global, null-safe
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/&/g,'&amp;') /* ...5 chars... */;
}

// ui/js/overlays/tooltips-toasts.js:303  — private, inside a closure
function escapeHtml(str) {
  if (!str) return '';          // <-- any falsy value, so 0 and false also become ''
  return String(str).replace(/* ... */);
}
```

The two differ in behaviour: the nested copy maps `0` and `false` to an empty string, the global one
preserves them. A caller that gets fixed later leaves the other one silently behind.

**Why this matters more than usual here:** a duplicated escaper with divergent behaviour is the
exact shape of the sidebar tag bug fixed earlier today — a tag containing an apostrophe reached an
inline handler as valid JavaScript. That class of defect is found by noticing there are two
escapers and asking why.

**Suggested fix:** delete the nested copy and use the global. If the closure genuinely needs
isolation, extract one shared helper into `namespace.js` and import it in both places.

---

## Q3 — 172 empty `catch` blocks, with no distinction between benign and dangerous (Medium)

Distribution:

| File | Count |
|---|---|
| `MainForm.cs` | 74 |
| `Services/DatabaseService.Backup.cs` | 31 |
| `Services/ClipboardListener.cs` | 17 |
| `Services/DatabaseService.cs` | 12 |
| `Services/AppIconStore.cs` | 9 |
| `Services/TrayService.cs` | 8 |
| everything else | 21 |

Most are defensible. Cleanup of a temp file, deleting a stale `-wal`/`-shm` sidecar, or ignoring a
failed icon extraction genuinely should not stop the caller. That is normal and fine.

The problem is that **nothing marks the difference**. A catch that ignores "the temp file was
already gone" looks identical to one that ignores "the backup write failed". There is no logging, no
counter, no comment. At 172 occurrences, a reviewer cannot tell which ones are load-bearing.

This is not an argument to add a log line to all of them — that would be noise. It is an argument
for making the dangerous ones visible. The candidates worth an explicit comment or a counter are in
`DatabaseService.Backup.cs` (backup writes and file moves, where a silent failure means the user
believes they have a safety net that does not exist) and the import/export step in `MainForm.cs`
(covered by Q1).

**Suggested fix:** do not sweep all 172. Review the ~31 in `DatabaseService.Backup.cs` first, and
comment the ones where a failure means data is unprotected. Leave the rest alone.

---

## Q4 — `MainForm.cs` has grown to 3,471 lines (Low)

It holds the RPC dispatch (already partially extracted once into `MainForm.RpcDispatch.cs`), the
window/shell lifecycle, the drag-and-drop handlers, and the import/export package code — plus 74 of
the empty catches from Q3.

Not urgent, and the earlier extraction is evidence the team already recognises it. Worth noting only
because import/export (Q1) is a self-contained concern that would extract cleanly, the same way the
dispatch did.

---

## Q5 — Dead code cannot be reliably detected right now (Tooling gap)

Recording this because it is a limit on what this audit could cover, and because the natural next
step fails badly.

**The attempt:** list every `window.X =` export, then search for references. The first run flagged
**280 symbols as unused** — including `escapeHtml`, `getSetting`, `renderSidebarNav` and
`toggleSidebarLayout`, all of which are demonstrably in active use.

**Why it failed:** the search matched the literal string `window.escapeHtml`, but callers use the
bare identifier `escapeHtml(...)`. Inline `onclick="..."` handlers in `ui/index.html` reference
bare names too. Every symbol looked unused. **Those 280 results were discarded, not reported.**

The real obstacles:

- `ripgrep` is broken in this environment (per `docs/knowledge/INDEX.md`); `grep` is the only tool
- The JS invariant harnesses (`DualClip.Tests/js-harness/*.js`) have been deleted, and with them any
  static reference checking
- No linter or bundler is configured in the repo

**Suggested fix:** if dead-code detection is wanted, add a linter (`eslint` with `no-unused-vars`)
rather than attempting it with `grep`. Until then, treat any dead-code claim as unverified.

---

## Checked and found clean

Each verified directly, not assumed:

- **Debug logging** — 2 occurrences of `console.log`/`console.debug` across all of `ui/js`. Both are
  deliberate diagnostics. Good discipline.
- **`TODO` / `FIXME` / `HACK`** — zero across `ui/js`, `Services/`, `MainForm*.cs`, `Models/`.
- **Line endings** — every file checked is internally consistent (all CRLF, no mixed endings). The
  Git warnings about LF/CRLF are `.gitattributes` normalisation, not file corruption.
- **SQL injection** — every dynamic fragment in `Services/` builds generated parameter names only;
  all values are bound via `Parameters.AddWithValue`. No injection found.
- **RPC message ids** — `bridge.js` derives ids from `Date.now()` and increments; no collision path.

---

## Recommended order

1. **Q1** — the only finding where users lose something without being told.
2. **Q2** — small, and it removes a known trap.
3. **Q3** — review the backup-file catches only; leave the benign majority alone.
4. **Q4, Q5** — maintenance, no urgency.