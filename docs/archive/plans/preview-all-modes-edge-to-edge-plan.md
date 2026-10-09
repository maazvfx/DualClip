# Plan: Universal Edge-to-Edge Preview Across All View Modes

## 1. Problem Definition & Findings
- **Current Behavior in Standard / Large Modes**:
  - In Standard mode (680×540) and Large mode (960×720), the preview window opens as a centered floating card with blank backdrop gap spaces around it:
    - Text clips: `width: 560px`, `max-height: 85vh` ([ui/css/overlays-modals.css](file:///c:/Users/Maaz/Documents/DualClip/ui/css/overlays-modals.css#L2-L16)).
    - Image clips: `width: 780px`, `height: 82vh` ([ui/css/overlays-modals.css](file:///c:/Users/Maaz/Documents/DualClip/ui/css/overlays-modals.css#L19-L28)).
  - This creates visible blank margins around the preview dialog instead of seamlessly occupying the window like in Compact mode.
- **Desired Behavior**:
  - Open full edge-to-edge (`100vw` × `100vh`) in all view modes (Compact, Standard, Large), rendering as a dedicated full-window preview view with matching window frame stroke and zero wasted blank gaps.

## 2. Proposed Implementation
1. **Unify Edge-to-Edge Preview Styling** in [ui/css/overlays-modals.css](file:///c:/Users/Maaz/Documents/DualClip/ui/css/overlays-modals.css):
   - Apply the edge-to-edge dimensions (`width: 100vw !important`, `height: 100vh !important`, `max-width: 100vw !important`, `max-height: 100vh !important`, `margin: 0 !important`, `border-radius: 0 !important`) universally or per mode to `.preview-modal-overlay .modal-card` and `.preview-card`.
   - Ensure text preview bodies (`.preview-body`, `#prevContent`) expand to `max-height: none` / `flex: 1 1 auto` so content utilizes the full height.
   - Maintain `object-fit: contain` for images so screenshots/photos scale cleanly without cropping.
   - Include the inset matching perimeter frame stroke (`box-shadow: inset 0 0 0 1px var(--frame-border, var(--border)) !important;`) across all view modes.
2. **Verification & Checks**:
   - Verify with `node --check` / build.
   - Check text preview scrolling and image lightbox rendering across Compact (360×260), Standard (680×540), and Large (960×720) modes.
