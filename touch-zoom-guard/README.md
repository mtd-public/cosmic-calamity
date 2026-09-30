# touch-zoom-guard

This is a drop-in fix for **mobile and tablet browsers that zoom a touch game when you tap rapidly** (fire buttons),
or when two fingers are down (joystick + button). It is one JS file and one CSS file, with no dependencies and no build step.

## Why it happens

| Cause | Browsers |
|---|---|
| **Double-tap-to-zoom** fires when two taps land within ~300 ms, so rapid fire-button taps trigger it | iOS/iPadOS Safari (and every iOS browser, since they all use WebKit), older Android Chrome |
| `user-scalable=no` / `maximum-scale=1` are **ignored** for accessibility | iOS 10+ Safari; Android Chrome with "Force enable zoom" turned on |
| **Joystick finger + button finger read as a pinch** | iOS Safari (proprietary `gesture*` events), Android |
| `preventDefault()` on **pointer** events does *not* cancel the zoom recognisers; only `touchstart`/`touchend` (non-passive) and `gesture*` can | Safari especially |
| `touch-action` is **not inherited**, so a button without its own `touch-action` can still double-tap zoom | all |
| Once zoomed, nothing resets the page, so it **stays zoomed** | all |

## What it does (layered)

1. **CSS:** sets `touch-action: none` on the page and on every control, turns off overscroll/pull-to-refresh and the iOS callout, and pins `body` in place.
2. **Touch events:** calls non-passive `preventDefault()` on `touchstart`/`touchmove`/`touchend` everywhere except "allow" areas (menus).
   Pointer events still fire, so pointer-based joysticks and buttons keep working.
3. **Safari pinch:** cancels `gesturestart`/`gesturechange`/`gestureend`. It also cancels `dblclick`, ctrl+wheel (trackpad pinch) and ctrl/cmd `+`/`-`/`0`.
4. **Menus:** allow areas scroll with one finger, and multi-touch there is blocked. If a second tap comes quickly, the zoom is cancelled but the **click is still delivered** to the button.
5. **Recovery:** watches `visualViewport.scale`. If a zoom slips through, it:
   - re-applies the viewport meta, which snaps most browsers back to 1×;
   - **stands down**, so the player can pinch back out;
   - adds the class `tzg-zoomed` to `<html>`;
   - calls `onZoomChange(true)` so the game can pause.
6. **Fullscreen (optional):** `enterFullscreen('landscape')` hides the browser UI and locks orientation. This works on Android Chrome, Samsung Internet, Firefox and iPadOS Safari. iPhone Safari has no element fullscreen, so on iPhone items 1–5 do the work.

Optional extra: a web app manifest with `"display": "fullscreen"` lets players install the game to their home screen. The game then runs without browser UI and zoom is not an issue.

## Integrate (about 5 minutes)

1. **Viewport meta** (keep it: Android honours it, and the reset uses it):
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
   ```
2. **Copy the folder** `touch-zoom-guard/` into the game and include both files. Put the CSS before the game's own CSS so the game can override it:
   ```html
   <link rel="stylesheet" href="touch-zoom-guard/touch-zoom-guard.css">
   <script src="touch-zoom-guard/touch-zoom-guard.js"></script>
   ```
3. **Mark the areas that need normal taps or scrolling** (menus, dialogs, settings, forms) with `data-touch-allow`:
   ```html
   <div class="menu" data-touch-allow>…</div>
   ```
   Mark non-button controls (such as a joystick `<div>`) with `data-touch-control`. `canvas` and `button` are covered automatically.
4. **Initialise once** at startup:
   ```js
   TouchZoomGuard.init({
     allowSelector: '[data-touch-allow]',             // default
     onZoomChange: (zoomed) => { if (zoomed) pauseGame(); },
   });
   ```
5. **Optionally**, from the "Start" tap (it must be a user gesture):
   ```js
   TouchZoomGuard.enterFullscreen('landscape');      // or 'portrait'
   ```
6. **Optionally**, add a hint that shows only while zoomed:
   ```html
   <div class="tzg-hint">Pinch out to reset zoom</div>
   ```

### Rules for game input code

- Use **Pointer Events** (`pointerdown`/`pointermove`/`pointerup`) for controls. Do **not** rely on `click` for fire buttons, because `click` is suppressed on the game surface.
- Track every finger by `pointerId`, and call `setPointerCapture` on the joystick and buttons, so multi-touch works.
- Don't attach your own `{ passive: true }` touch listeners that expect default behaviour on the game surface.
- Menu buttons inside `data-touch-allow` can keep using `click`.

## Test

```bash
node touch-zoom-guard/test/tap-spam.mjs <url-or-file> --start "<start-button selector>" \
     --buttons "#fire,#jump" [--joystick 200,400] [--menu "<menu button selector>"]
```

The test emulates an iPad and an iPhone. It holds a joystick finger, taps the buttons 60 times with a second finger, and fails if any of these happen:

- the page zooms;
- the guard doesn't cancel `touchend` on a control;
- a menu tap doesn't click;
- a script error occurs.

Headless Chromium doesn't perform a real double-tap zoom, so the key check is `touchendCancelled`; the same page without the guard fails it. Always finish with a quick manual check on a real iPhone/iPad and an Android device.
