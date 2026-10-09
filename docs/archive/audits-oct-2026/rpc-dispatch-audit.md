# Audit Report: MainForm.RpcDispatch.cs

## 1. Module Purpose & Responsibilities
- **JSON-RPC Bridge Controller**: Ingests `CoreWebView2WebMessageReceivedEventArgs` from the WebView2 Chromium container, dispatches ~100 distinct RPC methods, and returns structured JSON responses matching caller request IDs.
- **Security & Origin Perimeter**: Validates that all incoming messages strictly originate from the trusted virtual asset scheme (`https://appassets.example`), discarding any unauthorized cross-origin messages.
- **Native Host Intermediary**: Translates frontend UI requests into Win32 calls (window drag, window resize, clip pasting via `keybd_event`, native file drag via OLE `DoDragDrop`, and SQLite database queries).

---

## 2. Dead Code & Safe Pruning Targets
- **`case "window_show_ack":` (Lines 117–119)**:
  - No-op RPC returning `{ ok = true }`; exists as a legacy synchronization handshake.
  - *Recommendation*: Can be safely deprecated in both C# and `rpc-contracts.js`.
- **Note on Pruning Invariant**:
  - Any method label pruned from `RpcDispatch.cs` MUST be pruned simultaneously from `ui/js/core/rpc-contracts.js`, as enforced by `DualClip.Tests/RpcContractInvariantTests.cs`.

---

## 3. Performance & Memory Hotspots
- **Per-Message `JsonDocument` Allocations**:
  - Every incoming message allocates a new `JsonDocument` via `JsonDocument.Parse(e.WebMessageAsJson)` on the UI thread. For rapid bursts (e.g. search typing, mouse drags, volume sliders), this generates avoidable short-lived heap allocations.
- **Large Response Serialization on UI Thread**:
  - Handlers returning large datasets (such as `HandleGetClips` with thumbnail strings or `export_package`) serialize large JSON payloads on the main WinForms thread before passing them to `PostWebMessageAsJson`, occasionally causing 10–20ms frame drops during rapid queries.

---

## 4. Code Duplication & Refactoring Targets
- **Inconsistent Parameter Extraction**:
  - Argument parsing is fragmented: some cases use strongly typed helpers (`TryGetClipId`, `TryGetBool`), while dozens of others repeat manual checks:
    ```csharp
    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.String)
    ```
  - Refactoring to a unified `args.GetString(0)`, `args.GetInt64(0)` extension helper would reduce ~300 lines of boilerplate.
- **Inline Switch Bloat**:
  - While core operations (`HandleGetClips`, `HandlePasteClip`) are extracted to dedicated methods, complex operations (such as `start_file_drag`, `export_package`, and `import_dropped_package`) span 60–100 lines directly inside `switch` case labels.

---

## 5. Critical Invariants (DO NOT TOUCH)
- **Origin Validation Perimeter**:
  - `if (!string.IsNullOrEmpty(e.Source) && !e.Source.StartsWith("https://appassets.example", StringComparison.OrdinalIgnoreCase)) return;`
  - MUST remain the first line of `OnWebMessageReceived`. Disabling this allows untrusted web content loaded in any preview frame to execute arbitrary native code.
- **RpcContract Invariant Parity**:
  - Every `case "method_name"` MUST have an exact matching entry in `ui/js/core/rpc-contracts.js`. Breaking this contract fails CI and test suites.
- **RPC ID Correlation**:
  - `SendRpcResponse(rpcId, payload)` MUST return the exact `rpcId` received in the request to resolve the correct frontend `Promise`.

---

## 6. Prioritized Action Plan
- **High**: Extract multi-line `case` handlers (`start_file_drag`, `export_package`) into dedicated private helper methods to keep the dispatch table readable.
- **Medium**: Unify parameter extraction with shared `TryGetArg` extension methods.
- **Low**: Deprecate unused no-op handshake calls (`window_show_ack`) in coordination with `rpc-contracts.js`.
