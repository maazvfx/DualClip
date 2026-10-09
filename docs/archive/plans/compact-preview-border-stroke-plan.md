# Plan: Compact Preview Window Border & Stroke Matching

## 1. Verification Findings
- **Main Window Stroke Definition**: In [ui/css/base-variables.css](file:///c:/Users/Maaz/Documents/DualClip/ui/css/base-variables.css#L688-L705), the main application window (`#appFrame`) renders its perimeter stroke via:
  ```css
  #appFrame {
    border: 1px solid var(--frame-border, var(--border));
  }
  ```
  When "Hide Window Border" is toggled on, it uses:
  ```css
  html[data-window-border="hidden"] #appFrame {
    border: none !important;
  }
  ```
- **Compact Preview Discrepancy**: In [ui/css/overlays-modals.css](file:///c:/Users/Maaz/Documents/DualClip/ui/css/overlays-modals.css#L1898-L1912), the compact preview overlay renders edge-to-edge (`100vw` × `100vh`) with `border: none !important` and hardcodes an inset blue accent line:
  ```css
  box-shadow: inset 0 0 0 1px var(--accent, #3b82f6) !important;
  ```
  This creates an inconsistency with the main history window, which uses the theme's natural frame border (`var(--frame-border, var(--border))`).

## 2. Proposed Solution
1. Update `overlays-modals.css` so the compact preview card uses the exact same frame border / stroke line as `#appFrame`:
   - Replace `var(--accent, #3b82f6)` with `var(--frame-border, var(--border))`.
   - Ensure `box-shadow: inset 0 0 0 1px var(--frame-border, var(--border)) !important;` so the 1px stroke line renders crisply inside the edge-to-edge frame without causing layout overflow.
   - Add a rule for `html[data-window-border="hidden"]` to remove the inset stroke when the user has disabled window borders.
2. Verify with `node --check` / build checks.

## 3. Verification Steps
- Check that when opening preview (Spacebar) in Compact mode, the outer stroke line matches the main history window border across light and dark themes.
- Confirm that no scrollbars or overflow gaps appear.
