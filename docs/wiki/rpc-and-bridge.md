# RPC Bridge & Frontend-Host Contracts

## Overview
The WebView2 frontend talks to the C# `MainForm` host over a JSON-RPC bridge defined across three files:

| Layer | File | Role |
| :--- | :--- | :--- |
| Transport | [`ui/js/core/bridge.js`](../../ui/js/core/bridge.js) | `callHost()` transport, `pywebview.api` shim, host-event dispatcher |
| Contract | [`ui/js/core/rpc-contracts.js`](../../ui/js/core/rpc-contracts.js) | `RpcContracts` argument registry + `callHostChecked()` |
| Dispatch | [`MainForm.RpcDispatch.cs`](../../MainForm.RpcDispatch.cs) | `OnWebMessageReceived` intake and the `switch (method)` dispatch |

---

## 📡 Transport

### Frontend to Host
`callHost(method, args, timeoutMs)` in `bridge.js:68` sends:
```json
{ "id": <rpcId>, "method": "<name>", "args": [ ... ] }
```
via `window.chrome.webview.postMessage`. The `id` is a monotonically increasing counter seeded from a timestamp offset (`bridge.js:4`) to avoid collisions across reloads.

- **Timeouts**: 8s default; 120s for the eight dialog-backed methods (`browse_application`, `export_clips`, `import_into_collection`, `import_dropped_package`, `import_package_base64`, `clear_history`, `clear_collection`, `delete_clips_in_collection`) because they block on a native file or message box (`bridge.js:75-76`).
- **Fallback shim**: `window.pywebview.api` mirrors the same methods positionally so Node.js harnesses can run without WebView2.

### Host to Frontend (two distinct shapes)
Both travel over `PostWebMessageAsJson`; the frontend tells them apart by which JSON key is present (`bridge.js:13-19`).

1. **RPC response** — matches a pending call by id and resolves its promise:
   ```json
   { "__rpc_response_id": <rpcId>, "result": { ... } }
   ```
   Emitted by `MainForm.SendRpcResponse` (`MainForm.cs:2286`).
2. **Host event** — an unsolicited push, dispatched by name:
   ```json
   { "event": "<name>", "data": { ... } }
   ```
   Emitted by `MainForm.PostEventToJs` (`MainForm.cs:2220`).

`PostEventToJs` marshals to the UI thread and, if the WebView2 core is not ready yet, queues into a **bounded 50-item drop-oldest FIFO** that is flushed by `FlushPendingEventsToJs` (`MainForm.cs:2256`).

### Host event names
Handled in the `bridge.js:19-63` dispatcher. Each guards on the target global existing.

| Event | Frontend handler | Notes |
| :--- | :--- | :--- |
| `onClipAdded` | `window.onClipAdded` | Also re-stamps `_lastClearAt` |
| `onClipUpdated` | `window.onClipUpdated` | |
| `refreshClips` | `window.refreshClips` | Stamps `_lastClearAt` |
| `refreshStorageStats` | `window.refreshStorageStats` | |
| `onWindowShow` | `window.onWindowShow` | Calls `setWindowVisibility(true)` first |
| `onWindowHide` | `window.onWindowHide` | Calls `setWindowVisibility(false)` first |
| `onInvalidateHeight` | `window.invalidateCachedHeight` | |
| `onInvalidateClips` | `window.invalidateClips` | |
| `onCaptureStateChanged` | `window.onCaptureStateChanged` | Payload: `paused`, `is_timed`, `remaining_seconds` |
| `onPauseChanged` | `window.onPauseChanged` | `onPauseStateChanged` is accepted as an alias; only the former is emitted |
| `onCycleNext` | `window.onCycleNext` | Quick-number-paste stepping (next only — see below) |
| `onWinReleased` | `window.onWinReleased` | |
| `onToast` | `window.showToast` | Reads `msg.data.message`; `data.type` may be `warning` |
| `onDropZoneShow` / `onDropZoneHide` | matching `window.*` | Drag-over feedback |

The host emits **13** of these. `bridge.js:29-62` also contains six handler branches with **no matching emitter** anywhere in `MainForm*.cs`:

| Dead branch | Handler it calls | Defined at |
| :--- | :--- | :--- |
| `onCyclePrev` | `window.onCyclePrev` | `ui/js/keyboard.js:1061` |
| `onPasteNumbered` | `window.onPasteNumbered` | `ui/js/keyboard.js:1075` |
| `onInvalidateHeight` | `window.invalidateCachedHeight` | `ui/js/list/render.js:219` |
| `onInvalidateClips` | `window.invalidateClips` | `ui/js/core/state.js:506` |
| `open_edit_clip` | `openEditClipModal` | `ui/js/overlays/modals.js:1162` |
| `onPauseStateChanged` | `window.onPauseChanged` | alias of an emitted event |

Each guard is a `typeof === 'function'` check, so these are inert rather than broken — but they are unreachable. `scripts/check-docs-freshness.ps1` reports them as `EVENT DRIFT` warnings. Wire an emitter or delete the branch; do not add new ones without an emitter.

### Security
`OnWebMessageReceived` drops any message whose `e.Source` does not start with `https://appassets.example` (`MainForm.RpcDispatch.cs:38`).

---

## 📑 The contract registry (119 methods)

`rpc-contracts.js` holds `RpcContracts`, mapping every method to its positional argument names. `callHostChecked(method, {named: value})` expands the named object into a positional array using `buildRpcArgs` (`rpc-contracts.js:156`), applying declared `defaults` and inserting `null` for undeclared omissions.

**Do not hand-maintain a method table in this wiki.** Read `rpc-contracts.js` — it is the single source of truth and it is enforced:

`DualClip.Tests/RpcContractInvariantTests.cs` parses both sides and asserts five things:
- every `case "method"` in the host has a declared contract,
- every contract has a handler (catches dead surface),
- the two counts are equal,
- contract arg names are unique identifiers,
- no handler reads an `args[n]` index beyond its declared arity.

The only deviation tolerated today is an uncontracted method falling back to positional `callHost`. Current state: **119 contracts, 119 handlers, zero drift.**

### Groups
| Group | Examples |
| :--- | :--- |
| Window & viewport | `hide_window`, `set_window_size`, `resize_window`, `reset_window_size`, `start_drag`, `start_resize`, `set_window_pos`, `center_window`, `set_pinned`, `set_modal_open`, `set_show_taskbar`, `window_show_ack`, `ui_ready` |
| Clips & content | `get_clips`, `get_clip`, `paste_clip`, `paste_multi`, `paste_text`, `paste_delete`, `copy_clip`, `set_clipboard_text`, `add_clip`, `restore_clip`, `delete_clip`, `toggle_pin`, `toggle_favorite`, `clear_history` |
| Collections | `rename_collection`, `move_to_collection`, `merge_collection`, `clear_collection`, `delete_collection_def`, `save_collection`, `set_collection_parent`, `reassign_collection`, `migrate_collection_keys` |
| Tags | `set_tags_for_clip`, `batch_add_tags`, `batch_remove_tags`, `get_tag_stats`, `get_suggested_tags`, `rename_tag`, `delete_tag` |
| Import / export | `export_clips`, `import_into_collection`, `import_dropped_package`, `import_package_base64`, `browse_application`, `get_clip_temp_file`, `start_file_drag` |
| Settings | `set_hotkey`, `set_capture_images`, `set_capture_filters`, `set_blocklist`, `set_max_clips`, `set_auto_expire_days`, `set_line_display`, `set_thumb_size`, `set_quick_number_paste`, `set_clip_details` |
| Stats & status | `get_storage_stats`, `get_usage_stats`, `reset_usage_stats`, `get_paused`, `set_paused`, `set_timed_incognito`, `get_incognito_status` |

### Contract pitfalls worth knowing
- **`clear_history`** takes 8 positional params. Params 3-5 (`keepStarred`, `deleteUnpinned`, `deleteImages`) default to **true** in C#, so omitting them still purges images. They are declared `optional` so the registry does not under-document them.
- **`set_window_size` / `resize_window`** declare `optional: ['animate', 'persist']`. `persist` defaults to **true** in the `pywebview.api` shim (`bridge.js:137`), so transient callers (Settings, lightbox preview) must pass `false` or they will overwrite the user's remembered size.
- **`get_autostart`** has no caller; the UI reads the `dualclip_autostart` localStorage mirror instead (noted in `rpc-contracts.js:86`).
- **`set_notify_oversized_clips`, `set/get_clear_on_lock`, `set/get_clear_on_lock_scope`** were deliberately removed — the backend implemented them but the Settings screen never exposed a control, leaving them reachable only by hand-editing `settings.json`. Do not re-add without a UI (`rpc-contracts.js:135-139`).

---

## 🧪 Invariant Harnesses
- `DualClip.Tests/RpcContractInvariantTests.cs` — the 5 structural contract guards above.
- `DualClip.Tests/js-harness/rpc-bridge-invariants.js` — serialization, host calls, fallback bridges.