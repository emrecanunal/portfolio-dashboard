// Live FX rates service — uses Frankfurter (https://api.frankfurter.dev)
//
// Frankfurter is a free, open-source API backed by the European Central Bank.
// No API key, no signup, daily updates around 16:00 CET.
// Supports TRY since it's in the ECB reference set.
//
// Endpoint: https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR
// Response: { amount, base, date, rates: { TRY: 39.5, EUR: 0.91 } }

const API_BASE = 'https://api.frankfurter.dev/v1'

// Hardcoded staleness thresholds (in milliseconds)
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000 // 12 hours → trigger silent auto-refresh
export const VERY_STALE_AFTER_MS = 24 * 60 * 60 * 1000 // 24 hours → show banner

// Fetches USD-base rates and converts to "1 USD = X TRY" / "1 EUR = X TRY".
// Returns: { USD: 39.5, EUR: 43.1, TRY: 1, fetchedAt: 1714560000000, source: 'frankfurter' }
// Throws on network error so the caller can decide what to do (typically: keep stored rates).
export async function fetchLiveFxRates() {
  const url = `${API_BASE}/latest?base=USD&symbols=TRY,EUR`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    throw new Error(`FX API error: HTTP ${res.status}`)
  }

  const data = await res.json()
  if (!data?.rates?.TRY) {
    throw new Error('FX API returned invalid data (no TRY rate)')
  }

  // Frankfurter returns rates relative to base=USD, e.g. { TRY: 39.5, EUR: 0.91 }
  // Our store wants "1 unit of foreign ccy = X TRY".
  //   USD→TRY = data.rates.TRY            (1 USD = X TRY)
  //   EUR→TRY = data.rates.TRY / data.rates.EUR  (since EUR rate is "1 USD = X EUR", invert)

  const usdToTry = data.rates.TRY
  const eurToUsd = 1 / data.rates.EUR
  const eurToTry = eurToUsd * usdToTry

  return {
    rates: {
      TRY: 1,
      USD: round4(usdToTry),
      // EUR→TRY is a division followed by a multiplication, and binary floats
      // do not divide cleanly: the raw result rendered as "55.628408959034466"
      // in the Settings rate field. Four decimals is well past what any FX
      // quote carries and keeps the field editable by hand.
      EUR: round4(eurToTry),
    },
    fetchedAt: Date.now(),
    apiDate: data.date, // YYYY-MM-DD from Frankfurter (ECB publish date)
    source: 'frankfurter',
  }
}

// Helpers for staleness checks, used by UI

export function getRateAge(fetchedAt) {
  if (!fetchedAt) return Infinity
  return Date.now() - fetchedAt
}

export function isStale(fetchedAt) {
  return getRateAge(fetchedAt) > STALE_AFTER_MS
}

export function isVeryStale(fetchedAt) {
  return getRateAge(fetchedAt) > VERY_STALE_AFTER_MS
}

// Pretty-print "X minutes ago" / "X hours ago" / "X days ago"
export function formatRelativeTime(timestamp, lang = 'en') {
  if (!timestamp) return lang === 'tr' ? 'hiç' : 'never'
  const ageMs = Date.now() - timestamp
  const minutes = Math.floor(ageMs / 60000)
  const hours = Math.floor(ageMs / 3600000)
  const days = Math.floor(ageMs / 86400000)

  if (lang === 'tr') {
    if (minutes < 1) return 'az önce'
    if (minutes < 60) return `${minutes} dk önce`
    if (hours < 24) return `${hours} saat önce`
    return `${days} gün önce`
  }
  // English
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

// FX rates carry at most 4 decimals in practice; anything beyond that is
// floating-point noise from the USD→TRY→EUR conversion chain.
function round4(n) {
  return Math.round(n * 10000) / 10000
}
