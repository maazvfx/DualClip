# RPC Bridge Audit — `MainForm.cs` + `MainForm.RpcDispatch.cs`

**Date**: 2026-10-05
**Scope**: the JSON-RPC boundary between the WebView2 UI and the native side — 119 methods
**Status**: Findings only. **Nothing was changed.**
**Method**: extracted every `case` label from the dispatch switch, every entry from the JS contract
registry, and diffed the two. Then traced each apparent gap back to both sides before reporting it.

---

## Summary

**The bridge is in better shape than a 119-method hand-written switch has any right to be.** The
contract registry and the dispatch switch are in *perfect* agreement — no drift in either direction.
The security and error-handling wrapper is sound. Every handler answers.

The real finding is the opposite of what I expected: **seven handlers are never called, and two of
them are the only way to reach features that are otherwise fully built and shipped.**

| # | Issue | Severity |
|---|---|---|
| B1 | 7 dead handlers; 2 back fully-implemented features with no UI control at all | Medium |
| B2 | `get_autostart` unused — the toggle trusts a local mirror, not the real OS state | Low |
| B3 | The bridge is named `pywebview`, a pywebview/python convention, in a C# app | Low |

---

## B1 — Seven handlers are never called, and two hide unreachable features (Medium) — RESOLVED BY REMOVAL

**Resolved by removal.** The team chose to keep the app minimal rather than add Settings controls, so
the dormant feature surface is gone end to end:

| Removed | Where |
|---|---|
| `ClearOnLock`, `ClearOnLockScope` properties | `Services/AppSettings.cs` |
| `NotifyOversizedClips` property | `Services/AppSettings.cs` |
| `set_/get_clear_on_lock`, `set_/get_clear_on_lock_scope`, `set_/get_notify_oversized_clips` (6 handlers) | `MainForm.RpcDispatch.cs` |
| 6 matching contract entries | `ui/js/core/rpc-contracts.js` |
| 3 localStorage default entries | `ui/js/core/settings-defaults.js` |
| lock-triggered `ClearHistoryAdvanced` call + `refreshClips` post | `MainForm.SystemEvents_SessionSwitch` |
| `if (!s.NotifyOversizedClips) return;` gate | `MainForm.OnOversizedClipDropped` |

Two consequences worth knowing:

- **The oversized-clip notification now fires unconditionally.** It previously defaulted to on but
  could be switched off by hand-editing `settings.json` to `false`. Anyone who had done that will now
  see the notification again. The gate had no UI, so the "off" state was only reachable that way.
- **Locking the workstation no longer clears history.** `ClearOnLock` defaulted to `false` and had no
  UI, so this removed dead code — but if any hand-edited config had enabled it, that behaviour is gone.
  `SystemEvents_SessionSwitch` still hides the window on lock, which was never gated on the setting.

Old `settings.json` files keep loading: `AppSettings.Load` deserializes with default options, which
ignore unknown members, so leftover `ClearOnLock` / `NotifyOversizedClips` keys are simply dropped on
the next save.

`get_autostart` (see B2) was **not** removed — the autostart feature is reachable and wired to a real
toggle; only its getter is unused.

`ClearHistoryAdvanced` itself is unchanged and still covered: auto-expire, Clear History, and the
image-purge paths all call it. `ClearOnLockTests` was renamed `ClearHistoryAdvancedTests` and retains
that coverage.

Original finding, for the record:

Diffing all 119 handled methods against every reference in `ui/` (both the string-literal calling
convention and the `api.<method>` property convention) leaves seven with **zero** callers:

| Method | Refs outside the contract registry |
|---|---|
| `get_autostart` | 0 (see B2) |
| `get_clear_on_lock` | 0 |
| `set_clear_on_lock` | 0 |
| `get_clear_on_lock_scope` | 0 |
| `set_clear_on_lock_scope` | 0 |
| `get_notify_oversized_clips` | 0 |
| `set_notify_oversized_clips` | 0 |

I checked whether these might be reached indirectly through a generic settings mechanism. They are
not. `SETTING_DEFAULTS` (`settings-defaults.js:8`) is only a defaults-and-type table used by
`getSetting`/`setSetting` — it does **not** generate controls. The settings screen is hand-built:
41 explicit rows in `ui/index.html`, none of which mentions "clear on lock" or "oversized".

**Which makes this more than dead code.** Both features are fully implemented on the native side:

```csharp
// MainForm.cs:340 — the behaviour exists and works
if (s.ClearOnLock)
{
    bool keepPinned = !string.Equals(s.ClearOnLockScope, "all", ...);
    ...
}

// MainForm.cs:1426 — and so does this one
if (!s.NotifyOversizedClips) return;
```

`AppSettings.ClearOnLock`, `ClearOnLockScope` (with a `keep_pinned` / `all` enum) and
`NotifyOversizedClips` are all modelled, defaulted, loaded and acted upon. The sidebar even listens
for the oversized-clip event. **There is simply no switch anywhere in the UI to turn either one on.**
A user can only enable them by hand-editing the settings file.

This looks like a refactor that moved settings onto a generic table and left the per-setting RPC
handlers behind, while the UI controls were never rebuilt.

**Suggested fix:** decide per feature whether to ship the control or drop the handler. Do not leave
a setting that silently does nothing. If the controls are wanted, they need to be added to
`index.html` and wired to the seven handlers that already exist and already work.

---

## B2 — The autostart toggle trusts a local mirror (Low)

`set_autostart` is called ([bridge.js:144](ui/js/core/bridge.js#L144)) and the settings screen has a
working toggle. But `get_autostart` has no caller — on load the UI reads the toggle state straight
from local storage:

```js
// ui/js/settings/settings-core.js:198
const autostart = localStorage.getItem('dualclip_autostart') === '1';
```

So the switch reflects what the UI last asked for, not what is actually registered. A user who
disables the app in Task Manager, or moves the executable, sees the toggle still on. The getter
exists precisely to resolve this and is simply never used.

Small, but it is the same "two sources of truth for one setting" shape flagged in an earlier review.

---

## B3 — The bridge is called `pywebview` (Low)

The primary call path is a compatibility shim named after pywebview, the Python library:

```js
// ui/js/core/bridge.js:95
window.pywebview = { api: { ... } };
```

with **288 call sites** across the UI doing `window.pywebview.api.some_method(...)`, and a
`pywebviewready` event. This is a C# / WinForms / WebView2 application — there is no Python
anywhere in it.

Nothing is broken; it works. But every maintainer who opens `state.js` or `keyboard.js` has to work
out why a desktop clipboard manager has a Python webview bridge, and a future contributor could
reasonably conclude pywebview is a supported host. A rename to something like `window.host` would be
mechanical and would remove a standing source of confusion.

---

## Checked and found correct

**Contract registry is in perfect sync.** This was the headline risk and it came back clean:

| Check | Result |
|---|---|
| `case` labels in `MainForm.RpcDispatch.cs` | 119 |
| Entries in `ui/js/core/rpc-contracts.js` | 119 |
| Declared but unhandled | **0** |
| Handled but undeclared | **0** |

Both directions matter. A declared-but-unhandled method is a call that fails at runtime; an
unhandled-but-undeclared one is invisible surface area. Neither exists.

**Message origin is checked before anything else.**

```csharp
// MainForm.RpcDispatch.cs:38
if (!string.IsNullOrEmpty(e.Source) && !e.Source.StartsWith("https://appassets.example", ...))
    return;
```

Any message from an unexpected origin is dropped before the JSON is even parsed. For a page that
renders user-supplied clipboard content, this is the right first line of defence.

**Every request gets exactly one response.** The dispatch is wrapped in a `try` whose `catch` sends
`{ ok = false, error }`, the switch has a `default:` that answers
`unhandled_method: <name>`, and every `case` sends and breaks. A caller cannot be left hanging on an
exception — the failure surfaces as an error response rather than a silently dropped request.

**Failures are reported, not swallowed.** Handlers return specific error codes
(`invalid_clip_id`, `clip_not_found`) and surface `_db.LastBackupError` when a data-safety precondition
fails, rather than reporting success.

---

## A note on method

My first pass at finding unused handlers matched only the string-literal calling convention and
flagged ten methods as dead — including `set_collection_parent` and `get_all_tags_with_stats`, both
of which are actively used via `api.<method>` property access. Those ten were discarded and the
search redone across both conventions, which is how the real list of seven was arrived at.

Recorded because the same class of false positive appeared in the code-quality audit, and because
the app genuinely uses two calling conventions at once — which is itself a small design smell worth
knowing about if anyone extends the bridge.

---

## Recommended order

1. **B1** — the only finding where shipped functionality is unreachable by the user. Decide: ship the
   controls, or remove the settings and handlers.
2. **B3** — mechanical rename, do it when the bridge is next touched.
3. **B2** — wire the existing getter into the settings load.