// Offline működés és frissítés.
// - Az app saját fájljai: mindig a hálózatról jönnek (a GitHub 10 perces gyorsítótárát is
//   megkerülve), így indításkor mindig a legfrissebb változat fut. Térerő nélkül, vagy ha a
//   hálózat 4 mp alatt nem válaszol, a készüléken tárolt példány töltődik be.
// - A Firebase programkönyvtár verziószámos címről jön, az sosem változik: elég a tárolt példány.
// Új kiadásnál a CACHE számát növelni kell (ez látszik a Beállításokban verzióként).

const CACHE = 'kassza-v20';
const SDK = 'https://www.gstatic.com/firebasejs/';
const TIMEOUT = 4000;
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
  'js/display.js',
  'js/period.js',
  'js/views/login.js',
  'js/views/entry.js',
  'js/views/summary.js',
  'js/views/search.js',
  'js/views/todos.js',
  'js/views/calendar.js',
  'js/views/charts.js',
  'js/views/settings.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/splash.webp',
];

self.addEventListener('install', event => {
  // cache: 'reload' – a telepítés se a böngésző régi, gyorsítótárazott példányait mentse el.
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const fromCache = () => cache.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === 'navigate' ? cache.match('./') : undefined));

  const network = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });

  // Lassú hálózatnál ne várakoztassuk sokáig: 4 mp után a tárolt példány (ha van).
  const timeout = new Promise(resolve => setTimeout(resolve, TIMEOUT)).then(fromCache);
  try {
    const res = await Promise.race([network, timeout]);
    return res || (await network);
  } catch {
    const hit = await fromCache();
    if (hit) return hit;
    throw new Error('offline, és nincs tárolt példány');
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const own = new URL(req.url).origin === location.origin;
  if (own) event.respondWith(networkFirst(req));
  else if (req.url.startsWith(SDK)) event.respondWith(cacheFirst(req));
  // A Firebase adatforgalmához nem nyúlunk.
});
