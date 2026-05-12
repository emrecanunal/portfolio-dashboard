// Service worker for Portfolio Dashboard PWA.
//
// Strategy:
//   - App shell (HTML, JS, CSS, icons) → cache-first with background update
//   - API calls (/api/*) → network-only, never cached (always fresh data)
//   - External APIs (Frankfurter for FX) → network-only
//
// Bump CACHE_VERSION when you ship breaking changes — old caches will be
// purged on the next visit.

const CACHE_VERSION = 'v1'
const CACHE_NAME = `portfolio-dashboard-${CACHE_VERSION}`

// On install: just activate immediately. We don't pre-cache anything because
// Vite produces hashed asset names that we don't know ahead of time.
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

// On activate: clear out old caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('portfolio-dashboard-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

// On fetch: smart routing
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle GET requests on our own origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  // NEVER cache API calls — always hit the network for fresh data
  if (url.pathname.startsWith('/api/')) {
    return // browser handles normally
  }

  // App shell: cache-first with background update
  // (stale-while-revalidate pattern — instant load, refresh in background)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)

      const networkPromise = fetch(request)
        .then((response) => {
          // Only cache successful responses
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone())
          }
          return response
        })
        .catch(() => null)

      // Return cached immediately if available, otherwise wait for network
      return cached || networkPromise || new Response('Offline', { status: 503 })
    })()
  )
})
