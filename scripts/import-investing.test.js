// Tests for the Investing.com importer.
//
// This script writes the file that replaces the user's entire portfolio, from
// an export whose numbers are ambiguous by construction: "1.223,72" is a
// thousand and change, "446.37600000" is four hundred and change, and the two
// live in the same row. Every bug this file pins produced a plausible number
// rather than an error.

import { describe, it, expect } from 'vitest'
import {
  parsePrice,
  parseQuantity,
  parseDate,
  normaliseSymbol,
  parseInvestingExport,
  perLegCommission,
  verify,
  toTransactions,
  parseDeposit,
  cashRunway,
} from './import-investing.mjs'

describe('parsePrice', () => {
  it('reads the Turkish convention: dots group, comma decides', () => {
    expect(parsePrice('1.771,000')).toBe(1771)
    expect(parsePrice('9,140')).toBe(9.14)
    expect(parsePrice('409,15')).toBe(409.15)
  })

  it('reads a dollar amount the same way', () => {
    // "$1.223,72" is one thousand two hundred, not a hundred and twenty-two
    // thousand. Read with the English rule it is off by 100x and still looks
    // like a share price.
    expect(parsePrice('$1.223,72')).toBe(1223.72)
  })

  it('keeps the sign when it sits outside the currency mark', () => {
    // The export writes "-$13,12". Strip only digits-adjacent characters and
    // this parses as NaN, which then spreads through every total it joins.
    expect(parsePrice('-$13,12')).toBe(-13.12)
    expect(parsePrice('-$52,94')).toBe(-52.94)
  })

  it('returns NaN for an empty cell rather than zero', () => {
    // Zero is a number the caller would happily add up. NaN is not.
    expect(parsePrice('')).toBeNaN()
    expect(parsePrice('-')).toBeNaN()
  })
})

describe('parseQuantity', () => {
  it('reads the English convention, because that column uses it', () => {
    expect(parseQuantity('446.37600000')).toBeCloseTo(446.376, 8)
    expect(parseQuantity('5.14880033')).toBeCloseTo(5.14880033, 8)
    expect(parseQuantity('22.00000000')).toBe(22)
  })
})

describe('parseDate', () => {
  it('reads day-first and returns the format every comparison assumes', () => {
    expect(parseDate('11/08/2026')).toBe('2026-08-11')
    expect(parseDate('14/12/2023')).toBe('2023-12-14')
  })

  it('refuses anything it cannot read, rather than guessing', () => {
    expect(parseDate('2026-08-11')).toBeNull()
    expect(parseDate('')).toBeNull()
  })
})

describe('normaliseSymbol', () => {
  it('drops the BIST suffix', () => {
    expect(normaliseSymbol('RALYH.IS')).toBe('RALYH')
  })

  it('drops the exchange tag from a US ticker', () => {
    // .O is "this trades on NASDAQ", not part of the name. Left on, the price
    // source returns nothing and the position values at cost — a holding that
    // reports exactly 0% profit forever.
    expect(normaliseSymbol('GOOGL.O')).toBe('GOOGL')
    expect(normaliseSymbol('MU.O')).toBe('MU')
    expect(normaliseSymbol('HIMS.K')).toBe('HIMS')
  })

  it('turns a trailing lowercase letter into a share class', () => {
    // BRKb is Berkshire class B. Upper-case first and the b is indistinguishable
    // from the ticker, giving BRKB — which is not a symbol anywhere.
    expect(normaliseSymbol('BRKb')).toBe('BRK.B')
  })

  it('leaves an ordinary ticker alone', () => {
    expect(normaliseSymbol('KO')).toBe('KO')
    expect(normaliseSymbol('TSM')).toBe('TSM')
    expect(normaliseSymbol(' nok ')).toBe('NOK')
  })
})

// A miniature export with all three sections, including the summary that must
// be ignored: it aggregates the two TSM lots into one line, and importing that
// would merge two purchases at different prices into a single wrong cost basis.
const CSV = `"Açık Pozisyonların Özeti"
"","İsim","Sembol","Borsa","Çeşidi","Miktar","Ortalama Fiyat","Mevcut Fiyat","Komisyon","Net K/Z"
"","Taiwan Semiconductor","TSM","NYSE","Al","1.60000000","409,15","417,73","$3,00","$10,73"
"Piyasa Değ.","$668,37"
"Açık Pozisyonlar"
"","İsim","Sembol","Borsa","Açılış Tar.","Çeşidi","Miktar","Açılış F.","Mevcut Fiyat","Komisyon","Net K/Z"
"","Taiwan Semiconductor","TSM","NYSE","05/08/2026","Al","0.60000000","414,50","417,73","$1,50","$0,44"
"","Taiwan Semiconductor","TSM","NYSE","31/07/2026","Al","1.00000000","405,94","417,73","$1,50","$10,29"
"Kapalı Pozisyonlar"
"","İsim","Sembol","Borsa","Açılış Tar.","Çeşidi","Miktar","Açılış F.","Kapanış Tarihi","Kapanış F.","Kazanç %","Net K/Z"
"","Coca-Cola","KO","NYSE","15/06/2026","Al","3.00000000","81,81","03/08/2026","87,05","5,18%","$12,72"
"Kapanıştaki K/Z","$12,72"
`

describe('parseInvestingExport', () => {
  const parsed = parseInvestingExport(CSV)

  it('keeps every open lot separate instead of the summary line', () => {
    expect(parsed.open).toHaveLength(2)
    expect(parsed.open.map((r) => r.quantity)).toEqual([0.6, 1])
    expect(parsed.open.map((r) => r.openPrice)).toEqual([414.5, 405.94])
  })

  it('reads the closed section with both of its dates', () => {
    expect(parsed.closed).toHaveLength(1)
    expect(parsed.closed[0]).toMatchObject({
      symbol: 'KO',
      openDate: '2026-06-15',
      closeDate: '2026-08-03',
      quantity: 3,
      openPrice: 81.81,
      closePrice: 87.05,
      declaredPL: 12.72,
    })
  })
})

describe('perLegCommission', () => {
  it('takes the fee the export states', () => {
    expect(perLegCommission(parseInvestingExport(CSV).open)).toBe(1.5)
  })

  it('returns null when the export charges none', () => {
    expect(perLegCommission([{ commission: NaN }])).toBeNull()
  })

  it('refuses to pick one when the rows disagree', () => {
    // The closed lots carry no commission column, so a single number has to
    // stand for all of them. If the open lots cannot agree on it, guessing
    // would put every closed row out by the difference.
    expect(() => perLegCommission([{ commission: 1.5 }, { commission: 2.5 }])).toThrow(
      /more than one commission/
    )
  })
})

describe('verify', () => {
  const parsed = parseInvestingExport(CSV)

  it('accepts an export that agrees with itself', () => {
    const { problems } = verify(parsed, {
      openTotal: 668.37,
      closedTotal: 12.72,
      openPL: 10.73,
      commission: 1.5,
    })
    expect(problems).toEqual([])
  })

  it('catches a P/L that the commission was left out of', () => {
    // Off by exactly the fee: small, plausible, and wrong on every row.
    const { problems } = verify(parsed, { commission: 0 })
    expect(problems.length).toBeGreaterThan(0)
  })

  it('catches a declared total that the rows do not add up to', () => {
    const { problems } = verify(parsed, { openTotal: 66837, commission: 1.5 })
    expect(problems.some((p) => p.includes('open positions total'))).toBe(true)
  })

  it('catches a decimal separator read the wrong way round', () => {
    // The real failure mode: 414,50 read as 41450 parses fine and produces a
    // number that is only wrong by a factor of a hundred.
    const broken = {
      open: [{ ...parsed.open[0], openPrice: 41450 }],
      closed: [],
    }
    const { problems } = verify(broken, { commission: 1.5 })
    expect(problems).toHaveLength(1)
  })
})

describe('toTransactions', () => {
  const parsed = parseInvestingExport(CSV)
  const txns = toTransactions(parsed, 'p1', {
    assetType: 'global',
    currency: 'USD',
    commission: 1.5,
    idPrefix: 'p1-tx',
  })

  it('makes one buy per open lot and a buy plus a sell per closed one', () => {
    expect(txns).toHaveLength(4)
    expect(txns.filter((t) => t.type === 'buy')).toHaveLength(3)
    expect(txns.filter((t) => t.type === 'sell')).toHaveLength(1)
  })

  it('charges the commission to both legs of a closed lot', () => {
    const ko = txns.filter((t) => t.symbol === 'KO')
    expect(ko.map((t) => t.fee)).toEqual([1.5, 1.5])
  })

  it('carries the asset type and currency it was told', () => {
    expect(txns.every((t) => t.assetType === 'global' && t.currency === 'USD')).toBe(true)
  })

  it('orders by date, so no sell arrives before the buy that supplies it', () => {
    const dates = txns.map((t) => t.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('parseDeposit', () => {
  it('reads a declared deposit', () => {
    expect(parseDeposit('2026-02-17=100000')).toEqual({ date: '2026-02-17', amount: 100000 })
  })

  it('rejects a day-first date, which would land in the wrong month', () => {
    expect(parseDeposit('17/02/2026=100000')).toBeNull()
  })

  it('rejects a deposit of nothing', () => {
    expect(parseDeposit('2026-02-17=0')).toBeNull()
    expect(parseDeposit('2026-02-17=')).toBeNull()
  })
})

describe('cashRunway', () => {
  const t = (date, type, price, quantity = 1) => ({ date, type, price, quantity, fee: 0 })

  it('judges the balance at the close of the day, not after each fill', () => {
    // The buy is listed first, but the sell that funded it happened the same
    // day. Judged fill by fill this reports an overdraft that never existed.
    const r = cashRunway([t('2026-07-15', 'buy', 100), t('2026-07-15', 'sell', 120)])
    expect(r.negativeDays).toBe(0)
    expect(r.closing).toBeCloseTo(20, 6)
  })

  it('names the first and last short day and the worst one', () => {
    const r = cashRunway([
      t('2026-07-01', 'buy', 100),
      t('2026-07-02', 'buy', 100),
      t('2026-07-03', 'sell', 150),
      t('2026-07-10', 'deposit', 1000),
    ])
    expect(r.firstNegative.date).toBe('2026-07-01')
    expect(r.lastNegative).toBe('2026-07-03')
    expect(r.minDate).toBe('2026-07-02')
    expect(r.min).toBeCloseTo(-200, 6)
    expect(r.negativeDays).toBe(3)
  })
})


// Ağustos 2026'da 364 işlemin 39'u çift id'liydi: idPrefix'in varsayılanı 'inv'
// olduğu için iki ayrı Investing.com dosyası da inv-1'den başlamıştı. Tek
// tarayıcıda hiçbir belirtisi yoktu — id'ye bakan tek şey senkron, ve o daha
// yoktu. Çakışan iki satırdan biri diğerinin üstüne sessizce yazılıyordu.
describe('id onekleri: cakisma bir daha sessizce olmasin', () => {
  const parsed = parseInvestingExport(CSV)

  it('onek verilmezse hata verir', () => {
    expect(() => toTransactions(parsed, 'p1', { assetType: 'global' }))
      .toThrow(/idPrefix/)
  })

  it('farkli onekler farkli id kumeleri uretir', () => {
    const a = toTransactions(parsed, 'p1', { assetType: 'global', idPrefix: 'a' })
    const b = toTransactions(parsed, 'p2', { assetType: 'global', idPrefix: 'b' })
    const overlap = a.map((t) => t.id).filter((id) => b.some((t) => t.id === id))
    expect(overlap).toEqual([])
  })

  it('ayni onek ayni id leri uretir — tekrar aktarmak ikizlemesin', () => {
    const a = toTransactions(parsed, 'p1', { assetType: 'global', idPrefix: 'a' })
    const b = toTransactions(parsed, 'p1', { assetType: 'global', idPrefix: 'a' })
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id))
  })

  it('tek bir ice aktarma icinde id ler zaten benzersiz', () => {
    const txns = toTransactions(parsed, 'p1', { assetType: 'global', idPrefix: 'a' })
    expect(new Set(txns.map((t) => t.id)).size).toBe(txns.length)
  })
})
