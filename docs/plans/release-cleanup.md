# Plan — Release Cleanup: Remove Dead Double-Click Setting, Comment Policy, Persistence Decision

Date: 2026-10-07
Scope: 5 files. Written per RULES.md "Mandatory Planning Gate" (requires codebase exploration).

## 1. Remove the double-click setting entirely (dead UI, live code)
There is no control for it anywhere in Settings (no HTML row, no entry in the settings search
index), yet the logic is fully active: it is read on startup and still reset by
"Restore Defaults". It silently changes behaviour with no way to see or control it.

Decision: **double-click always pastes and closes the window.** The 'paste_keep' and
'expand' modes are removed, along with every setting, branch and reset path for them.

- `ui/js/core/namespace.js` — drop `doubleClickAction` global and its startup load
- `ui/js/core/settings-defaults.js` — drop `dualclip_double_click_action`
- `ui/js/list/render.js` — dblclick handler pastes unconditionally and always closes;
  remove the `'expand'` branch and the single-click-expand guard that keyed off the setting
- `ui/js/settings/settings-core.js` — drop the startup read and the Restore Defaults call
- `ui/js/settings/settings-shortcuts.js` — drop `changeDoubleClickAction`

Also remove the now-orphaned `dualclip_click_expand` only if nothing else reads it
(verify first — it is referenced by the single-click expand path).

## 2. Comment policy (decided, not a blanket removal)
- **C# comments are free.** The compiler discards them; they never reach the exe. Keep them.
- **HTML/CSS/JS comments do ship**, because WebView2 loads the source files from the output
  folder. Stripping them means minifying, which would break the project's 1:1 source-to-output
  sync and make user-reported bugs impossible to diagnose.
- Decision: **do not minify.** Keep comments that explain *why*; remove comments that only
  restate what the code does.

## 3. Persistence of the remaining 62 interface preferences — NO CHANGE
Re-checked: these are stored in the app's private WebView2 profile folder, they survive normal
restarts, and nothing overwrites them at startup (`getSetting` only falls back to a default
when nothing is stored). They are lost only if that folder is deleted — a deliberate factory
reset, an uninstall, or a restore onto another machine. That is the expected behaviour for
"delete the app and reinstall". Migrating all 62 into settings.json is a large change for no
user-visible gain, so it is declined.

The one setting that genuinely mattered — clip details — already has a real two-way sync with
settings.json as the owner.

## 4. Tests
`WindowSizePolicyTests` asserts the old `960x720` default in 8 places and will fail against
the new `970x730`. Update those assertions so they document the new intended behaviour.
Targeted runs only, per RULES.md — the full suite stays reserved for release validation.

## 5. Out of scope
A full dead-code and quality audit is being handed to a dedicated reviewer agent; this plan
covers only the double-click removal, the comment policy, and the test update.