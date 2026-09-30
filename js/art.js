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
    pow: {
      bg: '#07080a', floor: '#4a4640', floor2: '#34302b', line: '#c9a227', grass: '#3d5a2a',
      wall: '#6a5a4a', wallStyle: 'corrugated', crate: '#7a6242', crateStyle: 'wood',
      pillar: 'machine', tent: '#6a2430', accent: '#ff8a3a', field: '#ff8a3a',
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
      case 'J': solidOnFloor(); for (let x = 1; x < 16; x += 3) px(g, x, 0, 1, 16, '#8a8f99'); px(g, 0, 7, 16, 2, '#5a5f69'); break;
      case 'j': solidOnFloor(); px(g, 0, 0, 2, 16, '#5a5f69'); px(g, 14, 0, 2, 16, '#5a5f69'); break;
      case 'G': case 'k': solidOnFloor(); locker(g, th); if (ch === 'G') px(g, 6, 2, 4, 2, '#ffd23a'); break;
      case 'i': solidOnFloor(); intel(g, th, true); break;
      default: floorBase(g, th, ch, r);
    }
    cache.set(key, c);
    return c;
  }

  // ---------------------------------------------------------------- 2D pickups (map preview)
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

  // ---------------------------------------------------------------- terminal portraits
  // Anime faces in the style of turn-tactics "classic" (ink outlines, radial speed lines, big eyes,
  // spiky bangs), drawn at 160 px and pixelated down to 64 px for the retro terminal.
  const INK = '#10121e';
  const hiC = document.createElement('canvas'); hiC.width = hiC.height = 160;
  const LOOK = {
    snake: { skin: '#f5cfb0', shade: '#d9a488', hair: '#3a2c2a', eye: '#4a6a9a', bg: '#1a2c4a', uni: '#2c3e62', tips: [[-34, -8], [-26, -30], [-14, -18], [-4, -40], [8, -22], [20, -38], [28, -14], [36, -6]] },
    hale: { skin: '#f0c8a8', shade: '#cfa086', hair: '#c8ccd6', eye: '#5a4a3a', bg: '#3a2a1a', uni: '#3d5a34', tips: [[-32, -18], [-18, -26], [-6, -22], [8, -27], [22, -22], [32, -16]] },
    iris: { skin: '#dff8ff', shade: '#9fd8ec', hair: '#4fe3ff', eye: '#2a8cff', bg: '#0a3a5a', uni: '#e8f6ff', tips: [[-36, 4], [-30, -24], [-18, -8], [-10, -34], [2, -12], [12, -34], [22, -10], [32, -26], [36, 6]] },
    threnody: { skin: '#e8d8f4', shade: '#b8a0d0', hair: '#8a4ad8', eye: '#ff4bd8', bg: '#2a0a3a', uni: '#40205a', tips: [[-38, 12], [-30, -20], [-20, 0], [-8, -36], [4, -6], [16, -34], [26, -2], [36, -18], [40, 16]] },
  };
  function shadeHex(h, a) { return shade(h, a); }
  function drawEye(g, L, side, blink, glowEye) {
    const x = side * 14, y = -4;
    g.save();
    if (blink) { g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 9, y + 2); g.quadraticCurveTo(x, y + 6, x + 9, y + 2); g.stroke(); g.restore(); return; }
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, y, 9, 11, 0, 0, 7); g.fill();
    const ig = g.createLinearGradient(0, y - 10, 0, y + 10); ig.addColorStop(0, shadeHex(L.eye, -0.5)); ig.addColorStop(1, shadeHex(L.eye, 0.35));
    g.fillStyle = ig; g.beginPath(); g.ellipse(x + side * 1, y + 1, 6.5, 9, 0, 0, 7); g.fill();
    g.fillStyle = glowEye ? '#ffffff' : INK; g.beginPath(); g.ellipse(x + side * 1, y + 2, 3, 4.5, 0, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 2, y - 4, 2.6, 0, 7); g.fill(); g.beginPath(); g.arc(x + 3, y + 5, 1.3, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 3.4; g.beginPath(); g.moveTo(x - 11, y - 7); g.quadraticCurveTo(x, y - 15, x + 11, y - 8); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(x + side * 10, y - 8); g.lineTo(x + side * 13, y - 11); g.stroke();
    g.restore();
  }
  function portraitHi(who, mouth, blink, t) {
    const L = LOOK[who], g = hiC.getContext('2d');
    const ai = who === 'iris' || who === 'threnody';
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 160, 160);
    const bgg = g.createRadialGradient(80, 70, 6, 80, 80, 120); bgg.addColorStop(0, shade(L.bg, 0.45)); bgg.addColorStop(0.55, L.bg); bgg.addColorStop(1, shade(L.bg, -0.6));
    g.fillStyle = bgg; g.fillRect(0, 0, 160, 160);
    g.save(); g.translate(80, 64);
    for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2 + (ai ? t * 0.2 : 0); g.strokeStyle = i % 2 ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.2)'; g.lineWidth = i % 4 ? 2 : 5; g.beginPath(); g.moveTo(Math.cos(a) * 62, Math.sin(a) * 62); g.lineTo(Math.cos(a) * 150, Math.sin(a) * 150); g.stroke(); }
    g.restore();
    g.save(); g.translate(80, 84); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = INK; g.lineWidth = 2.4;
    if (ai) g.globalAlpha = 0.92;
    // back hair
    const hg = g.createLinearGradient(0, -70, 0, 40); hg.addColorStop(0, shade(L.hair, 0.3)); hg.addColorStop(1, shade(L.hair, -0.45));
    g.fillStyle = hg; g.beginPath();
    if (who === 'iris' || who === 'threnody') { g.moveTo(-38, -30); g.bezierCurveTo(-54, 10, -50, 50, -40, 76); g.lineTo(40, 76); g.bezierCurveTo(50, 50, 54, 10, 38, -30); }
    else { g.moveTo(-34, -30); g.bezierCurveTo(-42, -5, -40, 10, -34, 16); g.lineTo(34, 16); g.bezierCurveTo(40, 10, 42, -5, 34, -30); }
    g.closePath(); g.fill(); g.stroke();
    // body
    const ug = g.createLinearGradient(0, 36, 0, 84); ug.addColorStop(0, shade(L.uni, 0.22)); ug.addColorStop(1, shade(L.uni, -0.4));
    g.fillStyle = ug; g.beginPath(); g.moveTo(-80, 82); g.lineTo(-68, 52); g.quadraticCurveTo(-40, 36, 0, 38); g.quadraticCurveTo(40, 36, 68, 52); g.lineTo(80, 82); g.closePath(); g.fill(); g.stroke();
    if (who === 'snake') { g.fillStyle = '#c8d2dc'; g.beginPath(); g.moveTo(40, 44); g.quadraticCurveTo(62, 44, 72, 58); g.lineTo(78, 82); g.lineTo(46, 82); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#4fe3ff'; g.fillRect(56, 60, 5, 5); }
    if (who === 'hale') { g.fillStyle = '#ffc94a'; for (let i = 0; i < 3; i++) { g.fillRect(-54 + i * 11, 58, 8, 10); g.strokeRect(-54 + i * 11, 58, 8, 10); } g.fillStyle = '#1a2a14'; g.fillRect(-4, 40, 8, 42); }
    if (ai) { g.strokeStyle = who === 'iris' ? '#4fe3ff' : '#ff4bd8'; g.lineWidth = 1.5; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-50 + i * 22, 82); g.lineTo(-50 + i * 22, 60 - (i % 2) * 8); g.lineTo(-40 + i * 22, 52); g.stroke(); } g.strokeStyle = INK; g.lineWidth = 2.4; }
    // neck
    g.fillStyle = L.shade; g.beginPath(); g.moveTo(-11, 16); g.lineTo(-12, 42); g.quadraticCurveTo(0, 48, 12, 42); g.lineTo(11, 16); g.closePath(); g.fill(); g.stroke();
    // face
    const sk = g.createRadialGradient(-8, -12, 6, 0, 0, 46); sk.addColorStop(0, shade(L.skin, 0.35)); sk.addColorStop(0.65, L.skin); sk.addColorStop(1, L.shade);
    g.fillStyle = sk; g.beginPath(); g.moveTo(-30, -16); g.bezierCurveTo(-31, 8, -18, 27, 0, 35); g.bezierCurveTo(18, 27, 31, 8, 30, -16); g.bezierCurveTo(30, -50, -30, -50, -30, -16); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(0,0,0,.14)'; g.beginPath(); g.moveTo(-29, -12); g.quadraticCurveTo(0, -2, 29, -12); g.lineTo(29, -20); g.lineTo(-29, -20); g.fill();
    // eyes
    if (who === 'snake') {
      drawEye(g, L, -1, blink, false);
      // cybernetic plate over the right eye, red optic
      g.fillStyle = '#b9c6d2'; g.beginPath(); g.moveTo(4, -16); g.lineTo(28, -18); g.lineTo(30, 8); g.lineTo(16, 12); g.lineTo(4, 6); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = INK; for (const [x, y] of [[8, -12], [25, -14], [26, 4], [8, 3]]) g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = (t * 3 | 0) % 2 ? '#ff2a2a' : '#ff7a7a'; g.beginPath(); g.arc(17, -3, 6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(15, -5, 3, 3);
      // stubble
      g.fillStyle = 'rgba(60,40,40,.35)'; for (let i = 0; i < 40; i++) { const a = Math.PI * (0.15 + (i / 40) * 0.7), r = 26 + (i % 3) * 3; g.fillRect(Math.cos(a) * r - 1, Math.sin(a) * r - 4, 2, 2); }
    } else {
      drawEye(g, L, -1, blink, who === 'threnody'); drawEye(g, L, 1, blink, who === 'threnody');
    }
    // nose + mouth
    g.strokeStyle = '#8a6a6a'; g.lineWidth = 2; g.beginPath(); g.moveTo(1, 9); g.lineTo(-1, 15); g.lineTo(1.5, 15.5); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 2.4;
    if (mouth) { g.fillStyle = '#6a1a2a'; g.beginPath(); g.ellipse(0, 23, 6, 4.5, 0, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#ff8aa0'; g.beginPath(); g.ellipse(0, 25, 3, 1.6, 0, 0, 7); g.fill(); }
    else { g.beginPath(); g.moveTo(-6, 23); g.quadraticCurveTo(0, who === 'hale' ? 21 : 25, 6, 23); g.stroke(); }
    if (who === 'hale') { g.fillStyle = '#d8dce4'; g.beginPath(); g.moveTo(-14, 19); g.quadraticCurveTo(0, 12, 14, 19); g.quadraticCurveTo(0, 17, -14, 19); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(80,50,40,.5)'; g.lineWidth = 1.5; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(sd * 22, 6); g.lineTo(sd * 18, 14); g.stroke(); } g.strokeStyle = INK; g.lineWidth = 2.4; }
    // bangs
    const bg2 = g.createLinearGradient(0, -64, 0, 10); bg2.addColorStop(0, shade(L.hair, 0.35)); bg2.addColorStop(1, shade(L.hair, -0.3));
    g.fillStyle = bg2; g.beginPath(); g.moveTo(-36, -18); g.bezierCurveTo(-40, -56, 40, -66, 38, -16);
    const tips = L.tips; for (let i = tips.length - 1; i >= 0; i--) { const [x, y] = tips[i], px2 = i > 0 ? tips[i - 1][0] : -36; g.lineTo(x, y); g.lineTo((x + px2) / 2, y - 16); }
    g.closePath(); g.fill(); g.stroke();
    // hair shine
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3.5; g.beginPath(); g.arc(0, -8, 44, -2.35, -1.95); g.stroke(); g.beginPath(); g.arc(0, -8, 44, -1.62, -1.35); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 2.4;
    if (who === 'snake') { // bandana with trailing tails
      g.fillStyle = '#e83a4a'; g.beginPath(); g.moveTo(-36, -26); g.quadraticCurveTo(0, -40, 36, -26); g.lineTo(36, -18); g.quadraticCurveTo(0, -32, -36, -18); g.closePath(); g.fill(); g.stroke();
      const w = Math.sin(t * 6) * 4;
      g.beginPath(); g.moveTo(34, -24); g.quadraticCurveTo(52, -24 + w, 62, -10 + w); g.lineTo(58, -4 + w); g.quadraticCurveTo(48, -16, 34, -18); g.closePath(); g.fill(); g.stroke();
    }
    if (who === 'iris') { // headset + circuit tattoo
      g.fillStyle = '#e8f6ff'; g.beginPath(); g.arc(-33, -6, 8, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-30, 2); g.quadraticCurveTo(-24, 20, -8, 22); g.stroke();
      g.strokeStyle = '#4fe3ff'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(20, 8); g.lineTo(26, 12); g.lineTo(26, 18); g.stroke(); g.strokeStyle = INK;
    }
    if (who === 'threnody') { // halo of broken rings
      g.strokeStyle = '#ff4bd8'; g.lineWidth = 3; g.beginPath(); g.arc(0, -60, 34, Math.PI * 1.05, Math.PI * 1.55 + Math.sin(t) * 0.2); g.stroke(); g.beginPath(); g.arc(0, -60, 34, Math.PI * 1.7, Math.PI * 1.95); g.stroke();
      g.strokeStyle = INK;
    }
    g.restore();
    // AI hologram scanlines / glitch
    if (ai) {
      for (let y = 0; y < 160; y += 3) { g.fillStyle = who === 'iris' ? 'rgba(79,227,255,.08)' : 'rgba(255,75,216,.08)'; g.fillRect(0, y, 160, 1); }
      if (who === 'threnody') for (let k = 0; k < 3; k++) { const y = (Math.random() * 160) | 0, h = 2 + ((Math.random() * 6) | 0), dx = ((Math.random() - 0.5) * 18) | 0; g.drawImage(hiC, 0, y, 160, h, dx, y, 160, h); }
    }
  }
  function portrait(canvas, who, mouth, blink, t) {
    const g = canvas.getContext('2d');
    const S2 = canvas.width;
    if (!who || !LOOK[who]) {
      g.fillStyle = '#02060a'; g.fillRect(0, 0, S2, S2);
      for (let i = 0; i < 300; i++) { g.fillStyle = Math.random() < 0.5 ? '#6a7a70' : '#1a2420'; g.fillRect((Math.random() * S2) | 0, (Math.random() * S2) | 0, 2, 1); }
      return;
    }
    portraitHi(who, mouth, blink, t || 0);
    g.imageSmoothingEnabled = true;
    g.clearRect(0, 0, S2, S2);
    g.drawImage(hiC, 0, 0, S2, S2);
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

  return { T, THEMES, tile, pickup, icon, portrait, text, shade };
})();
