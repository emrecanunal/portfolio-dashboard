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
