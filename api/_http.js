// Shared HTTP helpers for the price endpoints.
//
// Vercel ignores files under api/ whose name starts with an underscore, so this
// is a plain module rather than a serverless function.

/**
 * fetch() with a hard deadline.
 *
 * Every upstream here is a free, unofficial, no-contract source that can and
 * does hang. Without a deadline a single slow source burns the whole 10s Vercel
 * budget and the user sees a generic timeout instead of "TEFAS is down" — and
 * the other sources in the same request never get a chance to answer.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`TIMEOUT_${timeoutMs}MS`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cache headers for a price response.
 *
 * BIST and TEFAS publish closing prices once a day; intraday quotes move by the
 * minute but nobody needs second-level freshness in a portfolio tracker. Letting
 * Vercel's edge serve a shared copy means auto-refresh across several devices
 * costs the upstream one request instead of one per device per tick — which is
 * the difference between "polite" and "banned" for sources like TEFAS that
 * enforce 6 requests per minute.
 *
 * stale-while-revalidate keeps the UI instant while the edge refreshes behind it.
 */
export function setCacheHeaders(res, { maxAge = 300, swr = 600 } = {}) {
  res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${swr}`)
}

/**
 * CORS + method guard shared by every price endpoint.
 *
 * ALLOWED_ORIGIN (set it in the Vercel dashboard to your own deployment URL)
 * turns these endpoints from an open scraping proxy that anyone can point at
 * İş Yatırım on your behalf into something only your own app can call. Left
 * unset it falls back to '*', which keeps local development and any preview
 * deployment working.
 *
 * Returns true when the caller has already been answered and the handler
 * should stop.
 */
export function applyCors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', allowed)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return true
  }
  return false
}

/** Parse and normalise the ?symbols=A,B,C query parameter. */
export function parseSymbols(symbolsParam, max) {
  const symbols = (symbolsParam || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
  const unique = [...new Set(symbols)]
  if (unique.length === 0) return { error: 'No symbols provided' }
  if (unique.length > max) return { error: `Max ${max} symbols per request` }
  return { symbols: unique }
}

// === Yahoo Finance ===
//
// Yahoo answers 429 to requests that arrive with no cookies, so every caller
// has to be handed a jar first. This lived in api/bist.js, where it was written
// for the BIST fallback; api/history.js then asked Yahoo for monthly candles
// without it and got rate-limited on the first call. Shared, so the next
// endpoint that needs Yahoo cannot repeat that.
//
// The jar is per serverless instance and short-lived, which is fine: a cold
// instance simply warms up again.

const YAHOO_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const COOKIE_TTL_MS = 60 * 60 * 1000

let _cookieJar = null
let _cookieFetchedAt = 0

// Exposed so probe-history.mjs can report whether a jar was actually
// obtained — "Yahoo is blocking us" and "our warm-up silently returned
// nothing" look identical from the outside otherwise.
export function yahooCookieState() {
  return { hasCookies: Boolean(_cookieJar), length: _cookieJar ? _cookieJar.length : 0 }
}

export async function warmUpYahooCookies() {
  if (_cookieJar && Date.now() - _cookieFetchedAt < COOKIE_TTL_MS) return _cookieJar
  try {
    const res = await fetchWithTimeout(
      'https://fc.yahoo.com',
      { headers: { 'User-Agent': YAHOO_UA, Accept: 'text/html,*/*' }, redirect: 'manual' },
      4000
    )
    let setCookieHeaders = []
    if (typeof res.headers.getSetCookie === 'function') {
      setCookieHeaders = res.headers.getSetCookie()
    } else {
      const all = res.headers.get('set-cookie')
      if (all) setCookieHeaders = all.split(/,(?=\s*\w+=)/)
    }
    _cookieJar = setCookieHeaders.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ')
    _cookieFetchedAt = Date.now()
  } catch {
    _cookieJar = ''
  }
  return _cookieJar
}

/** Headers a Yahoo chart request needs to avoid an instant 429. */
export async function yahooHeaders() {
  const cookies = await warmUpYahooCookies()
  return {
    'User-Agent': YAHOO_UA,
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://finance.yahoo.com/',
    ...(cookies ? { Cookie: cookies } : {}),
  }
}
