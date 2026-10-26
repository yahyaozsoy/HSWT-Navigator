// Offline support: app shell is cache-first, everything else network-first.
const CACHE = 'hswt-navigator-v9';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
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
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isTile = url.hostname.endsWith('tile.openstreetmap.org');

  if (isTile) {
    // Keep tiles the user has already seen so the map works with patchy campus Wi-Fi.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }

  // Routing and menu APIs go straight to the network; the app has its own fallbacks.
  if (url.origin !== location.origin && url.hostname !== 'unpkg.com') return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r ?? caches.match('index.html'))),
  );
});
