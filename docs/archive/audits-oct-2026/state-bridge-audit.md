# Architecture & Code Quality Audit: ui/js/core/state.js & bridge.js

## 1. Module Purpose & Responsibilities
- `bridge.js`: WebView2 IPC adapter. Emulates the legacy pywebview RPC interface (`window.pywebview.api`) on top of `window.chrome.webview.postMessage`, mapping RPC callbacks via incremental message IDs and routing backend push events (`onClipAdded`, `onWindowShow`, `onWindowHide`, `onToast`, `refreshClips`) to frontend handlers.
- `state.js`: Global state orchestration and data synchronization. Manages clip collections (`allClips`, `clips`), selection states (`selectedIndex`, `selectedIndices`), optimistic mutation shields (`pendingPinOverrides`, `pendingFavOverrides`), infinite scroll pagination offsets (`clipsLoadedOffset`), and clip hydration (`formatClipForUI`).

## 2. Dead Code & Safe Pruning Targets
- Dead fallback mock code in `bridge.js`: Lines 70–73 returns `{ ok: false, error: 'WebView2 not available' }` without providing functional browser mocks.
- Redundant time group calculation in `formatClipForUI()`: Lines 103–115 contains an early return `return calcClipTimeGroup(c);` followed immediately by dead unreachable try-catch calculation code (lines 105–114). This unreachable block can be cleanly deleted.
- Deprecated RPC caller: `window_show_ack()` is routed in `bridge.js` and `RpcDispatch.cs` but performs no meaningful work on the host.

## 3. Performance & Memory Hotspots
- Clip formatting allocation overhead (`formatClipForUI`):
  - Invocations occur during ingestion, bulk pagination, search, and filtering. Every call constructs an object with ~25 properties, runs regexes, parses ISO dates (`new Date()`), and checks auto-sort rules.
  - Doing this synchronously across hundreds of clips on the UI thread during scrolling or fast typing can cause micro-stutters.
- Optimistic Override Maps:
  - `pendingPinOverrides` and `pendingFavOverrides` are Maps storing optimistic UI modifications to prevent background query overwrites. While entries store timestamps, there is no automatic cleanup timer; over days of long-running execution without full reloads, this map could slowly accumulate memory if not pruned.

## 4. Code Duplication & Refactoring Targets
- Age Label vs Time Group calculations: Date parsing and `diffDays` calculations are duplicated across `calcClipTimeGroup` and `age_label` inside `formatClipForUI`.
- Event listener dispatching in `bridge.js`: Event dispatch uses a large `else if` chain (lines 19–64) checking global function properties on `window`. Replacing this with an event map or `EventTarget` pattern would decouple modules and improve extensibility.

## 5. Critical Invariants (DO NOT TOUCH)
- **Monotonic Sequence IDs (`clipFetchSeq`)**: Stale backend response rejection (`if (mySeq !== clipFetchSeq) return;`). Guarantees that asynchronous SQLite query returns never overwrite newer queries.
- **`clipsLoadedOffset` for Infinite Scroll**: Must strictly track server-provided row counts rather than `allClips.length`. If a user deletes an item from `allClips`, `allClips.length` decreases, but `clipsLoadedOffset` must not rewind, or subsequent scroll queries will skip rows.
- **Double rAF in `notifyUiReadyOnce()`**: Guarantees layout tree calculation and initial WebView2 paint before signaling the host window to become visible, eliminating blank white-flash glitches on startup.

## 6. Prioritized Action Plan
- **Medium**: Delete unreachable dead code in `formatClipForUI` (lines 105–114).
- **Medium**: Add periodic eviction / TTL pruning to `pendingPinOverrides` and `pendingFavOverrides` to prevent unbounded memory growth in 24/7 background operation.
- **Low**: Refactor `bridge.js` event routing from an `if/else` chain into an event dispatcher map.
