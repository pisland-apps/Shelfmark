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
const CACHE_VERSION = 'shelfmark-v1.64.4';

const PRECACHE_URLS = [
  './',
  'app.js',
  'manifest.json',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'lib/pdf.min.mjs',
  'lib/pdf.worker.min.mjs'
];
// Deliberately NOT precaching './index.html' directly as its own cache key —
// only './'. On some static hosts (GitHub/Cloudflare Pages), a direct
// '/index.html' request can 302-redirect to '/', which poisons the cache
// entry with a redirect response instead of the real page. Precaching only
// './' and resolving all navigations through it (below) avoids that.

// v1.64.4: a Response with redirected:true must never be stored for a navigation — Chrome refuses to let a
// service worker answer a navigation with one (net::ERR_FAILED, the installed app then fails to open).
// Cloudflare Pages redirects /index.html -> / . If any fetched file arrives redirected, rebuild it as a
// plain Response (same body, status and headers; redirected is false on a Response we construct).
function plainResponse(res){
  if(!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then(body => new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }));
}

self.addEventListener('install', (event)=>{
  // cache:'reload' skips the browser's HTTP cache. cache.addAll() goes through it, and static
  // hosts (GitHub Pages: about 10 minutes) can hand back the PREVIOUS app.js, which would then be
  // stored under the NEW cache name and served until the next version bump. Same all-or-nothing
  // behaviour as addAll: any failed file fails the install.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => Promise.all(PRECACHE_URLS.map(url =>
        fetch(new Request(url, { cache: 'reload' })).then(res => {
          if(!res.ok) throw new Error('Precache failed: ' + url + ' (' + res.status + ')');
          return plainResponse(res).then(clean => cache.put(url, clean));
        })
      )))
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
          plainResponse(res.clone()).then(copy => caches.open(CACHE_VERSION).then(cache => cache.put(req, copy)));
        }
        return res;
      });
    })
  );
});
