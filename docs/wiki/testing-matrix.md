# Testing & Invariant Verification Matrix

## Overview
DualClip has a dual-layer test strategy:
- **Node.js harnesses** (9 files) execute the *real* frontend modules inside a DOM shim and assert behaviour.
- **.NET xUnit suites** (31 files) cover backend persistence, search SQL, window geometry, packaging, and structural contracts over the JS/C# boundary.

There is no test runner script — run both layers manually.

---

## 🟢 Node.js Invariant Harnesses
Run from the repo root. These load real source via `vm.runInThisContext`, so a top-level `var` in the frontend becomes a true global.

| Harness | Covers |
| :--- | :--- |
| `ui-navigation-invariants.js` | Search filtering scopes, keyboard routing, Escape ladder, modal dialog lifetimes |
| `ui-bulk-invariants.js` | Shift-range select, Ctrl+A, bulk delete/merge, fuzzy matcher, unmapped-key safety |
| `ui-interaction-invariants.js` | Drag-and-drop, context-menu + selection interaction, sidebar collapse |
| `rpc-bridge-invariants.js` | Executes real `bridge.js`, asserts the argument array reaching the host per method |
| `auto-tier-invariants.js` | `getAdaptiveTier()` classifier + dense `getRowHeight()` per-tier buckets |
| `format-detection-invariants.js` | `getFormatTag()` edge cases: JSON, PowerShell, shebangs, `#` comments, fences, 250KB payloads |
| `group-count-invariants.js` | Group header counts render `N+` when a run hits the end of the loaded page window |
| `mode-switch-invariants.js` | `changeQuickViewLayoutPreset()` for Standard / Compact / Expanded |
| `pagination-invariants.js` | `loadNextClipPage()` index clamping and viewport chunking |

Run one:
```powershell
node DualClip.Tests/js-harness/rpc-bridge-invariants.js
```
Run all:
```powershell
Get-ChildItem DualClip.Tests\js-harness\*.js | ForEach-Object { node $_.FullName; if (-not $?) { "FAILED: $($_.Name)" } }
```

---

## 🔷 .NET xUnit Suites

```powershell
dotnet test DualClip.Tests/DualClip.Tests.csproj
```

### Structural / contract
| Suite | Asserts |
| :--- | :--- |
| `RpcContractInvariantTests` | 5 guards tying `rpc-contracts.js` to the host `switch (method)`: every handler contracted, every contract handled, counts equal, arg names unique identifiers, no handler reads past declared arity |
| `UiStaticInvariantTests` | Static assertions over the shipped HTML/JS |

### Backend data & lifecycle
| Suite | Asserts |
| :--- | :--- |
| `DataLifecycleInvariantTests` | WAL mode, backup/restore round-trips, pruning |
| `ClearHistoryScopeTests` | The full destructive-delete checkbox matrix |
| `ClearOnLockTests` | Clear-on-lock behaviour |
| `MaxClipsEnforcementTests` | Cap enforced during capture, not only on setting change |
| `DeduplicationTests` | `content_hash` dedup is **case-sensitive** and consistently uppercase hex |
| `ExportImportOrderingTests` | Export writes chronological `sort_rank`; import sorts by it then **densely renumbers** |
| `PackageValidationTests` | `.dualclip` / `.zip` validation and rejection paths |
| `AddTextToCollectionTests` | Add-to-collection flow |
| `ClipRenameTests` | Clip rename |

### Search
| Suite | Asserts |
| :--- | :--- |
| `SearchScopeTests` | Search scope filtering |
| `SearchTokenizationTests` | FTS5 `porter unicode61` tolerance for `C++`, wildcards, boolean words, paths, punctuation |
| `TagAndNicknameQueryTests` | `tag:` / `nick:` prefixes resolve against real tables, never degrade to full-text scan |
| `AutoSortPatternTests` | `MatchUrlPattern` reached **reflectively** (Win32 type, not constructible) |
| `AutoTierInvariantTests` | `auto` line-density repair |

### Clipboard capture
| Suite | Asserts |
| :--- | :--- |
| `FormatDetectionInvariantTests` | Format detection + syntax classification rules |
| `RichTextCaptureTests` | RTF capture |
| `FileDropCaptureTests` | `CF_HDROP` multi-file capture |
| `SvgVectorCaptureTests` | SVG vector capture |
| `GifCaptureTests` | Animated GIF capture |
| `OversizedDropNotificationTests` | Oversized-drop notification |

### Window geometry
| Suite | Asserts |
| :--- | :--- |
| `WindowPlacementTests` | Multi-monitor + mixed-DPI placement via pure geometry math; never off-screen or clipped by a taskbar |
| `WindowSizePolicyTests` | Which bounds a summon restores **before reveal** — the contract that kills the Compact summon flicker |

### UX / frontend-adjacent
| Suite | Asserts |
| :--- | :--- |
| `SidebarLayoutTests` | Sidebar section toggling |
| `SidebarNestedAdversarialTests` | Nested sidebar drag, selection, pywebview/chrome bridge shims |
| `CompactAndSearchInteractionTests` | Compact preview auto-expand/collapse, idle search row; `preview-window.html` must **not** exist |
| `ModeSwitchInvariantTests` | View-mode switch flow + RPC surface |
| `GroupCountPaginationTests` | Group counts + pagination fixes |
| `QuickNumberPasteTests` | Quick-number paste stepping |

### Support
| Suite | Asserts |
| :--- | :--- |
| `UrlCleanerTests` | Tracking-parameter stripping |

`TestDb.cs` is a shared fixture/helper, not a suite.

---

## 🔁 Running everything
```powershell
dotnet test DualClip.Tests/DualClip.Tests.csproj
Get-ChildItem DualClip.Tests\js-harness\*.js | ForEach-Object { node $_.FullName }
```