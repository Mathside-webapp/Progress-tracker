/* Mathside PWA — Step 5
   GitHub Pages + localhost friendly.
   Provides app-shell caching, a graceful offline fallback, and controlled updates. */

const CACHE_NAME = 'mathside-app-shell-v3';
const CACHE_PREFIX = 'mathside-app-shell-';

const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './assets/mathside-icon.svg',
  './css/styles.css?v=11.4',
  './css/art-theme.css?v=7.0',
  './css/student-v8.css?v=10.5',
  './css/design-v9.css?v=9.1',
  './css/v10-features.css?v=11.2',
  './js/config.js',
  './js/app.js?v=11.4',
  './js/student-v8.js?v=10.7.2',
  './js/v10-features.js?v=11.1',
  './js/design-v9.js?v=9',
  './js/pwa.js?v=2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase/CDN/other third-party requests stay network-controlled.
  if (url.origin !== self.location.origin) return;

  // Page navigations: try the newest version first, then cached page, then offline screen.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (_) {
        return (await caches.match(request))
          || (await caches.match('./index.html'))
          || (await caches.match('./offline.html'));
      }
    })());
    return;
  }

  // Same-origin assets: network first so CSS/JS edits appear quickly, cache as fallback.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      return (await caches.match(request)) || Response.error();
    }
  })());
});
