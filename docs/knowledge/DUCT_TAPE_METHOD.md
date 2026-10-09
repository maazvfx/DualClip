# Duct-Tape Method (reference)

## What it is
Fast temp test to narrow the fault circle. Turn OFF all suspects at once. See if the bug goes away.

## How it works
1. Commit first. You need a clean point to revert to.
2. Add one temp block at the end of the scoped file only (here: `ui/css/overlays-modals.css`). Turn off gutter, padding, badges, tick with `!important`.
3. Copy changed `ui/` files to both `bin/Debug/net10.0-windows/ui/` and `bin/Release/net10.0-windows/ui/`. Press Ctrl+R, repro with Ctrl+D.
4. Read result:
   - Fixed = cause is inside your OFF list. Circle smaller. Turn items back ON one by one to pinpoint.
   - Not fixed = OFF list missed it. Circle bigger. Look outside (modal width, outer padding, flex, WebView scroll).
5. Finish: remove temp tape. Keep only the one real fix.

## Example from Move dialog gap
OFF list: `#moveCollectionList` gutter + padding, `.move-sections-box` padding, `.move-collection-item` margin, badge + tick hide. Gap went away = fixable inside list padding/gutter. Turned numbers back ON — gap stayed away = numbers innocent. Kept real fix only:
`#moveCollectionModal .move-sections-box { padding: 4px; }`
`#moveCollectionModal #moveCollectionList { padding: 0; margin: 0; scrollbar-gutter: auto; }`

## Rule
Temp tape is throwaway. Never keep `!important` tape. Revert and keep one real fix.
