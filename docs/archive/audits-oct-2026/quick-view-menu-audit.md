# Architecture & Code Quality Audit: ui/js/settings/quick-view-menu.js

## 1. Module Purpose & Responsibilities
- `quick-view-menu.js`: Populates, opens, and synchronizes the compact Quick View dropdown menu located in the top navigation bar.
- Key responsibilities:
  1. Declarative Menu Configuration (`QUICK_VIEW_MENU_CONFIG`): Defines sections (Layout & Preset, Style & Appearance, Item Display & Meta) with options, storage keys, and callbacks.
  2. Macro Preset Bundling (`changeQuickViewLayoutPreset`): Dynamically reconfigures density, window size, line limits, metadata, thumbnail sizes, and zoom level when switching between `Standard` and `Compact`.
  3. Dynamic DOM Generation: Builds the quick menu layout on the fly and syncs values bidirectionally with the main Settings view controls.
  4. Design System Switching: Routes theme styling (`linear`, `notion`, `nord`, `geist`, `raycast`) and text contrast (`full`, `soft`, `dim`).

## 2. Dead Code & Safe Pruning Targets
- Defunct preset values: Legacy migrations for `expanded` layout preset (line 128) and removed design variants can be pruned.
- Unnecessary try-catch blocks: Deep nesting of 7 consecutive single-line `try { ... } catch (e) {}` blocks (lines 184–194) can be consolidated into a single guarded helper.

## 3. Performance & Memory Hotspots
- Double render passes on preset switch:
  - In `changeQuickViewLayoutPreset()`, calls `renderList()` or `renderVirtualWindow()` immediately and then triggers `_modeMorphTimer` timeout which calls them again at 220ms.
  - Causes a double-render pass during preset animations.

## 4. Code Duplication & Refactoring Targets
- Mirroring with `settings-core.js`:
  - `changeClipDetailsSetting`, `changeQuickViewZoom`, and `applyQuickViewWindowSize` re-implement settings update patterns found in `settings-core.js` and `settings-appearance.js`.
  - Synchronization logic (keeping `qv*` dropdowns in sync with `st*` dropdowns in the full Settings modal) is scattered across both files.

## 5. Critical Invariants (DO NOT TOUCH)
- **Macro Decoupling (User Customizations Overwrite Resistance)**: User's explicit line display (`dualclip_line_display`) and thumbnail size (`dualclip_thumb_size`) are deliberately preserved across Standard/Compact mode switching. Do not force-clobber them with preset defaults.
- **`hydrateOnly` Flag**: During startup hydration (`hydrateOnly = true`), macro sub-overrides must NOT execute, preventing initial settings from overwriting customized individual values.
- **`mainView` Specificity**: Layout preset classes (`layout-compact`, `layout-standard`) must only apply to `#mainView` and `#listContainer`, never the global root `body`, keeping `#settingsView` visually unaffected.

## 6. Prioritized Action Plan
- **Medium**: Unify bidirectional sync between `quick-view-menu.js` and `settings-core.js` using a shared settings event bus.
- **Low**: Consolidate consecutive try-catch blocks into a clean preset application routine.
- **Low**: Clean up obsolete `expanded` preset fallbacks.
