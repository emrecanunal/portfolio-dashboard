// The demo portfolio is what every new user sees before they enter anything of
// their own, and the dashboard runs computeDataWarnings() over whatever is
// loaded. So demo data that isn't internally consistent greets a first-time
// user with a warning about *our* mistake.
//
// That is not hypothetical: until August 2026 the Global portfolio deposited
// $4,000 and then bought $8,652 of stock, and Claude T3 was ₺59,638 short.
// Both showed "cash is below zero — a deposit is probably missing" on a fresh
// install. This file is here so that can't come back quietly.

import { describe, it, expect } from 'vitest'
import { demoTransactions, demoSubPortfolios, demoPriceCache } from './demoData.js'
import {
  computeDataWarnings,
  computeCashByPortfolio,
  computeHoldings,
} from '../lib/calculations.js'

const FX = { TRY: 1, USD: 34.5, EUR: 37.2 }

describe('demo data', () => {
  it('raises no data warnings on a fresh install', () => {
    expect(computeDataWarnings(demoTransactions, demoPriceCache, FX)).toEqual([])
  })

  it('never lets a portfolio spend more than it deposited', () => {
    for (const [portfolioId, amountTRY] of computeCashByPortfolio(demoTransactions, FX)) {
      const name = demoSubPortfolios.find((p) => p.id === portfolioId)?.name || portfolioId
      expect(`${name}: ${Math.round(amountTRY)}`).toBe(`${name}: ${Math.round(Math.max(0, amountTRY))}`)
    }
  })

  it('has a price for every symbol it holds', () => {
    for (const h of computeHoldings(demoTransactions)) {
      expect(demoPriceCache[h.symbol]?.price, `no demo price for ${h.symbol}`).toBeGreaterThan(0)
    }
  })

  it('only references portfolios that exist', () => {
    const ids = new Set(demoSubPortfolios.map((p) => p.id))
    for (const tx of demoTransactions) {
      expect(ids.has(tx.portfolioId), `unknown portfolioId ${tx.portfolioId}`).toBe(true)
    }
  })

  it('gives every transaction a date the app can parse', () => {
    for (const tx of demoTransactions) {
      expect(tx.date, `bad date on ${tx.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
