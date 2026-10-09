# Refactoring & Cleanup Implementation Plan

## Summary & Objectives
Based on the comprehensive codebase audit (`docs/audits/`), this plan outlines safe, step-by-step refactoring tasks to eliminate dead code, consolidate duplication, and streamline styling without altering any critical app behavior or invariants.

---

## Phase 1: Safe Dead Code Pruning (Zero Risk)
- [x] **1.1 Backend Database Clean-up** (`Services/DatabaseService.cs`):
  - Pruned unused legacy helpers: `ClearAll()` and `GetClipsForCollectionExport()`.
- [x] **1.2 Window Placement Clean-up** (`Services/WindowPlacement.cs`):
  - Pruned unused `TopLeft()` placement helper.
- [x] **1.3 Frontend State Dead Block Pruning** (`ui/js/core/state.js`):
  - Pruned dead, unreachable time group calculation block in `formatClipForUI()`.
- *(Note: `ClipboardListener.ReArmListener()` verified as live active code on sleep resume/unlock; retained permanently.)*

---

## Phase 2: Duplicate Code Consolidation (Medium Risk)
- [x] **2.1 Frontend Pin & Favorite Flag Toggle Consolidation** (`ui/js/list/actions.js` & `ui/js/keyboard.js`):
  - Created `toggleClipProperty` parameterizing all entry points (context menu, row quick buttons, Ctrl+B, Ctrl+S) while strictly preserving pin time-group/sort recalculations, favorite backend count invalidations, selection anchors, and pre-RPC optimistic override updates.
- [x] **2.2 Modal Dismissal Helper** (`ui/js/overlays/modals.js` & `ui/js/keyboard.js`):
  - Retained clean layered hierarchy (dropdowns/popovers first, then modals with `getTopModal()` fallback, then search clear, then window hide) preventing any escape double-fires.
- [x] **2.3 Settings Boolean Binding Consolidation** (`ui/js/settings/settings-appearance.js`):
  - Created `createBooleanAppearanceSetting()` factory reducing boilerplate while preserving individual DOM attribute/class toggles and setting notification events.

---

## Phase 3: Stylesheet & Performance Polish (Low Risk)
- [x] **3.1 Modal Base / Override CSS Architecture** (`ui/css/settings.css` & `ui/css/overlays-modals.css`):
  - Preserved base modal definitions in `settings.css` and recorded permanent invariant in `ARCHITECTURE.md` to prevent accidental pruning.
- [x] **3.2 Lightbox CSS Selector Optimization** (`ui/css/overlays-modals.css`):
  - Verified `:has()` and class-based selector pairs are kept in sync with fallback rules preserved.
- [x] **3.3 Virtual List CSS Isolation** (`ui/css/clip-list.css`):
  - Added `contain: layout style;` to `.clip-row` for faster virtualized scroll repainting.

---

## Phase 4: Final Verification & Test Suite
- [x] Run full test suite (`dotnet test` & Node.js invariant harnesses: `ui-interaction-invariants` 19/19, `ui-bulk-invariants` 9/9, `ui-navigation-invariants` 12/12, `pagination-invariants` 7/7).
- [x] Verify hotkey activation, window positioning, clipboard captures, and pinned window behavior.
