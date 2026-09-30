// Tap-spam regression test for touch-zoom-guard.
// Emulates an iPad (and an iPhone), holds a joystick finger, hammers the fire
// buttons with a second finger, and checks the page never zooms, that the
// guard cancels touchend on controls, and that menu taps still click.
//
// Usage:
//   node touch-zoom-guard/test/tap-spam.mjs <url> --start "<selector>" \
//        --buttons "#btn-a,#btn-b" [--joystick 200,400] [--menu "<selector>"]
//
// Needs Playwright (npm i -D playwright, or a global install + NODE_PATH).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium, devices } = pw;

const args = process.argv.slice(2);
const url = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i > 0 ? args[i + 1] : d; };
const start = opt('start');
const buttons = opt('buttons', '').split(',').filter(Boolean);
const [jx, jy] = opt('joystick', '').split(',').map(Number);
const menu = opt('menu');
if (!url || !buttons.length) { console.error('usage: tap-spam.mjs <url> --buttons "#a,#b" [--start sel] [--joystick x,y] [--menu sel]'); process.exit(2); }

let failed = false;
const b = await chromium.launch();
for (const name of ['iPad (gen 7) landscape', 'iPhone 13 landscape']) {
  const ctx = await b.newContext({ ...devices[name] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url);
  await p.waitForTimeout(500);
  if (start) { await p.tap(start); await p.waitForTimeout(400); }
  const cdp = await ctx.newCDPSession(p);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const vp = p.viewportSize();
  const J = { x: jx || vp.width * 0.2, y: jy || vp.height * 0.7, id: 1 };
  const centers = [];
  for (const s of buttons) {
    const bb = await p.locator(s).boundingBox();
    if (!bb) throw new Error('button not visible: ' + s);
    centers.push({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
  }
  await tp('touchStart', [J]);
  await tp('touchMove', [{ ...J, x: J.x + 30 }]);
  let maxScale = 1;
  for (let i = 0; i < 60; i++) {
    const c = centers[i % centers.length];
    await tp('touchStart', [{ ...J, x: J.x + 30 }, { ...c, id: 2 }]);
    await p.waitForTimeout(15);
    await tp('touchMove', [{ ...J, x: J.x + 30 }]); // lift finger 2, keep joystick
    await p.waitForTimeout(45);
    maxScale = Math.max(maxScale, await p.evaluate(() => (window.visualViewport ? visualViewport.scale : 1)));
  }
  await tp('touchEnd', []);
  const cancelled = await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    const t = new Touch({ identifier: 99, target: el, clientX: 5, clientY: 5 });
    const ev = new TouchEvent('touchend', { changedTouches: [t], touches: [], cancelable: true, bubbles: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, buttons[0]);
  let menuClicked = null;
  if (menu) {
    await p.waitForTimeout(400);
    await p.evaluate((sel) => { window.__tzgClicked = false; document.querySelector(sel).addEventListener('click', () => (window.__tzgClicked = true), { once: true }); }, menu);
    await p.tap(menu);
    await p.waitForTimeout(200);
    menuClicked = await p.evaluate(() => window.__tzgClicked);
  }
  const ok = maxScale <= 1.01 && cancelled && menuClicked !== false && !errs.length;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: maxScale=${maxScale} touchendCancelled=${cancelled} menuClick=${menuClicked} errors=${JSON.stringify(errs)}`);
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
