// Offline support: the app shell is network-first with a cached fallback; map tiles the user has
// seen are kept (in a separate, size-limited cache) so the map works with patchy campus Wi-Fi.
const CACHE = 'hswt-navigator-v11';
const TILES = 'hswt-tiles-v1';
const MAX_TILES = 600; // roughly 10 MB
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/theme.js',
  'js/app.js',
  'js/data/campus.js',
  'js/data/categories.js',
  'js/data/people.generated.js',
  'js/data/mobility.generated.js',
  'js/data/weihenstephan.generated.js',
  'js/data/triesdorf.js',
  'js/data/triesdorf.generated.js',
  'js/data/hswt.js',
  'js/data/mensa-labels.js',
  'js/lib/i18n.js',
  'js/lib/directions.js',
  'js/lib/mensa.js',
  'js/lib/transit.js',
  'js/lib/navigation.js',
  'js/lib/rooms.js',
  'js/lib/routing.js',
  'js/lib/hours.js',
  'js/lib/schedule.js',
  'js/lib/search.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/sprite.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Drop the oldest tiles once the cache is over its limit (keys come back in insertion order).
async function trimTiles(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isTile = url.hostname === 'tile.openstreetmap.org';
  // Routing, timetable and menu APIs go straight to the network; the app has its own fallbacks.
  if (!isTile && url.origin !== location.origin) return;

  const network = fetch(request);
  // Store a copy of good responses. Registered before respondWith, so the copy is taken before
  // the page starts reading the body; waitUntil keeps the worker alive until it is written.
  event.waitUntil(
    network
      .then((res) => {
        if (!res.ok || (!isTile && res.type !== 'basic')) return;
        const copy = res.clone();
        return caches.open(isTile ? TILES : CACHE).then((c) => c.put(request, copy).then(() => isTile && trimTiles(c)));
      })
      .catch(() => {}),
  );

  if (isTile) {
    // Show a seen tile at once and refresh it in the background (stale-while-revalidate).
    event.respondWith(caches.open(TILES).then(async (c) => (await c.match(request)) ?? network.catch(() => Response.error())));
    return;
  }

  event.respondWith(
    network.catch(async () => {
      const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return cached;
      // Offline and not cached: pages get the app shell, other files a plain network error
      // (an HTML page in place of a script or image would only cause confusing errors).
      return request.mode === 'navigate' ? ((await caches.match('index.html')) ?? Response.error()) : Response.error();
    }),
  );
});
