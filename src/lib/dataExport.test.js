// Restore replaces everything, cannot be undone, and is the one operation
// aimed straight at the data every other calculation reads. A backup written
// months ago will not match today's schema, and a single malformed row is
// enough to make every number downstream wrong while still looking plausible.
//
// So: validate before touching anything, and be specific about what is wrong.

import { describe, it, expect } from 'vitest'
import { parseJsonBackup, RESTORABLE_SETTINGS } from './dataExport.js'

const goodTxn = (over = {}) => ({
  id: 't1',
  date: '2026-07-15',
  type: 'buy',
  assetType: 'bist',
  symbol: 'THYAO',
  quantity: 10,
  price: 300,
  fee: 5,
  currency: 'TRY',
  portfolioId: 'p1',
  notes: '',
  ...over,
})

const backup = (over = {}) =>
  JSON.stringify({
    version: 2,
    exportedAt: '2026-08-01T10:00:00.000Z',
    transactions: [goodTxn()],
    subPortfolios: [{ id: 'p1', name: 'Ana', color: '#10b981' }],
    ...over,
  })

describe('parseJsonBackup: file-level checks', () => {
  it('rejects text that is not JSON', () => {
    expect(parseJsonBackup('not json').ok).toBe(false)
  })

  it('rejects a file with no transaction list', () => {
    const r = parseJsonBackup(JSON.stringify({ subPortfolios: [] }))
    expect(r.ok).toBe(false)
  })

  it('accepts a well-formed backup', () => {
    const r = parseJsonBackup(backup())
    expect(r.ok).toBe(true)
    expect(r.summary.transactions).toBe(1)
    expect(r.issues).toEqual([])
  })

  it('reports the file version so an old shape can be recognised', () => {
    expect(parseJsonBackup(backup({ version: 1 })).summary.version).toBe(1)
    // Backups written before versioning claim nothing; treat that as v0
    // rather than assuming they match today's schema.
    expect(parseJsonBackup(backup({ version: undefined })).summary.version).toBe(0)
  })
})

describe('parseJsonBackup: per-transaction validation', () => {
  const withTxn = (over) => parseJsonBackup(backup({ transactions: [goodTxn(over)] }))

  it('rejects a transaction with an unusable date', () => {
    // Day-first is a real export format elsewhere, and would be read as a
    // different day entirely by every date comparison in calculations.js.
    const r = withTxn({ date: '15/07/2026' })
    expect(r.issues[0].problems).toContain('date')
    // Nothing survived, so the file is refused rather than restored empty.
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown transaction type', () => {
    expect(withTxn({ type: 'dividend' }).issues[0].problems).toContain('type')
  })

  it('rejects a non-numeric quantity or price', () => {
    expect(withTxn({ quantity: 'ten' }).issues[0].problems).toContain('quantity')
    expect(withTxn({ price: null }).issues[0].problems).toContain('price')
  })

  it('rejects a negative quantity, price or fee', () => {
    expect(withTxn({ quantity: -1 }).issues[0].problems).toContain('quantity')
    expect(withTxn({ price: -1 }).issues[0].problems).toContain('price')
    expect(withTxn({ fee: -1 }).issues[0].problems).toContain('fee')
  })

  it('rejects a missing symbol or currency', () => {
    expect(withTxn({ symbol: '' }).issues[0].problems).toContain('symbol')
    expect(withTxn({ currency: null }).issues[0].problems).toContain('currency')
  })

  it('requires both sides of an exchange', () => {
    const r = withTxn({ type: 'exchange', assetType: 'cash', toAmount: 0, toCurrency: 'USD' })
    expect(r.issues[0].problems).toContain('toAmount')
  })

  it('rejects an exchange into the same currency', () => {
    const r = withTxn({
      type: 'exchange',
      assetType: 'cash',
      currency: 'USD',
      toAmount: 100,
      toCurrency: 'USD',
    })
    expect(r.issues[0].problems).toContain('toCurrency')
  })

  it('flags a transaction pointing at a portfolio that is not in the file', () => {
    const r = withTxn({ portfolioId: 'ghost' })
    expect(r.issues[0].problems).toContain('portfolioId')
  })

  it('keeps the good rows and reports only the bad ones', () => {
    const r = parseJsonBackup(
      backup({
        transactions: [goodTxn(), goodTxn({ id: 't2', quantity: 'x' }), goodTxn({ id: 't3' })],
      })
    )
    expect(r.ok).toBe(true)
    expect(r.data.transactions).toHaveLength(2)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].id).toBe('t2')
    expect(r.summary.dropped).toBe(1)
  })

  it('refuses the file outright when nothing survives', () => {
    const r = parseJsonBackup(backup({ transactions: [goodTxn({ type: 'nonsense' })] }))
    expect(r.ok).toBe(false)
  })

  it('gives a transaction with no id a stable position reference', () => {
    const r = parseJsonBackup(backup({ transactions: [goodTxn({ id: undefined, price: -5 })] }))
    expect(r.issues[0].index).toBe(0)
  })
})

describe('parseJsonBackup: which settings come back', () => {
  // A backup records a portfolio. It also happens to contain a snapshot of
  // things that describe RIGHT NOW — exchange rates, when prices were last
  // fetched. Restoring a three-month-old USD rate over today's would silently
  // rewrite every converted figure in the app, which is the worst kind of
  // damage: invisible and everywhere.
  const settings = {
    baseCurrency: 'USD',
    language: 'tr',
    monthlyExpensesUSD: 2500,
    withdrawalRate: 0.035,
    cashThresholdPct: 12,
    fxRates: { TRY: 1, USD: 34.5, EUR: 37.2 },
    fxMeta: { fetchedAt: 1714560000000, source: 'frankfurter' },
    priceMeta: { fetchedAt: 1714560000000 },
    finnhubApiKey: 'should-never-come-back',
  }

  it('restores the settings that describe the user', () => {
    const r = parseJsonBackup(backup({ settings }))
    expect(r.data.settings.monthlyExpensesUSD).toBe(2500)
    expect(r.data.settings.withdrawalRate).toBe(0.035)
    expect(r.data.settings.language).toBe('tr')
  })

  it('drops the settings that describe the moment', () => {
    const r = parseJsonBackup(backup({ settings }))
    expect(r.data.settings.fxRates).toBeUndefined()
    expect(r.data.settings.fxMeta).toBeUndefined()
    expect(r.data.settings.priceMeta).toBeUndefined()
  })

  it('never restores an API key, even if the file carries one', () => {
    const r = parseJsonBackup(backup({ settings }))
    expect(r.data.settings.finnhubApiKey).toBeUndefined()
  })

  it('keeps the allowlist and the restored keys in step', () => {
    const r = parseJsonBackup(backup({ settings }))
    for (const key of Object.keys(r.data.settings)) {
      expect(RESTORABLE_SETTINGS).toContain(key)
    }
  })
})

describe('parseJsonBackup: archives', () => {
  it('passes the month-end archives through when present', () => {
    const r = parseJsonBackup(
      backup({ priceHistory: { THYAO: { '2026-07': 300 } }, fxHistory: { '2026-07': { USD: 40 } } })
    )
    expect(r.data.priceHistory.THYAO['2026-07']).toBe(300)
    expect(r.data.fxHistory['2026-07'].USD).toBe(40)
  })

  it('signals absent archives as null so the caller keeps what it has', () => {
    // An older backup predates them. Wiping months that cost API calls to
    // rebuild — against a 25-a-day quota — would be a bad trade.
    const r = parseJsonBackup(backup())
    expect(r.data.priceHistory).toBeNull()
    expect(r.data.fxHistory).toBeNull()
  })
})
