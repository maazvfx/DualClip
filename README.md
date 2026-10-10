# DualClip ⚡

A high-performance, lightweight clipboard manager for Windows built with **C# (.NET 10), WinForms, and WebView2**.

---

## 🌟 Key Features

* 🚀 **Instant Hotkey Activation**: Fast, flicker-free summon near the cursor or in center screen.
* 📋 **Rich History & Pinning**: Pin favorites to top, rename clips, and assign tags.
* 🔍 **Instant Type-to-Search**: Start typing immediately on summon to filter clips with fuzzy matching and full-text search.
* 🎨 **Clean Layout Modes**:
  * **Standard Mode**: Full view with metadata and customizable line density.
  * **Compact Mode**: Ultra-dense minimal view with automatic metadata suppression and zero layout shifting.
* 🛡️ **Privacy & Security First**:
  * Automatically ignores credentials copied from 1Password, Bitwarden, KeePass, and other vaults.
  * Optional screen-capture protection to block recording tools.
* ⌨️ **Quick Number Paste (1–9)**: Paste badged items directly with number keys.

---

## 🛠️ Building from Source

### Prerequisites
* Windows 10/11
* [.NET 10 SDK](https://dotnet.microsoft.com/download)
* WebView2 Evergreen Runtime

### Build & Run
```bash
# Clone the repository
git clone https://github.com/maazvfx/DualClip.git
cd DualClip

# Build solution
dotnet build

# Run application
dotnet run --no-build
```

---

## 📖 Documentation
* [Architecture Overview](docs/ARCHITECTURE.md)
* [User Guide & Shortcuts](docs/USER_GUIDE.md)

---

## 📄 License
DualClip is proprietary software. All rights reserved.
