# DualClip — Architecture

How DualClip is put together, what it stores, and where. Every path and schema in this
document was read from source at the `v1.0.0` tag.

---

## 1. Process Model

DualClip is a **WinForms shell hosting a WebView2 Chromium view**. There is no server, no
account, and no sync. The C# side owns the clipboard, the database, and the OS integration; the
web side owns rendering and interaction. They talk over a JSON-RPC bridge.

```
┌──────────────────────────────────────────────────────────────┐
│  WinForms host  (net10.0-windows, WinExe, asInvoker)          │
│                                                              │
│  Program.cs ── single-instance mutex, DPI, exception guard   │
│  MainForm.cs ── WebView2 lifecycle, window shell,            │
│                 JSON-RPC dispatch (~100 methods)             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Services                                               │  │
│  │  ClipboardListener  hidden Win32 window, WM_CLIPBOARD.. │  │
│  │  DatabaseService*   SQLite + FTS5, 6 partials           │  │
│  │  HotkeyService      RegisterHotKey + LL keyboard hook   │  │
│  │  TrayService        notification area                   │  │
│  │  AppSettings        settings.json                      │  │
│  │  PathHelper         portable / installed path resolution│  │
│  │  AppDiscovery/Icon  process → friendly name + icon      │  │
│  └────────────────────────────────────────────────────────┘  │
│                          ⇅  PostWebMessageAsJson             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ui/  — vanilla HTML5 / CSS3 / ES6 modules             │  │
│  │  no framework, no bundler, no third-party runtime dep   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
              │                    │                 │
              ▼                    ▼                 ▼
        SQLite (WAL)        settings.json      images\*.png
        %LOCALAPPDATA%      %APPDATA%          %APPDATA%
```

The WebView2 environment is created with a dedicated user-data folder and **all permissions are
denied** (`PermissionRequested` → `Deny`, [MainForm.cs:1111](../MainForm.cs)).

---

## 2. Storage Model

DualClip resolves every path through [`Services/PathHelper.cs`](Services/PathHelper.cs). There are
two modes, chosen by the presence of a `portable.dat` file next to the executable
([PathHelper.cs](../Services/PathHelper.cs)).

### Installed mode (default)

| Data | Path |
| :--- | :--- |
| **Database** | `%LOCALAPPDATA%\DualClip\data\clips.db` |
| **WebView2 profile** | `%LOCALAPPDATA%\DualClip\webview2_profile` |
| **Settings** | `%APPDATA%\DualClip\settings.json` |
| **Image cache** | `%APPDATA%\DualClip\images\` |

> ⚠️ **The database and the WebView2 profile live under `%LOCALAPPDATA%`; settings and images live
> under `%APPDATA%`.** These are two different folders. If you are writing a backup script or a
> support article, back up **both**.
>
> The `DUALCLIP_DB_PATH` environment variable overrides the database location
> ([PathHelper.cs](../Services/PathHelper.cs)). No migration currently moves existing data
> between the two roots — see *Known Rough Edges* below.

### Portable mode

`portable.dat` in the executable's folder redirects everything to `<exe dir>\portable_data\`,
with `data\`, `images\`, and `webview2_profile\` beneath it.

### Backups

Automatic backups land next to the database as
`clips_backup_<yyyyMMdd_HHmmss>_<reason>.db` — for example
`clips_backup_20261003_164946_pre_clear.db` ([DatabaseService.Backup.cs:187](Services/DatabaseService.Backup.cs#L187)).
Reasons include `pre_clear` and `manual`. Each attempt first checks for free disk space (requires
at least 50 MB, or 2× the current database size), stages to a GUID-named `.tmp`, and only then
swaps into place, so concurrent attempts cannot collide.

---

## 3. Database Schema

SQLite, opened with `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, and
`foreign_keys=ON` ([DatabaseService.cs:83](Services/DatabaseService.cs#L83)).

### `clips` — the clip table

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | INTEGER PK AUTOINCREMENT | |
| `text_content` | TEXT NOT NULL | full payload |
| `preview` | TEXT NOT NULL | short display form, also indexed |
| `content_hash` | TEXT NOT NULL | dedupe key; **case-sensitive** (see Known Rough Edges) |
| `track` | TEXT NOT NULL | `manual` or `voice` (voice dictation apps are tracked separately) |
| `collection` | TEXT NOT NULL | collection id, default `all` |
| `is_image` | INTEGER | 0/1 |
| `image_path`, `thumbnail_data`, `img_dims`, `img_size` | TEXT | image payload metadata |
| `src_process`, `src_title` | TEXT | originating application |
| `pinned`, `favorite` | INTEGER | 0/1 |
| `nickname` | TEXT | user-assigned label |
| `created_at`, `last_used_at` | INTEGER | Unix seconds |
| `sort_rank` | INTEGER | chronological ordering, densified on import |
| `use_count` | INTEGER | paste counter |

Indexes: `idx_clips_hash (content_hash)`, `idx_clips_mru (pinned DESC, sort_rank DESC, id DESC)`,
`idx_clips_track (track, last_used_at DESC)`, and `idx_clips_nickname_nocase (nickname COLLATE NOCASE)`.

Columns added after the first release are backfilled by `EnsureColumn`, so upgrades are
non-destructive ([DatabaseService.cs:117-125](Services/DatabaseService.cs#L117-L125)).

### `collections`

`id TEXT PK`, `name`, `pinned`, `sort_order`, `created_at`. Fresh installs start with a completely
clean slate (0 custom collections), ready for the user to create their own collections.

### `tags` / `clip_tags`

A many-to-many tag table with `normalized_name` uniqueness, `last_used_at` tracking, cascading
deletes, and an orphan sweep that runs on every startup
([DatabaseService.Tags.cs:34](Services/DatabaseService.Tags.cs#L34), sweep at
[DatabaseService.cs:167](Services/DatabaseService.cs#L167)).

### `app_config`

Generic `key`/`val` key-value store for settings that belong in the database rather than
`settings.json`.

### `fts_clips` — full-text index

An FTS5 external-content virtual table over `clips(text_content, preview)` using the
`porter unicode61` tokenizer with `prefix='2 3'`, kept in sync by insert/delete/update triggers
([DatabaseService.Fts.cs:41](Services/DatabaseService.Fts.cs#L41)).

**Graceful degradation:** if FTS5 is unavailable in the bundled SQLite build, the DDL failure is
caught, `FtsAvailable` is set to `false`, and the app stays permanently in a legacy `LIKE`-based
search mode instead of failing to start.

---

## 4. The JSON-RPC Bridge

[`MainForm.RpcDispatch.cs`](../MainForm.RpcDispatch.cs) handles inbound JSON messages with a large `switch` on the `method` name, and
responds on the same id. The frontend declares the contract in
[`ui/js/core/rpc-contracts.js`](../ui/js/core/rpc-contracts.js) — treat that file as the source of
truth when adding a method, and update it alongside the C# handler.

122 methods are live, grouped as:

- **Clip lifecycle** — `get_clips`, `add_clip`, `update_clip`, `delete_clip`, `restore_clip`,
  `copy_clip`, `paste_clip`, `paste_delete`, `paste_multi`, `paste_text`, `set_nickname`
- **Collections** — `get_collections`, `save_collection`, `rename_collection`,
  `delete_collection_def`, `delete_clips_in_collection`, `move_to_collection`,
  `reassign_collection`, `merge_collection`, `clear_collection`, `migrate_collection_keys`,
  `get_collection_counts`
- **Import / export** — `export_clips`, `import_into_collection`
- **Window** — `hide_window`, `set_window_pos`, `set_window_size`, `resize_window`,
  `start_drag`, `start_resize`, `start_file_drag`, `reset_window_size`, `window_show_ack`
- **App state** — `set_paused`, `get_paused`, `set_autostart`, `get_autostart`,
  `set_prevent_screen_capture`, `set_show_taskbar`, `set_remember_window_size`, `set_suppress_in_fullscreen`

### Export package format (`.dualclip`)

A ZIP archive with three parts:

```
manifest.json    { format: "com.dualclip.export", format_version: 1,
                   minimum_reader_version: 1, app_version, created_at,
                   clip_count, image_count, collection_count,
                   hash_algorithm: "sha256", content_encoding: "utf-8" }
clips.json       array of clip records, including sort_rank
images/<sha256>.png
```

The reader **refuses** any package whose `minimum_reader_version` exceeds its own, so a newer
export fails loudly rather than silently dropping fields. Import validates entry paths against
`^images/[a-f0-9]{64}\.png$`, caps `clips.json` at 64 MB, and requires the root to be a JSON array.

---

## 5. Clipboard Capture Pipeline

[`Services/ClipboardListener.cs`](../Services/ClipboardListener.cs) creates a hidden message-only
Win32 window and listens for `WM_CLIPBOARDUPDATE`. For each event, in order:

1. **Dedupe** — compute a content hash; an existing clip gets its `last_used_at` bumped instead
   of a new row.
2. **Size clamp** — drop payloads over the configured limit.
3. **Privacy filter** — if the source process, window title, or executable path matches a known
   password manager, the clip is discarded and never written. `IsVaultProcess` matches ~21
   managers (1Password, Bitwarden, KeePass/KeePassXC, LastPass, Dashlane, NordPass, Proton Pass,
   Keeper, Zoho Vault, and a broad generic `vault` catch-all).
4. **User blocklist** — skip any app the user has explicitly excluded.
5. **Auto-sort** — `ResolveAutoSortCollection` walks the user's rules in order and picks a
   collection from URL origin, window title, or process name.
6. **Persist** — `AddOrBump`, then notify the UI.

Rich `CF_HTML` clipboard content is read for the page URL, which feeds the `url` auto-sort rules.

---

## 6. Hotkeys

Two distinct mechanisms live in [`Services/HotkeyService.cs`](../Services/HotkeyService.cs):

- **Default binding — `Ctrl+Shift+V`**, registered with Win32 `RegisterHotKey` using
  `MOD_NOREPEAT`.
- **Custom binding — user-configurable.** If the user's chosen combo involves the **Windows key**,
  a low-level `WH_KEYBOARD_LL` hook is used instead, because Win+V is already claimed by the OS
  and `RegisterHotKey` cannot observe modifiers in that combination. The hook tracks a fire latch
  that releases when the target key **or any participating modifier** goes up, so out-of-order
  modifier release cannot wedge it.

If a custom combo fails to register, the service silently falls back to `Ctrl+Shift+V`.

In-window shortcuts are handled declaratively by the frontend in
[`ui/js/keyboard.js`](../ui/js/keyboard.js) — see the table in [README.md](../README.md).

---

## 7. Privacy Posture

**No telemetry, no analytics, no account, no crash reporting.** No `HttpClient`, `WebRequest`, or
any `System.Net` usage exists in the C# codebase.

There *are* three outbound HTTPS requests, all from the frontend, all user-initiated, and all
read-only fetches of static JSON:

| Purpose | URL | Trigger |
| :--- | :--- | :--- |
| Update check | `raw.githubusercontent.com/maazvfx/dualclip-releases/main/version.json` | User clicks "Check for updates" |
| Remote links | `raw.githubusercontent.com/maazvfx/dualclip-links/main/links.json` | User opens the links/settings section |
| Website / tip | `dualclip.vercel.app` | User clicks a link |

Download URLs coming back from the version manifest are re-validated against an HTTPS + GitHub
host allowlist before they are ever opened, so a compromised manifest cannot redirect a user to
an arbitrary host.

Clipboard contents are **never** transmitted. This is verifiable by inspection: no code path
serializes clip text into an outbound request.

---

## 8. Build & Packaging

### Build

```powershell
taskkill /F /IM DualClip.exe 2>$null
dotnet build -c Debug   -warnaserror
dotnet build -c Release -warnaserror
```

Both configurations build with **0 errors and 0 warnings**. There is no `.sln`.

### Test

```bash
dotnet test
```

280 xUnit tests live in `DualClip.Tests/`, which references the main project. Each test builds a
throwaway SQLite database in a temp directory and disposes it, so the suite never touches a real
user history and tests cannot leak state into one another.

### Package

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-release.ps1
```

The script runs `node -c` over every file in `ui/js`, builds Debug and Release with warnings as
errors, publishes self-contained `win-x64`, and then produces two artifacts in `dist/`:

| Artifact | Notes |
| :--- | :--- |
| `DualClip-Setup-1.0.0.exe` | Inno Setup 6. `PrivilegesRequired=lowest` → **no UAC prompt**. Optional desktop shortcut and a `HKCU\...\Run` autostart entry. Excludes `portable.dat` so an installed copy never flips into portable mode. Includes a WebView2-runtime availability check that falls back to checking for Edge itself. |
| `DualClip-Portable-1.0.0.zip` | Self-contained payload plus a `portable.dat` marker. Non-exe files are marked hidden so extraction looks clean. |

`scripts/publish-release.ps1 -ReleaseOutDir <path>` copies both artifacts elsewhere; `-SkipInstaller`
skips the Inno Setup step if `ISCC` is not on PATH.

### Requirements

- .NET 10 SDK to build (not to run — release builds are self-contained)
- Inno Setup 6 for the installer
- Node.js only for the JS syntax-check step

---

## 9. Known Rough Edges & Findings

1. **Split data roots.** The database lives under `%LOCALAPPDATA%` while settings and images live
   under `%APPDATA%`, with no migration between them.
2. **URL auto-sort matching has a permissive branch.** A substring match runs before the strict
   host check, so any input that literally contains the pattern textually matches regardless of its
   real host. The strict host comparison is correct but shadowed for those inputs.
3. **Two auto-sort engines exist** — one in C#, one in the frontend. The frontend one can override
   the collection actually shown.
4. **In-app update check reaches out** on demand (see §7). Not telemetry, but not zero-network
   either.
5. **Exported clips above ~250k characters** are dropped on re-import, and an image with a missing
   binary can still be listed in `clips.json`.
6. **Dead Code Cleaned in Refactoring**:
   - `Services/DatabaseService.cs`: `ClearAll()` and `GetClipsForCollectionExport()` (pruned).
   - `Services/WindowPlacement.cs`: `TopLeft()` (pruned).
   - `ui/js/core/state.js`: Dead unreachable calculation block in `formatClipForUI` (pruned).

> **Convention worth preserving:** image `content_hash` values are stored as **uppercase** hex.
> The column has no `COLLATE NOCASE`, so the dedupe comparison (`WHERE content_hash = $h`) is
> case-sensitive and every write site must agree on the casing. This was a live bug — import
> lowercased image hashes while capture stored them uppercase, so re-importing a package duplicated
> image rows and image files. Import now normalises to uppercase.
>
> **`MaxClips` is amortized, not instantaneous.** Capture calls
> `EnforceMaxClipsIfNeeded`, which counts at most once every `TrimCheckInterval` (25) new clips to
> keep `COUNT(*)` off the clipboard hot path. The store can therefore hold up to
> `MaxClips + 25` clips briefly. Growth is bounded; it is no longer unbounded between setting
> changes. `EnforceMaxClips` remains the immediate, exact trim used when the setting is saved.
>
> **`ReArmListener()` is critical live code.** Called on Windows resume from sleep (`PowerModes.Resume`)
> and session unlock (`SessionSwitchReason.SessionUnlock`) to cycle the Win32 clipboard format
> listener registration. Never prune it.
>
> **Modal base styles live in `ui/css/settings.css`.** The `.modal-overlay` and `.modal-card` blocks
> at the top of `settings.css` are the foundation that centers dialogs and sets backdrops across the
> entire app (`overlays-modals.css` only provides overrides). Never delete them as duplicates.

---

## 10. Contributing & Architecture Standards

- Never run the app as part of a build or test loop — kill any running `DualClip.exe` first.
- Any change to the RPC surface must update **both** `MainForm.RpcDispatch.cs` and
  `ui/js/core/rpc-contracts.js`.
- Schema changes belong in `InitializeDatabase` using `EnsureColumn`, never as an in-place
  `ALTER` at a call site.