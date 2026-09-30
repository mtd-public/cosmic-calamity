// Headless mechanics check: drives the real game through window.GAME and asserts the core
// stealth rules (takedown, hiding, detection -> alert -> evasion -> calm, shooting, doors,
// exits, core sabotage + escape timer).
// Usage: python3 -m http.server 4180 &  BASE=http://localhost:4180/ CHROMIUM=/opt/pw-browsers/chromium node tools/sim-check.mjs
import { execSync } from 'node:child_process';
import { join } from 'node:path';
const pw = await import('playwright').catch(() => import(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs')));
const base = process.env.BASE || 'http://localhost:4180/';
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_CERT/.test(m.text())) errors.push(m.text()); });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.goto(base);
await page.waitForTimeout(500);

let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// helper installed in page: place player / enemy, press a key, fast-forward
await page.evaluate(() => {
  window.T = {
    S: () => GAME.state,
    tile: (tx, ty) => ({ x: tx * 16 + 8, y: ty * 16 + 8 }),
    place(tx, ty, dir) { const P = GAME.state.player; Object.assign(P, T.tile(tx, ty)); if (dir != null) P.dir = dir; },
    key(code) { dispatchEvent(new KeyboardEvent('keydown', { code })); dispatchEvent(new KeyboardEvent('keyup', { code })); },
    freezeAll() { for (const e of GAME.state.enemies) { e.stun = 999; } },
  };
});

// ---------------------------------------------------------------- 1. takedown from behind
let r = await page.evaluate(() => {
  GAME.start(0);
  const S = T.S();
  // hall patrol trooper '>' starts at (2,4) heading east; stand right behind it, facing it
  const e = S.enemies.find((e) => e.type === 'grunt' && e.mode === 'line' && e.pdx === 1);
  for (const o of S.enemies) if (o !== e) o.stun = 999;
  e.pause = 99; e.x = 5 * 16 + 8; e.y = 4 * 16 + 8; e.dir = e.tdir = 0; e.mode = 'sentry'; e.lookDirs = [0];
  T.place(4, 4, 0); S.player.x = e.x - 12;
  GAME.ff(0.05);
  T.key('KeyJ'); GAME.ff(0.2);
  return { ko: e.ko > 0, takedowns: S.stats.takedowns, phase: S.phase };
});
check('silent takedown from behind', r.ko && r.takedowns === 1 && r.phase === 'sneak', JSON.stringify(r));

// ---------------------------------------------------------------- 2. being seen raises an alert
r = await page.evaluate(() => {
  GAME.start(0);
  const S = T.S();
  const e = S.enemies.find((e) => e.type === 'grunt' && e.mode === 'line' && e.pdx === 1);
  for (const o of S.enemies) if (o !== e) o.stun = 999;
  e.x = 5 * 16 + 8; e.y = 4 * 16 + 8; e.mode = 'sentry'; e.lookDirs = [0]; e.dir = e.tdir = 0;
  S.player.x = e.x + 40; S.player.y = e.y;
  GAME.ff(1.0);
  const alerted = S.phase === 'alert', icon = e.icon;
  // break line of sight: hide far away
  S.player.x = 40 * 16 + 8; S.player.y = 29 * 16 + 8;
  GAME.ff(16);
  const evasion = S.phase;
  GAME.ff(13);
  return { alerted, icon, evasion, after: S.phase, alerts: S.stats.alerts };
});
check('spotted -> ALERT', r.alerted && r.alerts === 1, JSON.stringify(r));
check('lost track -> EVASION -> calm', r.evasion === 'evasion' && r.after === 'sneak', JSON.stringify(r));

// ---------------------------------------------------------------- 3. hiding in a locker hides you
r = await page.evaluate(() => {
  GAME.start(0);
  const S = T.S();
  for (const o of S.enemies) o.stun = 999;
  // lockers at (25..26, 9) in the hall; stand below (25,10) facing up
  T.place(25, 10, -Math.PI / 2);
  GAME.ff(0.05);
  T.key('KeyJ'); GAME.ff(0.1);
  const hidden = !!S.player.hidden;
  // a trooper staring right at the locker from 3 tiles away must not see the player
  const e = S.enemies.find((e) => e.type === 'grunt');
  e.stun = 0; e.x = 25 * 16 + 8; e.y = 13 * 16 - 8; e.mode = 'sentry'; e.lookDirs = [-Math.PI / 2]; e.dir = e.tdir = -Math.PI / 2; e.state = 'patrol';
  GAME.ff(2);
  const phaseWhileHidden = S.phase, aw = e.aw;
  T.key('KeyJ'); GAME.ff(0.1);
  return { hidden, phaseWhileHidden, aw, out: !S.player.hidden };
});
check('hide in locker', r.hidden && r.out, JSON.stringify(r));
check('hidden player is invisible', r.phaseWhileHidden === 'sneak' && r.aw === 0, JSON.stringify(r));

// ---------------------------------------------------------------- 4. sneak shot drops an unaware trooper
r = await page.evaluate(() => {
  GAME.start(0);
  const S = T.S();
  const e = S.enemies.find((e) => e.type === 'grunt' && e.mode === 'line' && e.pdx === 1);
  for (const o of S.enemies) if (o !== e) o.stun = 999;
  e.x = 10 * 16 + 8; e.y = 4 * 16 + 8; e.mode = 'sentry'; e.lookDirs = [0]; e.dir = e.tdir = 0;
  T.place(5, 4, 0);
  const ammo = S.player.ammo;
  GAME.ff(0.05);
  T.key('KeyK'); GAME.ff(1);
  return { dead: e.dead, ammo: S.player.ammo, before: ammo, kills: S.stats.kills };
});
check('sneak shot kills unaware trooper', r.dead && r.kills === 1 && r.ammo === r.before - 1, JSON.stringify(r));

// ---------------------------------------------------------------- 5. keycard -> door -> exit
r = await page.evaluate(() => {
  let completed = null;
  GAME.start(0);
  const S = T.S();
  for (const o of S.enemies) o.stun = 999;
  // locked door at (39,6): bump without the card
  T.place(39, 7, -Math.PI / 2);
  GAME.ff(0.05); T.key('KeyJ'); GAME.ff(0.1);
  const lockedStill = S.grid[6 * S.w + 39] === 'D';
  // grab the keycard
  const K = S.pickups.find((p) => p.type === 'K');
  S.player.x = K.x; S.player.y = K.y; GAME.ff(0.1);
  T.place(39, 7, -Math.PI / 2); GAME.ff(0.05); T.key('KeyJ'); GAME.ff(0.1);
  const opened = S.grid[6 * S.w + 39] === 'd';
  T.place(45, 1); GAME.ff(0.1);
  return { lockedStill, card: S.hasCard, opened, done: S.done };
});
check('door locked without keycard', r.lockedStill, JSON.stringify(r));
check('keycard opens door, exit completes stage', r.card && r.opened && r.done, JSON.stringify(r));

// ---------------------------------------------------------------- 6. annex exit needs intel
r = await page.evaluate(() => {
  GAME.start(2);
  const S = T.S();
  for (const o of S.enemies) o.stun = 999;
  const ex = S.grid.indexOf('E');
  const e = { x: ex % S.w, y: (ex / S.w) | 0 };
  T.place(e.x, e.y); GAME.ff(0.2);
  const blocked = !S.done;
  const ii = S.grid.indexOf('I');
  T.place(ii % S.w, ((ii / S.w) | 0) + 1, -Math.PI / 2); GAME.ff(0.05); T.key('KeyJ'); GAME.ff(0.1);
  const intel = S.intel;
  GAME.ff(0.7);
  T.place(e.x, e.y); GAME.ff(0.2);
  return { blocked, intel, done: S.done };
});
check('annex: exit blocked until intel, then completes', r.blocked && r.intel && r.done, JSON.stringify(r));
await page.evaluate(() => { document.getElementById('codecSkip').click(); });

// ---------------------------------------------------------------- 7. mothership: arm 3 cores -> escape timer -> pod
r = await page.evaluate(() => {
  GAME.start(4);
  const S = T.S();
  for (const o of S.enemies) o.stun = 999;
  const cores = [];
  S.grid.forEach((c, i) => { if (c === 'Z') cores.push({ x: i % S.w, y: (i / S.w) | 0 }); });
  for (const c of cores) {
    // stand on any open neighbour, facing the core
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ch = S.grid[(c.y + dy) * S.w + c.x + dx];
      if (ch === '.' || ch === ',') { T.place(c.x + dx, c.y + dy, Math.atan2(-dy, -dx)); break; }
    }
    GAME.ff(0.05); T.key('KeyJ'); GAME.ff(1.5);
    for (const o of S.enemies) o.stun = 999;
  }
  const armed = S.cores, escape = S.escape, phase = S.phase;
  const ex = S.grid.indexOf('E');
  T.place(ex % S.w, (ex / S.w) | 0); GAME.ff(0.2);
  return { total: S.coresTotal, armed, escape, phase, done: S.done };
});
check('mothership: all cores armed starts escape', r.armed === 3 && r.total === 3 && r.escape > 0 && r.phase === 'alert', JSON.stringify(r));
check('mothership: escape pod completes', r.done, JSON.stringify(r));

// ---------------------------------------------------------------- 8. capture -> POW camp -> breakout -> rescue
r = await page.evaluate(() => {
  let captured = false;
  GAME.start(0);
  const S0 = T.S();
  // lethal damage on a capturable stage leads to capture, not death
  S0.player.hp = 1; S0.player.inv = 0;
  S0.bullets.push({ x: S0.player.x, y: S0.player.y - 3, vx: 0, vy: 0, owner: 'enemy', dmg: 50, life: 1 });
  GAME.ff(2);
  captured = GAME.mode === 'card' && GAME.state.def.id === 'pow';
  return { captured, mode: GAME.mode, id: GAME.state.def.id };
});
check('shield 0 on stages 1-4 -> captured to POW camp', r.captured, JSON.stringify(r));
await page.evaluate(() => { document.getElementById('stagecard').dispatchEvent(new PointerEvent('pointerdown')); });
await page.waitForTimeout(200);
await page.evaluate(() => { document.getElementById('codecSkip').click(); });
r = await page.evaluate(() => {
  const S = T.S();
  for (const o of S.enemies) o.stun = 999;
  const P = S.player;
  const cagedStart = P.caged, ammo0 = P.ammo;
  // own cell door is straight below the start
  T.place(9, 3, Math.PI / 2); GAME.ff(0.05); T.key('KeyJ'); GAME.ff(1.5);
  const out = !P.caged && S.grid[4 * S.w + 9] === 'j';
  // gear locker
  T.place(36, 3, -Math.PI / 2); GAME.ff(0.05); T.key('KeyJ'); GAME.ff(0.2);
  const gear = P.ammo > ammo0;
  // free the prisoner in the first cell (door at 3,4), walk them out through the gate
  T.place(3, 5, -Math.PI / 2); GAME.ff(0.05); T.key('KeyJ'); GAME.ff(1.5);
  const following = S.pows.filter((w) => w.state === 'follow').length;
  // lead them along a walkable route to the exit, a step at a time
  const route = [[3, 6], [8, 6], [8, 9], [20, 9], [20, 18], [30, 18], [37, 22], [37, 23]];
  for (const [tx, ty] of route) {
    const tgt = T.tile(tx, ty);
    for (let i = 0; i < 400 && Math.hypot(P.x - tgt.x, P.y - tgt.y) > 2; i++) {
      const d = Math.hypot(tgt.x - P.x, tgt.y - P.y), st = Math.min(d, 1.5);
      P.x += (tgt.x - P.x) / d * st; P.y += (tgt.y - P.y) / d * st; GAME.ff(1 / 60);
      for (const o of S.enemies) o.stun = 999;
    }
  }
  GAME.ff(0.5);
  return { cagedStart, out, gear, following, done: S.done, rescued: S.stats.rescued && S.stats.rescued.length, phase: S.phase };
});
check('POW: start caged, pick lock, recover gear', r.cagedStart && r.out && r.gear, JSON.stringify(r));
check('POW: freed prisoner follows and is rescued at the gate', r.following === 1 && r.done && r.rescued === 1, JSON.stringify(r));

// ---------------------------------------------------------------- 9. soak: every stage runs 60s of AI with no errors
for (const i of [0, 1, 2, 3, 4, 'pow']) {
  r = await page.evaluate((i) => { GAME.start(i); const S = T.S(); S.player.hp = 1e9; S.player.maxHp = 1e9; GAME.ff(60); return { phase: S.phase, enemies: S.enemies.length }; }, i);
  check(`stage ${i} 60s AI soak`, !errors.length, JSON.stringify(r));
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(fails ? `${fails} check(s) FAILED` : 'SIM CHECK PASS');
process.exit(fails ? 1 : 0);
