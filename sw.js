// Кэш оболочки приложения: работает офлайн, обновляется в фоне.
// При изменении файлов увеличь VERSION, чтобы старый кэш удалился.
const VERSION = 'v10';
const CACHE = 'trenirovki-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'sync.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// сначала сеть (в обход HTTP-кэша), без сети — из кэша
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
