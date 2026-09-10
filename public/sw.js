/* StockPulse service worker.
 *
 * Bump CACHE_VERSION whenever the caching rules below change — the activate
 * handler deletes every cache that doesn't carry the current version.
 */

const CACHE_VERSION = 'v2';
const SHELL_CACHE = `stockpulse-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `stockpulse-static-${CACHE_VERSION}`;
const PAGES_CACHE = `stockpulse-pages-${CACHE_VERSION}`;
const DATA_CACHE = `stockpulse-data-${CACHE_VERSION}`;
const MARKET_CACHE = `stockpulse-market-${CACHE_VERSION}`;

const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE, PAGES_CACHE, DATA_CACHE, MARKET_CACHE];

/* Everything filled while signed in. The app sits behind a password, so these
 * are dropped as soon as the server reports the session is gone — otherwise
 * the cached portfolio would stay readable offline without it. The shell and
 * static caches hold only public assets and survive a sign-out. */
const USER_DATA_CACHES = [PAGES_CACHE, DATA_CACHE, MARKET_CACHE];

const LOGIN_PATH = '/login';

const OFFLINE_URL = '/offline.html';

/* Precached on install so a cold, offline start still renders something. */
const SHELL_ASSETS = [
  OFFLINE_URL,
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

/* Keep the runtime caches from growing without bound.
 *
 * Portfolio data and market quotes are capped separately on purpose: quote
 * lookups are per-symbol and far more numerous, and in a shared cache their
 * churn evicts the handful of campaign/watchlist responses that matter most
 * offline. */
const MAX_PAGES = 40;
const MAX_DATA_ENTRIES = 60;
const MAX_MARKET_ENTRIES = 150;

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // Cache keys are returned in insertion order, so the head is the oldest.
  for (const key of keys.slice(0, Math.max(0, keys.length - maxEntries))) {
    await cache.delete(key);
  }
}

self.addEventListener('install', (event) => {
  // Deliberately no skipWaiting() here: a new worker stays in `waiting` so the
  // app can prompt before swapping builds out from under an open session. The
  // SKIP_WAITING message below is what promotes it.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually so one 404 can't fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('stockpulse-') && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
      // Control the page that registered us, so the very first visit is
      // cached without needing a reload.
      await self.clients.claim();
    })()
  );
});

/* Lets the update prompt in the app activate a waiting worker on demand. */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function clearUserData() {
  return Promise.all(USER_DATA_CACHES.map((name) => caches.delete(name)));
}

/* An installed app has no address bar, so rather than leave it showing empty
 * pages after a session ends, tell open windows to go and sign in. */
async function notifySignedOut() {
  const windows = await self.clients.matchAll({ type: 'window' });
  for (const client of windows) client.postMessage({ type: 'SIGNED_OUT' });
}

async function offlinePage() {
  const shell = await caches.open(SHELL_CACHE);
  return (
    (await shell.match(OFFLINE_URL)) ||
    new Response('You are offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf)$/i.test(url.pathname)
  );
}

/* Content-hashed and versioned assets: cache-first, they never change in place. */
async function cacheFirst(request, cacheName) {
  // Match across every cache, not just `cacheName`, so assets written by the
  // install handler into the shell cache are found here too.
  const cached = await caches.match(request);
  if (cached) return cached;

  const cache = await caches.open(cacheName);
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/* Pages and data: prefer fresh, fall back to the last good copy when offline. */
async function networkFirst(request, cacheName, { maxEntries } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).then(() => {
        if (maxEntries) trimCache(cacheName, maxEntries);
      });
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GETs are cacheable; POST/PUT/DELETE must always reach the server.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Leave cross-origin traffic (market data CDNs, analytics) to the network.
  if (url.origin !== self.location.origin) return;

  // Next.js client-side navigation payloads are tied to a specific build ID —
  // serving a stale one breaks hydration, so never cache them.
  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const isMarketData = url.pathname.startsWith('/api/stock/');
    const cacheName = isMarketData ? MARKET_CACHE : DATA_CACHE;
    const maxEntries = isMarketData ? MAX_MARKET_ENTRIES : MAX_DATA_ENTRIES;

    event.respondWith(
      networkFirst(request, cacheName, { maxEntries })
        .then(async (response) => {
          // The proxy answers API calls with 401 once the session has expired
          // or been revoked. Purge before handing the response back, so the
          // data is already gone by the time the page reacts to it.
          if (response.status === 401) {
            await clearUserData();
            await notifySignedOut();
          }
          return response;
        })
        .catch(
          () =>
            new Response(JSON.stringify({ error: 'You are offline and this data is not cached.' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            })
        )
    );
    return;
  }

  if (request.mode === 'navigate' && url.pathname === LOGIN_PATH) {
    // Never cached: signing in always has to reach the server. The proxy sends
    // signed-out visitors here, so the form being served is also a cue to drop
    // cached data. (Someone signed in can open /login directly; the only cost
    // then is refilling the offline cache.)
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) await clearUserData();
          return response;
        })
        .catch(offlinePage)
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGES_CACHE, { maxEntries: MAX_PAGES }).catch(offlinePage));
  }
});
