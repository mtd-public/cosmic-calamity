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

  // ---------- touch: dr-mow "classic" scheme (Pointer Events, per-pointerId; works with touch-zoom-guard)
  //   LEFT 55%: a floating thumbstick, drawn faintly only while a finger is down (see drawTouch).
  //             Its direction is an absolute SCREEN direction; a light push = sneak.
  //   RIGHT:    tap anywhere = ACT (fires on pointerdown, no latency); tap inside the faint FIRE ring = FIRE.
  const R = 58;
  let fireHeld = null, actHeld = null;
  function resetStick() { stick.id = null; stick.x = stick.y = 0; stick.active = false; }

  function setupTouch() {
    const el = document.getElementById('touch');
    const fireEl = document.getElementById('hintFire');
    const inFire = (x, y) => {
      const r = fireEl.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return Math.hypot(x - cx, y - cy) < r.width * 0.75;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      isTouch = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events throw */ }
      if (e.clientX < window.innerWidth * 0.55) {
        // a new touch always takes the stick
        stick.id = e.pointerId; stick.ox = stick.tx = e.clientX; stick.oy = stick.ty = e.clientY; stick.active = true;
        stick.x = stick.y = 0;
        return;
      }
      if (inFire(e.clientX, e.clientY)) { fireHeld = e.pointerId; press('fire'); fireEl.classList.add('on'); }
      else { actHeld = e.pointerId; press('act'); document.getElementById('hintAct').classList.add('on'); }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stick.id) return;
      let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      stick.x = dx / R; stick.y = dy / R;
      stick.tx = stick.ox + dx; stick.ty = stick.oy + dy;
    });
    const end = (e) => {
      if (e.pointerId === stick.id) resetStick();
      if (e.pointerId === fireHeld) { fireHeld = null; release('fire'); fireEl.classList.remove('on'); }
      if (e.pointerId === actHeld) { actHeld = null; release('act'); document.getElementById('hintAct').classList.remove('on'); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    const pause = document.getElementById('btnPause');
    pause.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); press('pause'); release('pause'); });
  }

  // faint, low-fi stick (dr-mow style): only visible while in use
  function drawTouch(c) {
    const g = c.getContext('2d');
    if (c.width !== innerWidth || c.height !== innerHeight) { c.width = innerWidth; c.height = innerHeight; }
    g.clearRect(0, 0, c.width, c.height);
    if (!stick.active) return;
    g.beginPath(); g.arc(stick.ox, stick.oy, R, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,253,248,0.14)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(20,24,40,0.45)'; g.stroke();
    if (Math.hypot(stick.x, stick.y) > 0.15) {
      g.beginPath(); g.moveTo(stick.ox, stick.oy); g.lineTo(stick.tx, stick.ty);
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,253,248,0.3)'; g.stroke();
    }
    g.beginPath(); g.arc(stick.tx, stick.ty, 24, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,253,248,0.7)'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(20,24,40,0.8)'; g.stroke();
  }

  function reset() {
    held.clear(); pressed.clear(); resetStick(); fireHeld = actHeld = null;
    document.querySelectorAll('.hint.on').forEach((b) => b.classList.remove('on'));
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
    drawTouch,
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
