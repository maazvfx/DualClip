# Ideas & Feature Backlog

## Preview Dialog Enhancements

### 1. Full-Size / Maximize Mode Button
- **Idea**: Add a dedicated button/toggle to expand the preview dialog window into full-size / maximized mode.
- **Goals & Value**:
  - Make viewing large clipboard snippets, high-resolution images, long code blocks, and formatted text easier without cramped scrolling.
  - Quick toggle between standard modal overlay size and full-screen/expanded view.
- **Considerations**:
  - UI button placement in the preview dialog header / toolbar (e.g., alongside close/copy actions).
  - Responsive adjustment of preview content (syntax highlighting, markdown rendering, images) when expanded.
  - Keyboard shortcut support (e.g. `F11` or `Alt+Enter` / maximize shortcut).

---

## Tray Menu Enhancements

### 1. "Settings" Menu Option in System Tray
- **Idea**: Add a direct "Settings" option to the system tray context menu.
- **Goals & Value**:
  - Allow users to open and configure DualClip settings directly from the Windows taskbar / tray icon without first opening the main clipboard UI.
- **Considerations**:
  - Wire up tray click handler in WinForms tray menu context (`Program.cs` / `AppContext` / tray manager).
  - Open main window and directly navigate/open the Settings modal or tab.

---

## User Feedback & Support (Email / Gmail Direct Link)

### 1. Direct Email & Pre-filled Webmail Redirection (v1 Lean Design)
- **Concept**: Provide a simple, 0-maintenance feedback button/link in **Settings > About / Feedback** and on the website that opens the user's email client (or Gmail web compose).
- **Implementation Strategy**:
  - **Primary Action (Desktop / Default Mail Client)**: `mailto:support@dualclip.com?subject=DualClip%20Feedback&body=...` (auto-fills app version, OS build, and a template for Bug/Feedback/Feature).
  - **Web Action (Direct Gmail Web Compose)**: `https://mail.google.com/mail/?view=cm&fs=1&to=support@dualclip.com&su=DualClip+Feedback&body=...`
  - **Copy Email Button**: 1-click button to copy support email to clipboard in case no client opens.
- **Why this is best for v1**:
  - Zero backend/serverless code to build or maintain.
  - Users can naturally drag-and-drop screenshots and files directly into their own email composer.
  - You automatically get their verified email address and can hit "Reply" directly.

---

## Future Roadmap (Post-v1 / Later)
> **Product Decision**: v1 launches 100% free, local-first, zero login/sync required.
> For the comprehensive architectural roadmap (OCR, Multi-Device Sync, Snippets, Plugins), see [`docs/knowledge/FEATURE_STATUS.md`](../knowledge/FEATURE_STATUS.md).

### 1. Multi-Device Sync (Local LAN, Shared Folder, Cloud/DB)
- **Local Network / LAN (P2P)**: Automatic device discovery via mDNS / UDP broadcast + encrypted peer-to-peer WebSocket / TLS transfer over home/office Wi-Fi.
- **Local Folder / Shared Directory**: Sync via custom shared directory (NAS folder, Syncthing, network share) using incremental SQLite/JSON changelogs.
- **Optional Cloud Sync & User Accounts**: Optional login (Supabase / Postgres / Cloud storage) with end-to-end encryption (E2EE) and CRDT conflict resolution.

---

## Release & Production Checklist

### 1. Disable Live Reloading Before Packaging
- **Note**: Ensure dev live-reloading / hot-reload flags and listeners are disabled before building production installer (`.exe`/`.msi`) and `.zip` distribution archives.
- **Action Items**:
  - Verify release build configurations (`#if DEBUG` or production build flags) enforce dev reload suppression.
- Pre-release check: test clean launch without live-reload server / file watcher triggers.

---

## QA & Testing Checklist

### 1. Test "Preview per Clip" Dropdown Setting
- **Task**: Test the behavior and persistence of the "Preview per Clip" dropdown setting.
- **Verification Focus**:
  - Test dropdown value switching in Settings (e.g., toggle/adjust preview lines/clip mode).
  - Verify that changes apply immediately to clip list previews.
  - Verify persistence across app restart (settings saved to SQLite/config).

### 2. Comprehensive Import, Export & Clear History Testing (Agent & User Verification)
- **Task**: Fully verify all edge cases and workflows for Export, Import, and Clear History on both UI frontend and C# backend layers.
- **Test Matrix & Edge Cases**:
  - **Export**:
    - Export all history, filtered subset, pinned items, and mixed media (text, rich text, images).
    - Invalid/read-only path handling, cancellation, and large dataset performance.
  - **Import**:
    - Import clean file, malformed JSON/file, duplicate clips handling (merge vs overwrite vs skip).
    - Large import payload handling and UI list refresh sync.
  - **Clear History**:
    - Clear all unpinned history (ensure pinned clips remain protected).
    - Clear all history including pinned (when explicitly chosen).
    - Clear history by date range / filter.
    - Confirm DB transaction integrity and immediate UI list clearance.
- **Agent Task Scope**:
  - Prepare test scripts/automated test coverage + run end-to-end checks when user gives permission.

### 3. Manual User Verification: Text Drop onto Nested Collection
- **Task**: User manual interactive testing of dropping highlighted text onto a nested folder in the sidebar.
- **Verification Steps**:
  1. Create a parent folder (e.g. `Parent`) and a nested subfolder (e.g. `Child`).
  2. Select text externally or within app and drag-and-drop it directly onto `Child`.
  3. Verify the clip is added to `Child` and `Child` remains nested under `Parent` (does not pop out to top level).

### 4. Test Shift+Enter Action (Plain Text Paste / Multi-Action)
- **Task**: Test pressing `Shift+Enter` on selected clip in clipboard list.
- **Verification Focus**:
  - Verify `Shift+Enter` triggers the expected plain text paste / secondary paste action without UI window flicker or stuttering.
  - Verify smooth window hide / focus restore to the target application.
