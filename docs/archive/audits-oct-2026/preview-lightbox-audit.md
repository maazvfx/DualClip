# Architecture & Code Quality Audit: ui/js/overlays/preview-lightbox.js

## 1. Module Purpose & Responsibilities
- `preview-lightbox.js`: Full-screen modal inspector for both text clips and image screenshots.
- Key responsibilities:
  1. Spacebar QuickLook: Immediate inspection of clip contents with anchor retention (`_previewAnchor`) ensuring the main list scroll offset does not jump on close.
  2. Image Lightbox with Pan & Zoom: Supports `fit`, `100%`, `fill`, and continuous wheel zoom (`0.25x` to `8.0x`), mouse drag panning, and drag-to-desktop (`onLightboxImageDragStart`).
  3. High-Res Image Resolution: Lazy-fetches uncompressed local temp files via `get_clip_temp_file` or local file protocol if initial payload only included thumbnails.
  4. In-Place Text Editor: Large text streaming (up to full database clip size), live line/word/character statistics, wrap toggle (`Wrap: ON/OFF`), and Ctrl+Enter quick save.

## 2. Dead Code & Safe Pruning Targets
- Fallback mock host URLs: References to dummy image schemes `https://images.example/` (lines 149, 156, 175) from early prototyping can be cleaned up to rely solely on local WebView2 data URLs or virtual host mapping.
- Redundant try-catch wrappers around style sets: Extensive `try { img.style.opacity = '1'; } catch {}` statements that add verbosity without actual exception risk.

## 3. Performance & Memory Hotspots
- Pan/Zoom mouse move event listener (`lightboxMouseMoveHandler`):
  - Fires continuously on mousemove during panning. Applies CSS transforms directly to the DOM without requestAnimationFrame throttling (`applyImageZoom()`).
  - Wrapping pan updates in `requestAnimationFrame` would guarantee smooth 60/120Hz panning without intermediate style recalculations.
- Large text editing in `textarea`:
  - When loading multi-megabyte text clips (>500KB), `textBody.value = text` and subsequent word count regexes `(val.trim().match(/\S+/g) || []).length` cause a multi-hundred millisecond lockup on the main thread. Word count regex should be capped to the first 50KB or offloaded.

## 4. Code Duplication & Refactoring Targets
- Generation Counter Guards: Multiple asynchronous callbacks track `myGen = ++_previewGen` to discard stale network/IPC calls. A clean `AbortController` or cancellation token pattern would make this consistent across all async loaders.
- Save logic: `savePreviewClip()` duplicates optimistic in-memory updating and error reconciliation seen in `actions.js`.

## 5. Critical Invariants (DO NOT TOUCH)
- **Viewport Anchor Restoration (`_previewAnchor`)**: Must strictly capture `{ id, idx, scrollTop, viewportOffset }` before opening and restore the exact scroll position on close. Bypassing this causes the list to jump erratically when previewing clips via Spacebar.
- **Generation Token `_previewGen`**: Required to prevent late-arriving image payloads from a previously inspected clip from overwriting the image of a newly opened clip.
- **`saveBtn` Disabled State**: Must keep save button disabled until real textual modification occurs, preventing accidental database timestamp rewrites.

## 6. Prioritized Action Plan
- **Medium**: Throttle `applyImageZoom()` calls during drag-panning via `requestAnimationFrame` for buttery-smooth 120Hz display refresh.
- **Medium**: Cap text statistics calculation (word count regex) on giant clips to prevent UI freeze.
- **Low**: Remove legacy `https://images.example/` placeholders in favor of native WebView2 asset schemes.
