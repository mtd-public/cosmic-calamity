'use strict';
// Procedural 16-bit style pixel art: tiles, characters, effects and codec portraits.
const Art = (() => {
  const T = 16;

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shade(hex, amt) {
    const c = parseInt(hex.slice(1), 16);
    let r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
  }
  function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

  const THEMES = {
    depot: {
      bg: '#06080c', floor: '#3b414c', floor2: '#25292f', line: '#caa52a', grass: '#35512a',
      wall: '#34525e', wallStyle: 'corrugated', crate: '#8b6b3d', crateStyle: 'wood',
      pillar: 'machine', tent: '#6a2430', accent: '#5de0ff', field: '#5de0ff',
    },
    camp: {
      bg: '#070905', floor: '#56502e', floor2: '#7a6b48', line: '#d0b040', grass: '#3c6a27',
      wall: '#5d5a6a', wallStyle: 'palisade', crate: '#6b5a3a', crateStyle: 'wood',
      pillar: 'tree', tent: '#8a2232', accent: '#c34bff', field: '#c34bff',
    },
    lab: {
      bg: '#0a0d12', floor: '#6b7888', floor2: '#4f5d70', line: '#e0a040', grass: '#4f8a3a',
      wall: '#8a97a8', wallStyle: 'panel', crate: '#5a6878', crateStyle: 'container',
      pillar: 'server', tent: '#44506a', accent: '#e0a040', field: '#8fe8ff',
    },
    hangar: {
      bg: '#05070a', floor: '#4a515b', floor2: '#30353c', line: '#e6b422', grass: '#35512a',
      wall: '#2e3744', wallStyle: 'steel', crate: '#56623a', crateStyle: 'military',
      pillar: 'shuttle', tent: '#44506a', accent: '#ff6a3c', field: '#ff4a8a',
    },
    ship: {
      bg: '#06030b', floor: '#2d2240', floor2: '#1c1430', line: '#6dffb0', grass: '#2d6b4a',
      wall: '#3e245c', wallStyle: 'organic', crate: '#4b2f6e', crateStyle: 'pod',
      pillar: 'organic', tent: '#5a2a6e', accent: '#6dffb0', field: '#6dffb0',
    },
  };

  // ---------------------------------------------------------------- floors
  function floorBase(g, th, ch, r) {
    const st = th.wallStyle;
    if (ch === ';') {
      px(g, 0, 0, T, T, shade(th.grass, -0.35));
      for (let i = 0; i < 26; i++) {
        const x = (r() * 16) | 0, y = (r() * 14) | 0, h = 2 + ((r() * 3) | 0);
        px(g, x, y, 1, h, shade(th.grass, r() * 0.5 - 0.1));
        px(g, x, y, 1, 1, shade(th.grass, 0.45));
      }
      return;
    }
    const base = ch === ',' ? th.floor2 : th.floor;
    px(g, 0, 0, T, T, base);
    if (st === 'corrugated') { // depot
      if (ch === '.') {
        for (let i = 0; i < 18; i++) px(g, (r() * 16) | 0, (r() * 16) | 0, 1, 1, shade(base, (r() - 0.5) * 0.3));
        px(g, 0, 0, T, 1, shade(base, -0.18)); px(g, 0, 0, 1, T, shade(base, -0.18));
        if (r() < 0.15) { let x = (r() * 12) | 0, y = 3; for (let k = 0; k < 7; k++) { px(g, x, y + k, 1, 1, shade(base, -0.35)); x += r() < 0.5 ? 1 : 0; } }
      } else {
        for (let i = 0; i < 30; i++) px(g, (r() * 16) | 0, (r() * 16) | 0, 1, 1, shade(base, (r() - 0.5) * 0.35));
        if (ch === ':') { px(g, 3, 7, 10, 2, th.line); px(g, 3, 9, 10, 1, shade(th.line, -0.4)); }
      }
    } else if (st === 'palisade') { // camp
      if (ch === ',') {
        for (let i = 0; i < 26; i++) px(g, (r() * 16) | 0, (r() * 16) | 0, 1, 1, shade(base, (r() - 0.5) * 0.35));
        if (r() < 0.35) { const x = (r() * 13) | 0, y = (r() * 13) | 0; px(g, x, y, 1, 2, shade(th.grass, 0.1)); px(g, x + 2, y + 1, 1, 2, shade(th.grass, 0.2)); }
      } else if (ch === '.') {
        for (let i = 0; i < 14; i++) { const x = (r() * 15) | 0, y = (r() * 15) | 0; px(g, x, y, 2, 1, shade(base, 0.25)); px(g, x, y + 1, 2, 1, shade(base, -0.25)); }
      } else if (ch === ':') {
        px(g, 0, 0, T, T, '#4a4f5a'); px(g, 0, 0, T, 1, '#5d6370'); px(g, 0, 15, T, 1, '#30343c');
        px(g, 2, 2, 1, 1, '#7a808c'); px(g, 13, 2, 1, 1, '#7a808c'); px(g, 2, 13, 1, 1, '#7a808c'); px(g, 13, 13, 1, 1, '#7a808c');
      }
    } else if (st === 'panel') { // lab
      if (ch === ':') { hazard(g, '#2a2a2a', th.line); return; }
      px(g, 0, 0, T, 1, shade(base, -0.2)); px(g, 0, 8, T, 1, shade(base, -0.2));
      px(g, 0, 0, 1, T, shade(base, -0.2)); px(g, 8, 0, 1, T, shade(base, -0.2));
      px(g, 1, 1, 7, 1, shade(base, 0.25)); px(g, 9, 9, 7, 1, shade(base, 0.25));
      for (let i = 0; i < 5; i++) px(g, (r() * 16) | 0, (r() * 16) | 0, 1, 1, shade(base, -0.08));
    } else if (st === 'steel') { // hangar
      if (ch === ':') { hazard(g, '#222', th.line); return; }
      if (ch === ',') {
        for (let y = 1; y < 16; y += 3) px(g, 0, y, T, 1, shade(base, -0.45));
        px(g, 0, 0, 1, T, shade(base, -0.3));
        return;
      }
      px(g, 0, 0, T, 1, shade(base, 0.18)); px(g, 0, 0, 1, T, shade(base, 0.18));
      px(g, 0, 15, T, 1, shade(base, -0.35)); px(g, 15, 0, 1, T, shade(base, -0.35));
      [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([x, y]) => { px(g, x, y, 1, 1, shade(base, 0.4)); px(g, x + 1, y + 1, 1, 1, shade(base, -0.4)); });
      for (let i = 0; i < 6; i++) px(g, (r() * 16) | 0, (r() * 16) | 0, 1, 1, shade(base, (r() - 0.5) * 0.2));
    } else if (st === 'organic') { // ship
      if (ch === ':') {
        px(g, 0, 0, T, T, shade(base, -0.2));
        px(g, 0, 7, T, 2, shade(th.accent, -0.3)); px(g, 0, 7, T, 1, th.accent);
        return;
      }
      if (ch === ',') {
        for (let y = 1; y < 16; y += 4) for (let x = (y % 8 === 1 ? 0 : 2); x < 16; x += 4) px(g, x, y, 2, 2, shade(th.accent, -0.7));
        return;
      }
      // hex-ish plates
      const d = shade(base, -0.35), l = shade(base, 0.15);
      px(g, 4, 0, 8, 1, d); px(g, 4, 15, 8, 1, d); px(g, 0, 7, 4, 1, d); px(g, 12, 7, 4, 1, d);
      for (let i = 0; i < 4; i++) { px(g, 3 - i, i + 1, 1, 1, d); px(g, 12 + i, i + 1, 1, 1, d); px(g, i, 8 + i, 1, 1, d); px(g, 15 - i, 8 + i, 1, 1, d); }
      px(g, 5, 2, 6, 1, l);
      if (r() < 0.3) px(g, 7, 7, 2, 2, shade(th.accent, -0.55));
    }
  }

  function hazard(g, a, b) {
    px(g, 0, 0, T, T, a);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (((x + y) >> 2) % 2 === 0) px(g, x, y, 1, 1, b);
  }

  // ---------------------------------------------------------------- walls & solids
  function wall(g, th, r, face) {
    const c = th.wall, st = th.wallStyle;
    const top = face ? 11 : 16;
    px(g, 0, 0, T, top, c);
    if (st === 'corrugated') {
      for (let x = 0; x < T; x += 2) px(g, x, 0, 1, top, shade(c, 0.12));
      px(g, 0, 0, T, 1, shade(c, 0.35));
    } else if (st === 'palisade') {
      for (let x = 0; x < T; x += 4) { px(g, x, 0, 1, top, shade(c, -0.35)); px(g, x + 1, 0, 1, top, shade(c, 0.15)); }
      px(g, 0, 2, T, 1, shade(c, -0.3)); px(g, 0, 3, T, 1, '#8b8f99');
      px(g, 0, 0, T, 1, shade(c, 0.3));
    } else if (st === 'panel') {
      px(g, 0, 0, T, 1, shade(c, 0.35)); px(g, 0, top - 1, T, 1, shade(c, -0.2));
      px(g, 0, 5, T, 2, th.accent); px(g, 0, 7, T, 1, shade(th.accent, -0.4));
      px(g, 7, 0, 1, 5, shade(c, -0.15));
    } else if (st === 'steel') {
      px(g, 0, 0, T, 1, shade(c, 0.3)); px(g, 0, 1, 1, top - 1, shade(c, 0.15));
      px(g, 15, 1, 1, top - 1, shade(c, -0.35));
      px(g, 3, 3, 1, 1, shade(c, 0.45)); px(g, 12, 3, 1, 1, shade(c, 0.45));
      if (top > 12) { px(g, 3, 12, 1, 1, shade(c, 0.45)); px(g, 12, 12, 1, 1, shade(c, 0.45)); }
    } else if (st === 'organic') {
      for (let i = 0; i < 3; i++) {
        let x = (r() * 16) | 0;
        for (let y = 0; y < top; y++) { px(g, x, y, 1, 1, shade(c, -0.3)); if (r() < 0.4) x += r() < 0.5 ? -1 : 1; }
      }
      px(g, 0, 0, T, 1, shade(c, 0.3));
      if (r() < 0.5) { const x = 3 + ((r() * 10) | 0), y = 2 + ((r() * (top - 5)) | 0); px(g, x, y, 2, 2, th.accent); px(g, x, y, 1, 1, '#fff'); }
    }
    if (face) {
      const f = shade(c, -0.45);
      px(g, 0, 11, T, 5, f);
      px(g, 0, 11, T, 1, shade(c, -0.15));
      for (let x = 1; x < T; x += 4) px(g, x, 12, 1, 4, shade(f, -0.3));
      px(g, 0, 15, T, 1, shade(f, -0.4));
    }
  }

  function crate(g, th, r) {
    const c = th.crate, st = th.crateStyle;
    const top = shade(c, 0.12), face = shade(c, -0.35), line = shade(c, -0.55);
    px(g, 0, 0, T, 12, top); px(g, 0, 12, T, 4, face);
    px(g, 0, 0, T, 1, shade(c, 0.4)); px(g, 0, 11, T, 1, line); px(g, 0, 15, T, 1, line);
    px(g, 0, 0, 1, T, line); px(g, 15, 0, 1, T, line);
    if (st === 'wood') {
      for (let y = 3; y < 12; y += 4) px(g, 1, y, 14, 1, shade(c, -0.25));
      for (let i = 1; i < 11; i++) { px(g, i + 2, i, 1, 1, line); }
      px(g, 2, 13, 12, 1, shade(face, 0.2));
    } else if (st === 'container') {
      for (let x = 2; x < 15; x += 3) px(g, x, 1, 1, 10, shade(c, -0.2));
      px(g, 5, 13, 6, 2, th.accent);
    } else if (st === 'military') {
      px(g, 1, 5, 14, 2, shade(c, -0.25));
      px(g, 4, 2, 1, 2, '#e6d17a'); px(g, 6, 2, 1, 2, '#e6d17a'); px(g, 8, 2, 3, 1, '#e6d17a');
      px(g, 3, 13, 2, 2, '#222'); px(g, 11, 13, 2, 2, '#222');
    } else if (st === 'pod') {
      px(g, 0, 0, T, 16, 'rgba(0,0,0,0)');
      px(g, 2, 1, 12, 10, top); px(g, 1, 2, 14, 8, top);
      px(g, 7, 1, 2, 10, th.accent); px(g, 7, 1, 1, 10, '#fff');
    }
  }

  function barrel(g, th, r) {
    const c = th.wallStyle === 'organic' ? '#5b3a7a' : (th.wallStyle === 'palisade' ? '#5c6b3a' : '#3f6f8f');
    px(g, 3, 3, 10, 11, shade(c, -0.2));
    px(g, 2, 4, 12, 9, shade(c, -0.2));
    px(g, 3, 2, 10, 7, shade(c, 0.1)); px(g, 2, 3, 12, 5, shade(c, 0.1));
    px(g, 4, 3, 8, 4, shade(c, 0.3)); px(g, 6, 4, 3, 1, shade(c, 0.6));
    px(g, 2, 10, 12, 1, th.line); px(g, 3, 13, 10, 1, shade(c, -0.5));
  }

  function tree(g, th, r) {
    const d = shade(th.grass, -0.3);
    px(g, 6, 11, 4, 4, '#4a3320');
    px(g, 2, 2, 12, 10, d); px(g, 1, 4, 14, 6, d); px(g, 4, 0, 8, 13, d);
    for (let i = 0; i < 26; i++) px(g, 2 + ((r() * 12) | 0), 1 + ((r() * 10) | 0), 2, 1, shade(th.grass, r() * 0.4 - 0.1));
    px(g, 4, 2, 3, 2, shade(th.grass, 0.35));
  }

  function pillar(g, th, r) {
    const p = th.pillar;
    if (p === 'tree') return tree(g, th, r);
    if (p === 'machine') {
      px(g, 1, 0, 14, 12, '#5a616c'); px(g, 1, 12, 14, 4, '#353a42');
      px(g, 1, 0, 14, 1, '#8a929c'); px(g, 3, 3, 10, 6, '#2b3036');
      px(g, 4, 4, 2, 1, '#ff4040'); px(g, 7, 4, 2, 1, '#40ff70'); px(g, 3, 13, 10, 1, th.line);
      return;
    }
    if (p === 'server') {
      px(g, 1, 0, 14, 16, '#262d38'); px(g, 1, 0, 14, 1, '#4a5566'); px(g, 1, 12, 14, 4, '#1a1f27');
      for (let y = 2; y < 11; y += 2) { px(g, 2, y, 12, 1, '#323b48'); if (r() < 0.8) px(g, 3 + ((r() * 8) | 0), y, 1, 1, r() < 0.5 ? '#3fd0ff' : '#5dff8a'); }
      return;
    }
    if (p === 'shuttle') {
      px(g, 0, 0, T, T, '#b8bec9');
      px(g, 0, 0, T, 1, '#dde2ea'); px(g, 0, 8, T, 1, '#8a909b');
      px(g, 4, 0, 1, T, '#9aa0ab'); px(g, 12, 0, 1, T, '#9aa0ab');
      if (r() < 0.25) { px(g, 6, 3, 4, 2, '#3a2a55'); px(g, 6, 3, 4, 1, '#c34bff'); }
      if (r() < 0.2) px(g, 1, 11, 14, 2, '#a2303a');
      return;
    }
    // organic pillar
    px(g, 2, 0, 12, 16, shade(th.wall, 0.1)); px(g, 1, 3, 14, 10, shade(th.wall, 0.1));
    px(g, 5, 4, 6, 8, shade(th.accent, -0.55)); px(g, 6, 5, 4, 6, shade(th.accent, -0.2)); px(g, 7, 6, 2, 2, '#e8fff2');
    px(g, 2, 0, 12, 1, shade(th.wall, 0.4));
  }

  function tent(g, th, r) {
    const c = th.tent;
    if (th.wallStyle !== 'palisade') { // generator
      px(g, 1, 1, 14, 11, '#4b5260'); px(g, 1, 12, 14, 4, '#2c3038'); px(g, 3, 3, 10, 7, '#2a2e36');
      for (let x = 4; x < 12; x += 2) px(g, x, 4, 1, 5, '#606878');
      px(g, 12, 13, 2, 1, '#ff5040');
      return;
    }
    px(g, 0, 0, T, T, c);
    px(g, 0, 0, T, 1, shade(c, 0.3)); px(g, 7, 0, 2, T, shade(c, 0.18));
    for (let x = 1; x < 16; x += 5) px(g, x, 0, 1, T, shade(c, -0.25));
    px(g, 0, 13, T, 3, shade(c, -0.45));
    px(g, 6, 5, 4, 4, '#1a0a0e'); px(g, 7, 6, 2, 2, '#e8c34a'); // Vyrr insignia
  }

  function locker(g, th) {
    const c = th.wallStyle === 'organic' ? '#5a4a78' : '#51677e';
    px(g, 1, 0, 14, 12, shade(c, 0.1)); px(g, 1, 12, 14, 4, shade(c, -0.35));
    px(g, 1, 0, 14, 1, shade(c, 0.45)); px(g, 8, 0, 1, 16, shade(c, -0.5));
    for (let y = 2; y < 7; y += 2) { px(g, 3, y, 3, 1, shade(c, -0.5)); px(g, 10, y, 3, 1, shade(c, -0.5)); }
    px(g, 6, 8, 1, 2, '#ddd'); px(g, 10, 8, 1, 2, '#ddd');
    px(g, 1, 0, 1, 16, shade(c, -0.5)); px(g, 14, 0, 1, 16, shade(c, -0.5));
  }

  function bin(g, th) {
    const c = th.wallStyle === 'organic' ? '#3d6b52' : '#3f6b3a';
    px(g, 1, 3, 14, 13, shade(c, -0.3));
    px(g, 0, 2, 16, 8, c); px(g, 0, 2, 16, 1, shade(c, 0.4)); px(g, 8, 2, 1, 8, shade(c, -0.3));
    px(g, 0, 9, 16, 1, shade(c, -0.5));
    px(g, 3, 12, 10, 1, shade(c, -0.55)); px(g, 2, 15, 3, 1, '#111'); px(g, 11, 15, 3, 1, '#111');
  }

  function box(g) {
    const c = '#b48a50';
    px(g, 1, 2, 14, 10, c); px(g, 1, 12, 14, 4, shade(c, -0.3));
    px(g, 1, 2, 14, 1, shade(c, 0.3)); px(g, 7, 2, 2, 10, '#d4b27a');
    px(g, 3, 13, 3, 2, '#5a3b1c'); px(g, 10, 13, 2, 2, '#5a3b1c');
    px(g, 1, 2, 1, 14, shade(c, -0.45)); px(g, 14, 2, 1, 14, shade(c, -0.45));
  }

  function consoleTile(g, th, screen) {
    px(g, 1, 3, 14, 9, '#2f343d'); px(g, 1, 12, 14, 3, '#1c2026');
    px(g, 1, 3, 14, 1, '#59616e');
    px(g, 3, 5, 10, 4, screen);
    px(g, 4, 6, 5, 1, shade(screen, 0.5)); px(g, 4, 8, 3, 1, shade(screen, 0.3));
    px(g, 3, 10, 1, 1, '#ff4a4a'); px(g, 5, 10, 1, 1, '#ffd23a'); px(g, 7, 10, 1, 1, '#4aff7a');
  }

  function fieldTile(g, th) {
    if (th.wallStyle === 'panel') { // glass tank / wall
      px(g, 1, 1, 14, 14, 'rgba(160,230,255,0.35)');
      px(g, 1, 1, 14, 1, 'rgba(230,250,255,0.8)'); px(g, 3, 3, 1, 6, 'rgba(255,255,255,0.7)');
      px(g, 1, 14, 14, 1, 'rgba(60,90,110,0.9)');
      return;
    }
    px(g, 0, 6, T, 4, 'rgba(0,0,0,0.35)');
    px(g, 0, 7, T, 2, th.field); px(g, 0, 8, T, 1, '#ffffff');
    px(g, 0, 5, 2, 6, '#555'); px(g, 14, 5, 2, 6, '#555');
  }

  function door(g, th, open) {
    if (open) {
      px(g, 0, 0, 3, T, '#3a3f48'); px(g, 13, 0, 3, T, '#3a3f48');
      px(g, 0, 0, 3, 1, '#6a707b'); px(g, 13, 0, 3, 1, '#6a707b');
      px(g, 3, 0, 10, 1, '#0006');
      return;
    }
    px(g, 0, 0, T, 12, '#5e6570'); px(g, 0, 12, T, 4, '#353a42');
    px(g, 0, 0, T, 1, '#8c939e'); px(g, 7, 0, 2, 16, '#2c3037');
    for (let y = 2; y < 11; y += 3) { px(g, 1, y, 5, 1, th.line); px(g, 10, y, 5, 1, th.line); }
    px(g, 10, 13, 4, 2, '#15181c'); px(g, 11, 13, 1, 1, '#ff3030');
  }

  function exitTile(g, th) {
    px(g, 1, 1, 14, 14, '#10261c'); px(g, 2, 2, 12, 12, '#163d2a');
    px(g, 1, 1, 14, 1, '#5dff8a'); px(g, 1, 14, 14, 1, '#5dff8a'); px(g, 1, 1, 1, 14, '#5dff8a'); px(g, 14, 1, 1, 14, '#5dff8a');
    for (let i = 0; i < 3; i++) { px(g, 5 + i, 5 + i * 2, 6 - i * 2, 1, '#9dffb8'); }
  }

  function core(g, th, broken) {
    px(g, 1, 2, 14, 12, '#2a1c3a'); px(g, 1, 12, 14, 4, '#170f22'); px(g, 1, 2, 14, 1, '#5b4380');
    if (broken) {
      px(g, 5, 4, 6, 8, '#3a2f3a'); px(g, 6, 5, 1, 3, '#000'); px(g, 8, 7, 2, 1, '#000'); px(g, 9, 8, 1, 3, '#000');
      return;
    }
    px(g, 5, 3, 6, 10, '#9a2bd6'); px(g, 6, 2, 4, 12, '#c34bff'); px(g, 7, 4, 2, 7, '#f3c8ff');
  }

  function intel(g, th, used) { consoleTile(g, th, used ? '#20302a' : '#2fe07a'); if (!used) { px(g, 12, 1, 2, 2, '#ffd23a'); } }

  // Tile cache
  const cache = new Map();
  function tile(themeName, ch, variant, face) {
    const key = themeName + ch + variant + (face ? 'f' : '');
    let c = cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = T;
    const g = c.getContext('2d');
    const th = THEMES[themeName];
    const r = rng(variant * 7919 + ch.charCodeAt(0) * 131 + 7);
    const solidOnFloor = (under = '.') => floorBase(g, th, under, rng(variant + 3));
    switch (ch) {
      case '#': wall(g, th, r, face); break;
      case 'X': solidOnFloor(); crate(g, th, r); break;
      case 'x': solidOnFloor(); barrel(g, th, r); break;
      case 'T': solidOnFloor(th.pillar === 'tree' ? ',' : '.'); pillar(g, th, r); break;
      case 'A': solidOnFloor(','); tent(g, th, r); break;
      case 'L': solidOnFloor(); locker(g, th); break;
      case 'B': solidOnFloor(); bin(g, th); break;
      case 'O': solidOnFloor(); box(g); break;
      case 'C': solidOnFloor(); consoleTile(g, th, th.accent); break;
      case '=': solidOnFloor(); fieldTile(g, th); break;
      case 'D': door(g, th, false); break;
      case 'd': solidOnFloor(); door(g, th, true); break;
      case 'E': solidOnFloor(); exitTile(g, th); break;
      case 'Z': solidOnFloor(); core(g, th, false); break;
      case 'z': solidOnFloor(); core(g, th, true); break;
      case 'I': solidOnFloor(); intel(g, th, false); break;
      case 'i': solidOnFloor(); intel(g, th, true); break;
      default: floorBase(g, th, ch, r);
    }
    cache.set(key, c);
    return c;
  }

  // ---------------------------------------------------------------- characters
  const PAL = {
    snake: { suit: '#2c3a58', suitD: '#1d263c', pants: '#253049', boot: '#101218', belt: '#55503a', skin: '#e0a878', hair: '#3a2a1e', eye: '#1a1a1a', arm2: '#b9c6d2' },
    grunt: { suit: '#962233', suitD: '#61141f', pants: '#2b2b30', boot: '#0e0e10', belt: '#111', skin: '#62b04c', hair: '#3a7a2c', eye: '#ffd23a', arm2: '#62b04c' },
    heavy: { suit: '#4d3d70', suitD: '#302548', pants: '#27212f', boot: '#0e0e10', belt: '#111', skin: '#4f8f3d', hair: '#8b7fb0', eye: '#ff4040', arm2: '#6d5a96' },
  };

  // face: 0 down, 1 up, 2 left, 3 right. (x,y) = actor center; feet at y+6.
  function human(g, x, y, face, step, P, kind, o = {}) {
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x - 4, y + 5, 8, 2); g.fillRect(x - 5, y + 6, 10, 1);
    const la = step === 1 ? 1 : 0, lb = step === 2 ? 1 : 0;
    if (face <= 1) {
      // legs
      px(g, x - 3, y + 1, 2, 5 - la, P.pants); px(g, x + 1, y + 1, 2, 5 - lb, P.pants);
      px(g, x - 3, y + 5 - la, 2, 1, P.boot); px(g, x + 1, y + 5 - lb, 2, 1, P.boot);
      // torso
      px(g, x - 4, y - 4, 8, 6, P.suit); px(g, x + 2, y - 4, 2, 6, P.suitD);
      px(g, x - 4, y, 8, 1, P.belt);
      // arms
      const sa = step === 1 ? -1 : step === 2 ? 1 : 0;
      px(g, x - 6, y - 4 + sa, 2, 5, P.suit); px(g, x - 6, y + 1 + sa, 2, 1, P.skin);
      px(g, x + 4, y - 4 - sa, 2, 5, kind === 'snake' ? P.arm2 : P.suitD);
      px(g, x + 4, y + 1 - sa, 2, 1, kind === 'snake' ? '#7ff6ff' : P.skin);
      // head
      if (face === 0) {
        px(g, x - 3, y - 10, 6, 6, P.skin); px(g, x - 3, y - 10, 6, 2, P.hair);
        px(g, x - 2, y - 7, 1, 1, P.eye); px(g, x + 1, y - 7, 1, 1, kind === 'snake' ? '#ff2a2a' : P.eye);
      } else {
        px(g, x - 3, y - 10, 6, 6, P.hair); px(g, x - 2, y - 5, 4, 1, shade(P.skin, -0.2));
      }
    } else {
      const s = face === 3 ? 1 : -1;
      const sw = step === 1 ? 2 : step === 2 ? -2 : 0;
      px(g, x - 1 + sw * s, y + 1, 2, 5, shade(P.pants, -0.2));
      px(g, x - 1 - sw * s, y + 1, 2, 5, P.pants);
      px(g, x - 1 + sw * s, y + 5, 2, 1, P.boot); px(g, x - 1 - sw * s, y + 5, 2, 1, P.boot);
      px(g, x - 3, y - 4, 6, 6, P.suit); px(g, x - 3, y, 6, 1, P.belt);
      px(g, s > 0 ? x - 3 : x + 1, y - 4, 2, 6, P.suitD);
      // head
      px(g, x - 3, y - 10, 6, 6, P.hair);
      px(g, s > 0 ? x : x - 3, y - 9, 3, 5, P.skin);
      px(g, x + s * 2 - (s < 0 ? 0 : 0), y - 7, 1, 1, kind === 'snake' ? '#ff2a2a' : P.eye);
      // arm
      const armC = kind === 'snake' && s > 0 ? P.arm2 : P.suit;
      px(g, x - 1 - sw * s / 2, y - 3, 2, 5, armC);
      px(g, x - 1 - sw * s / 2, y + 2, 2, 1, kind === 'snake' && s > 0 ? '#7ff6ff' : P.skin);
    }
    // --- per-kind decoration
    if (kind === 'snake') {
      const t = o.t || 0, fl = Math.sin(t * 12) > 0 ? 1 : 0;
      if (face === 0) { px(g, x - 3, y - 9, 6, 1, '#d02e2e'); }
      else if (face === 1) { px(g, x - 3, y - 9, 6, 1, '#d02e2e'); px(g, x - 1, y - 8, 1, 3 + fl, '#b02525'); px(g, x + 1, y - 8, 1, 2 + (1 - fl), '#b02525'); }
      else {
        const s = face === 3 ? 1 : -1;
        px(g, x - 3, y - 9, 6, 1, '#d02e2e');
        px(g, x - s * 4 - (s > 0 ? 0 : 1), y - 9 + fl, 2, 1, '#b02525'); px(g, x - s * 6 - (s > 0 ? 0 : 1), y - 8 - fl, 2, 1, '#b02525');
      }
    } else if (kind === 'grunt') {
      px(g, x - 1, y - 11, 2, 1, P.hair); px(g, x - 3, y - 11, 1, 1, P.hair); px(g, x + 2, y - 11, 1, 1, P.hair);
      if (face === 0) { px(g, x - 3, y - 8, 6, 1, '#111'); px(g, x - 2, y - 8, 1, 1, P.eye); px(g, x + 1, y - 8, 1, 1, P.eye); px(g, x - 1, y - 5, 2, 1, '#2a4a20'); }
      else if (face >= 2) { const s = face === 3 ? 1 : -1; px(g, s > 0 ? x : x - 3, y - 8, 3, 1, '#111'); px(g, x + s * 2, y - 8, 1, 1, P.eye); px(g, x + s * 3 - (s > 0 ? 0 : 0), y - 6, 1, 1, P.skin); }
      px(g, x - 5, y - 4, 2, 2, '#1a1a1a'); px(g, x + 3, y - 4, 2, 2, '#1a1a1a');
    } else if (kind === 'heavy') {
      px(g, x - 8, y - 5, 4, 4, P.arm2); px(g, x + 4, y - 5, 4, 4, P.arm2);
      px(g, x - 8, y - 5, 4, 1, shade(P.arm2, 0.3)); px(g, x + 4, y - 5, 4, 1, shade(P.arm2, 0.3));
      px(g, x - 4, y - 12, 8, 4, '#6c6f7a'); px(g, x - 4, y - 12, 8, 1, '#9a9eab');
      if (face === 0) px(g, x - 3, y - 8, 6, 1, P.eye);
      else if (face >= 2) { const s = face === 3 ? 1 : -1; px(g, s > 0 ? x : x - 3, y - 8, 3, 1, P.eye); }
    }
    // weapon
    if (o.gun) {
      const a = o.aim;
      const gx = Math.round(x + Math.cos(a) * 6), gy = Math.round(y - 2 + Math.sin(a) * 5);
      px(g, gx - 1, gy - 1, kind === 'heavy' ? 4 : 3, kind === 'heavy' ? 3 : 2, kind === 'heavy' ? '#2a2a33' : '#1a1a1a');
      if (kind !== 'snake') px(g, gx, gy - 1, 1, 1, kind === 'heavy' ? '#ff4040' : '#c34bff');
    }
  }

  function body(g, x, y, P, kind, t, dead) {
    // lying on the floor, head to the left
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 9, y + 2, 18, 3);
    if (dead) {
      // dissolving goo
      const k = Math.min(1, t / 1.6);
      const w = Math.round(14 - k * 4), h = Math.round(4 + k * 2);
      px(g, x - w / 2, y + 1 - h / 2 + 2, w, h, '#2e7a2a'); px(g, x - w / 2 + 1, y + 2 - h / 2 + 1, w - 2, 1, '#6bd45a');
      if (k < 1) { px(g, x - 7, y - 2, 6, 4, shade(P.skin, -k * 0.5)); px(g, x - 1, y - 3, 8, 5, shade(P.suit, -k * 0.6)); }
      if ((t * 6 | 0) % 3 === 0) px(g, x - 3 + ((t * 13) % 7 | 0), y - 1 - ((t * 9) % 4 | 0), 1, 1, '#9dff8a');
      return;
    }
    px(g, x + 5, y - 1, 5, 2, P.pants); px(g, x + 5, y + 1, 5, 2, shade(P.pants, -0.2));
    px(g, x + 9, y - 1, 1, 4, P.boot);
    px(g, x - 2, y - 3, 7, 6, P.suit); px(g, x - 2, y + 1, 7, 2, P.suitD);
    px(g, x - 8, y - 2, 6, 5, P.skin); px(g, x - 8, y - 2, 2, 5, P.hair);
    if (kind === 'heavy') { px(g, x - 9, y - 3, 7, 3, '#6c6f7a'); }
    // stars
    for (let i = 0; i < 3; i++) {
      const a = t * 3 + i * 2.1;
      const sx = Math.round(x - 5 + Math.cos(a) * 5), sy = Math.round(y - 7 + Math.sin(a) * 2);
      px(g, sx, sy, 1, 1, '#ffe66b'); px(g, sx - 1, sy, 3, 1, 'rgba(255,230,107,0.5)');
    }
  }

  function drone(g, x, y, dir, t, eye) {
    const bob = Math.round(Math.sin(t * 4) * 1.5);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 4, y + 5, 8, 2);
    const cy = y - 5 + bob;
    px(g, x - 6, cy - 1, 12, 3, '#6a5f86'); px(g, x - 5, cy - 2, 10, 5, '#6a5f86');
    px(g, x - 3, cy - 5, 6, 4, '#a79dca'); px(g, x - 2, cy - 5, 2, 1, '#e0dcf0');
    px(g, x - 6, cy + 1, 12, 1, '#3c3552');
    px(g, x, cy - 8, 1, 3, '#888'); px(g, x, cy - 9, 1, 1, (t * 3 | 0) % 2 ? '#ff4040' : '#400');
    const ex = Math.round(x + Math.cos(dir) * 3), ey = Math.round(cy + Math.sin(dir) * 1.5);
    px(g, ex - 1, ey - 1, 3, 2, '#111'); px(g, ex, ey - 1, 1, 1, eye);
    px(g, x - 7, cy, 1, 1, (t * 5 | 0) % 2 ? '#5dffff' : '#135'); px(g, x + 6, cy, 1, 1, (t * 5 | 0) % 2 ? '#135' : '#5dffff');
  }

  function camera(g, x, y, dir, t, led) {
    const c = Math.cos(dir), s = Math.sin(dir);
    const mx = Math.round(x - c * 4), my = Math.round(y - s * 4);
    px(g, mx - 1, my - 1, 3, 3, '#444');
    const bx = Math.round(x), by = Math.round(y);
    px(g, bx - 2, by - 2, 5, 4, '#b8c0c8'); px(g, bx - 2, by - 2, 5, 1, '#e0e6ea');
    const lx = Math.round(x + c * 3), ly = Math.round(y + s * 2);
    px(g, lx - 1, ly - 1, 2, 2, '#111'); px(g, lx, ly - 1, 1, 1, '#4af');
    if ((t * 2 | 0) % 2 === 0) px(g, bx + 1, by - 2, 1, 1, led);
  }

  function pickup(g, type, x, y, t) {
    const b = Math.round(Math.sin(t * 3 + x) * 1);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 4, y + 3, 8, 2);
    const yy = y - 3 + b;
    if (type === 'r') {
      px(g, x - 4, yy - 3, 8, 7, '#eee'); px(g, x - 4, yy + 3, 8, 1, '#999');
      px(g, x - 1, yy - 2, 2, 5, '#e02a2a'); px(g, x - 3, yy, 6, 1, '#e02a2a');
    } else if (type === 'a') {
      px(g, x - 4, yy - 2, 8, 6, '#4b5a2a'); px(g, x - 4, yy - 2, 8, 1, '#6d7f3f');
      px(g, x - 3, yy - 4, 1, 3, '#e8c34a'); px(g, x - 1, yy - 4, 1, 3, '#e8c34a'); px(g, x + 1, yy - 4, 1, 3, '#e8c34a');
    } else if (type === 'K') {
      px(g, x - 4, yy - 2, 8, 6, '#2a8fe0'); px(g, x - 4, yy - 2, 8, 1, '#8fd0ff');
      px(g, x - 4, yy + 1, 8, 1, '#e8c34a');
      if ((t * 4 | 0) % 2) px(g, x + 2, yy - 1, 1, 1, '#fff');
    }
  }

  const ICONS = {
    '!': ['.##.', '.##.', '.##.', '.##.', '....', '.##.'],
    '?': ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'],
  };
  function icon(g, ch, x, y, color) {
    const m = ICONS[ch]; if (!m) return;
    const w = m[0].length, h = m.length;
    const ox = Math.round(x - w / 2), oy = Math.round(y - h);
    g.fillStyle = '#000';
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (m[j][i] === '#') g.fillRect(ox + i - 1, oy + j - 1, 3, 3);
    g.fillStyle = color;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (m[j][i] === '#') g.fillRect(ox + i, oy + j, 1, 1);
  }

  // ---------------------------------------------------------------- terminal portraits (48x48)
  function aiFace(g, W, t, mouth, col, glitch) {
    px(g, 0, 0, W, W, '#02060a');
    // concentric rings
    g.strokeStyle = shade(col, -0.6); g.lineWidth = 1;
    for (let r = 8; r < 30; r += 6) { g.beginPath(); g.arc(24, 24, r + ((t * 6) % 6), 0, Math.PI * 2); g.stroke(); }
    // wireframe head (a lattice of dots on an ellipse)
    for (let j = 0; j < 9; j++) {
      const y = 9 + j * 3.6, half = Math.sin((j + 0.5) / 9 * Math.PI) * 12;
      for (let i = -3; i <= 3; i++) {
        let x = 24 + (i / 3) * half;
        if (glitch && Math.random() < 0.12) x += (Math.random() - 0.5) * 10;
        px(g, Math.round(x), Math.round(y), 1, 1, shade(col, -0.2));
      }
    }
    // eyes
    const blink = Math.sin(t * 1.7) > 0.97;
    const eyeC = glitch ? '#ff3a6a' : '#ffffff';
    if (!blink) { px(g, 17, 19, 4, 2, col); px(g, 27, 19, 4, 2, col); px(g, 18, 19, 2, 1, eyeC); px(g, 28, 19, 2, 1, eyeC); }
    else { px(g, 17, 20, 4, 1, col); px(g, 27, 20, 4, 1, col); }
    // voice waveform mouth
    for (let i = 0; i < 12; i++) {
      const h = mouth ? 1 + Math.round(Math.abs(Math.sin(t * 20 + i * 1.3)) * 4) : 1;
      px(g, 18 + i, 32 - Math.floor(h / 2), 1, h, col);
    }
    if (glitch) {
      for (let k = 0; k < 3; k++) {
        const y = (Math.random() * W) | 0, h = 1 + ((Math.random() * 3) | 0), dx = ((Math.random() - 0.5) * 8) | 0;
        g.drawImage(g.canvas, 0, y, W, h, dx, y, W, h);
      }
    }
  }

  function portrait(canvas, who, mouth, blink, t) {
    const g = canvas.getContext('2d');
    const W = 48;
    t = t || 0;
    if (!who) {
      px(g, 0, 0, W, W, '#02060a');
      for (let i = 0; i < 300; i++) px(g, (Math.random() * W) | 0, (Math.random() * W) | 0, 2, 1, Math.random() < 0.5 ? '#6a7a70' : '#1a2420');
      return;
    }
    if (who === 'iris') { aiFace(g, W, t, mouth, '#4fe3ff', false); return scan(g, W, 'rgba(79,227,255,0.06)'); }
    if (who === 'threnody') { aiFace(g, W, t, mouth, '#d35bff', true); return scan(g, W, 'rgba(211,91,255,0.08)'); }
    px(g, 0, 0, W, W, '#0b1410');
    const P = {
      snake: { skin: '#d9a06a', skinD: '#a8703f', hair: '#3a2a1e', suit: '#2c3a58' },
      hale: { skin: '#c8906a', skinD: '#94603e', hair: '#b8b8b8', suit: '#3d4f2e' },
    }[who];
    // shoulders
    px(g, 6, 40, 36, 8, P.suit); px(g, 10, 37, 28, 4, P.suit);
    px(g, 20, 34, 8, 6, P.skinD);
    // face
    px(g, 14, 12, 20, 24, P.skin); px(g, 15, 10, 18, 2, P.skin); px(g, 16, 36, 16, 2, P.skin);
    px(g, 30, 14, 4, 22, P.skinD); px(g, 14, 12, 1, 22, P.skinD);
    px(g, 12, 20, 2, 6, P.skinD); px(g, 34, 20, 2, 6, P.skinD);
    const eyeY = 21;
    if (!blink) { px(g, 18, eyeY, 4, 2, '#fff'); px(g, 26, eyeY, 4, 2, '#fff'); px(g, 20, eyeY, 2, 2, '#1a1a1a'); px(g, 28, eyeY, 2, 2, '#1a1a1a'); }
    else { px(g, 18, eyeY + 1, 4, 1, P.skinD); px(g, 26, eyeY + 1, 4, 1, P.skinD); }
    px(g, 17, eyeY - 3, 6, 1, P.hair); px(g, 25, eyeY - 3, 6, 1, P.hair);
    px(g, 23, 23, 2, 5, P.skinD); px(g, 22, 28, 4, 1, P.skinD);
    if (mouth) { px(g, 20, 31, 8, 3, '#3a0e0e'); px(g, 21, 31, 6, 1, '#eee'); }
    else px(g, 20, 32, 8, 1, '#6a3020');
    if (who === 'snake') {
      px(g, 13, 6, 22, 6, P.hair); px(g, 12, 8, 3, 10, P.hair); px(g, 33, 8, 3, 10, P.hair);
      px(g, 14, 12, 3, 3, P.hair); px(g, 30, 11, 4, 3, P.hair);
      px(g, 12, 13, 24, 3, '#c82a2a'); px(g, 12, 13, 24, 1, '#ee5050');
      px(g, 35, 14, 5, 2, '#c82a2a'); px(g, 37, 16, 4, 2, '#a82020'); px(g, 39, 18, 3, 2, '#a82020');
      // cybernetic plate over the left eye
      px(g, 16, 18, 8, 7, '#8f9aa6'); px(g, 16, 18, 8, 1, '#c8d2dc'); px(g, 17, 20, 5, 3, '#1a1a1a');
      px(g, 19, 21, 2, 1, (t * 4 | 0) % 2 ? '#ff2020' : '#ff7070');
      px(g, 23, 18, 1, 9, '#5d6670');
      for (let i = 0; i < 26; i++) px(g, 16 + ((i * 7) % 16), 30 + ((i * 3) % 6), 1, 1, shade(P.skinD, -0.2));
      px(g, 30, 38, 12, 6, '#9aa6b2'); px(g, 32, 40, 2, 2, '#5dffff');
    } else {
      px(g, 14, 7, 20, 5, P.hair); px(g, 13, 9, 2, 8, P.hair); px(g, 33, 9, 2, 8, P.hair);
      px(g, 19, 29, 10, 2, '#a8a8a8');
      px(g, 16, 16, 1, 1, P.skinD); px(g, 31, 16, 1, 1, P.skinD); px(g, 18, 26, 1, 3, P.skinD); px(g, 29, 26, 1, 3, P.skinD);
      px(g, 10, 40, 4, 2, '#e0a040'); px(g, 34, 40, 4, 2, '#e0a040');
      px(g, 22, 38, 4, 10, '#2b3a20');
    }
    scan(g, W, 'rgba(224,160,64,0.06)');
  }
  function scan(g, W, tint) {
    for (let y = 0; y < W; y += 2) px(g, 0, y, W, 1, 'rgba(0,0,0,0.28)');
    g.fillStyle = tint; g.fillRect(0, 0, W, W);
  }

  // ---------------------------------------------------------------- 3x5 bitmap font
  // Glyph table from mstr-gme-dsgn-tmpt kits/vanilla-js/util/pixel-util-and-3x5-font.js
  const FONT = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
    '8': '111101111101111', '9': '111101111001111', A: '010101111101101', B: '110101110101110',
    C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
    G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101',
    O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
    S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010',
    W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
    ' ': '000000000000000', ':': '000010000010000', '.': '000000000000010', '-': '000000111000000',
    '+': '000010111010000', '/': '001001010100100', '!': '010010010000010', '%': '101001010100101',
    '>': '100010001010100', '<': '001010100010001', '*': '000101010101000', "'": '010010000000000',
  };
  function text(g, s, x, y, color, shadow) {
    s = String(s).toUpperCase();
    x = Math.round(x - (s.length * 4 - 1) / 2); y = Math.round(y);
    const draw = (ox, oy, c) => {
      g.fillStyle = c;
      for (let i = 0; i < s.length; i++) {
        const gl = FONT[s[i]] || FONT[' '];
        for (let j = 0; j < 15; j++) if (gl[j] === '1') g.fillRect(ox + i * 4 + (j % 3), oy + ((j / 3) | 0), 1, 1);
      }
    };
    if (shadow) { draw(x + 1, y + 1, shadow); draw(x - 1, y, shadow); draw(x, y - 1, shadow); }
    draw(x, y, color);
  }

  return { T, THEMES, tile, human, body, drone, camera, pickup, icon, portrait, text, PAL, shade };
})();
