# Agent brief: fix tap-to-zoom in a touch game

**Problem:** on mobile and tablet browsers (especially iOS/iPadOS Safari), rapidly tapping the on-screen buttons zooms the
page, and it stays zoomed. The same happens when a joystick finger and a button finger are down together.
`user-scalable=no` doesn't help (iOS ignores it), and neither does `preventDefault()` on pointer events.

**Fix:** add the drop-in `touch-zoom-guard` package, the canonical copy of which is in `mtd-public/sub-sinkers` under
`touch-zoom-guard/`. It contains `touch-zoom-guard.js`, `touch-zoom-guard.css`, `README.md` and `test/tap-spam.mjs`.

Steps:
1. Copy the `touch-zoom-guard/` folder into this repo unchanged, so fixes can be synced later.
2. Ensure the viewport meta is `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`.
3. Include `touch-zoom-guard.css` (before the game CSS) and `touch-zoom-guard.js` (before the game scripts).
4. Add `data-touch-allow` to every menu, dialog or overlay that needs normal taps or scrolling. Add `data-touch-control`
   to joystick/control elements that aren't `<button>` or `<canvas>`.
5. Call `TouchZoomGuard.init({ onZoomChange: z => { if (z) pause(); } })` once at startup.
6. Optionally call `TouchZoomGuard.enterFullscreen('landscape' | 'portrait')` from the start/play tap.
7. Make sure the game's touch controls use Pointer Events (not `click` or passive touch listeners), with per-`pointerId` tracking.
8. Remove any older ad-hoc zoom hacks in the game that fight with this, such as duplicate gesture blockers.
9. Run `node touch-zoom-guard/test/tap-spam.mjs <game url> --start "<start selector>" --buttons "<fire button selectors>"`.
   It must print PASS for both devices. Then verify the menus still work by tapping them.
