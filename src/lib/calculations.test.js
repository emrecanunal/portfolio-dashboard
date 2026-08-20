// Regression tests for the money math.
//
// Every test here corresponds to a bug that was found by hand in August 2026.
// If one of these goes red, a number somewhere in the UI is lying to the user —
// treat it as a release blocker, not a flaky test.
//
// Timezone note: transaction dates are plain 'YYYY-MM-DD' strings with no time
// and no zone. `new Date('2026-07-31')` parses that as UTC midnight, while
// `new Date(2026, 6, 31)` is *local* midnight — in UTC+3 the two are 3 hours
// apart, which used to silently drop end-of-month transactions. These tests are
// written to pass in ANY timezone; run `npm run test:tz` to prove it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  computeHoldings,
  computeCashByPortfolio,
  computeCashByCurrency,
  valueHoldings,
  computePortfolioSummary,
  computeAllocationDetail,
  computePerformanceSeries,
  computeMonthlySavingsSeries,
  computeFireMetrics,
  computeDataWarnings,
  valueAtMonth,
  projectMonthsToFire,
} from './calculations.js'
import { computeStageTargets, computeJourneyPosition } from './fireStages.js'

const FX = { TRY: 1, USD: 40, EUR: 45 }
const P1 = 'p1'
const P2 = 'p2'

// 20 Aug 2026, 09:00 UTC — same calendar day in every timezone from UTC-9 to UTC+14.
const NOW = new Date('2026-08-20T09:00:00Z')

function tx(overrides) {
  return {
    id: Math.random().toString(36).slice(2),
    date: '2026-07-15',
    type: 'buy',
    assetType: 'bist',
    symbol: 'THYAO',
    quantity: 1,
    price: 100,
    fee: 0,
    currency: 'TRY',
    portfolioId: P1,
    notes: '',
    ...overrides,
  }
}

const deposit = (o = {}) =>
  tx({ type: 'deposit', assetType: 'cash', symbol: 'CASH', quantity: 1, price: 100000, ...o })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

describe('computeHoldings', () => {
  it('accumulates quantity and cost, including fees, on buys', () => {
    const h = computeHoldings([
      tx({ quantity: 10, price: 100, fee: 50 }),
      tx({ quantity: 10, price: 200, fee: 50 }),
    ])
    expect(h).toHaveLength(1)
    expect(h[0].qty).toBe(20)
    expect(h[0].totalCost).toBe(10 * 100 + 50 + 10 * 200 + 50)
    expect(h[0].avgCost).toBeCloseTo(3100 / 20, 6)
  })

  it('removes cost at average on a partial sell, leaving avgCost unchanged', () => {
    const h = computeHoldings([
      tx({ quantity: 10, price: 100 }),
      tx({ quantity: 10, price: 200 }),
      tx({ type: 'sell', quantity: 5, price: 500 }),
    ])
    expect(h[0].qty).toBe(15)
    expect(h[0].avgCost).toBeCloseTo(150, 6) // sale price must not move the basis
  })

  it('keeps positions in different sub-portfolios separate', () => {
    const h = computeHoldings([
      tx({ quantity: 10, portfolioId: P1 }),
      tx({ quantity: 4, portfolioId: P2 }),
    ])
    expect(h).toHaveLength(2)
    expect(h.map((x) => x.qty).sort((a, b) => a - b)).toEqual([4, 10])
  })

  it('ignores cash-class transactions', () => {
    expect(computeHoldings([deposit(), tx({ type: 'withdraw', assetType: 'cash' })])).toEqual([])
  })

  it('reports every currency a position was traded in', () => {
    // BUG 1.6: currency was taken from the first transaction and never checked
    // again, so a EUR lot was silently valued as USD.
    const h = computeHoldings([
      tx({ symbol: 'AAPL', assetType: 'global', quantity: 1, price: 200, currency: 'USD' }),
      tx({ symbol: 'AAPL', assetType: 'global', quantity: 1, price: 190, currency: 'EUR' }),
    ])
    expect(h[0].currencies.sort()).toEqual(['EUR', 'USD'])
  })
})

describe('computeDataWarnings', () => {
  it('flags selling more than is held', () => {
    // BUG 1.7: the position simply vanished from the holdings list, silently.
    const warnings = computeDataWarnings(
      [tx({ quantity: 10, price: 100 }), tx({ type: 'sell', quantity: 25, price: 120 })],
      {},
      FX
    )
    const oversold = warnings.filter((w) => w.code === 'oversold')
    expect(oversold).toHaveLength(1)
    expect(oversold[0].symbol).toBe('THYAO')
  })

  it('does not flag a clean full exit', () => {
    const warnings = computeDataWarnings(
      [tx({ quantity: 10, price: 100 }), tx({ type: 'sell', quantity: 10, price: 120 })],
      {},
      FX
    )
    expect(warnings.filter((w) => w.code === 'oversold')).toHaveLength(0)
  })

  it('flags a portfolio whose cash went negative', () => {
    // BUG 1.5: Math.max(0, cash) hid the fact that a deposit was never recorded.
    const warnings = computeDataWarnings([tx({ quantity: 100, price: 1000 })], {}, FX)
    const neg = warnings.filter((w) => w.code === 'negative_cash')
    expect(neg).toHaveLength(1)
    expect(neg[0].amountTRY).toBeCloseTo(-100000, 6)
  })

  it('does not flag negative cash when deposits cover the purchases', () => {
    const warnings = computeDataWarnings(
      [deposit({ price: 200000 }), tx({ quantity: 100, price: 1000 })],
      {},
      FX
    )
    expect(warnings.filter((w) => w.code === 'negative_cash')).toHaveLength(0)
  })

  it('flags a symbol traded in more than one currency', () => {
    const warnings = computeDataWarnings(
      [
        tx({ symbol: 'AAPL', assetType: 'global', currency: 'USD' }),
        tx({ symbol: 'AAPL', assetType: 'global', currency: 'EUR' }),
      ],
      {},
      FX
    )
    expect(warnings.filter((w) => w.code === 'mixed_currency')).toHaveLength(1)
  })

  it('flags held positions with no price in the cache', () => {
    // BUG 1.9: these fell back to avgCost, so "no data" looked like "exactly 0% P/L".
    const warnings = computeDataWarnings([deposit(), tx({ quantity: 10 })], {}, FX)
    const missing = warnings.filter((w) => w.code === 'missing_price')
    expect(missing).toHaveLength(1)
    expect(missing[0].symbol).toBe('THYAO')
  })

  it('is silent on a clean portfolio', () => {
    const warnings = computeDataWarnings(
      [deposit(), tx({ quantity: 10, price: 100 })],
      { THYAO: { price: 120, currency: 'TRY' } },
      FX
    )
    expect(warnings).toEqual([])
  })
})

describe('cash tracking', () => {
  it('converts a foreign-currency deposit into TRY exactly once', () => {
    const cash = computeCashByPortfolio([deposit({ price: 1000, currency: 'USD' })], FX)
    expect(cash.get(P1)).toBeCloseTo(40000, 6)
  })

  it('debits a buy including its fee and credits a sell net of its fee', () => {
    const cash = computeCashByPortfolio(
      [
        deposit({ price: 100000 }),
        tx({ quantity: 10, price: 1000, fee: 500 }),
        tx({ type: 'sell', quantity: 5, price: 1200, fee: 300 }),
      ],
      FX
    )
    expect(cash.get(P1)).toBeCloseTo(100000 - 10500 + 5700, 6)
  })

  it('agrees with the per-currency breakdown for single-currency portfolios', () => {
    const txns = [
      deposit({ price: 100000 }),
      tx({ quantity: 10, price: 1000, fee: 500 }),
      tx({ type: 'sell', quantity: 5, price: 1200, fee: 300 }),
    ]
    const byPortfolio = computeCashByPortfolio(txns, FX)
    const byCurrency = computeCashByCurrency(txns)
    expect(byCurrency.get('TRY')).toBeCloseTo(byPortfolio.get(P1), 6)
  })

  it('moves an exchange between currencies without creating or destroying value', () => {
    const txns = [
      deposit({ price: 100000, currency: 'TRY' }),
      tx({
        type: 'exchange',
        assetType: 'cash',
        symbol: 'TRY→USD',
        quantity: 40000,
        price: 1,
        currency: 'TRY',
        toAmount: 1000,
        toCurrency: 'USD',
      }),
    ]
    const byCurrency = computeCashByCurrency(txns)
    expect(byCurrency.get('TRY')).toBeCloseTo(60000, 6)
    expect(byCurrency.get('USD')).toBeCloseTo(1000, 6)
    // At the reference rate the conversion is value-neutral in TRY terms.
    expect(computeCashByPortfolio(txns, FX).get(P1)).toBeCloseTo(100000, 6)
  })
})

describe('computePortfolioSummary', () => {
  it('surfaces a cash shortfall instead of silently clamping it to zero', () => {
    const s = computePortfolioSummary([tx({ quantity: 100, price: 1000 })], {}, FX)
    expect(s.cashRawTotal).toBeCloseTo(-100000, 6)
    expect(s.cashShortfallTRY).toBeCloseTo(100000, 6)
    expect(s.cashTotal).toBe(0) // display value stays clamped
  })

  it('marks holdings whose price is unknown', () => {
    const valued = valueHoldings(computeHoldings([tx({ quantity: 10, price: 100 })]), {}, FX)
    expect(valued[0].priceKnown).toBe(false)
    expect(valued[0].currentPrice).toBe(valued[0].avgCost)

    const priced = valueHoldings(
      computeHoldings([tx({ quantity: 10, price: 100 })]),
      { THYAO: { price: 150, currency: 'TRY' } },
      FX
    )
    expect(priced[0].priceKnown).toBe(true)
    expect(priced[0].marketValueTRY).toBeCloseTo(1500, 6)
  })

  it('scopes to a single sub-portfolio when asked', () => {
    const txns = [
      deposit({ portfolioId: P1, price: 50000 }),
      deposit({ portfolioId: P2, price: 30000 }),
    ]
    expect(computePortfolioSummary(txns, {}, FX, P1).totalValue).toBeCloseTo(50000, 6)
    expect(computePortfolioSummary(txns, {}, FX).totalValue).toBeCloseTo(80000, 6)
  })
})

describe('computeAllocationDetail', () => {
  it('exposes the previous-close base so the caller can aggregate a real day change', () => {
    // BUG 1.4: the dashboard KPI faked "today" as (monthly delta / 30) because
    // this function kept prevValueTRY private.
    const txns = [deposit({ price: 1000000 }), tx({ quantity: 100, price: 100 })]
    const cache = { THYAO: { price: 110, previousClose: 100, currency: 'TRY' } }
    const summary = computePortfolioSummary(txns, cache, FX)
    const rows = computeAllocationDetail(summary, cache, FX, computeCashByCurrency(txns))

    const bist = rows.find((r) => r.key === 'bist')
    expect(bist.prevValueTRY).toBeCloseTo(10000, 6)
    expect(bist.dayChangeTRY).toBeCloseTo(1000, 6)
    expect(bist.dayChangePct).toBeCloseTo(10, 6)
    expect(bist.dayChangeKnown).toBe(true)
  })

  it('reports dayChangeKnown=false when no position has a previous close', () => {
    const txns = [deposit({ price: 1000000 }), tx({ quantity: 100, price: 100 })]
    const cache = { THYAO: { price: 110, currency: 'TRY' } }
    const summary = computePortfolioSummary(txns, cache, FX)
    const rows = computeAllocationDetail(summary, cache, FX, computeCashByCurrency(txns))
    expect(rows.find((r) => r.key === 'bist').dayChangeKnown).toBe(false)
  })
})

describe('computePerformanceSeries', () => {
  it('includes a transaction dated on the last day of a month in that month', () => {
    // BUG 1.2: the cutoff was local midnight while the date parsed as UTC
    // midnight, so every end-of-month entry fell into the following month.
    const lastDay = computePerformanceSeries([deposit({ date: '2026-07-31' })], {}, FX, 3)
    const midMonth = computePerformanceSeries([deposit({ date: '2026-07-15' })], {}, FX, 3)
    expect(lastDay.map((p) => p.value)).toEqual(midMonth.map((p) => p.value))
    expect(lastDay[1].value).toBeCloseTo(100000, 6)
  })

  it('includes a transaction dated on the first day of a month in that month', () => {
    const s = computePerformanceSeries([deposit({ date: '2026-07-01' })], {}, FX, 3)
    expect(s[1].value).toBeCloseTo(100000, 6)
  })

  it('excludes transactions dated after the cutoff month', () => {
    const s = computePerformanceSeries([deposit({ date: '2026-08-01' })], {}, FX, 3)
    expect(s[0].value).toBe(0)
    expect(s[1].value).toBe(0)
    expect(s[2].value).toBeCloseTo(100000, 6)
  })

  it('spans from the earliest transaction when months = 0 (all time)', () => {
    const s = computePerformanceSeries([deposit({ date: '2026-03-10' })], {}, FX, 0)
    expect(s).toHaveLength(6) // Mar, Apr, May, Jun, Jul, Aug
    expect(s[0].value).toBeCloseTo(100000, 6)
  })

  it('returns the requested number of points', () => {
    expect(computePerformanceSeries([deposit()], {}, FX, 6)).toHaveLength(6)
    expect(computePerformanceSeries([deposit()], {}, FX, 12)).toHaveLength(12)
  })
})

describe('computeMonthlySavingsSeries', () => {
  it('counts deposits on the first and last day of a month', () => {
    const s = computeMonthlySavingsSeries(
      [deposit({ date: '2026-07-01', price: 10000 }), deposit({ date: '2026-07-31', price: 5000 })],
      FX,
      50000,
      3
    )
    const july = s[1]
    expect(july.savingsTRY).toBeCloseTo(15000, 6)
  })

  it('nets withdrawals against deposits and ignores buys', () => {
    const s = computeMonthlySavingsSeries(
      [
        deposit({ date: '2026-07-10', price: 30000 }),
        tx({ date: '2026-07-11', type: 'withdraw', assetType: 'cash', quantity: 1, price: 10000 }),
        tx({ date: '2026-07-12', quantity: 10, price: 1000 }), // buy — internal transfer
      ],
      FX,
      20000,
      3
    )
    expect(s[1].savingsTRY).toBeCloseTo(20000, 6)
    expect(s[1].fireRatio).toBeCloseTo(1, 6)
  })
})

describe('computeFireMetrics', () => {
  it('counts money that entered the portfolio once, not twice', () => {
    // BUG 1.3: `buy` was treated as an inflow alongside `deposit`, so depositing
    // 100k and then investing it registered as 200k of savings.
    const m = computeFireMetrics(
      [
        deposit({ date: '2026-07-15', price: 100000 }),
        tx({ date: '2026-07-16', quantity: 100, price: 1000 }),
      ],
      { THYAO: { price: 1000, currency: 'TRY' } },
      FX,
      6
    )
    expect(m.avgMonthlySavingsTRY * 6).toBeCloseTo(100000, 6)
  })

  it('treats a withdrawal as negative savings', () => {
    const m = computeFireMetrics(
      [
        deposit({ date: '2026-06-15', price: 120000 }),
        tx({ date: '2026-07-15', type: 'withdraw', assetType: 'cash', quantity: 1, price: 60000 }),
      ],
      {},
      FX,
      6
    )
    expect(m.avgMonthlySavingsTRY * 6).toBeCloseTo(60000, 6)
  })

  it('ignores an internal FX conversion', () => {
    const m = computeFireMetrics(
      [
        deposit({ date: '2026-07-01', price: 100000 }),
        tx({
          date: '2026-07-02',
          type: 'exchange',
          assetType: 'cash',
          symbol: 'TRY→USD',
          quantity: 40000,
          price: 1,
          toAmount: 1000,
          toCurrency: 'USD',
        }),
      ],
      {},
      FX,
      6
    )
    expect(m.avgMonthlySavingsTRY * 6).toBeCloseTo(100000, 6)
  })

  it('attributes value change above contributions to growth', () => {
    // Deposit 100k six months ago, buy at 100, price doubles to 200.
    const m = computeFireMetrics(
      [
        deposit({ date: '2026-02-10', price: 100000 }),
        tx({ date: '2026-02-11', quantity: 1000, price: 100 }),
      ],
      { THYAO: { price: 200, currency: 'TRY' } },
      FX,
      6
    )
    expect(m.avgMonthlySavingsTRY).toBeCloseTo(0, 6) // nothing added inside the window
    expect(m.avgMonthlyGrowthPct).toBeCloseTo(0, 6) // and nothing changed inside it either
  })
})

describe('FIRE stage targets', () => {
  it('reproduces the classic 25x ladder at a 4% withdrawal rate', () => {
    const targets = computeStageTargets(1000, 0.04)
    const by = Object.fromEntries(targets.map((s) => [s.id, s.targetUSD]))
    expect(by.coast).toBeCloseTo(12000 * 7, 6)
    expect(by.barista).toBeCloseTo(12000 * 12.5, 6)
    expect(by.lean).toBeCloseTo(12000 * 25, 6)
    expect(by.regular).toBeCloseTo(12000 * 50, 6)
    expect(by.fat).toBeCloseTo(12000 * 100, 6)
  })

  it('moves every target when the withdrawal rate changes', () => {
    // BUG 1.8: the selector was cosmetic — multipliers were hardcoded to 25.
    const at3 = computeStageTargets(1000, 0.03)
    const at5 = computeStageTargets(1000, 0.05)
    expect(at3.find((s) => s.id === 'lean').targetUSD).toBeCloseTo(12000 / 0.03, 6)
    expect(at5.find((s) => s.id === 'lean').targetUSD).toBeCloseTo(12000 / 0.05, 6)
    expect(at3.find((s) => s.id === 'lean').targetUSD).toBeGreaterThan(
      at5.find((s) => s.id === 'lean').targetUSD
    )
  })

  it('defaults to 4% when no rate is supplied', () => {
    expect(computeStageTargets(1000).map((s) => s.targetUSD)).toEqual(
      computeStageTargets(1000, 0.04).map((s) => s.targetUSD)
    )
  })

  it('positions the journey bar using the same rate', () => {
    const j = computeJourneyPosition({
      currentValueUSD: 12000 / 0.03,
      monthlyExpensesUSD: 1000,
      activeStageId: 'lean',
      withdrawalRate: 0.03,
    })
    expect(j.lastReachedIndex).toBe(2) // exactly at Lean
    expect(j.percentToActive).toBeCloseTo(100, 6)
  })
})

describe('projectMonthsToFire', () => {
  it('returns 0 when the target is already met', () => {
    expect(
      projectMonthsToFire({
        currentValue: 100,
        targetValue: 50,
        monthlyContribution: 10,
        monthlyGrowthRate: 1,
      })
    ).toBe(0)
  })

  it('divides evenly when there is no growth', () => {
    expect(
      projectMonthsToFire({
        currentValue: 0,
        targetValue: 1200,
        monthlyContribution: 100,
        monthlyGrowthRate: 0,
      })
    ).toBeCloseTo(12, 6)
  })

  it('is infinite when nothing is being added and nothing grows', () => {
    expect(
      projectMonthsToFire({
        currentValue: 100,
        targetValue: 1000,
        monthlyContribution: 0,
        monthlyGrowthRate: 0,
      })
    ).toBe(Infinity)
  })
})

describe('computePerformanceSeries with stored history', () => {
  // The whole point of the archive: before it existed, every past month was
  // valued at TODAY's price, so the line could only ever slope up. These tests
  // exist to make sure it can slope down again.

  const buy = (date, qty, price) =>
    tx({ date, quantity: qty, price, symbol: 'THYAO', assetType: 'bist' })

  it('values each month at that month\'s own price', () => {
    const txns = [deposit({ date: '2026-05-01', price: 100000 }), buy('2026-05-02', 100, 100)]
    const priceHistory = {
      THYAO: { '2026-05': 100, '2026-06': 150, '2026-07': 120, '2026-08': 130 },
    }
    const series = computePerformanceSeries(
      txns,
      { THYAO: { price: 130, currency: 'TRY' } },
      FX,
      4,
      { priceHistory, fxHistory: {} }
    )
    // 90.000 cash left after the buy, plus 100 shares at each month's close.
    expect(series.map((p) => p.value)).toEqual([
      90000 + 100 * 100,
      90000 + 100 * 150,
      90000 + 100 * 120,
      90000 + 100 * 130,
    ])
  })

  it('slopes DOWN when the market fell — the bug this whole feature exists for', () => {
    const txns = [deposit({ date: '2026-05-01', price: 100000 }), buy('2026-05-02', 100, 100)]
    const priceHistory = { THYAO: { '2026-05': 200, '2026-06': 150, '2026-07': 120, '2026-08': 90 } }
    const series = computePerformanceSeries(
      txns,
      { THYAO: { price: 90, currency: 'TRY' } },
      FX,
      4,
      { priceHistory, fxHistory: {} }
    )
    const values = series.map((p) => p.value)
    expect(values[0]).toBeGreaterThan(values[1])
    expect(values[1]).toBeGreaterThan(values[2])
    expect(values[2]).toBeGreaterThan(values[3])
  })

  it('produced a flat, only-rising line before history existed', () => {
    // Documents the old behaviour so nobody "simplifies" the archive away.
    const txns = [deposit({ date: '2026-05-01', price: 100000 }), buy('2026-05-02', 100, 100)]
    const series = computePerformanceSeries(txns, { THYAO: { price: 90, currency: 'TRY' } }, FX, 4)
    const values = series.map((p) => p.value)
    expect(new Set(values).size).toBe(1) // every month identical
    // Every past month is a reconstruction; the current one is legitimately live.
    expect(series.slice(0, -1).every((p) => p.estimated)).toBe(true)
  })

  it('uses each month\'s FX rate for foreign holdings', () => {
    const txns = [
      deposit({ date: '2026-05-01', price: 10000, currency: 'USD' }),
      tx({ date: '2026-05-02', symbol: 'AAPL', assetType: 'global', currency: 'USD', quantity: 10, price: 200 }),
    ]
    const priceHistory = { AAPL: { '2026-06': 200, '2026-07': 200, '2026-08': 200 } }
    const fxHistory = { '2026-06': { TRY: 1, USD: 30 }, '2026-07': { TRY: 1, USD: 40 }, '2026-08': { TRY: 1, USD: 50 } }
    // Current rates match the current month's archived rates, as they always
    // will in practice — the archive is written from them.
    const liveRates = { TRY: 1, USD: 50, EUR: 45 }
    const series = computePerformanceSeries(txns, {}, liveRates, 3, { priceHistory, fxHistory })
    // Holdings unchanged; only the lira value of them moves with the rate.
    expect(series[0].value).toBeCloseTo(10000 * 30, 6)
    expect(series[1].value).toBeCloseTo(10000 * 40, 6)
    expect(series[2].value).toBeCloseTo(10000 * 50, 6)
  })

  it('marks a month estimated when its price had to be reconstructed', () => {
    const txns = [deposit({ date: '2026-05-01', price: 100000 }), buy('2026-05-02', 100, 100)]
    // June is missing from the archive.
    const priceHistory = { THYAO: { '2026-05': 100, '2026-07': 120, '2026-08': 130 } }
    const fxHistory = { '2026-05': FX, '2026-06': FX, '2026-07': FX, '2026-08': FX }
    const series = computePerformanceSeries(txns, {}, FX, 4, { priceHistory, fxHistory })
    expect(series[0].estimated).toBe(false) // May: exact
    expect(series[1].estimated).toBe(true) // June: carried forward from May
    expect(series[2].estimated).toBe(false) // July: exact
  })

  it('treats the current month as live, not as a reconstruction', () => {
    // There is no month-end close for a month that hasn't ended. Using the
    // live price there is correct, so it must not be flagged.
    const txns = [deposit({ date: '2026-05-01', price: 100000 }), buy('2026-05-02', 100, 100)]
    const series = computePerformanceSeries(
      txns,
      { THYAO: { price: 500, currency: 'TRY' } },
      FX,
      4,
      { priceHistory: { THYAO: { '2026-05': 100, '2026-06': 100, '2026-07': 100 } }, fxHistory: {} }
    )
    const last = series[series.length - 1]
    expect(last.estimated).toBe(false)
    expect(last.value).toBeCloseTo(90000 + 100 * 500, 6)
  })
})

describe('the contributions line', () => {
  it('accumulates deposits and nets off withdrawals', () => {
    const txns = [
      deposit({ date: '2026-06-10', price: 50000 }),
      deposit({ date: '2026-07-10', price: 30000 }),
      tx({ date: '2026-08-05', type: 'withdraw', assetType: 'cash', quantity: 1, price: 10000 }),
    ]
    const series = computePerformanceSeries(txns, {}, FX, 3, { priceHistory: {}, fxHistory: {} })
    expect(series.map((p) => p.contributed)).toEqual([50000, 80000, 70000])
  })

  it('ignores buys and sells, which move money without adding any', () => {
    const txns = [
      deposit({ date: '2026-06-10', price: 50000 }),
      tx({ date: '2026-06-11', quantity: 100, price: 100 }),
      tx({ date: '2026-07-11', type: 'sell', quantity: 50, price: 200 }),
    ]
    const series = computePerformanceSeries(txns, {}, FX, 3, { priceHistory: {}, fxHistory: {} })
    expect(series.every((p) => p.contributed === 50000)).toBe(true)
  })

  it('converts a foreign deposit at the rate in force when it happened', () => {
    // $1000 deposited when USD was 30 cost 30.000 lira. It does not become
    // 50.000 lira of contribution just because the rate later moved.
    const txns = [deposit({ date: '2026-06-10', price: 1000, currency: 'USD' })]
    const fxHistory = { '2026-06': { TRY: 1, USD: 30 } }
    const series = computePerformanceSeries(txns, {}, { TRY: 1, USD: 50 }, 3, {
      priceHistory: {},
      fxHistory,
    })
    expect(series[0].contributed).toBeCloseTo(30000, 6)
    expect(series[2].contributed).toBeCloseTo(30000, 6)
  })

  it('is exact even when the value line is still being reconstructed', () => {
    const txns = [deposit({ date: '2026-06-10', price: 50000 }), tx({ date: '2026-06-11', quantity: 10, price: 100 })]
    const series = computePerformanceSeries(txns, {}, FX, 3)
    expect(series.slice(0, -1).every((p) => p.estimated)).toBe(true)
    expect(series[0].contributed).toBe(50000)
  })
})

describe('valueAtMonth', () => {
  it('falls back through history → live cache → average cost, flagging each', () => {
    const txns = [deposit({ price: 100000 }), tx({ quantity: 10, price: 100 })]

    const fromHistory = valueAtMonth(txns, '2026-08', {
      fxRates: FX,
      priceHistory: { THYAO: { '2026-08': 250 } },
      fxHistory: { '2026-08': FX },
    })
    expect(fromHistory.investedValue).toBeCloseTo(2500, 6)
    expect(fromHistory.estimated).toBe(false)

    const fromLive = valueAtMonth(txns, '2026-08', {
      priceCache: { THYAO: { price: 300 } },
      fxRates: FX,
      priceHistory: {},
      fxHistory: { '2026-08': FX },
    })
    expect(fromLive.investedValue).toBeCloseTo(3000, 6)
    expect(fromLive.estimated).toBe(true)

    const fromCost = valueAtMonth(txns, '2026-08', {
      fxRates: FX,
      priceHistory: {},
      fxHistory: { '2026-08': FX },
    })
    expect(fromCost.investedValue).toBeCloseTo(1000, 6)
    expect(fromCost.estimated).toBe(true)
  })
})
