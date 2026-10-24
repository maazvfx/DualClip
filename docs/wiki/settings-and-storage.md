# Settings & Preferences Engine

## Overview
Settings live in two places that must stay in sync:

| Layer | File | Role |
| :--- | :--- | :--- |
| Frontend | [`ui/js/settings/`](../../ui/js/settings/) | UI, controls, `localStorage` mirrors |
| Backend | [`Services/AppSettings.cs`](../../Services/AppSettings.cs) | `AppSettingsData` record + `settings.json` load/save |

Paths come from [`Services/PathHelper.cs`](../../Services/PathHelper.cs).

---

## 📁 Storage locations

`PathHelper` branches on **portable mode** — a `portable.dat` file next to the executable (`PathHelper.cs:10-21`). This changes every path, so hardcoding AppData in docs or code is wrong.

| What | Installed mode | Portable mode |
| :--- | :--- | :--- |
| Root | `%APPDATA%\DualClip` | `<exe>\portable_data` |
| Database | `%LOCALAPPDATA%\DualClip\data\clips.db` | `<root>\data\clips.db` |
| Settings | `<root>\settings.json` | `<root>\settings.json` |
| Images | `<root>\images` | `<root>\images` |
| WebView2 profile | `%LOCALAPPDATA%\DualClip\webview2_profile` | `<root>\webview2_profile` |
| Icon cache | `%LOCALAPPDATA%\DualClip\icon_cache` | `<root>\icon_cache` |
| Drag temp | `%TEMP%\DualClip\drag` | `<root>\temp_drag` |
| Temp | `<root>\temp` | `<root>\temp` |

Notes:
- The database file is named **`clips.db`**, not `DualClip.db`.
- Installed mode honors a **`DUALCLIP_DB_PATH`** environment variable override (`PathHelper.cs:52-58`).
- A legacy `clips_experiment.db` is auto-migrated to `clips.db` if only the old file exists.
- `CleanupTempFolders()` sweeps stale `import_*` directories out of `<root>\temp` on demand.

---

## ⚙️ Settings modules

| File | Owns |
| :--- | :--- |
| `settings-core.js` | Bootstrapping, migration of legacy keys, tab state, settings window geometry |
| `settings-appearance.js` | Theme, visual style, zoom, size preset, position modes, zebra, grouping, line display, thumb size |
| `settings-shortcuts.js` | Global summon hotkey, smart shortcuts, direct collection shortcuts, drag-out mode |
| `settings-storage.js` | Usage-stats dashboard, max clips, auto-expire days, custom collections |
| `settings-rules.js` | Ignore passwords, capture images, fullscreen suppression, blocklist, auto-sort rules, incognito |
| `quick-view-menu.js` | Quick-reset menu, layout preset, clip detail level, text power, selection style |
| `settings-defaults.js` (in `ui/js/core/`) | Default values, shared with the backend contract |

---

## 💾 Persistence contract

There is **no automatic bidirectional sync**. The pattern is explicit:

1. Control changes → frontend writes the `localStorage` mirror (all keys are namespaced `dualclip_*`).
2. Frontend calls the matching `set_*` RPC.
3. C# mutates `AppSettingsData`, persists `settings.json`, and returns `{ ok: true }`.
4. Backend confirmation is mirrored back into `localStorage` on read (`settings-core.js:183, 428, 442`).

Representative keys: `dualclip_theme`, `dualclip_visual_style`, `dualclip_zoom`, `dualclip_size_preset`, `dualclip_layout_preset`, `dualclip_hotkey_cfg`, `dualclip_autosort_rules`, `dualclip_blocked_apps`, `dualclip_max_clips`, `dualclip_auto_expire_days`, `dualclip_line_display`, `dualclip_clip_details`.

**Deliberate exception**: `get_autostart` has no caller — the UI reads the `dualclip_autostart` localStorage mirror only (see [`rpc-and-bridge.md`](rpc-and-bridge.md)).

---

## 📦 Import / export packages

- Format: `.dualclip` — a **plain ZIP archive**, not encrypted. Entries: `manifest.json`, `collections.json`, `clips.json`, and `images/<id>.<ext>` (`MainForm.cs:2702-2840`).
- `.zip` is accepted as an alias on import (`MainForm.cs:2940`).
- Any other extension is rejected and the filename falls back to `import.dualclip` (`MainForm.cs:3079-3081`).
- Validation is covered by `DualClip.Tests/PackageValidationTests.cs`.

---

## 🧹 URL cleaning

Tracking-parameter cleaning runs in the frontend. `cleanTrackingUrl()` in [`ui/js/list/actions.js`](../../ui/js/list/actions.js) removes tracking parameters such as `utm_*` and `fbclid` from a URL clip. The clip's context-menu clean-URL action copies the cleaned link. The old C# `UrlCleaner.cs` was removed as dead code.

---

## 🧪 Invariant Tests
- `DualClip.Tests/PackageValidationTests.cs`
- `DualClip.Tests/ClearOnLockTests.cs`
- `DualClip.Tests/WindowSizePolicyTests.cs`