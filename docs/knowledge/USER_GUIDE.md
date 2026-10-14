# DualClip — User Guide & Documentation

DualClip is a fast, privacy-first clipboard manager for Windows. It runs entirely on your machine: no accounts, no cloud, no telemetry. Every copy you make is captured locally, indexed instantly, and searchable the moment you press the hotkey.

> Verified against the live codebase. Default values below reflect the shipped defaults in `ui/js/core/settings-defaults.js` and `Services/AppSettings.cs`.

---

## 1. Quick Start

### Installation & Launch
- DualClip runs as a lightweight tray application. It stays in the system tray and monitors the clipboard in the background.
- On first launch it creates your local database automatically — there is nothing to configure.

### Basic Workflow
1. **Copy anything** — text, code, images, animated GIFs, SVGs, files, rich text, or colours.
2. **Open DualClip** — press the global hotkey. The default is **`Ctrl+Shift+V`**.
3. **Pick and paste** — press `Enter` to paste and close, or `Shift+Enter` to paste and keep DualClip open so you can grab several clips in a row. Press `Esc` to dismiss.

---

## 2. Core Features

### Multi-Format Capture
DualClip detects and renders whatever you copy:
- **Plain text and code** — source-language detection for JavaScript, C#, Python, HTML, CSS, JSON, SQL and more.
- **Images and screenshots** — thumbnails for PNG, JPEG and BMP.
- **Animated GIFs** — play in place in previews.
- **Vector graphics** — SVG capture and rendering.
- **Rich text** — RTF and HTML from Word, browsers and email clients keep their formatting.
- **File drops** — copy files in Explorer to record their paths, sizes and types.
- **Colours** — HEX, RGB and HSL values get a colour swatch.

### View Modes & Layouts
- **Standard view** — the default card layout with source app, timestamp and item size.
- **Compact preset** — a denser layout for power users.
- **Sidebar mode** — a narrow vertical panel to dock beside an editor or IDE.
- **Layout and size presets** — choose `standard` or `compact` layout, `default` or `compact` sizing independently.
- **Seven visual styles** — *Linear*, *Notion*, *Nord*, *Geist*, *Raycast*, *Paper* and *Crisp*. Dark and light modes each remember their own style, so you can use Linear in dark and Paper in light at the same time.

---

## 3. Organization

### Collections
- Group clips into named collections such as *Code Snippets*, *Work Notes* or *Templates*.
- Move clips with `Ctrl+D` or the right-click context menu.

### Pinned & Starred
- **Pin** important clips so they stay at the top and survive cleanup.
- **Star** clips you use often. Starred items can also be boosted in search results (enable *Boost starred* in Settings).

### Auto-Sort Rules
Route incoming clips automatically by source application, format, or pattern match (Settings → Routing).

### Grouping
Choose how the list is grouped: by **time**, **date**, **app**, **format**, **priority**, or **none**.

---

## 4. Search & Filtering

- **Instant search** — searches clip text, preview, nickname, custom title and source app as you type.
- **Fuzzy search** — tolerates minor typos. Off by default; enable it in Settings → Search.
- **Filter chips** — narrow by format, app, time range and collection using the dropdown filters in the search bar.
- **Stale-response protection** — if you type quickly, only the newest query is applied, so results never jump backwards.

---

## 5. Keyboard Shortcuts

### Global
| Shortcut | Action |
| :--- | :--- |
| `Ctrl+Shift+V` *(configurable)* | Show / hide the DualClip window |
| `Win+V` | Also supported — set it in Settings → Shortcuts |

### While the window is open
| Shortcut | Action |
| :--- | :--- |
| `Enter` | Paste the selected clip and close |
| `Shift+Enter` | Paste and keep the window open (sequential paste) |
| `1` – `9` | Quick-paste one of the top nine items |
| `Up` / `Down` | Move through the list |
| `Delete` | Delete the selected clip |
| `Ctrl+B` | Pin or unpin |
| `Ctrl+S` | Star or unstar |
| `Ctrl+A` | Select all |
| `Ctrl+D` | Move to collection |
| `F2` or `Ctrl+T` | Rename / Set Nickname |
| `Ctrl+F` or `/` | Focus the search box |
| `Ctrl+,` | Open Settings |
| `Ctrl+Tab` | Toggle View Mode (Standard / Compact) |
| `Esc` | Close the window or dialog |

> Inside dialogs, `Tab` and `Enter` move between fields and confirm, and `Esc` cancels.

---

## 6. Privacy & Security

- **Everything stays local** — your history lives in a SQLite file on your machine. Nothing is uploaded.
- **Password manager exclusion** — clips copied from password managers are ignored automatically. This covers Bitwarden, 1Password, KeePass / KeePassXC, LastPass, Dashlane, Enpass, Proton Pass, NordPass, RoboForm, Keeper, Sticky Password, PasswordSafe, Zoho Vault, Myki, mSecure and any window whose title or process contains *vault* or *authenticator*.
- **Pause capture** — turn on Incognito in Settings, or pause from the tray menu. The tray also offers timed pauses: 5, 15 or 30 minutes, or until you resume.
- **Clear on lock** — optionally wipe history when Windows locks or sleeps. You can either clear everything or keep pinned clips only. Off by default.
- **Screen capture protection** — DualClip asks Windows to exclude its window from screen recordings and screenshots, so it stays blank in recordings.
- **URL cleaner** — tracking parameters (`utm_*`, `fbclid`, `igshid`, `ttclid`, `twclid`, `pd_rd_*`, and similar) are stripped from copied links automatically.

---

## 7. Settings

Open Settings with `Ctrl+,` or the gear icon.

### General
- **Run at Windows startup** — adds DualClip to your Windows startup apps so it launches minimised in the tray. *(Not available in portable mode.)*
- **History limits** — maximum clips kept (default **500**) and automatic expiry by days (default **off**, `0`).
- **Window position** — pop up near the cursor, near and above, centred, or at the last dragged position.

### Appearance
- **Theme** — dark, light, or follow your Windows theme.
- **Visual style** — seven styles, remembered separately for dark and light.
- **Zoom** — 90%, 100%, 110% or 125%.
- **Density, line display and metadata** — control how much detail each row shows.
- **Thumbnail size** — small, medium or large.

### Behavior
- **Fuzzy search** (Settings → Search) and **boost starred** to prioritize your favorite clips.
- **Blocklist** — add executable names (for example `confidential-app.exe`) so their clipboard copies are never captured.
- **History and storage** — size limits, retention, and where the database lives (Settings → Storage).

---

## 8. Files & Data

| What | Where |
| :--- | :--- |
| Clip database | `%LOCALAPPDATA%\DualClip\data\clips.db` |
| Settings and app data | `%APPDATA%\DualClip\` |
| Portable mode | Drop a file named `portable.dat` next to `DualClip.exe`; data moves to `portable_data\` beside the app |
| Custom location | Set the `DUALCLIP_DB_PATH` environment variable to place the database anywhere |

**Backup** — close DualClip, then copy `clips.db` (plus its `-wal` file if present) to a safe place. Restore by copying it back.

---

## 9. Troubleshooting

**Q: `Enter` does not paste.**
**A:** DualClip simulates keystrokes to paste. If the target app runs as Administrator, DualClip must run as Administrator too — otherwise Windows blocks the lower-privilege window. Pasting into an elevated app from a normal app, or the reverse, fails by design.

**Q: A clip I copied is missing.**
**A:** Check, in order: Incognito mode is off, the tray is not paused, the source app is not a password manager or on your blocklist, the value is not over the 500-clip limit, and no auto-expiry rule removed it.

**Q: Nothing appears until I click the window.**
**A:** Check whether *Run at Windows startup* or *Autofocus search* behaviour in Settings was changed, and confirm the hotkey is not being intercepted by another app.

**Q: How do I move my history to another PC?**
**A:** Copy the database file to the same path on the other machine, or use **Export** — it writes a single `.zip` containing `manifest.json`, `clips.json`, `collections.json` and your images, which can be imported back into DualClip.

**Q: Can I restore a deleted clip?**
**A:** Deletions are not undoable from the UI. This is why pinned clips exist — keep anything you cannot lose, and back up the database periodically.