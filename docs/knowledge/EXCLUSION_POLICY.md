# DualClip Security & Git Exclusion Policy

## Overview
This document defines the strict exclusion rules for DualClip. Any files matching these categories must **NEVER** be committed or tracked in git.

---

## 🚫 Categories of Excluded Files

### 1. 🔑 Certificates, Private Keys & Secrets
* **Patterns**: `*.pfx`, `*.pem`, `*.key`, `*.p12`, `*.jks`, `*.cer`, `*.crt`
* **Environment files**: `.env`, `.env.*`, `secrets.json`
* **Reason**: Prevents code-signing certificates and developer credentials from leaking.

### 2. 🗄️ Databases & User Data
* **Patterns**: `*.db`, `*.db-shm`, `*.db-wal`, `*.sqlite`, `*.sqlite3`
* **Reason**: Local clip history, database caches, and personal clipboard contents must remain local only.

### 3. 📦 Build Artifacts & Binaries
* **Patterns**: `bin/`, `obj/`, `dist/`, `TestResults/`, `*.exe`, `*.zip`, `*.dll`, `*.log`
* **Reason**: Keep the repository lightweight and source-only; releases are distributed via GitHub Releases.

### 4. ⚙️ IDE, Editor & Agent Local State
* **Patterns**: `.obsidian/`, `.freebuff/`, `.gemini/`, `.agent/`, `.claude/`, `.cursor/`, `.idea/`, `.vscode/`, `.vs/`
* **Reason**: Prevents developer-specific workspace caches and editor plugins from polluting git history.

### 5. 🗃️ Legacy Backups & Mockup Prototypes
* **Patterns**: `backup/`, `prototypes/`, `ui/preview-*.html`
* **Reason**: Legacy audit drafts and early HTML prototypes are archived locally/dev-only and kept out of production releases.

---

## 🛡️ Enforced in `.gitignore`
All the rules above are actively enforced by [`.gitignore`](../../.gitignore).
