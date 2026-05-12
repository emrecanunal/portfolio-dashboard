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

  const res = await fetch(url, {
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

// === Fallback: Yahoo (kept as backup, though usually not needed) ===
let _cookieJar = null
let _cookieFetchedAt = 0
const COOKIE_TTL_MS = 60 * 60 * 1000

async function warmUpYahooCookies() {
  if (_cookieJar && Date.now() - _cookieFetchedAt < COOKIE_TTL_MS) return _cookieJar
  try {
    const res = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'manual',
    })
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

async function fetchYahoo(symbol) {
  const ticker = symbol.endsWith('.IS') ? symbol : `${symbol}.IS`
  const cookies = await warmUpYahooCookies()
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://finance.yahoo.com/',
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })

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

// Common handler — sequential calls with light pacing
async function handle(symbolsParam) {
  const symbols = (symbolsParam || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

  if (symbols.length === 0) {
    return { results: {}, errors: [{ symbol: '', error: 'No symbols provided' }] }
  }
  if (symbols.length > 30) {
    return { results: {}, errors: [{ symbol: '', error: 'Max 30 symbols per request' }] }
  }

  const results = {}
  const errors = []

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]
    try {
      results[sym] = await fetchOne(sym)
    } catch (err) {
      errors.push({ symbol: sym, error: err.message || 'failed' })
    }
    // 200ms pacing — İş Yatırım is generous, but we stay polite
    if (i < symbols.length - 1) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  return { results, errors }
}

// === Vercel handler ===
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const symbolsParam = url.searchParams.get('symbols') || ''
    const data = await handle(symbolsParam)
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' })
  }
}

export { handle as bistHandle }
