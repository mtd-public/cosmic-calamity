'use strict';
/* Faux-2D pixel art for the cabinet-projection renderer: character sprite frames (4 directions,
   walk cycles, poses), prop sprites, and the top/front face textures for walls and props.
   Everything is painted procedurally into small canvases, then given a 1px ink outline, SNES style.
   1 texel = 1/16 world unit = 1 screen pixel at the internal resolution. */
const Sprites = (() => {
  const INK = '#141626';
  const cache = new Map();
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  const shade = (h, a) => Art.shade(h, a);

  // 1px ink outline around every opaque shape (and optional inner ink where colours meet transparency)
  function outline(c, ink = INK) {
    const g = c.getContext('2d');
    const { width: w, height: h } = c;
    const d = g.getImageData(0, 0, w, h), a = d.data;
    const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 40;
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (op(x, y)) continue;
      if (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1)) add.push(x, y);
    }
    g.fillStyle = ink;
    for (let i = 0; i < add.length; i += 2) g.fillRect(add[i], add[i + 1], 1, 1);
    return c;
  }
  function mirror(src) {
    const c = canvas(src.width, src.height), g = c.getContext('2d');
    g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
    return c;
  }

  // ------------------------------------------------------------------ palettes (light, mid, dark)
  const P = {
    skin: ['#ffe4cc', '#f5c29e', '#cf8a6a'],
    snakeHair: ['#6a4c3a', '#43302a', '#261a1a'],
    snakeSuit: ['#6f93cf', '#43649e', '#27395e'],
    snakeLeg: ['#4a6496', '#2f4470', '#1c2a48'],
    bandana: ['#ff7a7a', '#e32f45', '#8e1a2a'],
    metal: ['#ffffff', '#c3ceda', '#7c8a9c'],
    boots: ['#4a4a58', '#2c2c36', '#18181e'],
    gSkin: ['#b4ff8a', '#6ccf52', '#3a8a30'],
    gUni: ['#ff7a88', '#d4304a', '#861a2c'],
    gLeg: ['#5a5a66', '#383844', '#202028'],
    hArmor: ['#c8b8ff', '#8a70d0', '#4c3a88'],
    hSkin: ['#9ae07a', '#5aa846', '#326a28'],
    jump: ['#ffc98a', '#ff8e2e', '#c25a12'],
    powHair: ['#8a5a3a', '#5a3a28', '#34221a'],
    hybHair: ['#ffffff', '#d4dce8', '#9aa6b8'],
    robot: ['#ffffff', '#d6dce6', '#8c96a6'],
  };

  // ------------------------------------------------------------------ characters (24 x 32, feet on row 30)
  // kind: snake | grunt | heavy | human | hybrid | robot ; dir: 0 down, 1 up, 2 right, 3 left
  // frame: 0..3 walk cycle ; pose: stand | walk | shoot | punch | stun
  function paintChar(kind, dir, frame, pose) {
    if (dir === 3) return mirror(getChar(kind, 2, frame, pose));
    const c = canvas(24, 32), g = c.getContext('2d');
    const step = pose === 'walk' ? [0, 1, 0, 2][frame % 4] : 0;
    const big = kind === 'heavy';
    const pal = {
      snake: { hair: P.snakeHair, suit: P.snakeSuit, leg: P.snakeLeg, skin: P.skin },
      grunt: { hair: P.gSkin, suit: P.gUni, leg: P.gLeg, skin: P.gSkin },
      heavy: { hair: P.hSkin, suit: P.hArmor, leg: P.gLeg, skin: P.hSkin },
      human: { hair: P.powHair, suit: P.jump, leg: P.jump, skin: P.skin },
      hybrid: { hair: P.hybHair, suit: P.jump, leg: P.jump, skin: ['#fff0e6', '#ecd2c2', '#c09a8a'] },
      robot: { hair: P.robot, suit: P.robot, leg: P.metal, skin: P.robot },
    }[kind];
    const S = pal.suit, L = pal.leg, K = pal.skin, H = pal.hair;
    const bob = pose === 'walk' && (frame % 2 === 1) ? 1 : 0;
    const o = bob; // whole upper body drops 1px on passing frames

    if (kind === 'robot') return paintRobot(c, g, dir, step, o);

    // --- legs
    if (dir <= 1) {
      const la = step === 1 ? 2 : 0, lb = step === 2 ? 2 : 0;
      px(g, 8, 22, 3, 8 - la, L[1]); px(g, 8, 22, 1, 8 - la, L[0]);
      px(g, 13, 22, 3, 8 - lb, L[1]); px(g, 15, 22, 1, 8 - lb, L[2]);
      px(g, 8, 28 - la, 3, 2, P.boots[1]); px(g, 13, 28 - lb, 3, 2, P.boots[1]);
      px(g, 8, 28 - la, 3, 1, P.boots[0]); px(g, 13, 28 - lb, 3, 1, P.boots[0]);
    } else {
      const sw = step === 1 ? 3 : step === 2 ? -3 : 0;
      px(g, 10 - sw, 22, 3, 8, L[2]); px(g, 10 - sw, 28, 3, 2, P.boots[2]);
      px(g, 10 + sw, 22, 3, 8, L[1]); px(g, 10 + sw, 22, 1, 8, L[0]); px(g, 10 + sw, 28, 4, 2, P.boots[1]);
    }
    // --- torso
    const tx = big ? 5 : 7, tw = big ? 14 : 10, sx = dir >= 2 ? 9 : tx, sw2 = dir >= 2 ? (big ? 8 : 6) : tw;
    px(g, sx, 14 + o, sw2, 9, S[1]);
    px(g, sx, 14 + o, 1, 9, S[0]);
    px(g, sx + sw2 - 2, 14 + o, 2, 9, S[2]);
    px(g, sx, 14 + o, sw2, 1, S[0]);
    if (kind !== 'heavy') px(g, sx, 21 + o, sw2, 1, kind === 'snake' ? '#6a6450' : S[2]);
    // --- arms
    const armSwing = pose === 'walk' ? (step === 1 ? 1 : step === 2 ? -1 : 0) : 0;
    const cyber = kind === 'snake';
    if (dir <= 1) {
      const lx = big ? 2 : 5, rx = big ? 19 : 17;
      const la = dir === 0 ? 'l' : 'r';
      px(g, lx, 14 + o + armSwing, 2, 7, S[1]); px(g, lx, 14 + o + armSwing, 1, 7, S[0]);
      px(g, lx, 21 + o + armSwing, 2, 2, K[1]);
      const rA = cyber && dir === 0 ? P.metal : S;
      px(g, rx, 14 + o - armSwing, 2, 7, rA[1]); px(g, rx + 1, 14 + o - armSwing, 1, 7, rA[2]);
      px(g, rx, 21 + o - armSwing, 2, 2, cyber && dir === 0 ? '#7ff6ff' : K[1]);
      void la;
      if (pose === 'shoot' && dir === 0) { px(g, rx - 1, 21 + o, 3, 4, '#22232e'); px(g, rx, 24 + o, 1, 1, '#ffd23a'); }
    }
    // --- head
    const hx = dir >= 2 ? 7 : 6, hw = dir >= 2 ? 10 : 12;
    const hy = 3 + o;
    px(g, hx, hy + 1, hw, 10, K[1]);
    px(g, hx + 1, hy, hw - 2, 12, K[1]);
    if (dir === 0) {
      // hair: crown + sides + jagged bangs
      px(g, hx, hy + 1, hw, 4, H[1]); px(g, hx + 1, hy, hw - 2, 2, H[0]);
      px(g, hx, hy + 1, 1, 8, H[2]); px(g, hx + hw - 1, hy + 1, 1, 8, H[2]);
      for (const [bx, bh] of [[1, 2], [3, 3], [5, 1], [7, 3], [9, 2]]) px(g, hx + bx, hy + 5, 1 + (bx % 2), bh, H[1]);
      px(g, hx + 2, hy + 1, 3, 1, H[0]);
      // eyes (anime: lash row, iris, highlight)
      const ey = hy + 7;
      for (const ex of [hx + 2, hx + hw - 4]) { px(g, ex, ey, 2, 1, INK); px(g, ex, ey + 1, 2, 2, kind === 'grunt' || kind === 'heavy' ? '#ffd23a' : '#3a5ab0'); px(g, ex + 1, ey + 1, 1, 1, '#ffffff'); }
      px(g, hx + 5, hy + 11, 2, 1, K[2]);
      px(g, hx + 1, hy + 10, 1, 1, '#ff9aa8'); px(g, hx + hw - 2, hy + 10, 1, 1, '#ff9aa8');
    } else if (dir === 1) {
      px(g, hx, hy + 1, hw, 11, H[1]); px(g, hx + 1, hy, hw - 2, 3, H[0]);
      px(g, hx, hy + 8, hw, 3, H[2]); px(g, hx + 2, hy + 1, 2, 7, H[0]);
      px(g, hx + 3, hy + 11, hw - 6, 1, K[2]);
    } else { // right-facing profile
      px(g, hx, hy + 1, 6, 9, H[1]); px(g, hx + 1, hy, 8, 3, H[0]); px(g, hx, hy + 1, 2, 10, H[2]);
      for (const [bx, bh] of [[6, 2], [8, 1]]) px(g, hx + bx, hy + 3, 2, bh, H[1]);
      px(g, hx + 7, hy + 7, 2, 1, INK); px(g, hx + 7, hy + 8, 2, 2, kind === 'grunt' || kind === 'heavy' ? '#ffd23a' : '#3a5ab0'); px(g, hx + 8, hy + 8, 1, 1, '#fff');
      px(g, hx + hw, hy + 8, 1, 2, K[1]); // nose
      px(g, hx + 6, hy + 11, 2, 1, K[2]);
      // front arm in profile
      const ax = 11 + armSwing * 2;
      const armC = cyber ? P.metal : S;
      if (pose === 'shoot' || pose === 'punch') {
        px(g, 12, 16 + o, 8, 2, armC[1]); px(g, 12, 16 + o, 8, 1, armC[0]);
        if (pose === 'shoot') { px(g, 19, 15 + o, 4, 3, '#22232e'); px(g, 22, 15 + o, 1, 1, '#ffd23a'); }
        else px(g, 20, 15 + o, 3, 4, cyber ? '#7ff6ff' : K[1]);
      } else {
        px(g, ax, 15 + o, 2, 7, armC[1]); px(g, ax, 15 + o, 1, 7, armC[0]);
        px(g, ax, 22 + o, 2, 2, cyber ? '#7ff6ff' : K[1]);
      }
    }

    // --- kind details
    if (kind === 'snake') {
      const t = frame % 2;
      if (dir === 0) {
        px(g, hx, hy + 3, hw, 2, P.bandana[1]); px(g, hx, hy + 3, hw, 1, P.bandana[0]);
        px(g, hx + hw, hy + 3 + t, 2, 1, P.bandana[1]); px(g, hx + hw + 1, hy + 4 - t, 2, 1, P.bandana[2]);
        // cybernetic plate over the right eye, glowing optic
        px(g, hx + hw - 5, hy + 6, 4, 5, P.metal[1]); px(g, hx + hw - 5, hy + 6, 4, 1, P.metal[0]);
        px(g, hx + hw - 4, hy + 8, 2, 2, '#ff2a2a'); px(g, hx + hw - 4, hy + 8, 1, 1, '#ffb0b0');
      } else if (dir === 1) {
        px(g, hx, hy + 3, hw, 2, P.bandana[1]);
        px(g, 13, hy + 4, 2, 2, P.bandana[2]); // knot
        px(g, 14, hy + 6, 1, 3 + t, P.bandana[1]); px(g, 16, hy + 5, 1, 3 - t, P.bandana[1]);
      } else {
        px(g, hx, hy + 3, hw, 2, P.bandana[1]); px(g, hx, hy + 3, hw, 1, P.bandana[0]);
        px(g, hx - 3, hy + 3 + t, 3, 1, P.bandana[1]); px(g, hx - 5, hy + 4 - t, 3, 1, P.bandana[2]);
        px(g, hx + 6, hy + 6, 4, 5, P.metal[1]); px(g, hx + 7, hy + 8, 2, 2, '#ff2a2a');
      }
    } else if (kind === 'grunt' || kind === 'heavy') {
      // crest spikes
      for (const [cx, ch] of dir >= 2 ? [[hx + 2, 3], [hx + 5, 2], [hx + 7, 1]] : [[hx + 3, 2], [hx + 6, 3], [hx + 9, 2]]) px(g, cx, hy - ch + 1, 2, ch, H[2]);
      if (dir === 0) {
        px(g, hx + 1, hy + 7, hw - 2, 2, '#12121a'); px(g, hx + 2, hy + 7, 2, 1, '#ffd23a'); px(g, hx + hw - 4, hy + 7, 2, 1, '#ffd23a');
        px(g, hx + 3, hy + 9, hw - 6, 3, K[0]); px(g, hx + 4, hy + 10, 1, 1, K[2]); px(g, hx + hw - 5, hy + 10, 1, 1, K[2]);
      } else if (dir >= 2) {
        px(g, hx + 5, hy + 7, 5, 2, '#12121a'); px(g, hx + 7, hy + 7, 2, 1, '#ffd23a');
        px(g, hx + 8, hy + 9, 4, 3, K[0]); // snout
      }
      if (kind === 'grunt') { px(g, dir >= 2 ? 8 : 5, 14 + o, 3, 2, '#22222a'); if (dir < 2) px(g, 16, 14 + o, 3, 2, '#22222a'); }
      if (kind === 'heavy') {
        px(g, hx - 1, hy - 1, hw + 2, 5, P.metal[1]); px(g, hx, hy - 2, hw, 2, P.metal[0]);
        if (dir === 0) { px(g, hx + 1, hy + 7, hw - 2, 2, '#ff4b5c'); }
        px(g, 1, 13 + o, 5, 4, P.hArmor[0]); px(g, 18, 13 + o, 5, 4, P.hArmor[0]);
        if (dir === 0 || dir === 2) { px(g, dir === 0 ? 18 : 16, 18 + o, 5, 5, '#2a2a36'); px(g, dir === 0 ? 20 : 20, 22 + o, 1, 1, '#ff4b5c'); }
      }
      if (pose === 'shoot' && dir === 1) px(g, 17, 14 + o, 3, 5, '#22232e');
    } else if (kind === 'hybrid') {
      if (dir === 0) { px(g, hx + hw - 4, hy + 8, 2, 2, '#4fe3ff'); px(g, hx, hy + 8, 1, 3, '#4fe3ff'); }
      if (dir >= 2) px(g, hx + 7, hy + 8, 2, 2, '#4fe3ff');
    }
    if (kind === 'human' || kind === 'hybrid') { if (dir === 0) px(g, 10, 16 + o, 4, 2, '#ffffff'); } // prisoner number patch
    if (pose === 'stun') { px(g, 5, 0, 1, 1, '#ffe66b'); px(g, 18, 1, 1, 1, '#ffe66b'); px(g, 12, 0, 1, 1, '#ffffff'); }
    return outline(c);
  }

  function paintRobot(c, g, dir, step, o) {
    const R = P.robot;
    px(g, 9, 22, 2, 8 - (step === 1 ? 2 : 0), P.metal[2]); px(g, 13, 22, 2, 8 - (step === 2 ? 2 : 0), P.metal[2]);
    px(g, 7, 9 + o, 10, 14, R[1]); px(g, 7, 9 + o, 10, 1, R[0]); px(g, 15, 10 + o, 2, 13, R[2]);
    px(g, 8, 17 + o, 8, 3, '#ff8e2e');
    if (dir !== 1) { px(g, 8, 12 + o, 8, 3, '#1a1c28'); px(g, dir === 2 ? 13 : dir === 3 ? 9 : 11, 13 + o, 2, 1, '#35e08a'); }
    px(g, 11, 5 + o, 1, 4, P.metal[2]); px(g, 11, 4 + o, 1, 1, '#ff4b5c');
    px(g, 5, 13 + o, 2, 6, P.metal[1]); px(g, 17, 13 + o, 2, 6, P.metal[1]);
    return outline(c);
  }

  function getChar(kind, dir, frame, pose) {
    const k = `c:${kind}:${dir}:${frame}:${pose}`;
    let c = cache.get(k);
    if (!c) { c = paintChar(kind, dir, frame, pose); cache.set(k, c); }
    return c;
  }

  // knocked-out body lying on its side (32 x 16)
  function body(kind) {
    const k = 'body:' + kind;
    if (cache.has(k)) return cache.get(k);
    const c = canvas(32, 16), g = c.getContext('2d');
    const heavy = kind === 'heavy', snake = kind === 'snake';
    const S = heavy ? P.hArmor : snake ? P.snakeSuit : P.gUni, K = heavy ? P.hSkin : snake ? P.skin : P.gSkin;
    px(g, 3, 5, 9, 9, K[1]); px(g, 3, 5, 9, 2, K[0]); px(g, 3, 8, 3, 2, '#12121a');
    px(g, 12, 6, 10, 8, S[1]); px(g, 12, 6, 10, 2, S[0]); px(g, 12, 12, 10, 2, S[2]);
    px(g, 22, 7, 7, 3, P.gLeg[1]); px(g, 22, 10, 7, 3, P.gLeg[2]); px(g, 28, 7, 2, 6, P.boots[1]);
    if (snake) { px(g, 3, 5, 9, 3, P.snakeHair[1]); px(g, 3, 7, 9, 1, P.bandana[1]); }
    else for (const [x, h] of [[5, 2], [8, 3]]) px(g, x, 5 - h, 2, h, K[2]);
    if (heavy) { px(g, 2, 3, 8, 4, P.metal[1]); }
    cache.set(k, outline(c));
    return c;
  }

  // ------------------------------------------------------------------ machines & props (sprites)
  function drone(eye, blink) {
    const k = `drone:${eye}:${blink}`;
    if (cache.has(k)) return cache.get(k);
    const c = canvas(22, 18), g = c.getContext('2d');
    px(g, 2, 8, 18, 4, '#7a6aa8'); px(g, 1, 9, 20, 2, '#7a6aa8'); px(g, 2, 8, 18, 1, '#a898d8');
    px(g, 6, 3, 10, 6, '#c8bcf0'); px(g, 7, 2, 8, 2, '#e8e0ff'); px(g, 8, 3, 3, 1, '#ffffff');
    px(g, 8, 6, 6, 3, '#1a1a28'); px(g, 10, 7, 2, 1, eye);
    px(g, 3, 12, 16, 1, '#4a3c78');
    px(g, 0, 9, 1, 1, blink ? '#5dffff' : '#135'); px(g, 21, 9, 1, 1, blink ? '#135' : '#5dffff');
    px(g, 11, 0, 1, 2, '#999'); px(g, 11, 0, 1, 1, blink ? '#ff4040' : '#600');
    cache.set(k, outline(c));
    return c;
  }

  // wall-mounted camera, 8 headings (0 = east, counter-clockwise in screen space)
  function camera(oct, led) {
    const k = `cam:${oct}:${led}`;
    if (cache.has(k)) return cache.get(k);
    const c = canvas(16, 16), g = c.getContext('2d');
    const a = oct / 8 * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    const cx = 8, cy = 8;
    px(g, cx - 3, cy - 2, 6, 5, '#d8dee6'); px(g, cx - 3, cy - 2, 6, 1, '#ffffff'); px(g, cx - 3, cy + 2, 6, 1, '#8a94a2');
    px(g, Math.round(cx + dx * 4) - 1, Math.round(cy + dy * 3) - 1, 3, 3, '#1a1a24');
    px(g, Math.round(cx + dx * 4), Math.round(cy + dy * 3) - 1, 1, 1, '#6fd8ff');
    px(g, cx + 1, cy - 2, 1, 1, led);
    cache.set(k, outline(c));
    return c;
  }

  function pickup(type) {
    const k = 'pk:' + type;
    if (cache.has(k)) return cache.get(k);
    const c = canvas(14, 12), g = c.getContext('2d');
    if (type === 'r') { px(g, 2, 3, 10, 8, '#f4f6fa'); px(g, 2, 3, 10, 1, '#ffffff'); px(g, 2, 10, 10, 1, '#b8c0cc'); px(g, 6, 4, 2, 6, '#ff4b5c'); px(g, 4, 6, 6, 2, '#ff4b5c'); }
    else if (type === 'a') { px(g, 2, 5, 10, 6, '#6a7f3f'); px(g, 2, 5, 10, 1, '#8aa050'); for (let i = 0; i < 3; i++) { px(g, 4 + i * 3, 1, 2, 5, '#ffc94a'); px(g, 4 + i * 3, 1, 2, 1, '#fff0a0'); } }
    else { px(g, 1, 3, 12, 8, '#3d8bff'); px(g, 1, 3, 12, 2, '#8fc4ff'); px(g, 1, 7, 12, 1, '#ffc94a'); px(g, 9, 4, 2, 2, '#ffffff'); }
    cache.set(k, outline(c));
    return c;
  }

  function barrel(th) {
    const k = 'barrel:' + th;
    if (cache.has(k)) return cache.get(k);
    const base = th === 'ship' ? ['#b890e0', '#8a5ab0', '#5a3a80'] : th === 'camp' ? ['#a8b86a', '#7a8a4a', '#4a5a2a'] : ['#8ac4ec', '#4f8fb8', '#2a5a80'];
    const c = canvas(14, 20), g = c.getContext('2d');
    px(g, 2, 4, 10, 15, base[1]); px(g, 1, 6, 12, 11, base[1]);
    px(g, 3, 5, 2, 12, base[0]); px(g, 10, 5, 2, 13, base[2]);
    px(g, 2, 1, 10, 4, base[0]); px(g, 3, 2, 8, 2, shade(base[0], 0.3));
    px(g, 1, 9, 12, 2, '#ffc94a'); px(g, 1, 14, 12, 1, base[2]);
    cache.set(k, outline(c));
    return c;
  }

  function tree() {
    if (cache.has('tree')) return cache.get('tree');
    const c = canvas(30, 40), g = c.getContext('2d');
    px(g, 13, 26, 4, 13, '#7a5232'); px(g, 13, 26, 1, 13, '#9a6a42'); px(g, 11, 37, 8, 2, '#5a3a22');
    const blob = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); for (let yy = -r; yy <= r; yy++) { const w = Math.round(Math.sqrt(r * r - yy * yy)); g.rect(x - w, y + yy, w * 2, 1); } g.fill(); };
    blob(15, 18, 12, '#3a8a3a'); blob(10, 14, 8, '#4faa46'); blob(19, 12, 8, '#4faa46'); blob(14, 8, 7, '#6fcf5a'); blob(11, 6, 3, '#9ae07a');
    for (let i = 0; i < 30; i++) { const x = 4 + ((i * 37) % 22), y = 6 + ((i * 17) % 22); px(g, x, y, 1, 1, i % 3 ? '#2f7a30' : '#8ad86a'); }
    cache.set('tree', outline(c));
    return c;
  }

  function pillar(th) {
    const k = 'pillar:' + th;
    if (cache.has(k)) return cache.get(k);
    const c = canvas(16, 34), g = c.getContext('2d');
    px(g, 3, 3, 10, 30, '#6a3a8a'); px(g, 3, 3, 2, 30, '#8a5ab0'); px(g, 11, 3, 2, 30, '#4a2466');
    px(g, 2, 1, 12, 4, '#9a6ac0'); px(g, 2, 30, 12, 3, '#4a2466');
    px(g, 6, 12, 4, 10, '#35e08a'); px(g, 7, 13, 2, 8, '#c8ffe4');
    cache.set(k, outline(c));
    return c;
  }

  function core(glow) {
    const k = 'core:' + glow;
    if (cache.has(k)) return cache.get(k);
    const c = canvas(16, 30), g = c.getContext('2d');
    px(g, 2, 22, 12, 7, '#3a2a58'); px(g, 2, 22, 12, 2, '#5b4380'); px(g, 2, 27, 12, 2, '#20163a');
    if (glow >= 0) {
      const cols = [['#e8a0ff', '#c34bff', '#8a20c8'], ['#ffd8ff', '#e880ff', '#b040e0']][glow];
      for (let y = 0; y < 18; y++) { const w = y < 9 ? 1 + y : 18 - y; px(g, 8 - Math.ceil(w / 2), 3 + y, w, 1, cols[1]); }
      for (let y = 2; y < 16; y++) { const w = y < 9 ? Math.max(1, y - 2) : Math.max(1, 14 - y); px(g, 7 - Math.floor(w / 2) + 1, 3 + y, Math.max(1, Math.floor(w / 2)), 1, cols[0]); }
    } else { px(g, 5, 14, 6, 8, '#3a2f3a'); px(g, 6, 16, 1, 3, '#000'); px(g, 8, 18, 2, 1, '#000'); }
    cache.set(k, outline(c));
    return c;
  }

  function tuft(v) {
    const k = 'tuft:' + v;
    if (cache.has(k)) return cache.get(k);
    const c = canvas(16, 12), g = c.getContext('2d');
    const cols = ['#9ae07a', '#5fbf4a', '#3a8a30'];
    for (let i = 0; i < 9; i++) {
      const x = 1 + ((i * 5 + v * 3) % 14), h = 5 + ((i * 7 + v) % 6);
      px(g, x, 12 - h, 1, h, cols[(i + v) % 3]); px(g, x, 12 - h, 1, 1, cols[0]);
    }
    cache.set(k, c);
    return c;
  }

  function exitPad(ok) {
    const k = 'exit:' + ok;
    if (cache.has(k)) return cache.get(k);
    const c = canvas(16, 16), g = c.getContext('2d');
    const col = ok ? ['#b4ffcc', '#35e08a', '#127a44'] : ['#ffb0b0', '#ff4b5c', '#8a1a2a'];
    px(g, 1, 1, 14, 14, col[2]); px(g, 2, 2, 12, 12, '#0c1a14');
    px(g, 1, 1, 14, 1, col[0]); px(g, 1, 14, 14, 1, col[1]); px(g, 1, 1, 1, 14, col[1]); px(g, 14, 1, 1, 14, col[1]);
    for (let i = 0; i < 3; i++) px(g, 5 + i, 4 + i * 3, 6 - i * 2, 2, col[1]);
    cache.set(k, c);
    return c;
  }

  // ------------------------------------------------------------------ face textures for walls & props
  // Wall top: continuous surface, with rim highlight / shadow only on its outer edges (mask: N,E,S,W open)
  function wallTop(th, mask) {
    const k = `wt:${th}:${mask}`;
    if (cache.has(k)) return cache.get(k);
    const T = Art.THEMES[th], c = canvas(16, 16), g = c.getContext('2d');
    const base = shade(T.wall, 0.08);
    px(g, 0, 0, 16, 16, base);
    const st = T.wallStyle;
    if (st === 'corrugated') for (let x = 0; x < 16; x += 4) px(g, x, 0, 1, 16, shade(base, -0.07));
    else if (st === 'palisade') for (let x = 1; x < 16; x += 4) { px(g, x, 0, 2, 16, shade(base, 0.08)); px(g, x + 2, 0, 1, 16, shade(base, -0.2)); }
    else if (st === 'panel') { px(g, 0, 7, 16, 2, shade(base, -0.08)); }
    else if (st === 'steel') { px(g, 3, 3, 1, 1, shade(base, 0.3)); px(g, 12, 11, 1, 1, shade(base, 0.3)); }
    else if (st === 'organic') { px(g, 4, 5, 2, 2, shade(T.accent, -0.3)); px(g, 11, 10, 1, 1, T.accent); }
    const [N, E, S, W] = [mask & 1, mask & 2, mask & 4, mask & 8];
    if (N) { px(g, 0, 0, 16, 1, shade(base, -0.45)); px(g, 0, 1, 16, 1, shade(base, 0.2)); }
    if (W) { px(g, 0, 0, 1, 16, shade(base, -0.45)); px(g, 1, 0, 1, 16, shade(base, 0.15)); }
    if (E) { px(g, 15, 0, 1, 16, shade(base, -0.5)); }
    if (S) { px(g, 0, 15, 16, 1, shade(base, 0.35)); }
    cache.set(k, c);
    return c;
  }
  // Wall front face (16 x hpx), tileable horizontally; ends darkened where the run stops (mask: E,W open)
  function wallFront(th, hpx, mask) {
    const k = `wf:${th}:${hpx}:${mask}`;
    if (cache.has(k)) return cache.get(k);
    const T = Art.THEMES[th], c = canvas(16, hpx), g = c.getContext('2d');
    const base = shade(T.wall, -0.22), st = T.wallStyle;
    px(g, 0, 0, 16, hpx, base);
    if (st === 'corrugated') for (let x = 0; x < 16; x += 2) px(g, x, 0, 1, hpx, shade(base, 0.12));
    else if (st === 'palisade') { for (let x = 0; x < 16; x += 4) { px(g, x, 0, 1, hpx, shade(base, -0.3)); px(g, x + 1, 0, 1, hpx, shade(base, 0.12)); } px(g, 0, 4, 16, 1, '#9a9eaa'); px(g, 0, hpx - 6, 16, 1, '#9a9eaa'); }
    else if (st === 'panel') { px(g, 0, 5, 16, 3, T.accent); px(g, 0, 5, 16, 1, shade(T.accent, 0.4)); px(g, 7, 0, 1, hpx, shade(base, -0.15)); px(g, 0, hpx - 4, 16, 1, shade(base, -0.2)); }
    else if (st === 'steel') { px(g, 0, hpx - 5, 16, 3, T.line); for (let x = 0; x < 16; x += 4) px(g, x, hpx - 5, 2, 3, '#222'); px(g, 3, 3, 1, 1, shade(base, 0.4)); px(g, 12, 3, 1, 1, shade(base, 0.4)); }
    else if (st === 'organic') { for (let i = 0; i < 2; i++) { let x = 3 + i * 8; for (let y = 0; y < hpx; y++) { px(g, x, y, 1, 1, shade(base, -0.3)); if (y % 3 === 0) x += (y % 2 ? 1 : -1); } } px(g, 6, 6, 2, 3, T.accent); px(g, 6, 6, 1, 1, '#fff'); }
    // light lip at the top, ambient occlusion at the bottom
    px(g, 0, 0, 16, 1, shade(base, 0.35));
    const ao = g.createLinearGradient(0, hpx - 6, 0, hpx);
    ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = ao; g.fillRect(0, hpx - 6, 16, 6);
    if (mask & 2) px(g, 15, 0, 1, hpx, shade(base, -0.45));
    if (mask & 8) px(g, 0, 0, 1, hpx, shade(base, -0.35));
    cache.set(k, c);
    return c;
  }

  // Props: top (16x16) and front (16 x hpx) art per tile kind
  function propTop(th, ch) {
    const k = `pt:${th}:${ch}`;
    if (cache.has(k)) return cache.get(k);
    const T = Art.THEMES[th], c = canvas(16, 16), g = c.getContext('2d');
    const box = (col, inset = 1) => { px(g, inset, inset, 16 - inset * 2, 16 - inset * 2, col[1]); px(g, inset, inset, 16 - inset * 2, 1, col[0]); px(g, inset, 15 - inset, 16 - inset * 2, 1, col[2]); px(g, inset, inset, 1, 16 - inset * 2, col[0]); px(g, 15 - inset, inset, 1, 16 - inset * 2, col[2]); };
    const crateCols = T.crateStyle === 'military' ? ['#8a9a5a', '#667a3a', '#3e4a22'] : T.crateStyle === 'container' ? ['#9aa8ba', '#6e7c8e', '#465262'] : T.crateStyle === 'pod' ? ['#9a78c8', '#6a4c98', '#3e2a60'] : ['#e0b070', '#b8844a', '#7a5228'];
    switch (ch) {
      case 'X': box(crateCols, 0); if (T.crateStyle === 'wood' || !T.crateStyle) { for (let y = 4; y < 16; y += 4) px(g, 1, y, 14, 1, crateCols[2]); } else if (T.crateStyle === 'pod') { px(g, 7, 1, 2, 14, T.accent); } else { px(g, 4, 4, 8, 8, crateCols[2]); px(g, 5, 5, 6, 6, crateCols[1]); } break;
      case 'L': case 'G': case 'k': box(['#b8cce0', '#8aa2bc', '#5a6e88'], 2); px(g, 7, 2, 1, 12, '#5a6e88'); break;
      case 'B': box(['#8ad06a', '#5aa048', '#346a28'], 0); px(g, 7, 0, 2, 16, '#346a28'); break;
      case 'O': box(['#f0cc90', '#d8a868', '#9a6e38'], 1); px(g, 7, 1, 2, 14, '#f8e4b8'); break;
      case 'C': case 'I': case 'i': box(['#6a7282', '#4a5262', '#2a303c'], 0); px(g, 2, 3, 12, 6, ch === 'I' ? '#35e08a' : ch === 'i' ? '#1a3020' : T.accent); px(g, 3, 4, 6, 1, '#ffffff'); for (let i = 0; i < 4; i++) px(g, 3 + i * 3, 11, 2, 2, ['#ff4b5c', '#ffc94a', '#35e08a', '#3d8bff'][i]); break;
      case 'D': box(['#aab2c0', '#7a8496', '#4a5262'], 0); for (let x = 1; x < 16; x += 4) px(g, x, 6, 2, 4, T.line); break;
      case 'T': if (T.pillar === 'server') { box(['#4a5668', '#2e3848', '#1a2230'], 0); } else if (T.pillar === 'shuttle') { px(g, 0, 0, 16, 16, '#e8eef6'); px(g, 0, 0, 16, 1, '#ffffff'); px(g, 0, 8, 16, 1, '#b8c0cc'); } else { box(['#b0b8c4', '#8a93a0', '#5a6270'], 0); px(g, 5, 5, 6, 6, '#5a6270'); } break;
      case 'A': // tent roof seen from above: a ridge across the tile
        px(g, 0, 0, 16, 16, '#d8465a'); px(g, 0, 7, 16, 2, '#ff8a98'); px(g, 0, 0, 16, 1, '#9a2a3a'); px(g, 0, 15, 16, 1, '#9a2a3a'); break;
      case 'J': case 'j': px(g, 0, 0, 16, 3, '#9aa0ac'); px(g, 0, 0, 16, 1, '#c8ced8'); break;
      default: box(['#9aa2b0', '#7a8290', '#4a5262'], 0);
    }
    cache.set(k, c);
    return c;
  }
  function propFront(th, ch, hpx) {
    const k = `pf:${th}:${ch}:${hpx}`;
    if (cache.has(k)) return cache.get(k);
    const T = Art.THEMES[th], c = canvas(16, hpx), g = c.getContext('2d');
    const face = (col) => { px(g, 0, 0, 16, hpx, col[1]); px(g, 0, 0, 16, 1, col[0]); px(g, 0, hpx - 1, 16, 1, col[2]); px(g, 0, 0, 1, hpx, col[2]); px(g, 15, 0, 1, hpx, col[2]); };
    const crateCols = T.crateStyle === 'military' ? ['#7a8a4a', '#566a2e', '#2e3a18'] : T.crateStyle === 'container' ? ['#8a98aa', '#5e6c7e', '#384252'] : T.crateStyle === 'pod' ? ['#8a68b8', '#5a3c88', '#2e1a50'] : ['#cc9a5c', '#a0703a', '#62401c'];
    switch (ch) {
      case 'X':
        face(crateCols);
        if (T.crateStyle === 'military') { px(g, 3, 3, 2, 2, '#e6d17a'); px(g, 6, 3, 5, 1, '#e6d17a'); px(g, 1, hpx - 4, 14, 1, crateCols[2]); }
        else if (T.crateStyle === 'container') { for (let x = 2; x < 15; x += 3) px(g, x, 1, 1, hpx - 2, crateCols[2]); }
        else if (T.crateStyle === 'pod') { px(g, 6, 2, 4, hpx - 4, T.accent); px(g, 7, 2, 1, hpx - 4, '#fff'); }
        else { for (let i = 1; i < hpx - 1; i++) px(g, Math.round(1 + (i / hpx) * 13), i, 1, 1, crateCols[2]); px(g, 1, (hpx / 2) | 0, 14, 1, crateCols[2]); }
        break;
      case 'L': case 'G': case 'k':
        face(['#9ab4d0', '#6f8fb0', '#44607e']);
        px(g, 8, 1, 1, hpx - 2, '#44607e');
        for (let y = 3; y < 9; y += 2) { px(g, 3, y, 3, 1, '#34485e'); px(g, 10, y, 3, 1, '#34485e'); }
        px(g, 6, 11, 1, 3, '#ffffff'); px(g, 10, 11, 1, 3, '#ffffff');
        if (ch === 'G') { px(g, 2, 2, 12, 1, '#ffd23a'); }
        break;
      case 'B': face(['#6fb058', '#4f8a3e', '#2e5a22']); px(g, 0, 0, 16, 3, '#8ad06a'); px(g, 3, hpx - 4, 10, 1, '#2e5a22'); break;
      case 'O': face(['#e0b478', '#c0904e', '#7a5228']); px(g, 3, 4, 3, 3, '#6a4020'); px(g, 10, 5, 2, 2, '#6a4020'); px(g, 7, 0, 2, 3, '#f8e4b8'); break;
      case 'C': case 'I': case 'i': face(['#4a5262', '#343a48', '#1e222c']); for (let i = 0; i < 3; i++) px(g, 3 + i * 4, 3, 2, 1, i === 1 ? '#35e08a' : '#ff4b5c'); break;
      case 'D': face(['#9aa2b0', '#6e7686', '#3e4452']); px(g, 7, 0, 2, hpx, '#2c3038'); for (let y = 3; y < hpx - 3; y += 4) { px(g, 1, y, 5, 1, T.line); px(g, 10, y, 5, 1, T.line); } px(g, 11, hpx - 7, 3, 3, '#15181c'); px(g, 12, hpx - 6, 1, 1, '#ff3030'); break;
      case 'T':
        if (T.pillar === 'server') { face(['#3a4658', '#262e3c', '#141a24']); for (let y = 2; y < hpx - 2; y += 3) { px(g, 2, y, 12, 1, '#384456'); px(g, 3 + ((y * 7) % 9), y, 1, 1, y % 2 ? '#35e08a' : '#3fd0ff'); } }
        else if (T.pillar === 'shuttle') { px(g, 0, 0, 16, hpx, '#c8d0dc'); px(g, 0, 0, 16, 1, '#ffffff'); px(g, 0, hpx - 5, 16, 3, '#c83a4a'); px(g, 5, 4, 6, 3, '#3a2a55'); px(g, 5, 4, 6, 1, '#c34bff'); }
        else { face(['#9aa2b0', '#6e7686', '#3e4452']); px(g, 3, 3, 10, 6, '#2a303c'); px(g, 4, 4, 2, 1, '#ff4040'); px(g, 7, 4, 2, 1, '#40ff70'); px(g, 1, hpx - 3, 14, 1, T.line); }
        break;
      case 'A': // tent front: fabric with a dark entrance flap
        px(g, 0, 0, 16, hpx, '#b8344a'); px(g, 0, 0, 16, 1, '#ff8a98'); for (let x = 3; x < 16; x += 5) px(g, x, 1, 1, hpx - 1, '#8a2434');
        break;
      case 'J': case 'j':
        for (let x = 1; x < 16; x += 3) { px(g, x, 0, 1, hpx, '#b8bec8'); px(g, x + 1, 0, 1, hpx, '#6a707c'); }
        px(g, 0, 0, 16, 2, '#9aa0ac'); px(g, 0, (hpx / 2) | 0, 16, 1, '#7a808c');
        break;
      default: face(['#8a93a0', '#5e6674', '#343a46']);
    }
    // ambient occlusion at the base
    const ao = g.createLinearGradient(0, hpx - 4, 0, hpx);
    ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = ao; g.fillRect(0, hpx - 4, 16, 4);
    cache.set(k, c);
    return c;
  }

  function blobShadow(w) {
    const k = 'shadow:' + w;
    if (cache.has(k)) return cache.get(k);
    const h = Math.max(3, Math.round(w * 0.4)), c = canvas(w, h), g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.38)';
    for (let y = 0; y < h; y++) { const t = (y + 0.5) / h * 2 - 1, half = Math.round(w / 2 * Math.sqrt(1 - t * t)); g.fillRect(w / 2 - half, y, half * 2, 1); }
    cache.set(k, c);
    return c;
  }

  return { getChar, body, drone, camera, pickup, barrel, tree, pillar, core, tuft, exitPad, wallTop, wallFront, propTop, propFront, blobShadow, outline };
})();
