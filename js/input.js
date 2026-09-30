'use strict';
// Unified input: keyboard, touch (virtual stick + buttons) and gamepad.
const Input = (() => {
  const held = new Set();      // actions currently held
  const pressed = new Set();   // edge-triggered actions not yet consumed
  const stick = { x: 0, y: 0, id: null, ox: 0, oy: 0, active: false };
  let pad = { x: 0, y: 0 };
  let isTouch = false;
  const listeners = [];

  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'act', KeyJ: 'act', KeyE: 'act', Enter: 'start', NumpadEnter: 'start',
    KeyK: 'fire', KeyF: 'fire', ControlLeft: 'fire',
    Escape: 'pause', KeyP: 'pause', KeyM: 'mute',
    ShiftLeft: 'sneak', ShiftRight: 'sneak',
  };

  function press(a) {
    if (!held.has(a)) { pressed.add(a); listeners.forEach((fn) => fn(a)); }
    held.add(a);
  }
  function release(a) { held.delete(a); }

  addEventListener('keydown', (e) => {
    const a = KEYMAP[e.code];
    if (!a) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    press(a);
  });
  addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) release(a); });

  // ---------- touch (Pointer Events, per-pointerId; works with touch-zoom-guard) ----------
  function setKnob(dx, dy) { const k = document.getElementById('stickKnob'); if (k) k.style.transform = `translate(${dx}px, ${dy}px)`; }
  function resetStick() { stick.id = null; stick.x = stick.y = 0; stick.active = false; setKnob(0, 0); }

  function setupTouch() {
    const zone = document.getElementById('stickZone');
    const base = document.getElementById('stickBase');
    const R = 46;

    function placeBase(x, y) {
      const r = zone.getBoundingClientRect();
      base.style.left = (x - r.left) + 'px';
      base.style.top = (y - r.top) + 'px';
      base.style.bottom = 'auto';
    }
    // a new touch always takes the stick
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      isTouch = true;
      stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.active = true;
      stick.x = stick.y = 0;
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      placeBase(e.clientX, e.clientY);
      setKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stick.id) return;
      let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      stick.x = dx / R; stick.y = dy / R;
      setKnob(dx, dy);
    });
    const end = (e) => { if (e.pointerId === stick.id) resetStick(); };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);

    const bind = (id, action) => {
      const el = document.getElementById(id);
      let pid = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        pid = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        el.classList.add('on'); press(action);
      });
      const up = (e) => { if (e.pointerId !== pid) return; pid = null; el.classList.remove('on'); release(action); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    };
    bind('btnAct', 'act');
    bind('btnFire', 'fire');
    bind('btnPause', 'pause');
  }

  function reset() {
    held.clear(); pressed.clear(); resetStick();
    document.querySelectorAll('.tbtn.on').forEach((b) => b.classList.remove('on'));
  }
  addEventListener('blur', reset);
  addEventListener('pagehide', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });

  // ---------- gamepad ----------
  const padPrev = {};
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { pad.x = pad.y = 0; return; }
    let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (Math.hypot(x, y) < 0.2) { x = 0; y = 0; }
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) y = -1; if (b(13)) y = 1;
    pad.x = x; pad.y = y;
    const map = { act: b(0), fire: b(2) || b(5) || b(7), pause: b(9), sneak: b(4) || b(6), start: b(9) };
    for (const k in map) {
      if (map[k] && !padPrev[k]) press(k);
      if (!map[k] && padPrev[k]) release(k);
      padPrev[k] = map[k];
    }
    // menu navigation from d-pad/stick edges
    const up = y < -0.6, down = y > 0.6;
    if (up && !padPrev.up) listeners.forEach((fn) => fn('up'));
    if (down && !padPrev.down) listeners.forEach((fn) => fn('down'));
    padPrev.up = up; padPrev.down = down;
  }

  function axis() {
    let x = 0, y = 0;
    if (held.has('left')) x -= 1;
    if (held.has('right')) x += 1;
    if (held.has('up')) y -= 1;
    if (held.has('down')) y += 1;
    if (x || y) {
      const d = Math.hypot(x, y);
      return { x: x / d, y: y / d, mag: held.has('sneak') ? 0.5 : 1 };
    }
    if (stick.active && Math.hypot(stick.x, stick.y) > 0.15) {
      const m = Math.min(1, Math.hypot(stick.x, stick.y));
      return { x: stick.x / m, y: stick.y / m, mag: held.has('sneak') ? 0.5 : m };
    }
    if (pad.x || pad.y) {
      const m = Math.min(1, Math.hypot(pad.x, pad.y));
      return { x: pad.x / m, y: pad.y / m, mag: held.has('sneak') ? 0.5 : m };
    }
    return { x: 0, y: 0, mag: 0 };
  }

  return {
    setupTouch,
    pollPad,
    axis,
    down: (a) => held.has(a),
    take(a) { if (pressed.has(a)) { pressed.delete(a); return true; } return false; },
    flush() { pressed.clear(); },
    reset,
    onPress(fn) { listeners.push(fn); },
    get isTouch() { return isTouch; },
    set isTouch(v) { isTouch = v; },
  };
})();
