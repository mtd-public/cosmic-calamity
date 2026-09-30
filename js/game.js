'use strict';
// Core simulation + world rendering.
const Game = (() => {
  const TILE = 16;
  const ALERT_TIME = 15, EVADE_TIME = 12;
  const KO_TIME = 50;
  const PLAYER_SPEED = 62;
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const TDEF = {
    '#': { s: 1, o: 1, wall: 1 }, 'X': { s: 1, o: 1 }, 'x': { s: 1, o: 1 }, 'T': { s: 1, o: 1 }, 'A': { s: 1, o: 1 },
    'L': { s: 1, o: 1, hide: 'LOCKER' }, 'B': { s: 1, o: 1, hide: 'BIN' }, 'O': { s: 1, o: 1, hide: 'BOX' },
    'C': { s: 1, o: 0 }, '=': { s: 1, o: 0 }, 'D': { s: 1, o: 1, door: 1 },
    'Z': { s: 1, o: 0, core: 1 }, 'z': { s: 1, o: 0 }, 'I': { s: 1, o: 0, intel: 1 }, 'i': { s: 1, o: 0 },
  };
  const EMPTY = {};
  const ENEMY_STATS = {
    grunt: { hp: 2, speed: 34, range: 88, fov: 0.55 },
    heavy: { hp: 5, speed: 26, range: 100, fov: 0.5 },
    drone: { hp: 1, speed: 32, range: 76, fov: 0.62 },
    camera: { hp: 1, speed: 0, range: 100, fov: 0.42 },
  };

  let S = null;         // world state
  let hooks = {};       // callbacks into UI (toast, codec, complete, gameover)

  // ------------------------------------------------------------------ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const approachAng = (a, b, step) => { const d = angDiff(a, b); return Math.abs(d) <= step ? b : a + Math.sign(d) * step; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const rand = (a, b) => a + Math.random() * (b - a);

  function tileAt(tx, ty) { return (tx < 0 || ty < 0 || tx >= S.w || ty >= S.h) ? '#' : S.grid[ty * S.w + tx]; }
  function def(ch) { return TDEF[ch] || EMPTY; }
  function solidT(tx, ty) { return !!def(tileAt(tx, ty)).s; }
  function opaqueAt(x, y) { return !!def(tileAt(Math.floor(x / TILE), Math.floor(y / TILE))).o; }
  function solidAt(x, y) { return !!def(tileAt(Math.floor(x / TILE), Math.floor(y / TILE))).s; }
  function boxBlocked(x, y, r) {
    return solidAt(x - r, y - r) || solidAt(x + r - 0.01, y - r) || solidAt(x - r, y + r - 0.01) || solidAt(x + r - 0.01, y + r - 0.01);
  }
  function setTile(tx, ty, ch) {
    S.grid[ty * S.w + tx] = ch;
    drawTileToBg(tx, ty);
    if (ty + 1 < S.h) drawTileToBg(tx, ty + 1);
    if (ty > 0) drawTileToBg(tx, ty - 1);
  }

  function losClear(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    const n = Math.ceil(d / 4);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (opaqueAt(x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ level load
  function load(index, h) {
    hooks = h || hooks;
    const L = LEVELS[index];
    const rows = L.map;
    const hgt = rows.length, w = Math.max(...rows.map((r) => r.length));
    S = {
      index, def: L, theme: L.theme, w, h: hgt, grid: new Array(w * hgt),
      enemies: [], pickups: [], bullets: [], particles: [], floaters: [], anim: [],
      phase: 'sneak', alertTimer: 0, evadeTimer: 0, lastKnown: null,
      t: 0, hasCard: false, intel: false, cores: 0, coresTotal: 0, escape: null,
      cam: { x: 0, y: 0 }, shake: 0, flash: 0, done: false, over: false, overT: 0,
      stats: { time: 0, alerts: 0, kills: 0, takedowns: 0, shots: 0, damage: 0 },
      prompt: '', msgCD: 0, bg: null, timers: [],
    };
    let px0 = 32, py0 = 32;
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        let ch = rows[y][x] || '#';
        const cx = x * TILE + 8, cy = y * TILE + 8;
        switch (ch) {
          case 'P': px0 = cx; py0 = cy; ch = L.floor; break;
          case '^': case 'v': case '<': case '>': {
            const d = { '^': [0, -1], 'v': [0, 1], '<': [-1, 0], '>': [1, 0] }[ch];
            S.enemies.push(makeEnemy('grunt', cx, cy, { mode: 'line', pdx: d[0], pdy: d[1] }));
            ch = L.floor; break;
          }
          case 'g': S.enemies.push(makeEnemy('grunt', cx, cy, { mode: 'sentry' })); ch = L.floor; break;
          case 'H': S.enemies.push(makeEnemy('heavy', cx, cy, { mode: 'sentry' })); ch = L.floor; break;
          case 'o': S.enemies.push(makeEnemy('drone', cx, cy, { mode: 'drone' })); ch = L.floor; break;
          case 'c': S.enemies.push(makeEnemy('camera', cx, cy, { mode: 'camera' })); ch = L.floor; break;
          case 'r': case 'a': case 'K': S.pickups.push({ type: ch, x: cx, y: cy, taken: false }); ch = L.floor; break;
        }
        if (ch === 'Z') S.coresTotal++;
        if ('EZ=D'.includes(ch)) S.anim.push([x, y]);
        S.grid[y * w + x] = ch;
      }
    }
    S.player = {
      x: px0, y: py0, dir: -Math.PI / 2, face: 1, hp: 100, maxHp: 100, ammo: index === 0 ? 8 : 10, maxAmmo: 30,
      moving: false, anim: 0, lock: 0, inv: 0, fireCD: 0, knockCD: 0, hidden: null, unhideT: 0,
      punchT: 0, shootT: 0, dead: false, planting: null,
    };
    // post-process enemies needing map knowledge
    for (const e of S.enemies) initEnemyFacing(e);
    buildBackground();
    S.cam.x = S.player.x; S.cam.y = S.player.y;
    return S;
  }

  function makeEnemy(type, x, y, o) {
    const b = ENEMY_STATS[type];
    return {
      type, x, y, ox: x, oy: y, dir: 0, odir: 0, tdir: 0,
      hp: b.hp, speed: b.speed, range: b.range, fov: b.fov,
      mode: o.mode, pdx: o.pdx || 0, pdy: o.pdy || 0, opdx: o.pdx || 0, opdy: o.pdy || 0,
      state: 'patrol', aw: 0, sees: false, icon: null, iconT: 0,
      path: null, pathKey: '', repath: 0, timer: rand(1.5, 3), pause: 0, idleT: rand(5, 10),
      lookDirs: [], lookI: 0, poi: null, subT: 0, sub: 0, checkHide: null,
      stun: 0, ko: 0, dead: false, deadT: 0, found: false, fireCD: 1, burst: 0,
      anim: 0, walking: false, stuckT: 0, lastX: x, lastY: y, sweepPhase: Math.random() * 6,
    };
  }

  function openDirs(e, minRun = 2) {
    const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    const out = [];
    for (const [dx, dy] of DIRS4) {
      let run = 0;
      for (let k = 1; k <= 4; k++) { if (solidT(tx + dx * k, ty + dy * k)) break; run++; }
      if (run >= minRun) out.push({ a: Math.atan2(dy, dx), run });
    }
    return out;
  }

  function initEnemyFacing(e) {
    if (e.mode === 'line' || e.mode === 'drone') {
      if (e.mode === 'drone') {
        const d = [[0, 1], [1, 0], [0, -1], [-1, 0]].find(([dx, dy]) => !solidT(Math.floor(e.x / TILE) + dx, Math.floor(e.y / TILE) + dy)) || [1, 0];
        e.pdx = e.opdx = d[0]; e.pdy = e.opdy = d[1];
      }
      e.dir = e.tdir = e.odir = Math.atan2(e.pdy, e.pdx);
    } else if (e.mode === 'sentry') {
      const dirs = openDirs(e, 2).sort((a, b) => b.run - a.run);
      e.lookDirs = dirs.length ? dirs.map((d) => d.a) : [Math.PI / 2];
      e.dir = e.tdir = e.odir = e.lookDirs[0];
    } else if (e.mode === 'camera') {
      const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
      let ax = 0, ay = 0;
      for (const [dx, dy] of DIRS4) if (tileAt(tx + dx, ty + dy) === '#') { ax -= dx; ay -= dy; }
      if (!ax && !ay) ay = 1;
      const a = Math.atan2(ay, ax);
      e.dir = e.tdir = e.odir = a;
      const n = Math.hypot(ax, ay);
      e.x -= (ax / n) * 5; e.y -= (ay / n) * 5; e.ox = e.x; e.oy = e.y;
    }
  }

  // ------------------------------------------------------------------ background
  function buildBackground() {
    const c = document.createElement('canvas');
    c.width = S.w * TILE; c.height = S.h * TILE;
    S.bg = c; S.bgCtx = c.getContext('2d');
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) drawTileToBg(x, y);
  }
  function variant(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) % 4; }
  function drawTileToBg(x, y) {
    const ch = tileAt(x, y);
    const below = tileAt(x, y + 1);
    const face = ch === '#' && below !== '#' && y + 1 < S.h;
    S.bgCtx.drawImage(Art.tile(S.theme, ch, variant(x, y), face), x * TILE, y * TILE);
  }

  // ------------------------------------------------------------------ pathfinding (BFS on tiles)
  function findPath(sx, sy, gx, gy) {
    const W = S.w, H = S.h;
    if (sx === gx && sy === gy) return [];
    const goalSolid = solidT(gx, gy);
    const prev = new Int32Array(W * H).fill(-1);
    const q = new Int32Array(W * H);
    let qh = 0, qt = 0;
    const start = sy * W + sx;
    prev[start] = start; q[qt++] = start;
    let found = -1;
    while (qh < qt) {
      const cur = q[qh++];
      const cx = cur % W, cy = (cur / W) | 0;
      if ((cx === gx && cy === gy) || (goalSolid && Math.abs(cx - gx) + Math.abs(cy - gy) === 1)) { found = cur; break; }
      for (const [dx, dy] of DIRS4) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (prev[ni] !== -1 || solidT(nx, ny)) continue;
        prev[ni] = cur; q[qt++] = ni;
      }
    }
    if (found < 0) return null;
    const path = [];
    for (let c = found; c !== start; c = prev[c]) path.push({ x: c % W, y: (c / W) | 0 });
    return path.reverse();
  }

  // ------------------------------------------------------------------ enemies
  function alive(e) { return !e.dead && e.ko <= 0; }

  function moveEnemy(e, dx, dy) {
    const P = S.player, r = 5;
    const blockP = (nx, ny) => !P.hidden && !P.dead && Math.hypot(nx - P.x, ny - P.y) < 10 && Math.hypot(nx - P.x, ny - P.y) < Math.hypot(e.x - P.x, e.y - P.y);
    const fly = e.type === 'drone';
    let moved = false;
    if (dx) { const nx = e.x + dx; if (!boxBlocked(nx, e.y, r) && !(blockP(nx, e.y) && !fly)) { e.x = nx; moved = true; } }
    if (dy) { const ny = e.y + dy; if (!boxBlocked(e.x, ny, r) && !(blockP(e.x, ny) && !fly)) { e.y = ny; moved = true; } }
    return moved;
  }

  function stepToward(e, tx, ty, sp, dt) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
    if (d < 0.6) return true;
    const s = Math.min(d, sp * dt);
    moveEnemy(e, dx / d * s, dy / d * s);
    e.tdir = Math.atan2(dy, dx);
    e.walking = true;
    return d < 2;
  }

  // returns 'moving' | 'arrived' | 'fail'
  function followPath(e, tx, ty, sp, dt) {
    const gx = Math.floor(tx / TILE), gy = Math.floor(ty / TILE);
    const key = gx + ',' + gy;
    e.repath -= dt;
    if (!e.path || e.pathKey !== key || e.repath <= 0) {
      e.path = findPath(Math.floor(e.x / TILE), Math.floor(e.y / TILE), gx, gy);
      e.pathKey = key; e.repath = 1.2;
    }
    if (!e.path) return 'fail';
    if (e.path.length === 0) {
      if (solidT(gx, gy)) return 'arrived';
      return stepToward(e, tx, ty, sp, dt) ? 'arrived' : 'moving';
    }
    const n = e.path[0];
    if (stepToward(e, n.x * TILE + 8, n.y * TILE + 8, sp, dt)) e.path.shift();
    // stuck detection
    if (Math.hypot(e.x - e.lastX, e.y - e.lastY) < 0.05) {
      e.stuckT += dt;
      if (e.stuckT > 0.8) { e.stuckT = 0; e.path = null; const cx = Math.floor(e.x / TILE) * TILE + 8, cy = Math.floor(e.y / TILE) * TILE + 8; e.x += (cx - e.x) * 0.5; e.y += (cy - e.y) * 0.5; }
    } else e.stuckT = 0;
    return 'moving';
  }

  function canSeePlayer(e) {
    const P = S.player;
    if (P.hidden || P.dead) return false;
    const range = e.range * (S.phase === 'alert' ? 1.3 : 1);
    const dx = P.x - e.x, dy = P.y - e.y, d = Math.hypot(dx, dy);
    if (d > range) return false;
    const inGrass = tileAt(Math.floor(P.x / TILE), Math.floor(P.y / TILE)) === ';';
    if (inGrass && d > 30) return false;
    if (d > 8 && Math.abs(angDiff(e.dir, Math.atan2(dy, dx))) > e.fov) return false;
    return losClear(e.x, e.y - 2, P.x, P.y - 3);
  }
  function canSeePoint(e, x, y) {
    const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
    if (d > e.range) return false;
    if (Math.abs(angDiff(e.dir, Math.atan2(dy, dx))) > e.fov) return false;
    return losClear(e.x, e.y, x, y);
  }

  function setIcon(e, ch) { e.icon = ch; e.iconT = ch === '!' ? 1.4 : 1.8; }

  function becomeSuspicious(e, x, y, quiet) {
    if (e.type === 'camera' || !alive(e)) return;
    if (e.state === 'alert') return;
    const fresh = e.state !== 'suspicious';
    e.state = 'suspicious';
    e.poi = { x, y };
    e.sub = 0; e.subT = 0.7; e.path = null;
    if (fresh) { setIcon(e, '?'); if (!quiet) Sound.sfx.question(); }
  }

  function spot(e) {
    setIcon(e, '!');
    e.aw = 1;
    triggerAlert(S.player.x, S.player.y);
  }

  function triggerAlert(x, y) {
    S.lastKnown = { x, y };
    S.alertTimer = ALERT_TIME;
    if (S.phase !== 'alert') {
      S.stats.alerts++;
      S.phase = 'alert';
      Sound.sfx.alert();
      if (!S.escape) Sound.playMusic('alert');
      for (const e of S.enemies) {
        if (!alive(e) || e.type === 'camera') continue;
        e.state = 'alert'; e.path = null; e.fireCD = rand(0.5, 0.9); e.checkHide = null;
      }
    }
  }

  function makeNoise(x, y, r, loud) {
    for (const e of S.enemies) {
      if (!alive(e) || e.type === 'camera') continue;
      if (Math.hypot(e.x - x, e.y - y) > r) continue;
      if (S.phase === 'alert') { if (loud) S.lastKnown = { x, y }; }
      else becomeSuspicious(e, x, y);
    }
  }

  function updateEnemy(e, dt) {
    const P = S.player;
    if (e.iconT > 0) { e.iconT -= dt; if (e.iconT <= 0) e.icon = null; }
    if (e.dead) { e.deadT += dt; return; }
    if (e.ko > 0) {
      e.ko -= dt;
      if (e.ko <= 0) { // wakes up groggy and suspicious
        e.hp = ENEMY_STATS[e.type].hp; e.found = false;
        e.state = 'patrol';
        if (S.phase === 'alert') { e.state = 'alert'; } else becomeSuspicious(e, e.x, e.y);
      }
      return;
    }
    e.lastX = e.x; e.lastY = e.y;
    e.walking = false;
    if (e.stun > 0) { e.stun -= dt; e.sees = false; return; }

    // ---- perception
    e.sees = canSeePlayer(e);
    if (e.sees) {
      const d = dist(e, P);
      if (S.phase === 'alert') { e.aw = 1; S.seen = true; if (e.state !== 'alert' && e.type !== 'camera') { e.state = 'alert'; e.fireCD = rand(0.4, 0.8); } }
      else {
        let rate = e.type === 'camera' ? 1.8 : 1.0 + 3.4 * Math.pow(1 - d / e.range, 2);
        if (S.phase === 'evasion') rate *= 2;
        if (e.state === 'suspicious') rate *= 1.5;
        if (P.moving) rate *= 1.15;
        e.aw += rate * dt;
        if (e.aw >= 1) spot(e);
        else if (e.aw > 0.3) {
          if (e.type === 'camera') { if (!e.icon) setIcon(e, '?'); }
          else if (e.state !== 'suspicious') becomeSuspicious(e, P.x, P.y);
          else { e.poi = { x: P.x, y: P.y }; if (e.sub === 2) { e.sub = 0; e.subT = 0.3; } }
        }
      }
    } else {
      e.aw = Math.max(0, e.aw - dt * (e.state === 'suspicious' ? 0.12 : 0.3));
    }

    // ---- bodies
    if (S.phase !== 'alert' && e.type !== 'camera' && e.state !== 'suspicious') {
      for (const b of S.enemies) {
        if (b === e || b.found || !(b.ko > 0)) continue;
        if (canSeePoint(e, b.x, b.y)) { b.found = true; becomeSuspicious(e, b.x, b.y); e.bodyCheck = true; break; }
      }
    }

    // ---- behaviour
    const sp = e.speed;
    switch (e.state) {
      case 'patrol': patrol(e, dt); break;
      case 'suspicious': {
        if (e.sub === 0) { // freeze and stare
          e.tdir = Math.atan2(e.poi.y - e.y, e.poi.x - e.x);
          e.subT -= dt;
          if (e.subT <= 0) e.sub = 1;
        } else if (e.sub === 1) {
          const r = followPath(e, e.poi.x, e.poi.y, sp * 1.1, dt);
          const near = Math.hypot(e.x - e.poi.x, e.y - e.poi.y) < (e.checkHide || e.bodyCheck ? 22 : 12);
          if (r !== 'moving' || near) { e.sub = 2; e.subT = e.bodyCheck ? 5 : 3.5; e.lookBase = e.dir; }
        } else {
          if (e.checkHide && P.hidden && P.hidden.tx === e.checkHide.tx && P.hidden.ty === e.checkHide.ty) {
            // found you!
            unhide(true);
            hooks.toast && hooks.toast('YOU WERE SEEN GETTING IN!');
            e.checkHide = null;
            spot(e);
            break;
          }
          e.checkHide = null;
          e.tdir = e.lookBase + Math.sin(e.subT * 2.4) * 1.3;
          e.subT -= dt;
          if (e.subT <= 0) { e.state = 'return'; e.path = null; e.bodyCheck = false; }
        }
        break;
      }
      case 'alert': alertBehaviour(e, dt); break;
      case 'search': {
        if (!e.poi || e.subT <= 0) {
          const lk = S.lastKnown || { x: e.ox, y: e.oy };
          e.poi = randomNear(lk.x, lk.y, 6);
          e.subT = rand(4, 7);
        }
        e.subT -= dt;
        const r = followPath(e, e.poi.x, e.poi.y, sp * 1.1, dt);
        if (r !== 'moving') { e.tdir += dt * 2; }
        break;
      }
      case 'return': {
        const r = followPath(e, e.ox, e.oy, sp, dt);
        if (r === 'arrived' || (r === 'fail')) {
          if (r === 'fail') { e.ox = e.x; e.oy = e.y; }
          e.x = e.ox; e.y = e.oy;
          e.state = 'patrol'; e.tdir = e.odir; e.pdx = e.opdx; e.pdy = e.opdy; e.path = null; e.pause = 0.5;
        }
        break;
      }
    }

    const turn = e.type === 'camera' ? 3 : (e.state === 'alert' ? 9 : 5);
    e.dir = approachAng(e.dir, e.tdir, turn * dt);
    if (e.walking) e.anim += dt * 7;
  }

  function patrol(e, dt) {
    if (e.mode === 'camera') {
      e.tdir = e.odir + Math.sin(S.t * 0.8 + e.sweepPhase) * 0.95;
      e.dir = e.tdir;
      return;
    }
    if (e.mode === 'sentry') {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.lookI = (e.lookI + 1) % e.lookDirs.length;
        e.timer = rand(2.2, 3.4);
      }
      e.tdir = e.lookDirs[e.lookI] + Math.sin(S.t * 1.3 + e.sweepPhase) * 0.25;
      return;
    }
    if (e.pause > 0) {
      e.pause -= dt;
      if (e.pauseLook != null) e.tdir = e.pauseLook;
      if (e.pause <= 0) { e.pauseLook = null; e.tdir = Math.atan2(e.pdy, e.pdx); }
      return;
    }
    if (e.mode === 'line') {
      e.idleT -= dt;
      if (e.idleT <= 0) {
        e.idleT = rand(6, 11);
        e.pause = 1.6;
        e.pauseLook = Math.atan2(e.pdy, e.pdx) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
        return;
      }
      const d = e.speed * dt;
      // stay centred on the patrol lane
      if (e.pdx) e.y += (e.oy - e.y) * Math.min(1, dt * 4); else e.x += (e.ox - e.x) * Math.min(1, dt * 4);
      if (!moveEnemy(e, e.pdx * d, e.pdy * d)) {
        e.pdx = -e.pdx; e.pdy = -e.pdy;
        e.pause = 1.1;
        e.pauseLook = null;
        e.tdir = Math.atan2(e.pdy, e.pdx);
      } else { e.tdir = Math.atan2(e.pdy, e.pdx); e.walking = true; }
    } else if (e.mode === 'drone') {
      const d = e.speed * dt;
      const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
      const cx = tx * TILE + 8, cy = ty * TILE + 8;
      // only turn when centred in a tile
      const ahead = solidT(tx + e.pdx, ty + e.pdy);
      const centred = Math.abs(e.x - cx) < d + 0.5 && Math.abs(e.y - cy) < d + 0.5;
      if (ahead && centred) {
        e.x = cx; e.y = cy;
        for (let k = 0; k < 4; k++) {
          const ndx = -e.pdy, ndy = e.pdx; // turn right
          e.pdx = ndx; e.pdy = ndy;
          if (!solidT(tx + e.pdx, ty + e.pdy)) break;
        }
        e.pause = 0.5;
        e.tdir = Math.atan2(e.pdy, e.pdx);
        return;
      }
      if (e.pdx) e.y += (cy - e.y) * Math.min(1, dt * 6); else e.x += (cx - e.x) * Math.min(1, dt * 6);
      moveEnemy(e, e.pdx * d, e.pdy * d);
      e.tdir = Math.atan2(e.pdy, e.pdx);
      e.walking = true;
      if (Math.random() < dt * 0.3 && Math.hypot(e.x - S.player.x, e.y - S.player.y) < 120) Sound.sfx.beep();
    }
  }

  function alertBehaviour(e, dt) {
    const P = S.player;
    if (e.type === 'camera') { patrol(e, dt); return; }
    if (e.sees) {
      e.tdir = Math.atan2(P.y - e.y, P.x - e.x);
      const d = dist(e, P);
      if (e.type !== 'drone') {
        e.fireCD -= dt;
        if (e.burst > 0 && e.fireCD <= 0) { enemyShoot(e); e.burst--; e.fireCD = e.burst > 0 ? 0.14 : rand(1.4, 1.9); }
        else if (e.fireCD <= 0) {
          if (e.type === 'heavy') { e.burst = 3; e.fireCD = 0; }
          else { enemyShoot(e); e.fireCD = rand(1.0, 1.5); }
        }
        if (d > 72) followPath(e, P.x, P.y, e.speed * 1.4, dt);
      } else {
        if (d > 40) followPath(e, P.x, P.y, e.speed * 1.6, dt);
        Sound.sfx.beep();
      }
      e.poi = null;
      return;
    }
    const lk = S.lastKnown;
    if (!lk) return;
    if (!e.poi) e.poi = { x: lk.x, y: lk.y, wander: false };
    if (!e.poi.wander) { e.poi.x = lk.x; e.poi.y = lk.y; }
    const r = followPath(e, e.poi.x, e.poi.y, e.speed * 1.5, dt);
    if (r !== 'moving') { e.poi = randomNear(lk.x, lk.y, 4); e.poi.wander = true; }
  }

  function randomNear(x, y, radTiles) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    for (let i = 0; i < 20; i++) {
      const nx = tx + Math.round(rand(-radTiles, radTiles)), ny = ty + Math.round(rand(-radTiles, radTiles));
      if (!solidT(nx, ny)) return { x: nx * TILE + 8, y: ny * TILE + 8 };
    }
    return { x, y };
  }

  function enemyShoot(e) {
    const P = S.player;
    const a = Math.atan2(P.y - 3 - (e.y - 3), P.x - e.x) + rand(-0.09, 0.09);
    const sp = e.type === 'heavy' ? 175 : 160;
    S.bullets.push({ x: e.x + Math.cos(a) * 7, y: e.y - 3 + Math.sin(a) * 7, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, owner: 'enemy', dmg: e.type === 'heavy' ? 12 : 10, life: 1.6, heavy: e.type === 'heavy' });
    Sound.sfx.eshoot();
    burst(e.x + Math.cos(a) * 8, e.y - 3 + Math.sin(a) * 8, 3, '#e07bff', 30);
  }

  // ------------------------------------------------------------------ player
  function playerBlocked(nx, ny) {
    const P = S.player;
    if (boxBlocked(nx, ny, 5)) return true;
    for (const e of S.enemies) {
      if (!alive(e) || e.type === 'camera') continue;
      const nd = Math.hypot(nx - e.x, ny - e.y);
      if (nd < 10 && nd < Math.hypot(P.x - e.x, P.y - e.y)) return true;
    }
    return false;
  }

  function tryMovePlayer(dx, dy) {
    const P = S.player;
    const doAxis = (ax, ay) => {
      const nx = P.x + ax, ny = P.y + ay;
      if (!playerBlocked(nx, ny)) { P.x = nx; P.y = ny; return true; }
      // bump a locked door with the keycard
      const tx = Math.floor((nx + Math.sign(ax) * 5) / TILE), ty = Math.floor((ny + Math.sign(ay) * 5) / TILE);
      if (tileAt(tx, ty) === 'D') tryDoor(tx, ty);
      // corner assist: slide around corners when nearly aligned
      const perp = ax ? [0, 1] : [1, 0];
      let best = 0;
      for (const s of [1, -1]) {
        for (let k = 1; k <= 7; k++) {
          const ox = perp[0] * s * k, oy = perp[1] * s * k;
          if (playerBlocked(P.x + ox, P.y + oy)) break;
          if (!playerBlocked(P.x + ox + ax, P.y + oy + ay)) { if (!best || k < Math.abs(best)) best = s * k; break; }
        }
      }
      if (best) {
        const step = Math.sign(best) * Math.min(Math.abs(best), Math.abs(ax + ay));
        P.x += perp[0] * step; P.y += perp[1] * step;
        return true;
      }
      return false;
    };
    if (dx) doAxis(dx, 0);
    if (dy) doAxis(0, dy);
  }

  function faceFromDir(a) {
    const c = Math.cos(a), s = Math.sin(a);
    if (Math.abs(c) > Math.abs(s) * 1.1) return c > 0 ? 3 : 2;
    return s > 0 ? 0 : 1;
  }

  function updatePlayer(dt) {
    const P = S.player;
    if (P.dead) return;
    P.lock -= dt; P.inv -= dt; P.fireCD -= dt; P.knockCD -= dt; P.punchT -= dt; P.shootT -= dt;
    const ax = Input.axis();
    P.moving = false;
    if (P.planting) {
      P.planting.t -= dt;
      if (P.planting.t <= 0) finishPlant(P.planting.tx, P.planting.ty);
      Input.take('act'); Input.take('fire');
      return;
    }
    if (P.hidden) {
      if (Input.take('act')) { unhide(false); return; }
      Input.take('fire');
      if (ax.mag > 0.5) { P.unhideT += dt; if (P.unhideT > 0.3) unhide(false); } else P.unhideT = 0;
      S.prompt = 'LEAVE ' + P.hidden.kind;
      return;
    }
    if (P.lock > 0) { Input.take('act'); Input.take('fire'); return; }
    if (ax.mag > 0.15) {
      const sneak = ax.mag < 0.62;
      const sp = PLAYER_SPEED * (sneak ? 0.55 : 1);
      P.dir = Math.atan2(ax.y, ax.x);
      P.face = faceFromDir(P.dir);
      tryMovePlayer(ax.x * sp * dt, ax.y * sp * dt);
      P.moving = true;
      P.sneak = sneak;
      P.anim += dt * (sneak ? 6 : 10);
    }
    S.prompt = contextPrompt();
    if (Input.take('act')) act();
    if (Input.take('fire')) fire();

    // pickups
    for (const p of S.pickups) {
      if (p.taken || Math.hypot(p.x - P.x, p.y - P.y) > 11) continue;
      if (p.type === 'r') {
        if (P.hp >= P.maxHp) { msg('LIFE FULL'); continue; }
        P.hp = Math.min(P.maxHp, P.hp + 40); floater(p.x, p.y, 'LIFE +40', '#7dff9a'); Sound.sfx.pickup();
      } else if (p.type === 'a') {
        if (P.ammo >= P.maxAmmo) { msg('AMMO FULL'); continue; }
        P.ammo = Math.min(P.maxAmmo, P.ammo + 6); floater(p.x, p.y, 'AMMO +6', '#ffd23a'); Sound.sfx.pickup();
      } else if (p.type === 'K') {
        S.hasCard = true; floater(p.x, p.y, 'KEYCARD', '#5ec8ff'); Sound.sfx.card();
        hooks.toast && hooks.toast('GOT KEYCARD\nLOCKED DOORS WILL NOW OPEN');
      }
      p.taken = true;
    }
    // exit
    if (tileAt(Math.floor(P.x / TILE), Math.floor(P.y / TILE)) === 'E') tryExit();
  }

  // run fn after `sec` of game time (so pauses, restarts and stage changes can't misfire it)
  function later(sec, fn) { S.timers.push({ t: sec, fn }); }

  function msg(t) { if (S.msgCD <= 0) { hooks.toast && hooks.toast(t); S.msgCD = 2.5; } }

  function nearestEnemyForCQC() {
    const P = S.player;
    let best = null, bd = 21;
    for (const e of S.enemies) {
      if (!alive(e) || e.type === 'camera' || e.type === 'drone') continue;
      const d = dist(e, P);
      if (d >= bd) continue;
      if (Math.abs(angDiff(P.dir, Math.atan2(e.y - P.y, e.x - P.x))) > 1.35) continue;
      best = e; bd = d;
    }
    return best;
  }

  function findInteract() {
    const P = S.player;
    const tx0 = Math.floor(P.x / TILE), ty0 = Math.floor(P.y / TILE);
    let best = null, bs = 1e9;
    for (let ty = ty0 - 1; ty <= ty0 + 1; ty++) for (let tx = tx0 - 1; tx <= tx0 + 1; tx++) {
      const ch = tileAt(tx, ty), d = def(ch);
      if (!(d.hide || d.door || d.core || d.intel)) continue;
      const cx = clamp(P.x, tx * TILE, tx * TILE + TILE), cy = clamp(P.y, ty * TILE, ty * TILE + TILE);
      const dd = Math.hypot(P.x - cx, P.y - cy);
      if (dd > 11) continue;
      const toward = Math.cos(angDiff(P.dir, Math.atan2(ty * TILE + 8 - P.y, tx * TILE + 8 - P.x)));
      const score = dd - toward * 6;
      if (score < bs) { bs = score; best = { tx, ty, ch, d }; }
    }
    return best;
  }

  function facingWall() {
    const P = S.player;
    const fx = P.x + Math.cos(P.dir) * 10, fy = P.y + Math.sin(P.dir) * 10;
    return tileAt(Math.floor(fx / TILE), Math.floor(fy / TILE)) === '#';
  }

  function contextPrompt() {
    const e = nearestEnemyForCQC();
    if (e) {
      if (e.type === 'heavy' && e.stun <= 0) return 'PUNCH (STUN)';
      return (!e.sees || e.stun > 0) ? 'TAKEDOWN' : 'PUNCH';
    }
    const it = findInteract();
    if (it) {
      if (it.d.hide) return 'HIDE IN ' + it.d.hide;
      if (it.d.door) return S.hasCard ? 'OPEN DOOR' : 'LOCKED';
      if (it.d.core) return 'PLANT CHARGE';
      if (it.d.intel) return 'DOWNLOAD INTEL';
    }
    if (facingWall()) return 'KNOCK';
    return '';
  }

  function act() {
    const P = S.player;
    const e = nearestEnemyForCQC();
    if (e) {
      const unaware = !e.sees || e.stun > 0;
      if (e.type === 'heavy' && e.stun <= 0) { punch(e, !e.sees); return; }
      if (unaware) takedown(e); else punch(e, false);
      return;
    }
    const it = findInteract();
    if (it) { interact(it); return; }
    if (facingWall() && P.knockCD <= 0) {
      P.knockCD = 0.9;
      Sound.sfx.knock();
      floater(P.x + Math.cos(P.dir) * 10, P.y + Math.sin(P.dir) * 10 - 6, 'KNOCK', '#cfd8cf');
      makeNoise(P.x, P.y, 88, false);
      return;
    }
    P.punchT = 0.18; P.lock = 0.15;
    Sound.sfx.whiff();
  }

  function takedown(e) {
    const P = S.player;
    e.ko = KO_TIME; e.state = 'ko'; e.stun = 0; e.aw = 0; e.path = null; e.icon = null; e.found = false; e.sees = false;
    S.stats.takedowns++;
    P.lock = 0.4; P.punchT = 0.3;
    Sound.sfx.takedown();
    S.shake = 3;
    burst(e.x, e.y - 4, 8, '#ffe66b', 40);
    floater(e.x, e.y - 12, 'TAKEDOWN', '#ffe66b');
  }

  function punch(e, silent) {
    const P = S.player;
    e.stun = 1.4;
    const a = Math.atan2(e.y - P.y, e.x - P.x);
    moveEnemy(e, Math.cos(a) * 6, Math.sin(a) * 6);
    P.punchT = 0.2; P.lock = 0.2;
    Sound.sfx.punch();
    burst(e.x, e.y - 5, 5, '#fff', 30);
    floater(e.x, e.y - 14, 'STUNNED', '#fff');
    if (silent) { e.aw = 0.6; if (S.phase !== 'alert') { e.state = 'suspicious'; e.poi = { x: P.x, y: P.y }; e.sub = 0; e.subT = 0.2; setIcon(e, '?'); } }
    else if (S.phase !== 'alert') spot(e);
  }

  function fire() {
    const P = S.player;
    if (P.fireCD > 0) return;
    if (P.ammo <= 0) { Sound.sfx.click(); msg('NO AMMO'); P.fireCD = 0.3; return; }
    P.ammo--; P.fireCD = 0.32; P.shootT = 0.2;
    S.stats.shots++;
    let a = P.dir, bestD = 0.42;
    for (const e of S.enemies) {
      if (!alive(e)) continue;
      const d = dist(e, P);
      if (d > 180) continue;
      const ea = Math.atan2(e.y - 3 - (P.y - 3), e.x - P.x);
      const dd = Math.abs(angDiff(P.dir, ea));
      if (dd < bestD && losClear(P.x, P.y - 3, e.x, e.y - 3)) { bestD = dd; a = ea; }
    }
    P.dir = a; P.face = faceFromDir(a);
    S.bullets.push({ x: P.x + Math.cos(a) * 7, y: P.y - 3 + Math.sin(a) * 7, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, owner: 'player', life: 0.8 });
    Sound.sfx.shoot();
    burst(P.x + Math.cos(a) * 9, P.y - 3 + Math.sin(a) * 9, 4, '#fff6a0', 40);
    makeNoise(P.x, P.y, 72, true);
  }

  function interact(it) {
    const P = S.player;
    if (it.d.hide) {
      P.hidden = { tx: it.tx, ty: it.ty, kind: it.d.hide, rx: P.x, ry: P.y };
      P.unhideT = 0;
      Sound.sfx.hide();
      // anyone watching knows where you went
      for (const e of S.enemies) {
        if (!alive(e) || !e.sees) continue;
        if (e.type === 'camera') { triggerAlert(it.tx * TILE + 8, it.ty * TILE + 8); continue; }
        if (S.phase === 'alert') {
          e.state = 'suspicious'; S.phase = S.phase; // will be converted below
        }
        e.state = 'suspicious'; e.poi = { x: it.tx * TILE + 8, y: it.ty * TILE + 8 }; e.sub = 1; e.path = null;
        e.checkHide = { tx: it.tx, ty: it.ty }; setIcon(e, '!');
      }
      return;
    }
    if (it.d.door) { tryDoor(it.tx, it.ty); return; }
    if (it.d.intel) {
      setTile(it.tx, it.ty, 'i');
      S.intel = true;
      Sound.sfx.download();
      floater(it.tx * TILE + 8, it.ty * TILE - 2, 'INTEL ACQUIRED', '#5dff8a');
      P.lock = 0.6;
      later(0.7, () => hooks.codec && hooks.codec(S.def.intel));
      return;
    }
    if (it.d.core) {
      P.planting = { tx: it.tx, ty: it.ty, t: 1.1 };
      Sound.sfx.plant();
      floater(it.tx * TILE + 8, it.ty * TILE - 2, 'ARMING...', '#ff6af0');
    }
  }

  function finishPlant(tx, ty) {
    const P = S.player;
    P.planting = null;
    setTile(tx, ty, 'z');
    S.cores++;
    Sound.sfx.smallboom();
    S.shake = 5;
    burst(tx * TILE + 8, ty * TILE + 8, 24, '#c34bff', 80);
    floater(tx * TILE + 8, ty * TILE - 2, `CHARGE ${S.cores}/${S.coresTotal}`, '#ff6af0');
    makeNoise(tx * TILE + 8, ty * TILE + 8, 110, false);
    if (S.cores >= S.coresTotal) {
      S.escape = S.def.escapeTime || 90;
      Sound.playMusic('escape');
      triggerAlert(P.x, P.y);
      later(0.6, () => hooks.codec && hooks.codec(S.def.allCores));
    } else hooks.toast && hooks.toast(`CHARGE ARMED ${S.cores}/${S.coresTotal}`);
  }

  function tryDoor(tx, ty) {
    if (S.hasCard) {
      setTile(tx, ty, 'd');
      Sound.sfx.door();
      burst(tx * TILE + 8, ty * TILE + 8, 10, '#aaa', 30);
    } else { if (S.msgCD <= 0) Sound.sfx.locked(); msg('LOCKED: KEYCARD REQUIRED'); }
  }

  function unhide(forced) {
    const P = S.player;
    if (!P.hidden) return;
    P.hidden = null; P.unhideT = 0; P.lock = forced ? 0.5 : 0.1;
    Sound.sfx.hide();
  }

  function tryExit() {
    if (S.done) return;
    const req = S.def.requires;
    if (req === 'intel' && !S.intel) { msg('DOWNLOAD THE INTEL FIRST'); return; }
    if (req === 'cores' && S.cores < S.coresTotal) { msg(`CORES REMAINING: ${S.coresTotal - S.cores}`); return; }
    S.done = true;
    Sound.sfx.clear();
    hooks.complete && hooks.complete(S.stats);
  }

  function hurtPlayer(dmg) {
    const P = S.player;
    if (P.inv > 0 || P.dead) return;
    P.hp -= dmg; P.inv = 0.25;
    S.stats.damage += dmg;
    S.shake = 4; S.flash = 0.25;
    Sound.sfx.hurt();
    burst(P.x, P.y - 4, 6, '#ff4040', 40);
    if (P.hp <= 0) die('YOU WERE KILLED IN ACTION.');
  }

  function die(reason) {
    const P = S.player;
    if (P.dead) return;
    P.hp = 0; P.dead = true;
    S.over = true; S.overT = 1.6; S.overReason = reason;
    Sound.stopMusic();
    Sound.sfx.gameover();
  }

  // ------------------------------------------------------------------ bullets & fx
  function updateBullets(dt) {
    const P = S.player;
    for (const b of S.bullets) {
      const steps = 3;
      for (let i = 0; i < steps && b.life > 0; i++) {
        b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
        if (solidAt(b.x, b.y)) {
          b.life = 0;
          burst(b.x - b.vx * 0.01, b.y - b.vy * 0.01, 3, b.owner === 'player' ? '#fff6a0' : '#e07bff', 30);
          if (b.owner === 'player') Sound.sfx.spark();
          break;
        }
        if (b.owner === 'player') {
          for (const e of S.enemies) {
            if (!alive(e)) continue;
            const hr = e.type === 'heavy' ? 8 : 7;
            if (Math.hypot(b.x - e.x, b.y - (e.y - 3)) < hr) { hitEnemy(e); b.life = 0; break; }
          }
        } else if (!P.hidden && !P.dead && Math.hypot(b.x - P.x, b.y - (P.y - 3)) < 6) {
          hurtPlayer(b.dmg); b.life = 0;
        }
      }
      b.life -= dt;
    }
    S.bullets = S.bullets.filter((b) => b.life > 0);
  }

  function hitEnemy(e) {
    const unaware = S.phase !== 'alert' && !e.sees && e.state !== 'alert';
    const dmg = unaware && e.type === 'grunt' ? 2 : 1;
    e.hp -= dmg;
    Sound.sfx.hit();
    const col = e.type === 'drone' || e.type === 'camera' ? '#ffd23a' : '#6bd45a';
    burst(e.x, e.y - 4, 7, col, 50);
    if (e.hp <= 0) { kill(e); return; }
    e.stun = Math.max(e.stun, 0.25);
    if (S.phase !== 'alert') spot(e);
  }

  function kill(e) {
    e.dead = true; e.deadT = 0; e.icon = null;
    S.stats.kills++;
    if (e.type === 'drone' || e.type === 'camera') {
      Sound.sfx.smallboom();
      burst(e.x, e.y - 4, 16, '#ff9a3c', 70);
      burst(e.x, e.y - 4, 8, '#555', 40);
    } else {
      Sound.sfx.goo();
      makeNoise(e.x, e.y, 36, false);
    }
  }

  function burst(x, y, n, color, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * speed;
      S.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.5), color });
    }
  }
  function floater(x, y, text, color) { S.floaters.push({ x, y, text, color, life: 1.3 }); }

  // ------------------------------------------------------------------ main update
  function update(dt) {
    if (!S) return;
    S.t += dt;
    S.msgCD -= dt;
    if (S.over) {
      S.overT -= dt;
      if (S.overT <= 0 && !S.overSent) { S.overSent = true; hooks.gameover && hooks.gameover(S.overReason); }
      updateFx(dt);
      return;
    }
    if (S.done) { updateFx(dt); return; }
    S.stats.time += dt;
    for (const tm of S.timers) { tm.t -= dt; if (tm.t <= 0 && !tm.fired) { tm.fired = true; tm.fn(); } }
    S.timers = S.timers.filter((tm) => !tm.fired);
    S.seen = false;
    S.prompt = '';
    updatePlayer(dt);
    for (const e of S.enemies) updateEnemy(e, dt);
    S.enemies = S.enemies.filter((e) => !(e.dead && e.deadT > 2.5));
    updateBullets(dt);
    updateFx(dt);

    // phase machine
    if (S.phase === 'alert') {
      if (S.seen) { S.alertTimer = ALERT_TIME; S.lastKnown = { x: S.player.x, y: S.player.y }; }
      else S.alertTimer -= dt;
      if (S.alertTimer <= 0 && !S.escape) {
        S.phase = 'evasion'; S.evadeTimer = EVADE_TIME;
        for (const e of S.enemies) if (alive(e) && e.state === 'alert') { e.state = 'search'; e.poi = null; e.subT = 0; }
        Sound.playMusic(S.def.music);
      } else if (S.alertTimer <= 0) S.alertTimer = 0.01;
    } else if (S.phase === 'evasion') {
      S.evadeTimer -= dt;
      if (S.evadeTimer <= 0) {
        S.phase = 'sneak';
        for (const e of S.enemies) if (alive(e) && (e.state === 'search' || e.state === 'alert')) { e.state = 'return'; e.path = null; }
      }
    }
    if (S.escape != null) {
      const before = Math.ceil(S.escape);
      S.escape -= dt;
      if (Math.ceil(S.escape) !== before && S.escape < 15) Sound.sfx.tick();
      if (S.escape <= 0) { S.escape = 0; die('THE MOTHERSHIP DETONATED WITH YOU ABOARD.'); }
    }
  }

  function updateFx(dt) {
    for (const p of S.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt; }
    S.particles = S.particles.filter((p) => p.life > 0);
    for (const f of S.floaters) { f.y -= dt * 14; f.life -= dt; }
    S.floaters = S.floaters.filter((f) => f.life > 0);
    S.shake = Math.max(0, S.shake - dt * 12);
    S.flash = Math.max(0, S.flash - dt);
  }

  // ------------------------------------------------------------------ rendering
  const CONE_COL = { patrol: '255,224,102', suspicious: '255,154,60', alert: '255,48,64', search: '255,154,60', return: '255,224,102' };

  function coneColor(e) {
    if (e.type === 'camera') return S.phase === 'alert' ? CONE_COL.alert : (e.aw > 0.3 ? CONE_COL.suspicious : '120,210,255');
    return CONE_COL[e.state] || CONE_COL.patrol;
  }

  function drawCone(g, e, ox, oy) {
    const range = e.range * (S.phase === 'alert' ? 1.3 : 1);
    const n = 18;
    g.beginPath();
    g.moveTo(e.x - ox, e.y - 2 - oy);
    for (let i = 0; i <= n; i++) {
      const a = e.dir - e.fov + (2 * e.fov * i) / n;
      const c = Math.cos(a), s = Math.sin(a);
      let d = 4;
      while (d < range && !opaqueAt(e.x + c * d, e.y - 2 + s * d)) d += 4;
      g.lineTo(e.x + c * d - ox, e.y - 2 + s * d - oy);
    }
    g.closePath();
    const col = coneColor(e);
    g.fillStyle = `rgba(${col},${e.sees ? 0.3 : 0.17})`;
    g.fill();
  }

  function render(g, vw, vh) {
    if (!S) return;
    const P = S.player;
    const th = Art.THEMES[S.theme];
    // camera
    const mw = S.w * TILE, mh = S.h * TILE;
    const tx = P.x - vw / 2, ty = P.y - vh / 2 - 8;
    S.cam.x += (tx - S.cam.x) * 0.15; S.cam.y += (ty - S.cam.y) * 0.15;
    let cx = mw <= vw ? (mw - vw) / 2 : clamp(S.cam.x, 0, mw - vw);
    let cy = mh <= vh ? (mh - vh) / 2 : clamp(S.cam.y, 0, mh - vh);
    if (S.shake > 0) { cx += rand(-S.shake, S.shake); cy += rand(-S.shake, S.shake); }
    cx = Math.round(cx); cy = Math.round(cy);

    g.fillStyle = th.bg; g.fillRect(0, 0, vw, vh);
    g.drawImage(S.bg, -cx, -cy);

    // animated tiles
    const pulse = (Math.sin(S.t * 4) + 1) / 2;
    for (const [x, y] of S.anim) {
      const sx = x * TILE - cx, sy = y * TILE - cy;
      if (sx < -16 || sy < -16 || sx > vw || sy > vh) continue;
      const ch = tileAt(x, y);
      if (ch === 'E') {
        const ok = !S.def.requires || (S.def.requires === 'intel' ? S.intel : S.cores >= S.coresTotal);
        g.fillStyle = ok ? `rgba(93,255,138,${0.15 + pulse * 0.3})` : `rgba(255,60,60,${0.1 + pulse * 0.15})`;
        g.fillRect(sx + 1, sy + 1, 14, 14);
      } else if (ch === 'Z') {
        g.fillStyle = `rgba(230,120,255,${0.2 + pulse * 0.4})`; g.fillRect(sx + 4, sy + 1, 8, 13);
      } else if (ch === '=' && S.theme !== 'lab') {
        g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.25})`; g.fillRect(sx, sy + 7, 16, 1);
      } else if (ch === 'D') {
        g.fillStyle = S.hasCard ? '#40ff70' : ((S.t * 2 | 0) % 2 ? '#ff3030' : '#601010'); g.fillRect(sx + 11, sy + 13, 1, 1);
      }
    }

    // vision cones
    for (const e of S.enemies) if (alive(e) && e.stun <= 0) drawCone(g, e, cx, cy);

    // pickups
    for (const p of S.pickups) if (!p.taken) Art.pickup(g, p.type, Math.round(p.x - cx), Math.round(p.y - cy), S.t);

    // bodies
    for (const e of S.enemies) {
      if (e.type === 'drone' || e.type === 'camera') continue;
      if (e.dead || e.ko > 0) Art.body(g, Math.round(e.x - cx), Math.round(e.y - cy), Art.PAL[e.type], e.type, e.dead ? e.deadT : S.t, e.dead);
    }

    // sorted actors
    const actors = [];
    for (const e of S.enemies) if (alive(e)) actors.push(e);
    if (!P.hidden) actors.push(P);
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) {
      const sx = Math.round(a.x - cx), sy = Math.round(a.y - cy);
      if (a === P) {
        if (P.inv > 0 && ((S.t * 30) | 0) % 2) continue;
        let step = 0;
        if (P.moving) step = [0, 1, 0, 2][(P.anim | 0) % 4];
        Art.human(g, sx, sy, P.face, step, Art.PAL.snake, 'snake', { t: S.t, gun: P.shootT > 0 || P.fireCD > 0.1, aim: P.dir });
        if (P.punchT > 0) {
          const fx = Math.round(sx + Math.cos(P.dir) * 8), fy = Math.round(sy - 3 + Math.sin(P.dir) * 6);
          g.fillStyle = '#b9c6d2'; g.fillRect(fx - 1, fy - 1, 3, 3); g.fillStyle = '#7ff6ff'; g.fillRect(fx, fy, 1, 1);
        }
        if (P.planting) { g.fillStyle = '#ff6af0'; g.fillRect(sx - 6, sy - 16, Math.round(12 * (1 - P.planting.t / 1.1)), 2); }
      } else if (a.type === 'drone') {
        Art.drone(g, sx, sy, a.dir, S.t, a.state === 'alert' ? '#ff3040' : a.state === 'patrol' || a.state === 'return' ? '#ffe066' : '#ff9a3c');
      } else if (a.type === 'camera') {
        Art.camera(g, sx, sy, a.dir, S.t, S.phase === 'alert' ? '#ff3040' : '#40ff70');
      } else {
        const step = a.walking ? [0, 1, 0, 2][(a.anim | 0) % 4] : 0;
        Art.human(g, sx, sy, faceFromDir(a.dir), step, Art.PAL[a.type], a.type, { gun: a.state === 'alert', aim: a.dir });
        if (a.stun > 0) {
          for (let i = 0; i < 2; i++) { const an = S.t * 6 + i * Math.PI; g.fillStyle = '#fff'; g.fillRect(Math.round(sx + Math.cos(an) * 5), Math.round(sy - 13 + Math.sin(an) * 2), 1, 1); }
        }
      }
    }

    // hidden player tell
    if (P.hidden) {
      const sx = P.hidden.tx * TILE - cx, sy = P.hidden.ty * TILE - cy;
      if (P.hidden.kind === 'BOX') {
        if (((S.t * 2) | 0) % 5 === 0) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(sx + 1, sy + 2, 14, 1); }
      } else if (((S.t * 1.5) | 0) % 4 !== 0) {
        g.fillStyle = '#ff2a2a'; g.fillRect(sx + 5, sy + 5, 1, 1); g.fillStyle = '#e0e0e0'; g.fillRect(sx + 9, sy + 5, 1, 1);
      }
    }

    // bullets
    for (const b of S.bullets) {
      const sx = Math.round(b.x - cx), sy = Math.round(b.y - cy);
      if (b.owner === 'player') {
        g.fillStyle = 'rgba(255,246,160,0.5)'; g.fillRect(Math.round(sx - b.vx * 0.012), Math.round(sy - b.vy * 0.012), 2, 2);
        g.fillStyle = '#fff'; g.fillRect(sx, sy, 2, 2);
      } else {
        g.fillStyle = b.heavy ? 'rgba(255,80,80,0.5)' : 'rgba(210,90,255,0.5)'; g.fillRect(sx - 2, sy - 2, 5, 5);
        g.fillStyle = b.heavy ? '#ffb0b0' : '#f0c8ff'; g.fillRect(sx - 1, sy - 1, 3, 3);
      }
    }
    for (const p of S.particles) { g.fillStyle = p.color; g.fillRect(Math.round(p.x - cx), Math.round(p.y - cy), 1, 1); }

    // icons over heads
    for (const e of S.enemies) {
      if (!e.icon || e.dead) continue;
      const lift = e.type === 'camera' ? 6 : e.type === 'drone' ? 14 : 13;
      Art.icon(g, e.icon, Math.round(e.x - cx), Math.round(e.y - cy - lift), e.icon === '!' ? '#ff3a3a' : '#ffd23a');
    }
    // awareness meters for partially-aware enemies
    for (const e of S.enemies) {
      if (!alive(e) || e.aw <= 0.05 || e.aw >= 1 || S.phase === 'alert') continue;
      const sx = Math.round(e.x - cx), sy = Math.round(e.y - cy) - (e.type === 'camera' ? 9 : 18);
      g.fillStyle = '#000'; g.fillRect(sx - 6, sy, 12, 3);
      g.fillStyle = e.aw > 0.6 ? '#ff6a3a' : '#ffd23a'; g.fillRect(sx - 5, sy + 1, Math.round(10 * e.aw), 1);
    }
    // floaters
    for (const f of S.floaters) {
      g.globalAlpha = Math.min(1, f.life * 2);
      Art.text(g, f.text, f.x - cx, f.y - cy - 5, f.color, '#05080c');
    }
    g.globalAlpha = 1;

    // screen tints
    if (S.phase === 'alert') { g.fillStyle = `rgba(255,0,0,${0.05 + pulse * 0.05})`; g.fillRect(0, 0, vw, vh); }
    if (S.escape != null) { g.fillStyle = `rgba(255,40,120,${0.06 + pulse * 0.08})`; g.fillRect(0, 0, vw, vh); }
    if (S.flash > 0) { g.fillStyle = `rgba(255,0,0,${S.flash})`; g.fillRect(0, 0, vw, vh); }
    if (P.dead) { g.fillStyle = `rgba(120,0,0,${Math.min(0.6, (1.6 - S.overT) * 0.5)})`; g.fillRect(0, 0, vw, vh); }
  }

  // Marathon-style motion sensor (round scope)
  function renderRadar(c) {
    if (!S) return;
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    const P = S.player;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 1;
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#021a0c'; g.fillRect(0, 0, W, H);
    const jam = S.phase === 'alert' || S.phase === 'evasion';
    if (jam) {
      for (let i = 0; i < 260; i++) { g.fillStyle = Math.random() < 0.5 ? '#0d5a2a' : '#062a14'; g.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 2, 1); }
      g.restore();
      drawRadarRing(g, cx, cy, R);
      if ((S.t * 2 | 0) % 2) Art.text(g, 'JAMMED', cx, cy - 2, S.phase === 'alert' ? '#ff4040' : '#ffb52e', '#000');
      return;
    }
    const scale = 2.4 / TILE; // px per world px
    const tilesR = Math.ceil(R / 2.4) + 1;
    const ptx = Math.floor(P.x / TILE), pty = Math.floor(P.y / TILE);
    for (let y = pty - tilesR; y <= pty + tilesR; y++) {
      for (let x = ptx - tilesR; x <= ptx + tilesR; x++) {
        if (x < 0 || y < 0 || x >= S.w || y >= S.h) continue;
        const ch = tileAt(x, y);
        const d = def(ch);
        if (!d.s) continue;
        g.fillStyle = d.o ? '#2a7a48' : '#1b4a2e';
        g.fillRect(Math.floor(cx + (x * TILE - P.x) * scale), Math.floor(cy + (y * TILE - P.y) * scale), 3, 3);
      }
    }
    // sweep
    const sa = S.t * 2.2;
    const grad = g.createLinearGradient(cx, cy, cx + Math.cos(sa) * R, cy + Math.sin(sa) * R);
    grad.addColorStop(0, 'rgba(93,255,138,0.0)'); grad.addColorStop(1, 'rgba(93,255,138,0.35)');
    g.strokeStyle = grad; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(sa) * R, cy + Math.sin(sa) * R); g.stroke();
    for (const e of S.enemies) {
      if (e.dead) continue;
      const ex = cx + (e.x - P.x) * scale, ey = cy + (e.y - P.y) * scale;
      if (Math.hypot(ex - cx, ey - cy) > R + 2) continue;
      if (alive(e)) {
        g.fillStyle = 'rgba(255,224,102,0.22)';
        g.beginPath(); g.moveTo(ex, ey);
        g.arc(ex, ey, e.range * scale, e.dir - e.fov, e.dir + e.fov); g.closePath(); g.fill();
      }
      g.fillStyle = e.ko > 0 ? '#777' : e.type === 'camera' ? '#5ec8ff' : '#ff3a3a';
      g.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 3, 3);
    }
    for (const p of S.pickups) {
      if (p.taken || p.type !== 'K') continue;
      g.fillStyle = (S.t * 3 | 0) % 2 ? '#5ec8ff' : '#fff';
      g.fillRect(Math.round(cx + (p.x - P.x) * scale) - 1, Math.round(cy + (p.y - P.y) * scale) - 1, 2, 2);
    }
    g.fillStyle = (S.t * 4 | 0) % 2 ? '#ffffff' : '#9dffb8';
    g.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 3, 3);
    g.restore();
    drawRadarRing(g, cx, cy, R);
  }
  function drawRadarRing(g, cx, cy, R) {
    g.strokeStyle = '#5dff8a'; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R - 0.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(93,255,138,0.25)';
    g.beginPath(); g.arc(cx, cy, R * 0.5, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  }

  // Full-map preview (debug / tooling)
  function renderMap(g) {
    g.drawImage(S.bg, 0, 0);
    for (const e of S.enemies) {
      drawCone(g, e, 0, 0);
      g.fillStyle = e.type === 'camera' ? '#5ec8ff' : e.type === 'drone' ? '#ff9a3c' : e.type === 'heavy' ? '#c34bff' : '#ff3a3a';
      g.fillRect(e.x - 3, e.y - 3, 6, 6);
    }
    for (const p of S.pickups) Art.pickup(g, p.type, p.x, p.y, 0);
    g.fillStyle = '#fff'; g.fillRect(S.player.x - 3, S.player.y - 3, 6, 6);
  }

  return {
    load, update, render, renderRadar, renderMap,
    get state() { return S; },
    unload() { S = null; },
  };
})();
