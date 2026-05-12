// All derived values are computed here from the source-of-truth transactions array.

import { convertToTRY } from './currency.js'

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
      qty: 0,
      totalCost: 0,
    }
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
    if (tx.type === 'deposit' || tx.assetType === 'cash' && tx.type === 'buy') {
      cash.set(portfolio, current + convertToTRY(tx.amountTRY || tx.quantity * tx.price, tx.currency, fxRates))
    } else if (tx.type === 'withdraw') {
      cash.set(portfolio, current - tryAmount)
    } else if (tx.type === 'buy') {
      cash.set(portfolio, current - tryAmount)
    } else if (tx.type === 'sell') {
      const inflow = convertToTRY(tx.quantity * tx.price - (tx.fee || 0), tx.currency, fxRates)
      cash.set(portfolio, current + inflow)
    }
  }
  return cash
}

export function valueHoldings(holdings, priceCache, fxRates) {
  return holdings.map((h) => {
    const currentPrice = priceCache[h.symbol]?.price ?? h.avgCost
    const marketValueLocal = h.qty * currentPrice
    const costLocal = h.totalCost
    const marketValueTRY = convertToTRY(marketValueLocal, h.currency, fxRates)
    const costTRY = convertToTRY(costLocal, h.currency, fxRates)
    return {
      ...h,
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

  const cashTotal = portfolioId
    ? cashMap.get(portfolioId) || 0
    : [...cashMap.values()].reduce((a, b) => a + b, 0)

  const investedValue = valued.reduce((sum, h) => sum + h.marketValueTRY, 0)
  const investedCost = valued.reduce((sum, h) => sum + h.costTRY, 0)
  const totalValue = investedValue + Math.max(0, cashTotal)
  const totalPL = investedValue - investedCost
  const plPct = investedCost > 0 ? (totalPL / investedCost) * 100 : 0

  return {
    totalValue,
    investedValue,
    cashTotal: Math.max(0, cashTotal),
    totalPL,
    plPct,
    holdings: valued,
    cashPct: totalValue > 0 ? (Math.max(0, cashTotal) / totalValue) * 100 : 0,
  }
}

export function computeAllocation(summary) {
  const { holdings, cashTotal, totalValue } = summary
  const buckets = { bist: 0, tefas: 0, global: 0, cash: cashTotal }
  for (const h of holdings) {
    if (h.assetType in buckets) buckets[h.assetType] += h.marketValueTRY
  }
  return Object.entries(buckets)
    .filter(([_, v]) => v > 0)
    .map(([key, value]) => ({
      key,
      value,
      pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }))
}

export function computePerformanceSeries(transactions, priceCache, fxRates, months = 6) {
  const now = new Date()
  const series = []
  for (let i = months - 1; i >= 0; i--) {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
    const txnsUpTo = transactions.filter((t) => new Date(t.date) <= cutoff)
    const summary = computePortfolioSummaryAt(txnsUpTo, priceCache, fxRates)
    series.push({
      label: cutoff.toLocaleDateString('en-US', { month: 'short' }),
      value: summary.totalValue,
      date: cutoff.toISOString().slice(0, 10),
    })
  }
  return series
}

function computePortfolioSummaryAt(txns, priceCache, fxRates) {
  const holdings = computeHoldings(txns)
  const valued = valueHoldings(holdings, priceCache, fxRates)
  const cashMap = computeCashByPortfolio(txns, fxRates)
  const cashTotal = [...cashMap.values()].reduce((a, b) => a + b, 0)
  const investedValue = valued.reduce((sum, h) => sum + h.marketValueTRY, 0)
  return { totalValue: investedValue + Math.max(0, cashTotal) }
}

export function computeFireMetrics(transactions, priceCache, fxRates, lookbackMonths) {
  const now = new Date()
  const cutoffPast = new Date(now.getFullYear(), now.getMonth() - lookbackMonths, now.getDate())

  const series = computePerformanceSeries(transactions, priceCache, fxRates, lookbackMonths + 1)
  if (series.length < 2) {
    return { avgMonthlySavingsTRY: 0, avgMonthlyGrowthPct: 0, annualizedReturn: 0 }
  }

  const inWindow = transactions.filter((t) => new Date(t.date) >= cutoffPast)
  let netInflow = 0
  for (const tx of inWindow) {
    const amt = convertToTRY((tx.quantity || 0) * (tx.price || 0) + (tx.fee || 0), tx.currency, fxRates)
    if (tx.type === 'buy' || tx.type === 'deposit') netInflow += amt
    if (tx.type === 'sell' || tx.type === 'withdraw') netInflow -= amt
  }
  const avgMonthlySavingsTRY = netInflow / lookbackMonths

  const start = series[0].value
  const end = series[series.length - 1].value
  const growthAmount = end - start - netInflow
  const avgMonthlyGrowthPct =
    start > 0 ? ((growthAmount / start) / lookbackMonths) * 100 : 0
  const annualizedReturn = avgMonthlyGrowthPct * 12

  return { avgMonthlySavingsTRY, avgMonthlyGrowthPct, annualizedReturn }
}

// === MONTHLY SAVINGS ===
//
// "Savings" = net cash flow into the portfolio for the calendar month.
//   = SUM(deposits + buy outflows from external cash) − SUM(withdrawals + sell inflows out)
//
// Practical interpretation: deposits − withdrawals during the month.
// (Buys/sells are internal transfers between cash and assets; they don't change net worth.)
//
// Returns an array of { year, month (1-12), label, savingsTRY, fireRatio } for the last `months` calendar months.
// fireRatio = savingsTRY / monthlyExpensesTRY (months of future freedom bought).

export function computeMonthlySavingsSeries(transactions, fxRates, monthlyExpensesTRY, months = 6) {
  const now = new Date()
  const series = []

  for (let i = months - 1; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = ref.getFullYear()
    const month = ref.getMonth() // 0-indexed
    const monthStart = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59) // last day of month

    let savings = 0
    for (const tx of transactions) {
      const txDate = new Date(tx.date)
      if (txDate < monthStart || txDate > monthEnd) continue
      const amountLocal = (tx.quantity || 1) * (tx.price || 0)
      const amountTRY = convertToTRY(amountLocal, tx.currency, fxRates)
      if (tx.type === 'deposit') savings += amountTRY
      if (tx.type === 'withdraw') savings -= amountTRY
    }

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
