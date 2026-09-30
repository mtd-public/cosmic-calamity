// Headless smoke test (adapted from dr-mow tools/smoke.mjs / mstr-gme-dsgn-tmpt tools/smoke-vanilla-starter.mjs):
// loads the game at desktop / phone / phone-landscape / tablet, plays a few seconds with the real
// controls, screenshots, and fails on any console error or page scroll.
// Usage: python3 -m http.server 4180 &  BASE=http://localhost:4180/ CHROMIUM=/opt/pw-browsers/chromium node tools/smoke.mjs
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
const pw = await import('playwright').catch(() => import(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs')));
const { chromium, devices } = pw;
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE || 'http://localhost:4180/';
const level = Number(process.env.LEVEL || 0);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
let failures = 0;

async function run(name, ctxOpts, act) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  // the sandbox has no route to Google Fonts; stub it so the check stays about the game
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}-title.png` });
  await act(page, name);
  const st = await page.evaluate(() => ({
    mode: GAME.mode,
    phase: GAME.state && GAME.state.phase,
    hp: GAME.state && GAME.state.player.hp,
    pos: GAME.state && [GAME.state.player.x | 0, GAME.state.player.y | 0],
    scroll: [document.scrollingElement.scrollHeight, innerHeight, document.scrollingElement.scrollWidth, innerWidth],
  }));
  const scrolls = st.scroll[0] > st.scroll[1] || st.scroll[2] > st.scroll[3];
  if (errors.length || scrolls) failures++;
  console.log(name.padEnd(11), 'errors:', errors.length ? errors : 'none', scrolls ? 'PAGE SCROLLS' : 'no scroll', JSON.stringify(st));
  await ctx.close();
}

// title -> NEW GAME -> skip card + briefing -> gameplay
async function enterGame(page, name, tap) {
  const click = (sel) => (tap ? page.tap(sel) : page.click(sel));
  await click('[data-action=start]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-card.png` });
  await click('#stagecard');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}-terminal.png` });
  await click('#codecSkip');
  await page.waitForTimeout(400);
  if (level) await page.evaluate((i) => GAME.start(i), level);
  await page.waitForTimeout(800);
}

await run('desktop', { viewport: { width: 1280, height: 800 } }, async (page, name) => {
  await enterGame(page, name, false);
  await page.screenshot({ path: `${OUT}/${name}-play0.png` });
  await page.keyboard.down('KeyD'); await page.waitForTimeout(700); await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${name}-shoot.png` });
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}-play1.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-pause.png` });
  await page.click('[data-action=resume]');
});

const touchPlay = async (page, name) => {
  await enterGame(page, name, true);
  await page.screenshot({ path: `${OUT}/${name}-play.png` });
  const vp = page.viewportSize();
  // drag the floating stick with a real touch sequence via CDP
  const cdp = await page.context().newCDPSession(page);
  const x0 = vp.width * 0.18, y0 = vp.height * 0.8;
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await tp('touchStart', x0, y0);
  for (let i = 1; i <= 6; i++) { await tp('touchMove', x0 + i * 7, y0 - i * 5); await page.waitForTimeout(60); }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}-stick.png` });
  await tp('touchEnd', 0, 0);
  // right side: tap inside the faint FIRE ring = fire, anywhere else = act
  const fire = await page.locator('#hintFire').boundingBox();
  await page.touchscreen.tap(fire.x + fire.width / 2, fire.y + fire.height / 2);
  await page.touchscreen.tap(vp.width * 0.8, vp.height * 0.45);
  const moved = await page.evaluate(() => ({ shots: GAME.state.stats.shots }));
  if (!moved.shots) { console.log(name, 'FIRE tap did not fire'); failures++; }
  await page.waitForTimeout(400);
  await page.tap('#btnPause');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-pause.png` });
};
await run('phone', { ...devices['iPhone 13'] }, touchPlay);
await run('phone-land', { ...devices['iPhone 13 landscape'] }, touchPlay);
await run('tablet', { ...devices['iPad Pro 11 landscape'] }, touchPlay);
await browser.close();
console.log(failures ? `${failures} profile(s) FAILED` : 'SMOKE PASS');
process.exit(failures ? 1 : 0);
