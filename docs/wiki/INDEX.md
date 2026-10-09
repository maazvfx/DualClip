# DualClip LLM-Wiki Index

This is the centralized, living technical reference for DualClip architecture, UX contracts, frontend modules, backend services, and test suites.

Links are relative, so this index works from any checkout location.

---

## 🧭 Core Subsystem Guides

- **[Keyboard, Focus & Escape Hierarchy](keyboard-and-focus.md)**
  - Event flow, 5-layer Escape ladder, input shields, shortcut bindings, and tab traps.
- **[Overlays, Context Menus & Modals](overlays-and-modals.md)**
  - Modal stack manager, context menus, popovers, lightbox preview, and pinning contracts.
- **[Window Lifecycle & Sizing](window-lifecycle.md)**
  - Summoning, auto-hide blur guards, preset sizes, compact morphing, and DPI handling.
- **[Clipboard Capture & Listener Engine](clipboard-capture.md)**
  - Win32 sequence monitoring, re-arm timers, format sniffers, and self-capture suppression.
- **[Search Engine & SQLite](search-and-database.md)**
  - Dual-tier prefix/substring search, tag filtering, indexing, and WAL mode lifecycle.
- **[Virtual List & Rendering Engine](virtual-list-and-rendering.md)**
  - Viewport DOM windowing, line clamps, zebra striping, and tag badges.
- **[Settings & Preferences Engine](settings-and-storage.md)**
  - `localStorage` mirrors, hotkey recorder, portable vs installed paths, backup/export/restore, and the URL cleaner.
- **[RPC Bridge & Frontend-Host Contracts](rpc-and-bridge.md)**
  - `callHost` / `PostWebMessageAsJson` protocols, the 119-method contract registry, and host event payloads.

---

## 🧪 Testing & Invariant Verification

- **[Testing Matrix & Invariant Suites](testing-matrix.md)**
  - All 9 Node.js invariant harnesses and 31 .NET xUnit suites with execution commands.

---

## 📚 Sibling Layers

| Layer | Purpose |
| :--- | :--- |
| [`docs/knowledge/ARCHITECTURE.md`](../knowledge/ARCHITECTURE.md) | System-level architecture |
| [`docs/CODEMAP.md`](../CODEMAP.md) | Symbol-to-file routing map |
| [`docs/STATE.md`](../STATE.md) | Active focus and recent resolutions |
| [`docs/DECISIONS.md`](../DECISIONS.md) | Recorded decisions and rationale |
| [`docs/QUEUE.md`](../QUEUE.md) | Queued work |
| [`docs/RULES.md`](../RULES.md) | Project rules for agents |

**Read-first discipline:** before editing code, read the relevant wiki page and the CODEMAP entry for the symbol. After editing, update the wiki page if a documented contract changed.

---

## 📜 Logging & State Standards
- **Daily / Micro edits**: Tracked cleanly via background Git commits.
- **Milestone status**: Documented in [`docs/STATE.md`](../STATE.md).

---

## ✅ Doc Lint

Wiki pages are checked against the code for broken links and stale symbols:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-docs-freshness.ps1
```

Run it before committing doc changes.