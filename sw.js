// Offline működés: az app fájljai a készüléken gyorsítótárazva.
// Új verzió kiadásakor a háttérben frissül, a következő indításkor már az új fut.

const CACHE = 'kassza-v2';
const SDK = 'https://www.gstatic.com/firebasejs/';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/firebase-config.js',
  'js/store-common.js',
  'js/store-local.js',
  'js/store-cloud.js',
  'js/format.js',
  'js/ui.js',
  'js/views/login.js',
  'js/views/entry.js',
  'js/views/summary.js',
  'js/views/charts.js',
  'js/views/settings.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Stale-while-revalidate: azonnal a tárolt változat, közben frissítés a hálózatról.
self.addEventListener('fetch', event => {
  const req = event.request;
  // Saját fájlok és a Firebase programkönyvtár (hogy az app térerő nélkül is elinduljon).
  // A Firebase adatforgalmához nem nyúlunk.
  const own = new URL(req.url).origin === location.origin;
  if (req.method !== 'GET' || !(own || req.url.startsWith(SDK))) return;

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }));
});
