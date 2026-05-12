// Global equity price fetcher via Stooq (stooq.com).
//
// Why Stooq:
//   - Free, no API key, no signup, no CORS issues (we proxy server-side)
//   - End-of-day data — perfect for portfolio tracking (not day-trading)
//   - Used by many open-source portfolio tools and pandas-datareader
//   - Symbol convention: "AAPL.US" (US ticker + ".US" suffix)
//
// Endpoint:
//   GET https://stooq.com/q/l/?s={symbol}&i=d&f=sd2t2ohlcvn&h&e=csv
//   Note: single-symbol queries only — batch returns N/D for unclear reasons
//
// Returns CSV like:
//   Symbol,Date,Time,Open,High,Low,Close,Volume,Name
//   AAPL.US,2026-05-07,22:00:22,289.27,292.13,285.78,287.44,45224300,APPLE INC
//
// We call Stooq once per symbol IN PARALLEL since each request is independent.
// Stooq's daily quota is generous for personal use (no documented limit, but
// "Exceeded the daily hits limit" appears at very high call counts).

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

async function fetchOne(symbol) {
  // Stooq expects ".US" suffix for US tickers; we add it if missing
  const stooqSymbol = symbol.includes('.') ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&i=d&f=sd2t2ohlcvn&h&e=csv`

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/csv,*/*',
    },
  })

  if (!res.ok) {
    throw new Error(`Stooq HTTP ${res.status}`)
  }

  const text = await res.text()
  const lines = text.trim().split('\n')

  if (lines.length < 2) {
    throw new Error('NO_DATA')
  }

  // Detect rate limit
  if (text.toLowerCase().includes('exceeded')) {
    throw new Error('RATE_LIMIT')
  }

  // Parse CSV: header line then data line
  // Format: Symbol,Date,Time,Open,High,Low,Close,Volume,Name
  const data = lines[1].split(',')
  if (data.length < 8) {
    throw new Error('BAD_CSV')
  }

  const [, , , openStr, highStr, lowStr, closeStr, volumeStr, nameStr] = data
  const close = parseFloat(closeStr)
  const open = parseFloat(openStr)

  // Stooq returns "N/D" when there's no data for the symbol
  if (closeStr === 'N/D' || !isFinite(close) || close <= 0) {
    throw new Error('NOT_FOUND')
  }

  // Day change uses today's open as the reference point. This matches what
  // most users expect from a "daily change" indicator on EOD data.
  const previousClose = isFinite(open) && open > 0 ? open : close
  const dayChangePct = previousClose > 0 ? ((close - previousClose) / previousClose) * 100 : 0

  return {
    symbol,
    price: close,
    currency: 'USD',
    previousClose,
    dayChangePct,
    name: nameStr ? nameStr.trim() : null,
  }
}

// Common handler — parallel fetches with a small concurrency cap
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

  // Concurrency: 5 in flight at a time — fast enough, polite to Stooq
  const BATCH = 5
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

export { handle as globalHandle }
