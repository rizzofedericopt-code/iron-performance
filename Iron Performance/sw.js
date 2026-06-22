// Service worker Iron Performance — offline shell + nessuna cache per le API
const CACHE = 'iron-performance-v1';
const ASSETS = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-512-maskable.png', './icons/apple-touch-icon.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                         // POST /api/store passa diretto
  const url = new URL(req.url);
  if (url.pathname.indexOf('/api/') !== -1) return;         // mai cache per le API
  if (req.mode === 'navigate') {                            // pagina: network-first
    e.respondWith(
      fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; })
                .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(                                            // asset: cache-first
    caches.match(req).then(c => c || fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(cc => cc.put(req, cp)); return r; }))
  );
});
