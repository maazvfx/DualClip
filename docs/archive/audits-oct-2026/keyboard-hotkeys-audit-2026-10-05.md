# Audit — Keyboard layer, shortcuts and global hotkeys

**Date**: 2026-10-05 · **Regenerated**: 2026-10-05 (fix status re-verified against the working tree)
**Type**: Read-only audit, with three fixes applied afterwards on explicit user instruction.
**Scope**: `ui/js/keyboard.js` (the global keydown router, window drag, focus lifecycle),
`ui/js/core/keyboard-map.js`, `Services/HotkeyService.cs` (RegisterHotKey + low-level hook),
`MainForm.cs` (hotkey wiring, `start_drag`), `MainForm.RpcDispatch.cs` (`set_hotkey`, `start_drag`),
`ui/js/settings/settings-shortcuts.js` (hotkey picker UI), and the Escape/modal wiring in
`ui/index.html`.
**Method**: full read of the router, mechanical diffing of modal ids against the Escape handler, and a
Node run of the two decisive expressions.
**Not run**: `dotnet test` (needs explicit user permission per `AGENTS.md` rule 6) and the app itself
(never launched without being asked). Windows-only behaviour (the modal move loop, the LL hook) is
argued from the Win32 contract and marked as needing a manual repro.

---

## 0. Fix status (current)

| # | Finding | Status | Detail |
|---|---------|--------|--------|
| K1 | F5 / Ctrl+R dev hot-reload in the release path | **DEFERRED BY REQUEST** | now behind `const DEV_HOT_RELOAD = true` at `keyboard.js:8`. Behaviour is unchanged from the original. **Must be set to `false` before the final release build.** |
| K2 | Enter and Space stolen from focused buttons | **FIXED** | `isButtonActive` at `keyboard.js:89`, applied to the Space branch (`:589`) and the Enter branch (`:658`) |
| K3 | Startup hotkey registration failure silently ignored | **FIXED** | `MainForm.cs:582-596` checks the result, persists the Ctrl+Shift+V fallback, posts `onToast`, shows a tray notification |
| K4 | "Autofocus search" is a no-op in practice | OPEN | search-as-you-type still focuses the box on any printable key |
| K5 | Numeric shortcuts map over raw array order, not display order | OPEN | |
| K6 | Titlebar double-click-to-pin unreachable; drag RPC blocks the UI thread | OPEN | needs a manual Windows repro to confirm the double-click outcome |
| K7 | Escape layer 3 leaves `selectedIndex = 0` on an empty list | OPEN | |
| K8 | Duplicate `onWindowShow` listeners | OPEN | |
| K9 | 150 ms activation buffer drops a fast summon+Enter | OPEN | |
| K10 | Native context menu suppressed on `SELECT` / contenteditable | OPEN | |
| K11 | `Alt+V` / `Alt+Shift+V` offered with no collision warning | OPEN | |

**Proof for the applied fixes**: `node --check ui/js/keyboard.js` clean; `dotnet build -c Debug
-warnaserror` → **0 errors, 0 warnings**. Tests were not run (permission needed). Note that the edits
sit alongside another agent's uncommitted work in the same two files; the changes are ~10 lines in
`keyboard.js` and ~13 in `MainForm.cs`.

### ⚠ Release checklist item

`ui/js/keyboard.js:8` — set `DEV_HOT_RELOAD = false` before the final release build. While it is
`true`, F5 and Ctrl+R re-read every stylesheet and script and reload the page **above** the IME, input
and modal guards, so a stray F5 while typing in a dialog discards the edit. The user asked for this to
stay enabled during active development; it is a single constant and nothing else depends on it.

---

## 1. Verdict

The router is disciplined: a single `keydown` listener, ordered layers, IME guards, and a
`preventDefault` on almost everything it claims. The Escape layer is complete, and the global hotkey
picker is a fixed 5-option list, so the app cannot hijack Ctrl+C/Ctrl+V. The three fixed problems were
at the edges — a dev-only reload path that shipped unguarded, two keys that fought focused buttons, and
one startup path that silently lost a hotkey binding.

---

## 2. Findings

### K1 — F5 / Ctrl+R dev hot-reload ships in the release build (Medium) — DEFERRED BY REQUEST

`ui/js/keyboard.js` originally opened with a hard reload branch as the **first** statement in the
global router — above the IME check, above `isInputActive`, above every modal check — that
cache-busted every stylesheet and script and called `window.location.reload()`. In a shipped app that
means: editing a clip and pressing F5 re-reads every asset and reloads the page, silently discarding
the edit, with no unsaved-changes guard; Ctrl+R fires on `e.code === 'KeyR'` even while the search box
has focus and mid-IME-composition; and the cache-busting `fetch()` of every asset is development
scaffolding that can fail on an installed build under `Program Files`.

It is now gated behind a single named constant so the release decision is one edit:

```js
const DEV_HOT_RELOAD = true;   // ← flip to false before the final release build
```

**Fix status**: the user is still actively iterating and needs the escape hatch, so it stays on and
behaves exactly as before — unconditional, above the guards. Do not "improve" it by re-adding the
modal/input guards while testing; that would silently stop F5 working from inside a dialog.

### K2 — Enter and Space were stolen from focused buttons (Medium) — FIXED

`isInputActive` treated `INPUT`, `TEXTAREA`, `SELECT` and contenteditable as "typing" and nothing
else, so a focused `<button>` was not an input: the Enter branch and the Space branch both matched,
both called `e.preventDefault()`, and the button never activated — Enter pasted the selected clip
instead, Space opened QuickLook.

Verified by running the two predicates verbatim:

```
focused BUTTON -> isInputActive = false
focused INPUT  -> isInputActive = true
Enter reaches the paste branch (which preventDefaults) = true
Space reaches the QuickLook branch (which preventDefaults) = true
```

For mouse users this was masked, because the `pointerup` handler deliberately blurs
`button, [role="button"], .collection-pill, .filter-chip` after every click — the app's own
anti-focus-trap measure was what created the trap for keyboard users. Evidence that this was a known
blind spot rather than a design choice: `btnToggleLayout` was the one button explicitly removed from
the tab order (`tabindex="-1"`) instead of being made to work.

**Fixed** with an `isButtonActive` predicate applied to the Space and Enter branches. Arrow, Home/End
and PageUp were intentionally left alone: they have no default button behaviour, so guarding them
would only remove list navigation.

### K3 — A hotkey that fails to register at startup was silently ignored (Medium) — FIXED

The settings path always handled this correctly: `MainForm.RpcDispatch.cs:1016-1037` checks
`UpdateCustomHotkey`'s return value, and on failure persists the Ctrl+Shift+V fallback and returns
`{ ok: false, fallback: "Ctrl+Shift+V" }`, which `settings-shortcuts.js:206-222` turns into a toast and
a UI revert. The **startup** path discarded the bool, so if another app had taken the saved combo the
app quietly ran Ctrl+Shift+V while `settings.json` and the Settings UI kept advertising a binding that
was never registered. Worse, the `win` variant returns `false` when the low-level hook fails to
install, in which case *nothing* is registered and the app has no summon hotkey at all — still with no
signal.

**Fixed** at `MainForm.cs:582-596`: the result is checked, the fallback is persisted (so Settings stops
lying), an `onToast` event is posted, and a tray notification is shown. `PostEventToJs` buffers into
`_pendingEventsQueue` when the WebView is not yet ready, so the startup toast is not lost.

### K4 — "Autofocus search" does not change anything the user can observe (Low-Med)

`dualclip_autofocus_search` is read in five places, all about focusing the search box *proactively* on
show. But the last branch of the router focuses the search box on **any** printable key with no setting
check, so with the setting OFF the user still cannot type a character without landing in the search
field. There is no `search_as_you_type` setting anywhere to turn that off, so the toggle is cosmetic.

**Fix**: gate the tail branch on the same setting, or rename the setting honestly (e.g. "Focus search
when the window opens") and note that typing always focuses it.

### K5 — Numeric shortcuts map over raw array order, not display order (Low-Med)

Ctrl+1..9 (move) and bare 1..9 (switch view) both index `customCollections` positionally, but that
array is in creation order while the visible pill bar sorts **pinned collections to the front**. After
pinning anything, "Ctrl+3 moves to the second pill I see" stops being true. Nested children are
interleaved in the same flat array, so a digit can land on a subfolder that is not visibly in that
position, and a digit can resolve to a reserved id that leaked in, silently turning a "move" into a
"star". The move branch is also the only mutating shortcut with no Undo toast (drag-and-drop, `Ctrl+D`
and the pill all offer one).

**Fix**: derive both mappings from the same sorted, filtered list the pills render, and add the same
Undo toast the drag path uses.

### K6 — Titlebar double-click-to-pin is unreachable, and the drag RPC blocks the UI thread (Low-Med)

The first `pointerdown` on the titlebar calls `start_drag`, whose handler is:

```csharp
ReleaseCapture();
SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);   // modal move loop
SendRpcResponse(rpcId, new { ok = true });                              // only after the drag ends
```

`SendMessage` with `HTCAPTION` enters the OS modal move loop **synchronously on the UI thread**. While
it runs the page is not pumping messages, so the second `pointerdown` of a double-click is never
delivered, and the `dblclick` handler is an explicit no-op anyway — the fast-click-to-pin branch is
dead code. `lastTitlebarClick` is also never cleared on pointerup or leave. The same blocking call
means that for the whole drag, clipboard captures (posted to the UI thread by `ClipboardListener`) queue
up and all land at once when it ends, and the RPC response is deferred by the entire drag so JS can
never learn when it finished.

*Needs a manual Windows repro to pin down the exact double-click outcome; the blocking mechanism and
the dead `dblclick` path are certain from the code.*

**Fix**: `PostMessage` instead of `SendMessage`; implement double-click from a real `dblclick` handler
or `WM_NCLBUTTONDBLCLK` rather than a 350 ms timer race; clear `lastTitlebarClick` on
`pointerup`/`pointerleave`.

### K7 — Escape layer 3 left `selectedIndex = 0` on an empty list (Low)

With `clips.length === 0`, `Math.max(0, Math.min(anchor, clips.length - 1))` evaluates to `0` because
`clips.length - 1` is `-1`. Executed:

```
Escape layer3 on empty clips -> selectedIndex = 0   (clips.length = 0)
```

The arrow-key handler does this correctly (sets `-1` explicitly), so the two paths disagree. Damage is
limited — the `selectedIndex >= 0 && selectedIndex < clips.length` guard is respected almost
everywhere — but a stale `0` on an empty list is what a later unchecked `clips[selectedIndex]` turns
into a real bug.

**Fix**: mirror the arrow handler — clear the selection and set `-1` when the list is empty.

### K8 — Duplicate `onWindowShow` listeners (Low)

`keyboard.js` registers a `chrome.webview.addEventListener('message', …)` and a
`window.addEventListener('message', …)` with the same body, and the first additionally re-applies the
size preset. In the WebView2 build only the `chrome.webview` channel delivers host messages, so the
second is dead code; in a `pywebview`-style host — which the `window.pywebview.api` naming throughout
suggests this was ported from — both fire, so `forceWindowFocus()` schedules its 4 timers twice and the
size-preset work runs twice per summon.

**Fix**: keep one channel, detect it once.

### K9 — The 150 ms activation buffer drops a fast summon+Enter (Low)

The buffer swallows `Enter`, `NumpadEnter`, `v` and `V` for 150 ms after the window appears, to stop
the summon keystroke from double-firing as a paste. Plain Enter is the primary paste action, so a user
who summons and hits Enter within 150 ms gets no action and no feedback. (Space is not in the swallowed
set, so QuickLook still works immediately, which makes the inconsistency more confusing.)

**Fix**: keep the buffer for the summon key itself and let Enter through, or queue and replay. At
minimum, do not swallow Enter — the OS hotkey that summoned the window cannot produce one.

### K10 — Native context menu suppressed too widely (Low)

`if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) e.preventDefault();`
also suppresses it on `SELECT` and contenteditable. The right predicate is "does this control
legitimately need the native menu", not "is it a text field".

### K11 — `Alt+V` / `Alt+Shift+V` offered with no collision warning (Low)

Only `Win+V` gets the explanatory warning. `Alt+V` and `Alt+Shift+V` are classic menu accelerators in
Office, VS Code, File Explorer and most Windows apps, and `RegisterHotKey` takes the combination
**system-wide** for as long as DualClip runs — so selecting `Alt+V` silently disables that accelerator
everywhere else, with no warning. (Worth stating as a positive: because the picker is a fixed list of
V combinations, the user cannot accidentally bind Ctrl+C/Ctrl+V/Ctrl+X and break their machine.)

**Fix**: extend the warning banner to the Alt combinations.

---

## 3. Checked and found clean

- **Escape covers every dialog.** Mechanically diffed the 13 `class="modal-overlay"` ids in
  `ui/index.html` plus `previewModal` and `settingsView` against every `getElementById(...)` in
  `keyboard.js`: **zero** dialogs missing, and all 14 overlays have their own click-to-close handler.
- **IME safety.** `e.isComposing || e.keyCode === 229` short-circuits before every branch (except the
  reload path, which is itself K1).
- **Typing safety.** Every mutating branch is gated on `!isInputActive`; the single-char tail branch
  additionally excludes Ctrl/Alt/Meta and Space.
- **Hotkey picker cannot steal common keys.** Fixed 5-option list, all V-based, all with ≥1 modifier.
- **`set_hotkey` reports failure and reverts both sides** (backend settings *and* the UI select +
  localStorage), with a user-visible toast. Only the startup path skipped this (K3, now fixed).
- **Low-level hook latch is sound.** `_winVDown` is released on `WM_KEYUP` of the target key *or* of
  any participating modifier, so out-of-order release cannot leave the summon latched on.
  `MOD_NOREPEAT` is set on the `RegisterHotKey` path and the LL hook swallows auto-repeat itself.
- **Modifier matching is exact.** The hook requires all four modifier states to equal the target, so
  `Ctrl+Alt+V` does not fire a `Ctrl+Shift+V` binding.
- **Titlebar drag guard excludes controls** (`button, input, select, a, [role="button"],
  [data-no-drag]`), so toolbar clicks never start a window drag.
- **Focus does not get stuck on mouse clicks** — which is what hid K2 from mouse users, and is the
  right instinct in the wrong place.

---

## 4. Suggested order of work

1. **The release checklist item** — flip `DEV_HOT_RELOAD` to `false` before the release build.
2. **K4 / K7 / K8** — small, independent, and each removes a silent inconsistency.
3. **K5** — sort the mapping like the pills and add the Undo toast.
4. **K6** — `PostMessage` instead of `SendMessage`, and implement double-click honestly.
5. **K9 / K10 / K11** — batch.

Worth adding as tests, following the repo's Node-harness style: a source-text invariant that the
release build cannot contain an active reload branch, and a behavioural test that dispatches a `keydown`
with `activeElement` = a `<button>` and asserts the default was not prevented.
