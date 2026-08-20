// Month-end price history, for seeding the performance chart's archive.
//
//   GET /api/history?type=bist|tefas|global&symbols=THYAO,ASELS&months=60
//   → { results: { THYAO: { '2024-01': 280.5, ... } }, errors: [], source }
//
// One closing price per calendar month, in the symbol's own currency. Daily
// rows are collapsed by taking the LAST trading day of each month, which is
// what "month-end close" means and what src/lib/history.js stores.
//
// This is a reconstruction from third parties, not a record of what the user
// saw. mergeBackfill() in history.js therefore lets any first-hand snapshot win
// over anything this returns.
//
// SOURCES
//   tefas   tefas.gov.tr /api/funds/fonFiyatBilgiGetir — same endpoint the
//           live price path uses, with a longer `periyod`. Proven: it returned
//           24 daily rows for a one-month window in the August 2026 probe.
//   bist    İş Yatırım HisseTekil — already used for live prices with a 7-day
//           window; here the window is simply widened. Same endpoint, same
//           parser, so if live BIST prices work these do too.
//   global  Yahoo Finance chart API at interval=1mo, which returns monthly
//           closes directly. This is the least certain of the three: Finnhub's
//           free tier does not reliably expose historical candles, and Stooq
//           closed its free CSV in March 2026. Yahoo already appears in
//           api/bist.js as a fallback, so it is at least a known quantity.
//           Run `npm run probe:history` to confirm before relying on it.

import { fetchWithTimeout, setCacheHeaders, applyCors, parseSymbols } from './_http.js'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const MAX_SYMBOLS = 12
const MAX_MONTHS = 60

// Collapse dated points into one value per month, keeping the latest date in
// each. Input: [{ ymd: '2026-07-31', value: 1.27 }, ...] in any order.
export function toMonthEnds(points) {
  const byMonth = new Map()
  for (const p of points) {
    if (!p?.ymd || typeof p.value !== 'number' || !isFinite(p.value) || p.value <= 0) continue
    const key = p.ymd.slice(0, 7)
    const seen = byMonth.get(key)
    if (!seen || p.ymd > seen.ymd) byMonth.set(key, p)
  }
  const out = {}
  for (const [key, p] of [...byMonth.entries()].sort()) out[key] = p.value
  return out
}

// === TEFAS ===
//
// `periyod` only accepts 1, 3, 6, 12, 36 or 60 months, so round the request up
// to the next allowed step rather than silently returning less than asked for.
const TEFAS_PERIODS = [1, 3, 6, 12, 36, 60]
function snapPeriod(months) {
  return TEFAS_PERIODS.find((p) => p >= months) ?? 60
}

async function tefasHistory(code, months) {
  const res = await fetchWithTimeout(
    'https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir',
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify({ fonKodu: code, dil: 'TR', periyod: snapPeriod(months) }),
    },
    9000
  )
  if (res.status === 429) throw new Error('TEFAS_RATE_LIMIT')
  if (!res.ok) throw new Error(`TEFAS_HTTP_${res.status}`)

  const rows = (await res.json())?.resultList
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('TEFAS_NO_DATA')

  return toMonthEnds(rows.map((r) => ({ ymd: normaliseYmd(r?.tarih), value: toNumber(r?.fiyat) })))
}

// === BIST (İş Yatırım) ===

function isYatirimDate(date) {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${d}-${m}-${date.getFullYear()}`
}

async function bistHistory(symbol, months) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - months, 1)
  const url =
    'https://www.isyatirim.com.tr/_layouts/15/Isyatirim.Website/Common/Data.aspx/HisseTekil' +
    `?hisse=${encodeURIComponent(symbol)}` +
    `&startdate=${isYatirimDate(start)}&enddate=${isYatirimDate(now)}`

  const res = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' } },
    9000
  )
  if (!res.ok) throw new Error(`IS_HTTP_${res.status}`)

  const rows = (await res.json())?.value
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('IS_NO_DATA')

  return toMonthEnds(
    rows.map((r) => ({ ymd: normaliseYmd(r?.HGDG_TARIH), value: toNumber(r?.HGDG_KAPANIS) }))
  )
}

// === Global (Yahoo, monthly candles) ===

async function globalHistory(symbol, months) {
  const range = months <= 12 ? '1y' : months <= 24 ? '2y' : months <= 60 ? '5y' : '10y'
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1mo&range=${range}`

  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/plain,*/*',
        Referer: 'https://finance.yahoo.com/',
      },
    },
    9000
  )
  if (res.status === 429) throw new Error('YH_RATE_LIMIT')
  if (!res.ok) throw new Error(`YH_HTTP_${res.status}`)

  const result = (await res.json())?.chart?.result?.[0]
  const stamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(stamps) || !Array.isArray(closes)) throw new Error('YH_NO_DATA')

  const points = stamps.map((t, i) => ({
    // Yahoo stamps a monthly candle at the START of its month, so the month key
    // is taken from the stamp itself, not from a "last day" calculation.
    ymd: new Date(t * 1000).toISOString().slice(0, 10),
    value: toNumber(closes[i]),
  }))
  return toMonthEnds(points)
}

// === helpers ===

// Return 'YYYY-MM-DD' from any of the shapes these sources use, or '' if it
// cannot be read — toMonthEnds() then drops the row rather than misfiling it.
export function normaliseYmd(value) {
  if (typeof value === 'number' && isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') return ''
  const t = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const dayFirst = t.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/)
  if (dayFirst) return `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`
  const parsed = Date.parse(t)
  return isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : ''
}

export function toNumber(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const n = parseFloat(value.trim().replace(/\./g, '').replace(',', '.'))
  return isFinite(n) ? n : 0
}

const FETCHERS = { tefas: tefasHistory, bist: bistHistory, global: globalHistory }

// Sequential with pacing. Backfill is a rare, deliberate action — there is no
// reason to hammer a source that is doing us a favour, and TEFAS in particular
// allows only about six requests a minute.
async function handle(type, symbolsParam, monthsParam) {
  const fetcher = FETCHERS[type]
  if (!fetcher) {
    return { results: {}, errors: [{ symbol: '', error: `Unknown type "${type}"` }] }
  }

  const parsed = parseSymbols(symbolsParam, MAX_SYMBOLS)
  if (parsed.error) return { results: {}, errors: [{ symbol: '', error: parsed.error }] }

  const months = Math.min(MAX_MONTHS, Math.max(1, Number(monthsParam) || 12))
  const pacing = type === 'tefas' ? 350 : 150

  const results = {}
  const errors = []
  for (const sym of parsed.symbols) {
    try {
      const months_ = await fetcher(sym, months)
      if (Object.keys(months_).length === 0) throw new Error('NO_MONTHS')
      results[sym] = months_
    } catch (err) {
      errors.push({ symbol: sym, error: err.message || 'failed' })
    }
    await new Promise((r) => setTimeout(r, pacing))
  }
  return { results, errors, source: type }
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const data = await handle(
      url.searchParams.get('type') || '',
      url.searchParams.get('symbols') || '',
      url.searchParams.get('months')
    )
    // A month-end close from the past never changes. Cache it hard.
    setCacheHeaders(res, { maxAge: 21600, swr: 86400 })
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' })
  }
}

export { handle as historyHandle }
