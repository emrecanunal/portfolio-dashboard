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

// Month-end closes for a set of symbols of one asset type.
async function fetchPriceHistoryFor(type, symbols, months) {
  if (symbols.length === 0) return { results: {}, errors: [] }
  const url = `/api/history?type=${type}&symbols=${encodeURIComponent(symbols.join(','))}&months=${months}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`History proxy HTTP ${res.status}`)
  const data = await res.json()
  return { results: data.results || {}, errors: data.errors || [] }
}

// Backfill every held symbol, one asset type at a time.
//
// The endpoint caps each request at 12 symbols, so long lists are chunked.
// onProgress(type, done, total) drives the button's label — a backfill can take
// the better part of a minute and a silent button looks broken.
export async function fetchPriceHistory({ holdings, months = 60, onProgress }) {
  const byType = { bist: [], tefas: [], global: [] }
  for (const h of holdings) {
    if (byType[h.assetType]) byType[h.assetType].push(h.symbol)
  }

  const results = {}
  const errors = []
  const sourceStats = {}

  for (const [type, symbols] of Object.entries(byType)) {
    if (symbols.length === 0) continue
    const chunks = []
    for (let i = 0; i < symbols.length; i += 12) chunks.push(symbols.slice(i, i + 12))

    let done = 0
    onProgress?.(type, 0, symbols.length)
    try {
      for (const chunk of chunks) {
        const r = await fetchPriceHistoryFor(type, chunk, months)
        Object.assign(results, r.results)
        errors.push(...r.errors)
        done += chunk.length
        onProgress?.(type, done, symbols.length)
      }
      sourceStats[type] = {
        ok: symbols.filter((s) => results[s]).length,
        failed: symbols.filter((s) => !results[s]).length,
      }
    } catch (err) {
      // A whole type failing (proxy down, source moved) must not abandon the
      // types that already succeeded.
      sourceStats[type] = { ok: 0, failed: symbols.length, error: err.message }
      errors.push(...symbols.map((s) => ({ symbol: s, error: err.message })))
    }
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
