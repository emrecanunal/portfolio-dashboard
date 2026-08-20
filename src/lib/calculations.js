// All derived values are computed here from the source-of-truth transactions array.
//
// Everything in this file is covered by calculations.test.js. If you change a
// formula, change the test first — several of these functions produce numbers
// that look plausible when they are wrong, which is the worst failure mode a
// portfolio tracker can have.

import { convertToTRY } from './currency.js'
import { monthKeyOfYmd, priceAtMonth, fxAtMonth } from './history.js'

// === DATES ===
//
// Transaction dates are plain 'YYYY-MM-DD' strings: a calendar day, with no
// time and no timezone. Feeding one to `new Date()` parses it as UTC midnight,
// while `new Date(y, m, d)` builds *local* midnight — three hours apart in
// Turkey. Mixing the two used to push every end-of-month transaction into the
// following month. So: never turn a transaction date into a Date just to
// compare it. Compare the strings, which sort chronologically for free.

/** Local calendar day of a Date, as 'YYYY-MM-DD'. */
export function toYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Today's calendar day in the user's own timezone (not UTC). */
export function todayYmd() {
  return toYmd(new Date())
}

/** Normalise a stored transaction date to a bare 'YYYY-MM-DD'. */
function txYmd(tx) {
  return String(tx?.date || '').slice(0, 10)
}

/** Last calendar day of the month `monthsAgo` months before `ref`, as 'YYYY-MM-DD'. */
function endOfMonthYmd(ref, monthsAgo) {
  // Day 0 of the following month === last day of the target month.
  return toYmd(new Date(ref.getFullYear(), ref.getMonth() - monthsAgo + 1, 0))
}

// === HOLDINGS ===

export function computeHoldings(transactions) {
  const holdings = new Map()
  for (const tx of transactions) {
    if (tx.assetType === 'cash') continue
    const key = `${tx.portfolioId}::${tx.symbol}`
    const h = holdings.get(key) || {
      portfolioId: tx.portfolioId,
      symbol: tx.symbol,
      assetType: tx.assetType,
      currency: tx.currency,
      // Every currency this position was ever traded in. More than one means
      // the `currency` field above cannot be trusted for the whole position —
      // computeDataWarnings turns that into a visible warning.
      currencies: [],
      qty: 0,
      totalCost: 0,
    }
    if (tx.currency && !h.currencies.includes(tx.currency)) h.currencies.push(tx.currency)
    if (tx.type === 'buy') {
      h.qty += tx.quantity
      h.totalCost += tx.quantity * tx.price + (tx.fee || 0)
    } else if (tx.type === 'sell') {
      const avg = h.qty > 0 ? h.totalCost / h.qty : 0
      h.totalCost -= avg * tx.quantity
      h.qty -= tx.quantity
    }
    holdings.set(key, h)
  }
  return [...holdings.values()].filter((h) => h.qty > 0.0001).map((h) => ({
    ...h,
    avgCost: h.qty > 0 ? h.totalCost / h.qty : 0,
  }))
}

// === CASH ===

export function computeCashByPortfolio(transactions, fxRates) {
  const cash = new Map()
  for (const tx of transactions) {
    const tryAmount = convertToTRY(
      (tx.quantity || 1) * (tx.price || 1) + (tx.fee || 0),
      tx.currency,
      fxRates
    )
    const portfolio = tx.portfolioId
    const current = cash.get(portfolio) || 0
    if (tx.type === 'deposit' || (tx.assetType === 'cash' && tx.type === 'buy')) {
      cash.set(
        portfolio,
        current + convertToTRY((tx.quantity || 1) * (tx.price || 0), tx.currency, fxRates)
      )
    } else if (tx.type === 'withdraw') {
      cash.set(portfolio, current - tryAmount)
    } else if (tx.type === 'buy') {
      cash.set(portfolio, current - tryAmount)
    } else if (tx.type === 'sell') {
      const inflow = convertToTRY(tx.quantity * tx.price - (tx.fee || 0), tx.currency, fxRates)
      cash.set(portfolio, current + inflow)
    } else if (tx.type === 'exchange') {
      // FX conversion: outflow in the source currency, inflow in the target.
      // There is no fee term — the conversion cost is carried by the rate the
      // user entered, so charging a fee on top would double-count it. In TRY
      // terms the net is (toAmount in TRY) − (fromAmount in TRY), which is ~0
      // when the entered rate matches the stored fxRates and slightly negative
      // when the broker's rate was worse than the reference rate.
      const out = convertToTRY(tx.quantity || 0, tx.currency, fxRates)
      const inn = convertToTRY(Number(tx.toAmount) || 0, tx.toCurrency || 'USD', fxRates)
      cash.set(portfolio, current + inn - out)
    }
  }
  return cash
}

// Same logic as computeCashByPortfolio but tracks cash separately per currency.
// Returns Map<currency, amountInThatCurrency>, e.g. { TRY: 96475, USD: 3271.99 }.
// Used by the asset-breakdown widget so TRY and USD cash render as separate
// rows. portfolioId=null aggregates across all portfolios.
//
// Exchange transactions (type='exchange') debit the source currency by
// `quantity` and credit the target currency (tx.toCurrency) by `tx.toAmount`.
// This represents an in-portfolio FX conversion at the broker. No fee is
// applied — the spread is already reflected in the rate implied by the two
// amounts the user entered.
export function computeCashByCurrency(transactions, portfolioId = null) {
  const cash = new Map()
  for (const tx of transactions) {
    if (portfolioId && tx.portfolioId !== portfolioId) continue
    const ccy = tx.currency || 'TRY'
    const current = cash.get(ccy) || 0
    const localGross = (tx.quantity || 1) * (tx.price || 1)
    const fee = tx.fee || 0

    if (tx.type === 'deposit' || (tx.assetType === 'cash' && tx.type === 'buy')) {
      cash.set(ccy, current + localGross)
    } else if (tx.type === 'withdraw') {
      cash.set(ccy, current - localGross - fee)
    } else if (tx.type === 'buy') {
      cash.set(ccy, current - localGross - fee)
    } else if (tx.type === 'sell') {
      cash.set(ccy, current + localGross - fee)
    } else if (tx.type === 'exchange') {
      // Debit source currency by the amount converted (in source units)
      cash.set(ccy, current - (tx.quantity || 0))
      // Credit target currency by toAmount
      const toCcy = tx.toCurrency || 'USD'
      const toAmount = Number(tx.toAmount) || 0
      cash.set(toCcy, (cash.get(toCcy) || 0) + toAmount)
    }
  }
  return cash
}

// === VALUATION ===

export function valueHoldings(holdings, priceCache, fxRates) {
  return holdings.map((h) => {
    const cached = priceCache[h.symbol]?.price
    // A position with no cached price falls back to its own average cost so the
    // portfolio total stays in the right ballpark — but `priceKnown: false` says
    // so out loud, because otherwise "we have no data" is indistinguishable from
    // "it happens to be flat at exactly 0.0%".
    const priceKnown = typeof cached === 'number' && isFinite(cached) && cached > 0
    const currentPrice = priceKnown ? cached : h.avgCost
    const marketValueLocal = h.qty * currentPrice
    const costLocal = h.totalCost
    const marketValueTRY = convertToTRY(marketValueLocal, h.currency, fxRates)
    const costTRY = convertToTRY(costLocal, h.currency, fxRates)
    return {
      ...h,
      priceKnown,
      currentPrice,
      marketValueLocal,
      marketValueTRY,
      costTRY,
      plTRY: marketValueTRY - costTRY,
      plPct: costTRY > 0 ? ((marketValueTRY - costTRY) / costTRY) * 100 : 0,
    }
  })
}

export function computePortfolioSummary(transactions, priceCache, fxRates, portfolioId = null) {
  const filtered = portfolioId
    ? transactions.filter((t) => t.portfolioId === portfolioId)
    : transactions

  const holdings = computeHoldings(filtered)
  const valued = valueHoldings(holdings, priceCache, fxRates)
  const cashMap = computeCashByPortfolio(filtered, fxRates)

  const cashRawTotal = portfolioId
    ? cashMap.get(portfolioId) || 0
    : [...cashMap.values()].reduce((a, b) => a + b, 0)

  // Negative cash is not a real position — it means a deposit was never
  // recorded. We still clamp the *displayed* figure to zero so totals stay
  // sane, but the shortfall is reported so the UI can ask the user to fix it
  // instead of quietly overstating their net worth.
  const cashTotal = Math.max(0, cashRawTotal)
  const cashShortfallTRY = cashRawTotal < 0 ? -cashRawTotal : 0

  const investedValue = valued.reduce((sum, h) => sum + h.marketValueTRY, 0)
  const investedCost = valued.reduce((sum, h) => sum + h.costTRY, 0)
  const totalValue = investedValue + cashTotal
  const totalPL = investedValue - investedCost
  const plPct = investedCost > 0 ? (totalPL / investedCost) * 100 : 0

  return {
    totalValue,
    investedValue,
    cashTotal,
    cashRawTotal,
    cashShortfallTRY,
    totalPL,
    plPct,
    holdings: valued,
    cashPct: totalValue > 0 ? (cashTotal / totalValue) * 100 : 0,
  }
}

// === DATA INTEGRITY ===
//
// One place for every "your data says something impossible" check. Each entry
// is { code, ... } with enough context for the UI to render an actionable
// sentence. Codes are stable strings — translations key off them.
export function computeDataWarnings(transactions, priceCache = {}, fxRates = {}) {
  const warnings = []

  // 1. A sub-portfolio whose cash balance went below zero. Almost always a
  //    missing deposit rather than actual margin debt.
  for (const [portfolioId, amountTRY] of computeCashByPortfolio(transactions, fxRates)) {
    if (amountTRY < -0.01) warnings.push({ code: 'negative_cash', portfolioId, amountTRY })
  }

  // 2. Selling more units than were ever held. The position silently
  //    disappears from computeHoldings, taking its cost basis with it.
  const running = new Map()
  const oversold = new Set()
  for (const tx of transactions) {
    if (tx.assetType === 'cash') continue
    const key = `${tx.portfolioId}::${tx.symbol}`
    let qty = running.get(key) || 0
    if (tx.type === 'buy') qty += tx.quantity
    else if (tx.type === 'sell') qty -= tx.quantity
    running.set(key, qty)
    if (qty < -0.0001 && !oversold.has(key)) {
      oversold.add(key)
      warnings.push({ code: 'oversold', portfolioId: tx.portfolioId, symbol: tx.symbol })
    }
  }

  // 3. The same symbol traded in more than one currency. computeHoldings keeps
  //    a single currency per position, so one of the lots is being converted
  //    with the wrong rate.
  const currenciesBySymbol = new Map()
  for (const tx of transactions) {
    if (tx.assetType === 'cash' || !tx.currency) continue
    const set = currenciesBySymbol.get(tx.symbol) || new Set()
    set.add(tx.currency)
    currenciesBySymbol.set(tx.symbol, set)
  }
  for (const [symbol, set] of currenciesBySymbol) {
    if (set.size > 1) {
      warnings.push({ code: 'mixed_currency', symbol, currencies: [...set].sort() })
    }
  }

  // 4. A held position with no usable price. Its P/L reads as exactly 0%,
  //    which looks like data rather than the absence of it.
  const seenMissing = new Set()
  for (const h of computeHoldings(transactions)) {
    const price = priceCache?.[h.symbol]?.price
    const known = typeof price === 'number' && isFinite(price) && price > 0
    if (!known && !seenMissing.has(h.symbol)) {
      seenMissing.add(h.symbol)
      warnings.push({ code: 'missing_price', symbol: h.symbol, assetType: h.assetType })
    }
  }

  return warnings
}

// === ALLOCATION ===

// Donut allocation. Investment buckets (bist/tefas/global) carry their TRY
// market value; cash splits into one bucket per currency (cash_TRY, cash_USD,
// cash_EUR, ...) so the donut and legend can show each cash type separately.
// Pass `cashByCurrency` (Map<ccy, amount>) and `fxRates` to enable the split.
// Without them, cash collapses into the legacy single 'cash' bucket.
export function computeAllocation(summary, cashByCurrency = null, fxRates = null) {
  const { holdings, cashTotal, totalValue } = summary
  const buckets = { bist: 0, tefas: 0, global: 0 }
  for (const h of holdings) {
    if (h.assetType in buckets) buckets[h.assetType] += h.marketValueTRY
  }

  const result = Object.entries(buckets)
    .filter(([_, v]) => v > 0)
    .map(([key, value]) => ({
      key,
      value,
      pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }))

  if (cashByCurrency && fxRates) {
    // One slice per currency, sorted TRY → USD → EUR → others alphabetically.
    const CURRENCY_ORDER = ['TRY', 'USD', 'EUR']
    const ccys = [...cashByCurrency.keys()].sort((a, b) => {
      const ai = CURRENCY_ORDER.indexOf(a)
      const bi = CURRENCY_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    for (const ccy of ccys) {
      const amount = cashByCurrency.get(ccy)
      if (!amount || amount <= 0) continue
      const trEquivalent = convertToTRY(amount, ccy, fxRates)
      result.push({
        key: `cash_${ccy}`,
        currency: ccy,
        nativeValue: amount,
        value: trEquivalent,
        pct: totalValue > 0 ? (trEquivalent / totalValue) * 100 : 0,
      })
    }
  } else if (cashTotal > 0) {
    // Legacy callers (no cashByCurrency) still get the combined bucket.
    result.push({
      key: 'cash',
      value: cashTotal,
      pct: totalValue > 0 ? (cashTotal / totalValue) * 100 : 0,
    })
  }

  return result
}

// Detailed breakdown for the AllocationBreakdown widget.
// For each asset category, returns the bucket totals AND the list of holdings
// inside it (so the UI can expand to show positions).
//
// Daily change is summed across positions using each price-cache entry's
// previousClose. `prevValueTRY` and `dayChangeKnown` are part of the contract:
// the dashboard's "today" KPI aggregates these rows rather than inventing its
// own number, so both sides of the app always agree on what today did.
//
// Cash is split by currency — TRY and USD cash render as separate rows.
// Pass `cashByCurrency` (a Map<ccy, amount>) so the widget can show native
// amounts alongside their TRY equivalents.
export function computeAllocationDetail(summary, priceCache, fxRates, cashByCurrency = null) {
  const { holdings, totalValue } = summary

  const empty = () => ({ value: 0, dayChangeTRY: 0, prevValueTRY: 0, known: 0, holdings: [] })
  const buckets = { bist: empty(), tefas: empty(), global: empty() }

  for (const h of holdings) {
    if (!(h.assetType in buckets)) continue
    const cached = priceCache?.[h.symbol] || {}
    const hasPrevClose = isFinite(cached.previousClose) && cached.previousClose > 0
    const prevPrice = hasPrevClose ? cached.previousClose : h.currentPrice
    const prevValueLocal = h.qty * prevPrice
    const prevValueTRY = convertToTRY(prevValueLocal, h.currency, fxRates)
    const dayChangeTRY = h.marketValueTRY - prevValueTRY

    const bucket = buckets[h.assetType]
    bucket.value += h.marketValueTRY
    bucket.dayChangeTRY += dayChangeTRY
    bucket.prevValueTRY += prevValueTRY
    if (hasPrevClose) bucket.known += 1
    bucket.holdings.push({
      symbol: h.symbol,
      qty: h.qty,
      currency: h.currency,
      currentPrice: h.currentPrice,
      priceKnown: h.priceKnown,
      avgCost: h.avgCost,
      marketValueTRY: h.marketValueTRY,
      costTRY: h.costTRY,
      plTRY: h.plTRY,
      plPct: h.plPct,
      dayChangeTRY,
      dayChangeKnown: hasPrevClose,
      dayChangePct: prevValueTRY > 0 ? (dayChangeTRY / prevValueTRY) * 100 : 0,
    })
  }

  const investmentRows = Object.entries(buckets)
    .filter(([_, v]) => v.value > 0)
    .map(([key, v]) => ({
      key,
      kind: 'investment',
      value: v.value,
      pct: totalValue > 0 ? (v.value / totalValue) * 100 : 0,
      prevValueTRY: v.prevValueTRY,
      dayChangeTRY: v.dayChangeTRY,
      dayChangeKnown: v.known > 0,
      dayChangePct: v.prevValueTRY > 0 ? (v.dayChangeTRY / v.prevValueTRY) * 100 : 0,
      holdings: v.holdings.sort((a, b) => b.marketValueTRY - a.marketValueTRY),
    }))

  // Cash buckets — one row per currency. Native amount carried separately so
  // the widget can show "₺96.475" vs "$3.272" instead of always TRY-equivalent.
  const cashRows = []
  const pushCash = (ccy, amount, trEquivalent) => {
    cashRows.push({
      key: `cash_${ccy}`,
      kind: 'cash',
      currency: ccy,
      nativeValue: amount,
      value: trEquivalent,
      pct: totalValue > 0 ? (trEquivalent / totalValue) * 100 : 0,
      prevValueTRY: trEquivalent,
      dayChangeTRY: 0,
      dayChangeKnown: true,
      dayChangePct: 0,
      holdings: [],
    })
  }
  if (cashByCurrency) {
    for (const [ccy, amount] of cashByCurrency.entries()) {
      if (!amount || amount <= 0) continue
      pushCash(ccy, amount, convertToTRY(amount, ccy, fxRates))
    }
  } else if (summary.cashTotal > 0) {
    // Fallback when caller didn't supply per-currency cash — single TRY line.
    pushCash('TRY', summary.cashTotal, summary.cashTotal)
  }

  return [...investmentRows, ...cashRows]
}

// Aggregate today's move across every investment row produced by
// computeAllocationDetail. Cash is excluded — it does not move on its own.
// `known` is false when not a single position has a previous close, which is
// the difference between "flat today" and "we have no idea".
export function computeDayChange(allocationDetail) {
  let absTRY = 0
  let prevTRY = 0
  let known = false
  for (const row of allocationDetail) {
    if (row.kind === 'cash') continue
    absTRY += row.dayChangeTRY
    prevTRY += row.prevValueTRY
    if (row.dayChangeKnown) known = true
  }
  return {
    absTRY,
    pct: prevTRY > 0 ? (absTRY / prevTRY) * 100 : 0,
    known,
  }
}

// === TIME SERIES ===

// Value the portfolio month by month, using each month's OWN prices and FX
// rates when we have them.
//
// This used to value every past month at today's prices and today's rates, so
// the line could only ever go up — it drew contributions, not performance.
// `options.priceHistory` / `options.fxHistory` (see history.js) fix that.
// Without them the function still works and still returns a line, but every
// point is flagged `estimated` so the chart can say so rather than implying a
// precision it does not have.
//
// months = 0 (or any falsy value) means "All time" — the series spans from the
// earliest transaction's month to the current one, capped at 60 months to keep
// the chart readable.
//
// Each point carries:
//   value        portfolio worth at that month's close, in TRY of that month
//   contributed  cumulative deposits minus withdrawals, each converted at the
//                rate in force when it happened — i.e. the lira you actually
//                parted with. The gap between the two lines IS the growth.
//   estimated    true when any price or rate behind `value` was reconstructed
export function computePerformanceSeries(
  transactions,
  priceCache,
  fxRates,
  months = 6,
  options = {}
) {
  const { priceHistory = null, fxHistory = null } = options
  const now = new Date()

  let effectiveMonths = months
  if (!months || months <= 0) {
    if (transactions.length === 0) {
      effectiveMonths = 6
    } else {
      // 'YYYY-MM-DD' strings sort chronologically, so no Date parsing needed.
      const earliest = transactions.reduce(
        (min, t) => (txYmd(t) < min ? txYmd(t) : min),
        txYmd(transactions[0])
      )
      const [ey, em] = earliest.split('-').map(Number)
      const monthsSpan = (now.getFullYear() - ey) * 12 + (now.getMonth() - (em - 1)) + 1
      effectiveMonths = Math.max(2, Math.min(60, monthsSpan))
    }
  }

  const series = []
  for (let i = effectiveMonths - 1; i >= 0; i--) {
    const cutoffYmd = endOfMonthYmd(now, i)
    const monthKey = monthKeyOfYmd(cutoffYmd)
    const txnsUpTo = transactions.filter((t) => txYmd(t) <= cutoffYmd)

    const isCurrentMonth = i === 0
    const snapshot = valueAtMonth(txnsUpTo, monthKey, {
      priceCache,
      fxRates,
      priceHistory,
      fxHistory,
      // The current month has no close yet, so live prices are the right
      // answer for it, not a reconstruction.
      preferLive: isCurrentMonth,
    })

    const labelDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
    series.push({
      label: labelDate.toLocaleDateString('en-US', {
        month: 'short',
        // For long ranges, include the year so the x-axis is unambiguous
        ...(effectiveMonths > 12 ? { year: '2-digit' } : {}),
      }),
      value: snapshot.totalValue,
      contributed: contributedUpTo(txnsUpTo, fxRates, fxHistory),
      estimated: snapshot.estimated,
      date: cutoffYmd,
    })
  }
  return series
}

// Cumulative net deposits up to a point, each converted at the rate in force
// in the month it happened.
//
// Deliberately NOT converted at today's rate: the question this answers is
// "how much money did I hand over", and for a foreign-currency deposit that is
// the lira it cost at the time. Needs no price history at all, so this line is
// exact from day one even when `value` is still being reconstructed.
function contributedUpTo(txns, fxRates, fxHistory) {
  let total = 0
  for (const tx of txns) {
    if (tx.type !== 'deposit' && tx.type !== 'withdraw') continue
    const rates = fxHistory
      ? fxAtMonth(fxHistory, monthKeyOfYmd(txYmd(tx)), fxRates).value
      : fxRates
    const amount = convertToTRY((tx.quantity || 1) * (tx.price || 0), tx.currency, rates)
    total += tx.type === 'deposit' ? amount : -amount
  }
  return total
}

// Portfolio value at one month's close.
//
// Resolution order for each holding's price:
//   1. that month's archived close            → exact
//   2. the nearest archived month             → estimated
//   3. the live price cache                   → estimated (this is the old
//                                               behaviour, now labelled)
//   4. the position's own average cost        → estimated
export function valueAtMonth(txns, monthKey, opts) {
  const { priceCache = {}, fxRates, priceHistory, fxHistory, preferLive = false } = opts

  const fxHit = fxHistory ? fxAtMonth(fxHistory, monthKey, fxRates) : { value: fxRates, quality: 'missing' }
  const monthRates = preferLive ? fxRates : fxHit.value
  let estimated = preferLive ? false : fxHit.quality !== 'exact'

  const holdings = computeHoldings(txns)
  let investedValue = 0

  for (const h of holdings) {
    let price = null

    if (!preferLive && priceHistory) {
      const hit = priceAtMonth(priceHistory, h.symbol, monthKey)
      if (hit.value != null) {
        price = hit.value
        if (hit.quality !== 'exact') estimated = true
      }
    }

    if (price == null) {
      const live = priceCache?.[h.symbol]?.price
      if (typeof live === 'number' && isFinite(live) && live > 0) {
        price = live
        if (!preferLive) estimated = true
      }
    }

    if (price == null) {
      price = h.qty > 0 ? h.totalCost / h.qty : 0
      estimated = true
    }

    investedValue += convertToTRY(h.qty * price, h.currency, monthRates)
  }

  const cashMap = computeCashByPortfolio(txns, monthRates)
  const cashTotal = [...cashMap.values()].reduce((a, b) => a + b, 0)

  return { totalValue: investedValue + Math.max(0, cashTotal), investedValue, estimated }
}

// === FIRE ===

// "Money I added" for FIRE purposes is deposits minus withdrawals — and nothing
// else. A buy moves cash into an asset and a sell moves it back; both are
// internal transfers that leave net worth untouched, and an `exchange` just
// swaps one currency for another. Counting buys as inflows (as this used to)
// doubled the savings rate *and* pushed the growth figure negative by the same
// amount, so the FIRE ETA was wrong in two directions at once.
function netExternalInflowTRY(transactions, fxRates, afterYmd = null) {
  let net = 0
  for (const tx of transactions) {
    if (afterYmd && txYmd(tx) <= afterYmd) continue
    if (tx.type !== 'deposit' && tx.type !== 'withdraw') continue
    const amount = convertToTRY((tx.quantity || 1) * (tx.price || 0), tx.currency, fxRates)
    if (tx.type === 'deposit') net += amount
    else net -= amount
  }
  return net
}

export function computeFireMetrics(transactions, priceCache, fxRates, lookbackMonths) {
  // FIRE math needs a finite window. When the chart selector is set to "All
  // time" (lookbackMonths=0), fall back to 12 months for these per-month
  // averages — anything longer dilutes the recency signal anyway.
  const effectiveMonths = lookbackMonths && lookbackMonths > 0 ? lookbackMonths : 12

  const series = computePerformanceSeries(transactions, priceCache, fxRates, effectiveMonths + 1)
  if (series.length < 2) {
    return { avgMonthlySavingsTRY: 0, avgMonthlyGrowthPct: 0, annualizedReturn: 0 }
  }

  // Measure contributions over exactly the window the series covers, so that
  // `end − start − netInflow` is a like-for-like subtraction. Anything on or
  // before the opening snapshot is already baked into `start`.
  const windowStartYmd = series[0].date
  const netInflow = netExternalInflowTRY(transactions, fxRates, windowStartYmd)
  const avgMonthlySavingsTRY = netInflow / effectiveMonths

  const start = series[0].value
  const end = series[series.length - 1].value
  const growthAmount = end - start - netInflow
  const avgMonthlyGrowthPct = start > 0 ? ((growthAmount / start) / effectiveMonths) * 100 : 0
  const annualizedReturn = avgMonthlyGrowthPct * 12

  return { avgMonthlySavingsTRY, avgMonthlyGrowthPct, annualizedReturn }
}

// === MONTHLY SAVINGS ===
//
// "Savings" = net cash flow into the portfolio for the calendar month
//   = deposits − withdrawals.
// Buys and sells are internal transfers between cash and assets; they don't
// change net worth. Same definition computeFireMetrics uses — keep them in step.
//
// Returns an array of { year, month (1-12), label, savingsTRY, fireRatio } for
// the last `months` calendar months.
// fireRatio = savingsTRY / monthlyExpensesTRY (months of future freedom bought).
export function computeMonthlySavingsSeries(transactions, fxRates, monthlyExpensesTRY, months = 6) {
  const now = new Date()
  const series = []

  for (let i = months - 1; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = ref.getFullYear()
    const month = ref.getMonth() // 0-indexed
    // Calendar-day bounds as strings — inclusive on both ends, so the 1st and
    // the 31st both land in their own month regardless of timezone.
    const monthStartYmd = toYmd(new Date(year, month, 1))
    const monthEndYmd = toYmd(new Date(year, month + 1, 0))

    const inMonth = transactions.filter((t) => {
      const d = txYmd(t)
      return d >= monthStartYmd && d <= monthEndYmd
    })
    const savings = netExternalInflowTRY(inMonth, fxRates)

    const fireRatio = monthlyExpensesTRY > 0 ? savings / monthlyExpensesTRY : 0

    series.push({
      year,
      month: month + 1,
      label: ref.toLocaleDateString('en-US', { month: 'short' }),
      savingsTRY: savings,
      fireRatio,
    })
  }

  return series
}

// Quick helper: just the current calendar month's savings.
export function computeCurrentMonthSavings(transactions, fxRates) {
  const series = computeMonthlySavingsSeries(transactions, fxRates, 0, 1)
  return series[0]?.savingsTRY || 0
}

export function projectMonthsToFire({ currentValue, targetValue, monthlyContribution, monthlyGrowthRate }) {
  const r = monthlyGrowthRate / 100
  if (currentValue >= targetValue) return 0
  if (monthlyContribution <= 0 && r <= 0) return Infinity
  if (r === 0) return (targetValue - currentValue) / monthlyContribution

  const numerator = targetValue * r + monthlyContribution
  const denominator = currentValue * r + monthlyContribution
  if (numerator <= 0 || denominator <= 0) return Infinity
  const n = Math.log(numerator / denominator) / Math.log(1 + r)
  return n > 0 && isFinite(n) ? n : Infinity
}

export function formatEta(months, t) {
  if (!isFinite(months)) return '∞'
  if (months <= 0) return '0 ' + t.fire.mo
  const yrs = Math.floor(months / 12)
  const mo = Math.round(months % 12)
  if (yrs === 0) return `${mo} ${t.fire.mo}`
  return `${yrs} ${t.fire.yrs} ${mo} ${t.fire.mo}`
}
