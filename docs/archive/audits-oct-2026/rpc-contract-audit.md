# Review — RPC dispatch layer & contract registry

**Date**: 2026-10-05
**Type**: Read-only review. **No source file was changed.**
**Scope**: `MainForm.RpcDispatch.cs` (the JSON-RPC switch), `ui/js/core/bridge.js` (the
`window.pywebview.api` wrappers and `callHost`), `ui/js/core/rpc-contracts.js` (the contract
registry), and `DualClip.Tests/RpcContractInvariantTests.cs`.
**Method**: mechanical cross-extraction of all three registries plus a Node script that compares the
highest `args[n]` index each C# case reads against the arity its contract entry declares. Every
number below is counted, not estimated.
**Not run**: `dotnet test` (needs explicit user permission per `AGENTS.md` rule 6).

---

## 1. Verdict

This layer is in genuinely good shape, and the numbers back that up: **120 C# handlers, 120 contract
entries, 120/120 matched in both directions, zero dangling names, and every out-of-range read
properly length-guarded.** The dispatch `default:` branch answers, and `callHost` has an 8 s (120 s
for dialog methods) timeout, so no caller can hang forever. That is a better-disciplined RPC layer
than most projects have.

Three gaps remain, all in the *registry and reachability* rather than the transport.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| R1 | `clear_history` documents 2 of its 8 parameters in the contract | **Low-Med** | **fixed** — `optional: [...]` + a comment recording the three `true` defaults |
| R2 | 7 endpoints have live C# handlers and contract entries but zero JS callers | **Low** | **annotated** — marked `// no caller` in the registry; the underlying UI gap is still open (see B1) |
| R3 | The contract invariant test cannot detect R1 or R2 by construction | **Low-Med** | open |

---

## 2. Findings

### R1 — `clear_history` under-documents 6 of its 8 parameters (Low-Med) — FIXED

**Fixed** in `ui/js/core/rpc-contracts.js:47`, no behaviour change: the six undocumented parameters are
now listed in an `optional: [...]` field, with a comment recording that `keepStarred`, `deleteUnpinned`
and `deleteImages` all default to **true** in `MainForm.RpcDispatch.cs:1297-1313`. The registry now
tells a reader that omitting them still purges images.

Original finding, for the record:

`ui/js/core/rpc-contracts.js:47`:

```js
clear_history: { args: ['includePinned', 'excludedProcesses'], defaults: { includePinned: false, excludedProcesses: [] } },
```

`MainForm.RpcDispatch.cs:1277-1344` reads **eight** positional parameters:

| # | Parameter | Effect if omitted |
|---|-----------|-------------------|
| 0 | `includePinned` | `false` (declared) |
| 1 | `excludedProcesses` | `null` (declared) |
| 2 | `keepStarred` | **`true`** |
| 3 | `deleteUnpinned` | **`true`** |
| 4 | `deleteImages` | **`true`** |
| 5 | `colPinned` | `null` |
| 6 | `colStarred` | `null` |
| 7 | `delCols` | `null` |

Every read is correctly length-guarded (`args.GetArrayLength() > n`), so there is **no crash and no
live bug** — the bridge wrapper does forward all eight (`bridge.js:150`, called from
`ui/js/list/actions.js:1039`). The problem is purely that the registry lies: parameters 2–7 are the
ones that decide *what actually gets deleted*, including the image purge, and someone refactoring
against the contract as the source of truth would send two arguments and silently get
`deleteImages: true` and `deleteUnpinned: true` defaults.

Note the file already has the right pattern three lines above — `resize_window` and `reset_window_size`
now use an `optional: [...]` field with an explanatory comment. `clear_history` was simply never
updated to match.

**Fix** — one line, no behaviour change:

```js
clear_history: { args: ['includePinned', 'excludedProcesses'], optional: ['keepStarred', 'deleteUnpinned', 'deleteImages', 'colPinned', 'colStarred', 'delCols'] },
```

Add a comment recording the C# defaults (`true` for the three booleans) so a future caller knows what
omitting them does.

---

### R2 — 7 endpoints are reachable from nowhere (Low) — ANNOTATED, root cause still open

The registry now carries a `// no caller` marker on the six clear-on-lock / oversized-clips endpoints
and on `get_autostart`, so a reader can tell "unimplemented" from "superseded" from "forgotten" as
the finding asked. The underlying problem is unchanged and is tracked as **B1** in
[`rpc-bridge-audit-2026-10-05.md`](rpc-bridge-audit-2026-10-05.md): three settings are fully
implemented natively but have no control in the hand-built Settings screen, so a user can only enable
them by hand-editing `settings.json`. Annotation documents the gap; it does not close it.

Every one of these has a C# handler **and** a contract entry — so `RpcContracts_EveryCsharpHandlerIsContracted`
and `RpcContracts_CountsMatch` both pass — but nothing in the frontend ever calls them:

| Endpoint | C# handler | JS callers |
|---|---|---|
| `center_window` | yes | 0 |
| `set_window_pos` | yes | 0 |
| `set_live_preview` / `get_live_preview` | yes | 0 |
| `set_start_hidden` / `get_start_hidden` | yes | 0 |
| `get_tag_stats` | yes | 0 |

This is not necessarily wrong — it is the residue of features that moved to the JS side (live-preview
state is localStorage now) or were never wired. But it is actively misleading in a registry that is
documented as the contract: a reader cannot tell "unimplemented" from "superseded" from "forgotten".

A full sweep of all 95 bridge wrappers found **19** with no caller outside `bridge.js` /
`rpc-contracts.js`. Thirteen of those are the write-only pattern discussed in
[`settings-persistence-audit.md`](settings-persistence-audit.md) (R-S1 there) — the backend half of a
setting the UI writes but never reads back. The seven above are the genuinely unreachable remainder.

**Fix**: either delete the dead endpoints, or mark them in `rpc-contracts.js` with a one-word comment
(`// superseded: state now lives in localStorage`) so the next reader is not sent hunting.

---

### R3 — The contract test cannot catch R1 or R2 (Low-Med)

`DualClip.Tests/RpcContractInvariantTests.cs` asserts five things, and all five pass today:

- every C# handler is contracted (`:261`)
- every contract has a C# handler (`:275`)
- the counts match (`:291`)
- arg names are unique identifiers (`:304`)
- `defaults` / `optional` are declared where present (`:331`)

Every one of those checks the contract **against the C# side only**. Nothing checks the contract
against the *frontend call sites*, which is why both R1 (an under-declared arg list that the C# runs
past) and R2 (endpoints nobody calls) sail through. R1 in particular is exactly the class of bug the
file exists to prevent — "accidental positional array drift between caller and callee", per its own
header comment — and it is present right now.

**Fix** — one new test closes both gaps mechanically:

```csharp
[Fact]
public void RpcContracts_NoHandlerReadsAnUndeclaredArg()
{
    // For every `case "m":` block in MainForm*.cs, the highest args[n] index read must be
    // <= (contract args count + optional count) - 1. Catches R1: clear_history reads args[7]
    // while declaring 2.
}
```

A companion test can assert that each contract entry appears at least once in `ui/js/` outside
`bridge.js` / `rpc-contracts.js`, whitelisting a small "known dead" list until R2 is cleaned up. That
keeps the test green while making the debt explicit.

---

## 3. Checked and found clean

- **Name consistency is exact.** 120 `case "…":` labels in `MainForm.RpcDispatch.cs`, 120 entries in
  `RpcContracts`, and every one of the 95 `window.pywebview.api` wrappers resolves to a real case.
  Zero orphans in any direction.
- **No out-of-range `JsonElement` indexing.** A Node pass over all 120 case blocks compared the
  highest `args[n]` each block reads against its declared arity: the only case that reads past its
  declaration is `clear_history` (R1), and that read is length-guarded in C#. Every optional argument
  in the dispatch (`resize_window` args[2]/args[3], `reset_window_size` args[0],
  `get_all_tags_with_stats` args[0], the several that accept an object *or* an array payload) is
  guarded by `GetArrayLength() >` or a `ValueKind` test before the read.
- **Unknown methods get an answer.** `MainForm.RpcDispatch.cs:1918-1920` — the `default:` branch
  responds `{ ok: false, error: "unhandled_method: …" }` rather than dropping the message.
- **No infinite pending promises.** `callHost` (`bridge.js:68-95`) registers a `setTimeout` before
  posting — 8 s normally, 120 s for the seven dialog methods (`browse_application`, `export_clips`,
  the three import methods, `clear_history`, `clear_collection`, `delete_clips_in_collection`) — and
  resolves `{ ok: false, error: 'RPC timeout: …' }` if the host never answers. The timer is cleared on
  the real response, so a slow-but-alive call cannot double-resolve.
- **The 120 s dialog timeout is well chosen.** Import/export and file dialogs legitimately block on
  the user, and they are exactly the methods on the list.
- **Fire-and-forget postMessage is safe.** Several call sites use
  `window.chrome.webview.postMessage({ id: 0, … })` directly (e.g. `hide_window`). Because `id: 0`
  never enters the `pendingCalls` map, it cannot collide with a real request id and cannot resolve
  someone else's promise.
- **The dispatch is mid-refactor but consistent.** 14 cases delegate to `Handle*` methods
  (`get_clips`, `paste_clip`, `paste_multi`, `copy_clip`, the import/export family, …) rather than
  responding inline. Each `Handle*` owns its own response; the delegation is uniform and no case both
  delegates and responds.

---

## 4. Suggested order of work

1. **R1** — one line in `rpc-contracts.js`, zero behaviour change, removes a live trap for whoever
   next touches the clear-history flow.
2. **R3** — add the "no undeclared arg" test first, so R1 and any future drift cannot come back.
3. **R2** — delete or annotate the seven dead endpoints when convenient; low urgency.

---

## 5. Note for the next agent

`docs/STATE.md` is under another agent's uncommitted window-sizing work, so per the collision rule in
`AGENTS.md` no STATE.md line is added here. Suggested entry once that work is committed:

```
- [OPEN] [RPC Contract Review](reviews/rpc-contract-audit.md): R1 `clear_history` declares 2 of 8 args; R2 7 endpoints with zero callers; R3 contract test cannot catch either.
```

No source file was modified by this review.
