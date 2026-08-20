// Month-end price and FX history.
//
// WHY THIS EXISTS
//
// The performance chart used to value every past month with TODAY's prices and
// TODAY's FX rates, because those were the only numbers stored. That produces a
// line that can never slope down on a market fall — it draws "what I paid in",
// not "what it was worth". Cost basis had the same problem: a 2023 dollar
// purchase had its cost converted at the 2026 rate.
//
// So we keep a small archive: one closing price per symbol per month, and one
// FX snapshot per month.
//
// WHY MONTH-END AND NOT DAILY
//
// The chart shows at most 60 points, one per month. Daily resolution would be
// ~30× the storage to draw the identical line. Today's daily change already
// comes from `previousClose` in the live price cache, so nothing else needs it.
// At 30 symbols × 60 months that is ~1800 numbers — a rounding error in a
// 5 MB localStorage budget.
//
// SHAPE
//   priceHistory = { AFA: { '2026-07': 1.2099, '2026-08': 1.2786 }, ... }
//   fxHistory    = { '2026-07': { TRY: 1, USD: 47.1, EUR: 55.0 }, ... }
//
// Prices are in the symbol's own currency. FX is "1 unit = X TRY", matching
// settings.fxRates, so the two are interchangeable at the call site.

/** 'YYYY-MM' for a stored transaction date string. */
export function monthKeyOfYmd(ymd) {
  return String(ymd || '').slice(0, 7)
}

/** 'YYYY-MM' for a Date, in local time (never UTC — see calculations.js). */
export function monthKeyOfDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** This calendar month, locally. */
export function currentMonthKey() {
  return monthKeyOfDate(new Date())
}

/** Every 'YYYY-MM' from `from` to `to` inclusive. Empty if `from` is later. */
export function monthKeysBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  const keys = []
  let y = fy
  let m = fm
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return keys
}

// Look up a month in an archive, saying honestly how good the answer is.
//
// `exact`   — we have a close for that very month
// `near`    — we carried the nearest known month forward (or back, before our
//             archive starts); directionally right, precisely wrong
// `missing` — the archive has nothing for this symbol at all
//
// Carrying a neighbouring month is far better than substituting today's value,
// which is what the old code did — but the caller must be able to tell the two
// apart so the chart can mark those points as reconstructed rather than drawing
// them as confidently as the rest.
export function lookupMonth(archive, key) {
  if (!archive) return { value: null, quality: 'missing' }
  if (Object.prototype.hasOwnProperty.call(archive, key)) {
    const exact = archive[key]
    if (exact != null) return { value: exact, quality: 'exact' }
  }

  const keys = Object.keys(archive).sort()
  if (keys.length === 0) return { value: null, quality: 'missing' }

  let earlier = null
  let later = null
  for (const k of keys) {
    if (k < key) earlier = k
    else if (k > key && later === null) later = k
  }

  // Prefer carrying forward: a price from before the month in question at least
  // existed before it. Reaching backwards from the future is a last resort.
  const chosen = earlier ?? later
  if (chosen == null) return { value: null, quality: 'missing' }
  return { value: archive[chosen], quality: 'near' }
}

/** Price of `symbol` at month `key`, from the archive. */
export function priceAtMonth(priceHistory, symbol, key) {
  return lookupMonth(priceHistory?.[symbol], key)
}

/** FX rates at month `key`. Falls back to `fallbackRates` when unknown. */
export function fxAtMonth(fxHistory, key, fallbackRates) {
  const hit = lookupMonth(fxHistory, key)
  if (hit.quality === 'missing' || !hit.value) {
    return { value: fallbackRates, quality: 'missing' }
  }
  return hit
}

// Write one month's closing values into the archive, returning a NEW object
// (the store persists by reference identity).
//
// Repeated writes within the same month simply overwrite, so the last refresh
// before the month rolls over becomes that month's close. That is what we want
// and it is self-correcting: no bookkeeping, no cron, no "did we capture it?".
export function recordPriceSnapshot(priceHistory, priceCache, key = currentMonthKey()) {
  const next = { ...priceHistory }
  let changed = false
  for (const [symbol, entry] of Object.entries(priceCache || {})) {
    const price = entry?.price
    if (typeof price !== 'number' || !isFinite(price) || price <= 0) continue
    // Manually typed prices are still the user's best knowledge of that month,
    // so they are archived too — but only when nothing else filled the slot.
    if (entry.source === 'manual' && next[symbol]?.[key] != null) continue
    next[symbol] = { ...next[symbol], [key]: price }
    changed = true
  }
  return changed ? next : priceHistory
}

export function recordFxSnapshot(fxHistory, fxRates, key = currentMonthKey()) {
  if (!fxRates) return fxHistory
  return { ...fxHistory, [key]: { ...fxRates } }
}

// Merge backfilled months in WITHOUT clobbering anything already recorded.
// Snapshots are first-hand observations; a backfill is a reconstruction from a
// third party, so where they disagree the snapshot wins.
export function mergeBackfill(existing, incoming) {
  const next = { ...existing }
  for (const [symbol, months] of Object.entries(incoming || {})) {
    const merged = { ...months, ...next[symbol] }
    next[symbol] = merged
  }
  return next
}

export function mergeFxBackfill(existing, incoming) {
  const next = { ...(existing || {}) }
  for (const [key, rates] of Object.entries(incoming || {})) {
    if (next[key]) continue
    next[key] = rates
  }
  return next
}

// How much history we actually hold — used by the Settings UI.
//
// Pass `heldSymbols` (what the portfolio owns today) to get `missing`: the
// symbols with NO archived month at all. Without it this function can only
// count what is present, and a symbol whose source refused us entirely — as
// Yahoo does for global equities — is invisible. "36 months across 3 symbols"
// while a fourth has nothing is not a true summary, and the chart it describes
// is estimated for every single month because of that fourth symbol.
export function historyCoverage(priceHistory, fxHistory, heldSymbols = null) {
  const symbols = Object.keys(priceHistory || {})
  const monthCounts = symbols.map((s) => Object.keys(priceHistory[s] || {}).length)
  const allMonths = new Set()
  for (const s of symbols) for (const k of Object.keys(priceHistory[s] || {})) allMonths.add(k)
  const sorted = [...allMonths].sort()

  const missing = heldSymbols
    ? [...new Set(heldSymbols)]
        .filter((s) => Object.keys(priceHistory?.[s] || {}).length === 0)
        .sort()
    : []

  return {
    symbols: symbols.length,
    months: sorted.length,
    earliest: sorted[0] || null,
    latest: sorted[sorted.length - 1] || null,
    fxMonths: Object.keys(fxHistory || {}).length,
    thinnest: monthCounts.length ? Math.min(...monthCounts) : 0,
    missing,
    // True when every held symbol has at least one archived month. Only then
    // can the chart be exact rather than estimated.
    complete: heldSymbols ? missing.length === 0 && symbols.length > 0 : null,
  }
}
