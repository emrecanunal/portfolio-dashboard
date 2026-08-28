// What a brand-new browser starts with, and why it matters more than it looks.
//
// Until August 2026 the initial state WAS the demo book: THYAO, ASELS, VOO and
// a year of believable trades. A first-time user could add a real transaction
// on top of it and never notice the seam.
//
// That was a nuisance in a single-browser app. With two devices syncing it is
// data loss: a phone opening the app for the first time boots full of invented
// trades and pushes them at the server as though they were real, and no merge
// can tell them apart from the ones typed on the laptop. So these two facts —
// first run is empty, and the demo set only arrives when asked for — are load
// bearing for the sync work, not cosmetic.

import { describe, it, expect, beforeAll } from 'vitest'

let usePortfolioStore
let demoTransactions

// zustand's persist middleware reaches for localStorage the moment store.js is
// imported, and vitest runs in node where there isn't one. A Map behind the
// three methods persist actually calls is enough, and keeps each run isolated.
beforeAll(async () => {
  const mem = new Map()
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  }
  ;({ usePortfolioStore } = await import('./store.js'))
  ;({ demoTransactions } = await import('../data/demoData.js'))
})

describe('initial state', () => {
  it('carries no transactions', () => {
    expect(usePortfolioStore.getState().transactions).toEqual([])
  })

  it('carries no prices', () => {
    expect(usePortfolioStore.getState().priceCache).toEqual({})
  })

  // Not zero portfolios: AddTransactionModal files a trade under
  // subPortfolios[0], so an empty list would file it under '' — a row that
  // exists but appears in no portfolio.
  it('offers exactly one portfolio to file a first trade under', () => {
    const { subPortfolios } = usePortfolioStore.getState()
    expect(subPortfolios).toHaveLength(1)
    expect(subPortfolios[0].id).toBeTruthy()
  })
})

describe('loadDemoData', () => {
  it('brings the sample book in only when called', () => {
    expect(usePortfolioStore.getState().transactions).toEqual([])
    usePortfolioStore.getState().loadDemoData()
    expect(usePortfolioStore.getState().transactions).toHaveLength(demoTransactions.length)
  })

  // The FIRE targets and the base currency describe the person, not the sample
  // data. Wiping them was the old resetToDefaults' habit, and it made "show me
  // a demo" cost a trip back through Settings.
  it('leaves the settings the person chose alone', () => {
    usePortfolioStore.getState().updateSettings({ fireTargetUSD: 750000, baseCurrency: 'USD' })
    usePortfolioStore.getState().loadDemoData()
    const { settings } = usePortfolioStore.getState()
    expect(settings.fireTargetUSD).toBe(750000)
    expect(settings.baseCurrency).toBe('USD')
  })
})

// 28 Ağustos'un ikinci hatası. Portföy silme iki adımdaydı: eylem portföyü
// mezar taşıyla işaretliyor, ekran ise işlemleri ham bir setState ile süzüyordu.
// Ham setState outbox'a dokunmaz — o yüzden işlem satırları için sunucuya
// hiçbir silme gitmiyor, satırlar orada hayatta kalıyor ve baştan çeken bir
// cihaza sahipsiz olarak dönüyorlardı. Bu test tam olarak o boşluğu tutuyor:
// yerelden gitmiş olması yetmez, KUTUDA silme işareti olmalı.
describe('deleteSubPortfolioWithTransactions', () => {
  it('marks the portfolio AND every transaction in it as deleted in the outbox', () => {
    usePortfolioStore.getState().clearAllTransactions()
    usePortfolioStore.getState().addSubPortfolio('Gidecek')
    const doomed = usePortfolioStore.getState().subPortfolios.at(-1)
    const keeper = usePortfolioStore.getState().subPortfolios[0]

    usePortfolioStore.getState().addTransaction({
      portfolioId: doomed.id, type: 'buy', assetType: 'bist', symbol: 'THYAO',
      quantity: 1, price: 100, fee: 0, currency: 'TRY', date: '2026-01-02',
    })
    usePortfolioStore.getState().addTransaction({
      portfolioId: keeper.id, type: 'buy', assetType: 'bist', symbol: 'ASELS',
      quantity: 1, price: 100, fee: 0, currency: 'TRY', date: '2026-01-02',
    })

    const before = usePortfolioStore.getState().transactions
    const goingId = before.find((t) => t.portfolioId === doomed.id).id
    const stayingId = before.find((t) => t.portfolioId === keeper.id).id

    usePortfolioStore.getState().deleteSubPortfolioWithTransactions(doomed.id)

    const { subPortfolios, transactions, outbox } = usePortfolioStore.getState()
    expect(subPortfolios.map((p) => p.id)).not.toContain(doomed.id)
    expect(transactions.map((t) => t.id)).not.toContain(goingId)

    expect(outbox.portfolios[doomed.id]).toBe('delete')
    expect(outbox.transactions[goingId]).toBe('delete')

    // Komşu portföyün işlemi silme işareti almamalı.
    expect(transactions.map((t) => t.id)).toContain(stayingId)
    expect(outbox.transactions[stayingId]).not.toBe('delete')
  })
})
