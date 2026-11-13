/* Hazel Chess service worker — app shell for offline bot & analysis */
const CACHE = 'hazel-chess-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './board.js',
  './bot.js',
  './bot-worker.js',
  './sfx.js',
  './lichess.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './board3d.js',
  './pieces/wK.webp', './pieces/wQ.webp', './pieces/wR.webp',
  './pieces/wB.webp', './pieces/wN.webp', './pieces/wP.webp',
  './pieces/bK.webp', './pieces/bQ.webp', './pieces/bR.webp',
  './pieces/bB.webp', './pieces/bN.webp', './pieces/bP.webp',
  '../vendor/chess.js',
  '../vendor/three/three.module.min.js',

  '../art/chess/wK.svg', '../art/chess/wQ.svg', '../art/chess/wR.svg',
  '../art/chess/wB.svg', '../art/chess/wN.svg', '../art/chess/wP.svg',
  '../art/chess/bK.svg', '../art/chess/bQ.svg', '../art/chess/bR.svg',
  '../art/chess/bB.svg', '../art/chess/bN.svg', '../art/chess/bP.svg',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/socket.io/')) return;
  const dest = e.request.destination;
  const netFirst = dest === 'document' || dest === 'script' || dest === 'style' || url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname.endsWith('.css');
  if (netFirst) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  })));
});
