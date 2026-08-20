// Client side of the history backfill.
//
// Two jobs: month-end FX from Frankfurter, and month-end prices from
// /api/history. Both are one-off, deliberate actions triggered from Settings —
// nothing here runs on a timer.

import { monthKeyOfYmd } from './history.js'

const FX_API = 'https://api.frankfurter.dev/v1'

// Frankfurter serves a whole date range in ONE request:
//   /v1/2023-12-01..2026-08-20?base=USD&symbols=TRY,EUR
//   → { rates: { '2023-12-01': { TRY: 28.9, EUR: 0.91 }, ... } }
// Verified against the live API in August 2026: an eight-month range came back
// as 169 daily entries. No key, no rate limit worth worrying about.
//
// Returns { '2023-12': { TRY: 1, USD: 28.99, EUR: 31.8 }, ... } — the same
// "1 unit = X TRY" shape as settings.fxRates, so the two are interchangeable.
export async function fetchFxHistory(fromYmd, toYmd) {
  const url = `${FX_API}/${fromYmd}..${toYmd}?base=USD&symbols=TRY,EUR`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`FX history HTTP ${res.status}`)

  const data = await res.json()
  const daily = data?.rates
  if (!daily || typeof daily !== 'object') throw new Error('FX history returned no rates')

  // Collapse to one entry per month, keeping the latest date in each — the
  // same month-end rule the price archive uses, so the two line up.
  const latestPerMonth = new Map()
  for (const ymd of Object.keys(daily).sort()) {
    latestPerMonth.set(monthKeyOfYmd(ymd), ymd)
  }

  const out = {}
  for (const [monthKey, ymd] of latestPerMonth) {
    const row = daily[ymd]
    const usdToTry = Number(row?.TRY)
    const usdToEur = Number(row?.EUR)
    if (!isFinite(usdToTry) || usdToTry <= 0) continue
    out[monthKey] = {
      TRY: 1,
      USD: usdToTry,
      // Frankfurter quotes EUR per USD; we want TRY per EUR.
      ...(isFinite(usdToEur) && usdToEur > 0 ? { EUR: usdToTry / usdToEur } : {}),
    }
  }
  return out
}

// Month-end closes for one asset type, over one bounded window.
async function fetchWindow(type, symbols, window) {
  if (symbols.length === 0) return { results: {}, errors: [] }
  const url =
    `/api/history?type=${type}&symbols=${encodeURIComponent(symbols.join(','))}` +
    `&from=${window.from}&to=${window.to}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`History proxy HTTP ${res.status}`)
  const data = await res.json()
  return { results: data.results || {}, errors: data.errors || [] }
}

// Split a span of months into windows.
//
// Why windows at all: one İş Yatırım request once took over nine seconds,
// past Vercel's ten-second ceiling. The sweep in probe-history.mjs later
// showed that was TRANSIENT, not a function of width — 1, 3, 6 and 12 months
// all return in 0.3–0.5s. So the width below is set from that measurement,
// and the windowing stays for what it actually buys: a bounded unit of work
// that a slow moment cannot push past the deadline, and a progress bar with
// something real to count.
//
// Re-run `npm run probe:history` before widening these further.
export function buildWindows(months, size, now = new Date()) {
  const windows = []
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  for (let offset = months - 1; offset >= 0; offset -= size) {
    const from = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const toOffset = Math.max(0, offset - size + 1)
    const to = new Date(now.getFullYear(), now.getMonth() - toOffset, 1)
    windows.push({ from: monthKey(from), to: monthKey(to) })
  }
  return windows
}

const WINDOW_MONTHS = {
  bist: 36, // measured: 1→36 months all return in 0.0–0.4s
  global: 24, // Yahoo returns monthly candles, so width is nearly free
  tefas: 60, // one request already spans 60 months; it rate-limits at 6/min
}

// Merge a window's results into the accumulator without losing earlier months.
function absorb(into, incoming) {
  for (const [symbol, months] of Object.entries(incoming)) {
    into[symbol] = { ...into[symbol], ...months }
  }
}

// Monthly closes from Finnhub, called straight from the browser.
//
// Fallback for when Yahoo refuses — which it did throughout the August 2026
// probe, cookie warm-up and both hosts notwithstanding. Finnhub is where the
// live global prices already come from and the key already lives in the
// browser, so this adds no new secret handling and no new server surface.
//
// Finnhub's free tier may answer 403 here: historical candles are a paid
// feature on some plans. That is reported rather than swallowed, because
// "no key", "wrong key" and "your plan excludes this" need different fixes.
export async function fetchFinnhubMonthlyHistory(symbol, months, apiKey) {
  const to = Math.floor(Date.now() / 1000)
  const from = to - months * 31 * 24 * 60 * 60
  const url =
    `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=M&from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`

  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (res.status === 401) throw new Error('FINNHUB_INVALID_KEY')
  if (res.status === 403) throw new Error('FINNHUB_PLAN_EXCLUDES_HISTORY')
  if (res.status === 429) throw new Error('FINNHUB_RATE_LIMIT')
  if (!res.ok) throw new Error(`FINNHUB_HTTP_${res.status}`)

  const data = await res.json()
  if (data?.s !== 'ok' || !Array.isArray(data.c) || !Array.isArray(data.t)) {
    throw new Error('FINNHUB_NO_DATA')
  }

  const out = {}
  data.t.forEach((stamp, i) => {
    const close = Number(data.c[i])
    if (!isFinite(close) || close <= 0) return
    const d = new Date(stamp * 1000)
    out[`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`] = close
  })
  return out
}

// Backfill every held symbol, one asset type at a time, walking the range in
// windows. onProgress(type, done, total) drives the button label — a backfill
// can take a minute and a silent button looks broken.
export async function fetchPriceHistory({ holdings, months = 60, onProgress, finnhubApiKey }) {
  const byType = { bist: [], tefas: [], global: [] }
  for (const h of holdings) {
    if (byType[h.assetType]) byType[h.assetType].push(h.symbol)
  }

  const results = {}
  const errors = []
  const sourceStats = {}

  for (const [type, symbols] of Object.entries(byType)) {
    if (symbols.length === 0) continue

    const windows = buildWindows(months, WINDOW_MONTHS[type] ?? 6)
    const chunks = []
    for (let i = 0; i < symbols.length; i += 12) chunks.push(symbols.slice(i, i + 12))
    const steps = windows.length * chunks.length

    let done = 0
    let failure = null
    onProgress?.(type, 0, steps)

    for (const window of windows) {
      for (const chunk of chunks) {
        try {
          const r = await fetchWindow(type, chunk, window)
          absorb(results, r.results)
          // One window failing for a symbol is normal — it may simply predate
          // the listing. Only report a symbol as failed if it ends up with no
          // months at all, which is checked after every window has run.
          if (r.errors.length) failure = failure || r.errors[0].error
        } catch (err) {
          // A whole window failing (proxy down, source moved) must not abandon
          // the windows and types that would otherwise succeed.
          failure = failure || err.message
        }
        done += 1
        onProgress?.(type, done, steps)
      }
    }

    let got = symbols.filter((s) => results[s] && Object.keys(results[s]).length > 0)
    let missing = symbols.filter((s) => !got.includes(s))

    // Second chance for global symbols Yahoo would not serve.
    if (type === 'global' && missing.length > 0 && finnhubApiKey?.trim()) {
      for (const symbol of missing) {
        try {
          const fromFinnhub = await fetchFinnhubMonthlyHistory(symbol, months, finnhubApiKey)
          if (Object.keys(fromFinnhub).length > 0) {
            absorb(results, { [symbol]: fromFinnhub })
            sourceStats.globalFallback = 'finnhub'
          }
        } catch (err) {
          failure = err.message
        }
        // Finnhub's free tier allows about one call a second.
        await new Promise((r) => setTimeout(r, 1100))
      }
      got = symbols.filter((s) => results[s] && Object.keys(results[s]).length > 0)
      missing = symbols.filter((s) => !got.includes(s))
    }

    sourceStats[type] = {
      ok: got.length,
      failed: missing.length,
      ...(missing.length && failure ? { error: failure } : {}),
    }
    errors.push(...missing.map((s) => ({ symbol: s, error: failure || 'no months returned' })))
  }

  return { results, errors, sourceStats }
}

// Earliest transaction date, as 'YYYY-MM-DD'. Transaction dates are plain
// calendar strings that sort chronologically, so no Date parsing is needed.
export function earliestTransactionYmd(transactions) {
  let earliest = null
  for (const tx of transactions) {
    const ymd = String(tx?.date || '').slice(0, 10)
    if (!ymd) continue
    if (earliest === null || ymd < earliest) earliest = ymd
  }
  return earliest
}

// How many months back the archive needs to reach to cover every transaction,
// capped at the 60 months the sources and the chart both top out at.
export function monthsToCover(transactions, now = new Date()) {
  const earliest = earliestTransactionYmd(transactions)
  if (!earliest) return 12
  const [y, m] = earliest.split('-').map(Number)
  const span = (now.getFullYear() - y) * 12 + (now.getMonth() - (m - 1)) + 1
  return Math.max(1, Math.min(60, span))
}
