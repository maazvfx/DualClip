# DualClip — Feature Status & Architectural Intent

This document records what is built, what is intentionally skipped, and what is currently planned or being prototyped.

---

## 1. Deliberately Skipped (Out of Scope / Rejected)

| Feature | Category | Rationale |
|---|---|---|
| **Virtual Desktop Separate Histories** (3A) | System Hooks | Fragile undocumented Windows COM API (`IVirtualDesktopManager`) prone to breaking across OS updates; breaks natural cross-desktop copy-paste expectations. |
| **Background Folder-Watch Auto-Import** (3B) | File System | Unsolicited background file scraping without explicit user clipboard action conflicts with user expectations and adds disk I/O overhead. |
| **Direct Delayed Rendering / Chaining** (3D) | COM / Ole | High risk of system-wide clipboard lockups across other third-party Windows apps if COM marshalling / STA thread stalls. |

---

## 2. Planned / Prototyping Roadmap

| Feature | Category | Strategy & Architecture |
|---|---|---|
| **On-Device Image OCR** (3C) | AI & Vision | Build and stress-test in an isolated **standalone sandbox app** first. Must be 100% asynchronous and local-only (`Windows.Media.Ocr`) so image text search never slows down the primary clipboard capture path. |
| **User Plugins & Custom Scripting** | Extensibility | Provide user scripting with built-in safeguards: user accountability disclaimers, permission prompts for network/disk operations, and AI-assisted safety analysis to detect suspicious patterns. |
| **Snippets & Text Expansion** | Productivity | Design and review full frontend UI mockups first (templates, variable placeholders like `{date}`, `{clipboard}`, `{input}`) before building backend storage and hotkey injection. |
| **Sync (Local Wi-Fi & Cloud)** | Multi-Device | Support two modes: (1) Local P2P Wi-Fi sync for self-hosted / local networks, and (2) Optional End-to-End Encrypted (E2EE) sync via free-tier cloud backends / WebDAV. |
| **AI & Translation Actions** | Intelligence | Deferred for later exploration when lightweight on-device local models or optional user-provided API keys are integrated. |
| **Mobile Companion App** | Platform | Deferred for post-desktop maturity. |
