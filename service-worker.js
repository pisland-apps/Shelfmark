// ============================================================================
// Shelfmark — service-worker.js
//
// CACHE_VERSION below controls the offline app-shell cache name. It is
// SEPARATE from APP_VERSION / APP_VERSION_DATE in app.js (the version-badge
// display label) and does NOT sync automatically — bump both together on
// every deploy, or old visitors can get stuck on a stale cached build while
// the badge (and your GitHub repo) shows a newer number. See APP_VERSION's
// comment in app.js, and the deploy checklist in README.md.
// ============================================================================
const CACHE_VERSION = 'shelfmark-v1.4.0';

const PRECACHE_URLS = [
  './',
  'app.js',
  'manifest.json',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];
// Deliberately NOT precaching './index.html' directly as its own cache key —
// only './'. On some static hosts (GitHub/Cloudflare Pages), a direct
// '/index.html' request can 302-redirect to '/', which poisons the cache
// entry with a redirect response instead of the real page. Precaching only
// './' and resolving all navigations through it (below) avoids that.

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;

  // Navigations (typing the URL, opening the installed PWA, refresh) always
  // resolve through the cached './' shell, cache-first, network fallback.
  if(req.mode === 'navigate'){
    event.respondWith(
      caches.match('./').then(cached => cached || fetch(req).catch(()=>caches.match('./')))
    );
    return;
  }

  // Everything else (app.js, icons, manifest): cache-first, network fallback,
  // and opportunistically top up the cache from any successful network fetch
  // so a later deploy's new files get picked up on next online visit.
  event.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(res => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(()=>cached);
    })
  );
});
