// Service worker for Portfolio Dashboard PWA.
//
// Strategy:
//   - Navigations (HTML)     → NETWORK-FIRST, cache as offline fallback
//   - Hashed build assets    → cache-first (their names change every build, so
//                              a cached copy can never be stale)
//   - API calls (/api/*)     → network-only, never cached (always fresh data)
//   - Cross-origin (fonts,
//     Frankfurter FX, …)     → untouched, browser handles it
//
// WHY NETWORK-FIRST FOR HTML (regression guard — do not "optimise" this back):
// index.html references build assets by content hash (index-a1b2c3.js). Serving
// a cached index.html after a new deploy makes the browser request an asset
// filename that no longer exists on the server. vercel.json rewrites every
// unmatched path to /index.html, so that request returns HTML with a 200 status
// instead of a 404 — the browser then refuses to execute HTML as a module
// ("Expected a JavaScript-or-Wasm module script but the server responded with a
// MIME type of text/html") and the app dies on a white screen. Always going to
// the network for HTML keeps the document and its asset names in sync.
//
// Bump CACHE_VERSION when you ship breaking changes — old caches are purged on
// the next visit.

const CACHE_VERSION = 'v2'
const CACHE_NAME = `portfolio-dashboard-${CACHE_VERSION}`

// On install: activate immediately. Nothing is pre-cached because Vite produces
// hashed asset names that aren't known ahead of time.
self.addEventListener('install', () => {
  self.skipWaiting()
})

// On activate: drop caches from previous versions and take over open pages.
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

// A response is only safe to cache when it actually is what was asked for.
// The SPA rewrite can answer a .js/.css request with index.html at status 200;
// storing that would make the breakage permanent and survive a reload.
//
// Note on response.type: Vite emits its bundles with a `crossorigin` attribute,
// so those requests run in CORS mode and come back as type 'cors' rather than
// 'basic' — even though they are same-origin. Accepting only 'basic' (as the
// first version of this file did) silently meant the JS and CSS were never
// cached at all and offline never worked. The caller already restricts this to
// our own origin, so allowing 'cors' here is safe. Opaque responses still fail
// the status check, since they report status 0.
function isCacheable(request, response) {
  if (!response || response.status !== 200) return false
  if (response.type !== 'basic' && response.type !== 'cors') return false

  const contentType = response.headers.get('content-type') || ''
  const isHtml = contentType.includes('text/html')

  if (request.destination === 'script' || request.destination === 'style') {
    return !isHtml
  }
  return true
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (isCacheable(request, response)) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    // Offline: fall back to whatever shell we have.
    const cached = (await cache.match(request)) || (await cache.match('/index.html'))
    return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
  }
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)

  if (cached) {
    // Refresh in the background; the current page keeps the instant response.
    fetch(request)
      .then((response) => {
        if (isCacheable(request, response)) cache.put(request, response.clone())
      })
      .catch(() => {})
    return cached
  }

  try {
    const response = await fetch(request)
    if (isCacheable(request, response)) cache.put(request, response.clone())
    return response
  } catch {
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only our own origin, only GET.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // Never cache API calls — portfolio prices must always be fresh.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  event.respondWith(handleAsset(request))
})
