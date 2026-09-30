/*!
 * touch-zoom-guard.js - stop mobile/tablet browsers from zooming touch games.
 * Drop-in, dependency-free, no build step. Exposes window.TouchZoomGuard.
 *
 * Problem: rapid tapping (fire buttons) triggers double-tap-to-zoom, and two
 * fingers (joystick + button) get read as a pinch. iOS Safari ignores
 * `user-scalable=no`, and preventDefault() on *pointer* events does not stop
 * its gesture recognisers. Once zoomed, the page often stays zoomed.
 *
 * Defences (all optional via init options):
 *   1. cancel touchstart/touchmove/touchend outside "allow" areas (non-passive)
 *   2. cancel Safari's proprietary gesturestart/gesturechange/gestureend
 *   3. double-tap guard inside allow areas (menus) that still delivers clicks
 *   4. block dblclick, ctrl+wheel and ctrl/cmd +/-/0 zoom (tablets w/ keyboards)
 *   5. detect a zoom that slipped through (visualViewport.scale), try to reset
 *      it, stand down so the player can pinch out, and notify the game
 *   6. enterFullscreen(): fullscreen + landscape lock where supported
 *
 * Game input should use Pointer Events: they still fire when the touch
 * events are cancelled, so joysticks and buttons keep working.
 */
(function (root) {
  'use strict';
  var G = {
    zoomed: false,
    options: null,
  };
  var DEFAULTS = {
    // Elements matching this selector keep native one-finger scrolling and taps
    // (menus, dialogs, settings). Everything else is treated as game surface.
    allowSelector: '[data-touch-allow]',
    doubleTapMs: 350,
    doubleTapSlop: 40,
    resetZoom: true,
    blockKeyboardZoom: true,
    onZoomChange: null, // function (zoomed:boolean) - e.g. pause the game
  };
  var active = false;
  var lastEnd = 0, lastX = 0, lastY = 0;
  var passiveFalse = { passive: false };

  function allowed(el) {
    return !!(el && el.closest && el.closest(G.options.allowSelector));
  }
  function onTouchStart(e) {
    if (G.zoomed) return; // let the player pinch back out
    if (!allowed(e.target) || e.touches.length > 1) e.preventDefault();
  }
  function onTouchMove(e) {
    if (G.zoomed) return;
    if (!allowed(e.target) || e.touches.length > 1) e.preventDefault();
  }
  function onTouchEnd(e) {
    var t = e.changedTouches && e.changedTouches[0];
    var now = e.timeStamp || Date.now();
    var quick = now - lastEnd < G.options.doubleTapMs && t &&
      Math.abs(t.clientX - lastX) + Math.abs(t.clientY - lastY) < G.options.doubleTapSlop;
    lastEnd = now;
    if (t) { lastX = t.clientX; lastY = t.clientY; }
    if (G.zoomed) return;
    if (!allowed(e.target)) { e.preventDefault(); return; }
    if (quick) {
      // 2nd quick tap in a menu: cancel the zoom but still deliver the click
      e.preventDefault();
      var btn = e.target.closest('button, [role="button"], a, input, label');
      if (btn && !btn.disabled) btn.click();
    }
  }
  function blockGesture(e) { if (!G.zoomed) e.preventDefault(); }
  function onWheel(e) { if (e.ctrlKey) e.preventDefault(); }
  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) e.preventDefault();
  }

  // Re-applying the viewport meta snaps most iOS/Android versions back to 1x.
  function resetZoom() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    var base = meta.getAttribute('content') || '';
    meta.setAttribute('content', /maximum-scale/.test(base)
      ? base.replace(/maximum-scale=[\d.]+/, 'maximum-scale=1.0001')
      : base + ', maximum-scale=1.0001');
    requestAnimationFrame(function () { meta.setAttribute('content', base); });
  }
  function checkZoom() {
    var vv = root.visualViewport;
    var z = !!vv && vv.scale > 1.02;
    if (z === G.zoomed) return;
    G.zoomed = z;
    if (z && G.options.resetZoom) resetZoom();
    if (document.documentElement) document.documentElement.classList.toggle('tzg-zoomed', z);
    // give the reset a moment before telling the game it is (still) zoomed
    setTimeout(function () {
      if (G.options.onZoomChange && G.zoomed === z) G.options.onZoomChange(z);
    }, z ? 400 : 0);
  }

  G.init = function (opts) {
    G.options = Object.assign({}, DEFAULTS, opts || {});
    if (active) return G;
    active = true;
    document.addEventListener('touchstart', onTouchStart, passiveFalse);
    document.addEventListener('touchmove', onTouchMove, passiveFalse);
    document.addEventListener('touchend', onTouchEnd, passiveFalse);
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) {
      document.addEventListener(ev, blockGesture, passiveFalse);
    });
    document.addEventListener('dblclick', blockGesture, passiveFalse);
    root.addEventListener('wheel', onWheel, passiveFalse);
    if (G.options.blockKeyboardZoom) root.addEventListener('keydown', onKey);
    if (root.visualViewport) {
      root.visualViewport.addEventListener('resize', checkZoom);
      root.visualViewport.addEventListener('scroll', checkZoom);
    }
    return G;
  };

  G.isTouchDevice = function () {
    return !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
  };

  // Call from a user gesture (e.g. the "Start" tap). Works on Android
  // Chrome/Samsung/Firefox and iPadOS Safari; iPhone Safari has no element
  // fullscreen, so there the touch guards do the work. Fails silently.
  G.enterFullscreen = function (orientation) {
    if (!G.isTouchDevice() || document.fullscreenElement || document.webkitFullscreenElement) return;
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    function lock() {
      try {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock(orientation || 'landscape').catch(function () {});
      } catch (e) { /* unsupported */ }
    }
    try {
      var p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(lock).catch(function () {}); else lock();
    } catch (e) { /* refused */ }
  };

  root.TouchZoomGuard = G;
})(window);
