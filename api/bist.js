// BIST stock price fetcher.
//
// Primary source: İş Yatırım (isyatirim.com.tr)
//   - No API key, no cookies, no rate limits
//   - Stable JSON endpoint used by major Turkish open-source projects (isyatirimhisse, etc.)
//   - Endpoint: /_layouts/15/Isyatirim.Website/Common/Data.aspx/HisseTekil
//   - Date format: dd-mm-yyyy
//   - Returns: { value: [{ HGDG_HS_KODU: "THYAO", HGDG_TARIH: "...", HGDG_KAPANIS: 301.50, ... }] }
//
// Fallback: Yahoo Finance v8 chart endpoint (with cookie warmup)
//   - Used only if İş Yatırım fails or returns no data
//   - More fragile (rate limits, 403/429 errors) — see comments below

import { fetchWithTimeout, setCacheHeaders, applyCors, parseSymbols, yahooHeaders } from './_http.js'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// Format date as dd-mm-yyyy (İş Yatırım format)
function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const y = date.getFullYear()
  return `${d}-${m}-${y}`
}

// === Primary: İş Yatırım ===
async function fetchIsYatirim(symbol) {
  // Get last ~7 days to handle weekends/holidays — we want the most recent close
  const now = new Date()
  const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const startDate = formatDate(past)
  const endDate = formatDate(now)

  const url =
    `https://www.isyatirim.com.tr/_layouts/15/Isyatirim.Website/Common/Data.aspx/HisseTekil` +
    `?hisse=${encodeURIComponent(symbol)}&startdate=${startDate}&enddate=${endDate}`

  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,text/plain,*/*',
    },
  })

  if (!res.ok) {
    throw new Error(`IS_HTTP_${res.status}`)
  }

  const data = await res.json()
  const rows = data?.value
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('IS_NO_DATA')
  }

  // Sort by date descending; most recent close is at the top
  // HGDG_TARIH format is "DD-MM-YYYY"
  const sorted = rows
    .filter((r) => typeof r.HGDG_KAPANIS === 'number' && r.HGDG_KAPANIS > 0)
    .sort((a, b) => {
      const parseTr = (s) => {
        const [d, m, y] = (s || '').split('-')
        return new Date(`${y}-${m}-${d}`).getTime()
      }
      return parseTr(b.HGDG_TARIH) - parseTr(a.HGDG_TARIH)
    })

  if (sorted.length === 0) {
    throw new Error('IS_NO_PRICE')
  }

  const latest = sorted[0]
  const previous = sorted[1]
  const price = latest.HGDG_KAPANIS
  const previousClose = previous?.HGDG_KAPANIS ?? price
  const dayChangePct = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0

  return {
    symbol,
    price,
    currency: 'TRY',
    previousClose,
    dayChangePct,
  }
}

// === Fallback: Yahoo (cookie warm-up lives in _http.js) ===

async function fetchYahoo(symbol) {
  const ticker = symbol.endsWith('.IS') ? symbol : `${symbol}.IS`
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`

  const res = await fetchWithTimeout(url, { headers: await yahooHeaders() })

  if (!res.ok) {
    if (res.status === 429) throw new Error('YH_RATE_LIMIT')
    throw new Error(`YH_HTTP_${res.status}`)
  }

  const data = await res.json()
  const result = data?.chart?.result?.[0]
  if (!result) throw new Error('YH_NOT_FOUND')

  const meta = result.meta || {}
  const price = meta.regularMarketPrice
  const previousClose = meta.chartPreviousClose ?? meta.previousClose
  if (typeof price !== 'number' || price <= 0) throw new Error('YH_NO_PRICE')

  const dayChangePct = previousClose ? ((price - previousClose) / previousClose) * 100 : 0
  return { symbol, price, currency: 'TRY', previousClose, dayChangePct }
}

// Try İş Yatırım first; on failure, fall back to Yahoo
async function fetchOne(symbol) {
  try {
    return await fetchIsYatirim(symbol)
  } catch (errIS) {
    try {
      return await fetchYahoo(symbol)
    } catch (errYH) {
      throw new Error(`IS:${errIS.message} | YH:${errYH.message}`)
    }
  }
}

// Common handler — concurrent calls with a small batch size.
// Sequential mode could not finish 25-30 symbols within Vercel's 10s hobby-plan
// timeout (each İş Yatırım call is ~400-800ms). Running 6 in parallel keeps the
// total under ~3s for typical portfolios while staying polite to the upstream.
async function handle(symbolsParam) {
  const parsed = parseSymbols(symbolsParam, 60)
  if (parsed.error) return { results: {}, errors: [{ symbol: '', error: parsed.error }] }
  const symbols = parsed.symbols

  const results = {}
  const errors = []

  const BATCH = 6
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(fetchOne))
    settled.forEach((s, idx) => {
      const sym = batch[idx]
      if (s.status === 'fulfilled') {
        results[sym] = s.value
      } else {
        errors.push({ symbol: sym, error: s.reason?.message || 'failed' })
      }
    })
  }

  return { results, errors }
}

// === Vercel handler ===
export default async function handler(req, res) {
  if (applyCors(req, res)) return

  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const symbolsParam = url.searchParams.get('symbols') || ''
    const data = await handle(symbolsParam)
    // BIST moves intraday, so keep this short — but five minutes of shared
    // edge cache still collapses an auto-refresh across several devices into
    // a single trip to İş Yatırım.
    setCacheHeaders(res, { maxAge: 300, swr: 600 })
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' })
  }
}

export { handle as bistHandle }
