// Offline play once the game has loaded once (pattern from mtd-public/turn-tactics sw.js).
// Bump VERSION whenever the shipped file list changes.
const VERSION = 'metal-snake-v3';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './touch-zoom-guard/touch-zoom-guard.css',
  './touch-zoom-guard/touch-zoom-guard.js',
  './vendor/three.min.js',
  './js/audio.js',
  './js/input.js',
  './js/art.js',
  './js/levels.js',
  './js/game.js',
  './js/sprites.js',
  './js/render3d.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
// Google Fonts are cached the first time they load
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // the page itself: network first for the newest build, cached copy when offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  if (url.origin === location.origin || RUNTIME_HOSTS.includes(url.hostname)) {
    // stale-while-revalidate
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
