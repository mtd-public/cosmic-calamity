// Renders the PWA / favicon icons from the in-game portrait art (js/art.js).
// Usage: python3 -m http.server 4180 &  BASE=http://localhost:4180/ CHROMIUM=/opt/pw-browsers/chromium node tools/make-icons.mjs
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
const pw = await import('playwright').catch(() => import(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs')));
const base = process.env.BASE || 'http://localhost:4180/';
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.goto(base + '?map=0');
mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const icons = { 'icon-192.png': [192, false], 'icon-512.png': [512, false], 'icon-maskable-512.png': [512, true], 'apple-touch-icon.png': [180, true] };
for (const [name, [size, maskable]] of Object.entries(icons)) {
  const data = await page.evaluate(([size, maskable]) => {
    const src = document.createElement('canvas'); src.width = src.height = 64;
    Art.portrait(src, 'snake', false, false, 0.1);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#05070a'; g.fillRect(0, 0, size, size);
    const pad = maskable ? size * 0.16 : size * 0.04;
    const s = size - pad * 2;
    g.drawImage(src, pad, pad, s, s);
    g.strokeStyle = '#9aa6b4'; g.lineWidth = Math.max(2, size / 64);
    g.strokeRect(pad, pad, s, s);
    return c.toDataURL('image/png').split(',')[1];
  }, [size, maskable]);
  writeFileSync(new URL('../icons/' + name, import.meta.url), Buffer.from(data, 'base64'));
  console.log('wrote icons/' + name);
}
await browser.close();
