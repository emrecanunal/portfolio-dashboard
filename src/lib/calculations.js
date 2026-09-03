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

/**
 * What one transaction does to the TRY cash balance.
 *
 * Factored out because two things need it and they must never drift apart: the
 * closing balance (computeCashByPortfolio) and the path it took to get there
 * (computeCashRuns). A portfolio can end the year solvent and have been
 * overdrawn for most of it; if the two disagreed about what a `sell` credits,
 * only one of them would be wrong and there would be no way to tell which.
 */
function cashDeltaTRY(tx, fxRates) {
  const withFee = convertToTRY(
    (tx.quantity || 1) * (tx.price || 1) + (tx.fee || 0),
    tx.currency,
    fxRates
  )
  // 'opening' nakit açısından bir para yatırma gibi davranır, ama TASARRUF
  // DEĞİLDİR — bkz. computeMonthlySavingsSeries. İkisini ayırmak şart: iki
  // yıllık bilinmeyen fonlamayı tek bir başlangıç bakiyesiyle kapatmak,
  // o ayın tasarrufu gibi görünseydi FIRE grafiği bir anda zıplardı.
  if (tx.type === 'deposit' || tx.type === 'opening' || (tx.assetType === 'cash' && tx.type === 'buy')) {
    return convertToTRY((tx.quantity || 1) * (tx.price || 0), tx.currency, fxRates)
  }
  if (tx.type === 'withdraw' || tx.type === 'buy') return -withFee
  if (tx.type === 'sell') {
    return convertToTRY(tx.quantity * tx.price - (tx.fee || 0), tx.currency, fxRates)
  }
  if (tx.type === 'transfer') {
    // __incoming, computeCashRuns'un hedef portföy için ürettiği kopyayı
    // işaretliyor. Aynı işlem iki akışta birden geçiyor ve her birinde işareti
    // farklı: kaynakta eksi, hedefte artı.
    const amount = convertToTRY((tx.quantity || 1) * (tx.price || 0), tx.currency, fxRates)
    if (tx.__incoming) return amount
    return -(amount + convertToTRY(tx.fee || 0, tx.currency, fxRates))
  }
  if (tx.type === 'exchange') {
    // FX conversion: outflow in the source currency, inflow in the target.
    // There is no fee term — the conversion cost is carried by the rate the
    // user entered, so charging a fee on top would double-count it. In TRY
    // terms the net is (toAmount in TRY) − (fromAmount in TRY), which is ~0
    // when the entered rate matches the stored fxRates and slightly negative
    // when the broker's rate was worse than the reference rate.
    const out = convertToTRY(tx.quantity || 0, tx.currency, fxRates)
    const inn = convertToTRY(Number(tx.toAmount) || 0, tx.toCurrency || 'USD', fxRates)
    return inn - out
  }
  return 0
}

/**
 * Portföy başına nakit.
 *
 * TRANSFER NEDEN AYRI ELE ALINIYOR
 *
 * Diğer her işlem tek bir portföyü etkiliyor, bu yüzden döngü basitçe
 * tx.portfolioId'ye yazıyor. Transfer iki portföyü birden etkiliyor: kaynaktan
 * çıkıyor, hedefe giriyor. Tek taraflı işlenirse para yok olur ya da yoktan var
 * olur — ve bu hiçbir yerde hata vermez, sadece iki sayı yanlış çıkar.
 *
 * Toplam üzerinde etkisi SIFIR olmalı; testler bunu kilitliyor.
 */
export function computeCashByPortfolio(transactions, fxRates) {
  const cash = new Map()
  const add = (pid, amount) => cash.set(pid, (cash.get(pid) || 0) + amount)

  for (const tx of transactions) {
    if (tx.type === 'transfer') {
      const amount = convertToTRY((tx.quantity || 1) * (tx.price || 0), tx.currency, fxRates)
      const fee = convertToTRY(tx.fee || 0, tx.currency, fxRates)
      // Masraf kaynaktan düşüyor: transferi yapan taraf öder, hedefe eksik
      // para varır. Hedefe tam tutarı yazıp masrafı da kaynaktan düşmek,
      // parayı yoktan var etmek olurdu.
      add(tx.portfolioId, -(amount + fee))
      if (tx.toPortfolioId) add(tx.toPortfolioId, amount)
      continue
    }
    add(tx.portfolioId, cashDeltaTRY(tx, fxRates))
  }
  return cash
}

// Whole calendar days from one 'YYYY-MM-DD' to another. Built from the parts
// via Date.UTC rather than parsing the string, so it cannot pick up a timezone
// on the way in — see the note at the top of this file.
function daysBetweenYmd(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

/**
 * How long cash may sit below zero before it means something is missing.
 *
 * Turkish equities settle T+2 and TEFAS funds T+1/T+2, so money that is
 * genuinely yours can be absent from the account for a couple of days — sell a
 * fund on Thursday to buy on Friday and the balance is short until Monday.
 * Four calendar days is that worst case, weekend included.
 *
 * Beyond it the explanation stops working: no settlement cycle runs for weeks.
 */
export const SETTLEMENT_TOLERANCE_DAYS = 4

/**
 * Every stretch during which a portfolio's cash closed below zero.
 *
 * The balance is judged at the END of each day, never after each fill. Within
 * one day the order of two transactions is an artefact of how they were entered
 * — a buy typed before the sell that funded it would otherwise invent an
 * overdraft that never happened.
 *
 * Each run reports how long it lasted in CALENDAR days, because that is what
 * separates the two explanations for negative cash. A settlement gap is short
 * and closes itself. A missing deposit is not, and does not.
 *
 * Returns [{ portfolioId, since, resolvedOn, days, worstTRY, worstDate,
 *            currentTRY, open, transient }], oldest first.
 */
export function computeCashRuns(transactions, fxRates = {}, today = todayYmd()) {
  // Transferin İKİ bacağı da ilgili portföyün akışına giriyor: kaynakta çıkış,
  // hedefte giriş. Yalnızca kaynağa yazılsaydı, hedef portföy parayı hiç almamış
  // gibi görünür ve nakdi haksız yere eksiye düşerdi — yani düzeltmek için
  // eklediğimiz özellik, düzeltmeye çalıştığı uyarıyı üretirdi.
  const byPortfolio = new Map()
  const push = (pid, tx) => {
    const list = byPortfolio.get(pid) || []
    list.push(tx)
    byPortfolio.set(pid, list)
  }
  for (const tx of transactions) {
    push(tx.portfolioId, tx)
    if (tx.type === 'transfer' && tx.toPortfolioId) {
      push(tx.toPortfolioId, { ...tx, __incoming: true })
    }
  }

  const runs = []

  for (const [portfolioId, list] of byPortfolio) {
    const sorted = [...list].sort((a, b) => (txYmd(a) < txYmd(b) ? -1 : txYmd(a) > txYmd(b) ? 1 : 0))
    let cash = 0
    let run = null

    for (let i = 0; i < sorted.length; i++) {
      cash += cashDeltaTRY(sorted[i], fxRates)
      const day = txYmd(sorted[i])
      const dayEnds = i === sorted.length - 1 || txYmd(sorted[i + 1]) !== day
      if (!dayEnds) continue

      if (cash < -0.01) {
        if (!run) run = { portfolioId, since: day, worstTRY: cash, worstDate: day }
        if (cash < run.worstTRY) {
          run.worstTRY = cash
          run.worstDate = day
        }
      } else if (run) {
        // The day cash came back is the day the gap closed, so the span
        // includes it: sell Thursday, settle Monday, four days.
        runs.push(finishRun(run, day, cash, false, today))
        run = null
      }
    }

    // Still short at the last transaction, which means still short now.
    if (run) runs.push(finishRun(run, null, cash, true, today))
  }

  return runs.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0))
}

function finishRun(run, resolvedOn, currentTRY, open, today) {
  const until = resolvedOn || today
  const days = Math.max(1, daysBetweenYmd(run.since, until))
  return {
    ...run,
    resolvedOn,
    open,
    days,
    currentTRY,
    // A gap that closed itself within the settlement window is the plumbing
    // working as designed, and worth no one's attention.
    //
    // An open run is never transient, however short. It has not demonstrated
    // that it closes — and more to the point, its balance is the negative
    // number sitting on the dashboard right now. Displaying a figure while
    // staying silent about it is precisely the failure this box exists to
    // prevent.
    transient: !open && days <= SETTLEMENT_TOLERANCE_DAYS,
  }
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
    // Transfer, hedef portföy için de ilgili bir işlem — kaynak filtresine
    // takılıp elenirse hedefe para hiç ulaşmamış görünür.
    const relevant =
      !portfolioId ||
      tx.portfolioId === portfolioId ||
      (tx.type === 'transfer' && tx.toPortfolioId === portfolioId)
    if (!relevant) continue
    const ccy = tx.currency || 'TRY'
    const current = cash.get(ccy) || 0
    const localGross = (tx.quantity || 1) * (tx.price || 1)
    const fee = tx.fee || 0

    if (tx.type === 'deposit' || tx.type === 'opening' || (tx.assetType === 'cash' && tx.type === 'buy')) {
      cash.set(ccy, current + localGross)
    } else if (tx.type === 'withdraw') {
      cash.set(ccy, current - localGross - fee)
    } else if (tx.type === 'buy') {
      cash.set(ccy, current - localGross - fee)
    } else if (tx.type === 'sell') {
      cash.set(ccy, current + localGross - fee)
    } else if (tx.type === 'transfer') {
      // Aynı para biriminde iki portföy arasında. Bir portföye daraltılmış
      // sorguda yalnızca ilgili bacak sayılıyor; daraltılmamışta ikisi birden
      // ve net etki sıfır.
      if (!portfolioId || tx.portfolioId === portfolioId) {
        cash.set(ccy, (cash.get(ccy) || 0) - localGross - fee)
      }
      if ((!portfolioId || tx.toPortfolioId === portfolioId) && tx.toPortfolioId) {
        cash.set(ccy, (cash.get(ccy) || 0) + localGross)
      }
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

/**
 * Bir portföyün işlemleri — GELEN TRANSFER BACAĞI DÂHİL.
 *
 * "Bu satır bu portföye ait mi" sorusunun tek cevabı burası. Daha önce her
 * çağıran yerde ayrı ayrı `tx.portfolioId === id` yazıyordu ve transferin
 * hedefi o süzgeçte eleniyordu: para kaynaktan çıkıyor, hedefe hiç varmıyordu.
 * Portföy kartındaki toplam, "Nakit rezerv" kutusu, performans çizgisi ve
 * portföyün işlem listesi — dördü de eksik gösteriyordu. Ana toplam doğru
 * çıktığı ve hiçbir kontrol bunu yakalamadığı için de sessizdi.
 *
 * Gelen bacak KOPYA olarak ve `__incoming` işaretiyle dönüyor — computeCashRuns'un
 * kurduğu düzen. cashDeltaTRY o işarete bakıp tutarı artı sayıyor; işaretsiz
 * bırakılsaydı parayı ALAN portföy onu çıkış gibi yazardı. Kopya şart: aynı
 * nesneye işaret koymak, kaynak kapsamdaki hesabı da bozardı.
 */
export function scopeTransactions(transactions, portfolioId = null) {
  if (!portfolioId) return transactions
  const out = []
  for (const tx of transactions) {
    if (tx.portfolioId === portfolioId) out.push(tx)
    else if (tx.type === 'transfer' && tx.toPortfolioId === portfolioId) {
      out.push({ ...tx, __incoming: true })
    }
  }
  return out
}

export function computePortfolioSummary(transactions, priceCache, fxRates, portfolioId = null) {
  const filtered = scopeTransactions(transactions, portfolioId)

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
export function computeDataWarnings(
  transactions,
  priceCache = {},
  fxRates = {},
  subPortfolios = null,
) {
  const warnings = []

  // 1. A sub-portfolio whose cash went below zero.
  //
  //    Two different things produce this and they deserve different answers.
  //    Selling a fund on Monday to buy shares on Tuesday leaves the account
  //    short until the sale settles: nothing is missing, the money is simply in
  //    transit, and the gap closes on its own within days. A deposit that was
  //    never recorded produces a shortfall that closes only when the next
  //    unrelated deposit happens to cover it — or never.
  //
  //    Short self-closing gaps are therefore reported as nothing at all.
  //    Silence is the verdict: this box means something is wrong, and saying
  //    "your settlement worked correctly" in a box titled 'Check your data'
  //    teaches the user to stop reading it.
  //
  //    Checking only TODAY's balance, which is what this used to do, misses the
  //    case entirely: a portfolio can be overdrawn for seventy days and close
  //    the year in the black. So the whole path is walked, not the endpoint.
  for (const run of computeCashRuns(transactions, fxRates)) {
    if (run.transient) continue
    warnings.push({
      code: run.open ? 'negative_cash' : 'negative_cash_period',
      portfolioId: run.portfolioId,
      // For an open run this is today's balance, which is what the old
      // single-number check reported and what the user can act on.
      amountTRY: run.open ? run.currentTRY : run.worstTRY,
      since: run.since,
      resolvedOn: run.resolvedOn,
      days: run.days,
      worstTRY: run.worstTRY,
      worstDate: run.worstDate,
    })
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

  // 5. A transaction filed under a portfolio that no longer exists.
  //
  //    This one is invisible by construction. The portfolio list is what the
  //    screen renders, but the totals are computed from the TRANSACTIONS — so a
  //    row whose portfolio is gone keeps contributing to net worth while having
  //    nowhere to be displayed. On 28 August that was 125.732 TRY of opening
  //    balance sitting under a portfolio one device had and the other did not,
  //    and no screen in the app could say where the difference came from.
  //
  //    Only checked when the caller passes the portfolio list, and only worth
  //    passing on the master view: a screen already scoped to one portfolio has
  //    filtered the orphans out before this function ever sees them.
  if (subPortfolios) {
    const known = new Set(subPortfolios.map((p) => p.id))
    const counts = new Map()
    for (const tx of transactions) {
      // A transfer's destination is a second reference to a portfolio and can
      // dangle on its own — the source may be alive while the target is gone.
      for (const id of [tx.portfolioId, tx.type === 'transfer' ? tx.toPortfolioId : null]) {
        if (!id || known.has(id)) continue
        counts.set(id, (counts.get(id) || 0) + 1)
      }
    }
    for (const [portfolioId, count] of counts) {
      warnings.push({ code: 'orphan_transactions', portfolioId, count })
    }
  }

  // 6. Bir portföyün elinde OLMAYAN bir dövizi harcaması.
  //
  //    Kasa'da yalnızca TL varken oradan USD transfer etmek, defterde USD
  //    kovasını eksiye düşürüyor — yani kaydedilmemiş bir döviz çevirimi var.
  //    Fazla satılmış pozisyonla aynı sınıf hata: olmayan bir şey harcanmış.
  //
  //    Yukarıdaki nakit kontrolü bunu YAKALAMAZ, çünkü o her şeyi TL'ye çevirip
  //    tek bir toplama bakıyor: 837.700 ₺ artı iken −5.651 USD'lik kova görünmez
  //    kalıyor ve toplam sağlıklı görünüyor. Ayrı bir kontrol olmasının sebebi bu.
  //    YALNIZCA KENDİ SATIRLARI BURADA OLAN PORTFÖY kontrol edilebilir.
  //
  //    Bir alt portföy sayfasında liste o portföye daraltılmış, ama içinde
  //    transferin gelen bacağı da var ve o satır KAYNAĞA ait. Kaynağın id'sini
  //    de kontrol listesine alınca, Kasa'nın yalnızca bu çıkışı görülüyor ve
  //    açılış bakiyesi kapsam dışında kaldığı için "Kasa'nın TL'si eksi"
  //    deniyordu — Amerika sayfasında, Kasa hakkında, tamamen yanlış.
  //
  //    __incoming işaretli satır başka bir portföyün kaydının kopyası; sahibi
  //    burada değil. Hedefi ayrıca eklemeye de gerek yok: yalnızca para ALAN
  //    bir portföyün bakiyesi eksiye düşemez.
  const portfolioIds = new Set()
  for (const tx of transactions) {
    if (tx.__incoming) continue
    if (tx.portfolioId) portfolioIds.add(tx.portfolioId)
  }
  for (const pid of portfolioIds) {
    for (const [currency, amount] of computeCashByCurrency(transactions, pid)) {
      // Kuruş altı sapmalar kayan nokta gürültüsü, hata değil.
      if (amount < -0.01) {
        warnings.push({ code: 'negative_currency', portfolioId: pid, currency, amount })
      }
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

/**
 * Dağılım, varlık sınıfına göre değil TEK TEK POZİSYONLARA göre.
 *
 * NEDEN AYRI BİR FONKSİYON
 *
 * computeAllocation() "BIST %45, nakit %15" diyor ve ana sayfada doğru soru bu:
 * varlık sınıfları arasında nasıl yayılmışım. Ama tek bir alt portföyün içinde
 * aynı soru anlamsız — T3'ün %97'si BIST, yani tek dilim. Orada sorulan soru
 * "bu portföy hangi pozisyonlardan oluşuyor".
 *
 * KUYRUK NEDEN TOPLANIYOR
 *
 * 30 pozisyonun 30'unu ayrı ayrı renklendirmek mümkün değil: kategorik paletler
 * 8 renkte tükeniyor ve ötesi renk körü bir okuyucu için ayırt edilemez hâle
 * geliyor. Bu yüzden ilk `topN` kalıyor, gerisi tek bir "diğer" satırında
 * toplanıyor — ve kaç kalem olduğu da yazıyor ki gizlenen şeyin büyüklüğü
 * belirsiz kalmasın.
 *
 * Nakit para birimi başına ayrı satır: 10.000 TL ile 10.000 USD aynı satırda
 * toplanırsa ortaya ne olduğu belirsiz bir sayı çıkar.
 *
 * @returns {Array<{key, label, kind, value, pct, count?}>} büyükten küçüğe
 */
export function computeHoldingAllocation(summary, cashByCurrency = null, fxRates = null, topN = 12) {
  const { holdings, cashTotal, totalValue } = summary
  const rows = []

  for (const h of holdings) {
    if (h.marketValueTRY <= 0) continue
    rows.push({ key: `h_${h.symbol}`, label: h.symbol, kind: h.assetType, value: h.marketValueTRY })
  }

  if (cashByCurrency && fxRates) {
    for (const [ccy, amount] of cashByCurrency) {
      if (!amount || amount <= 0) continue
      rows.push({
        key: `cash_${ccy}`,
        label: ccy,
        kind: 'cash',
        currency: ccy,
        nativeValue: amount,
        value: convertToTRY(amount, ccy, fxRates),
      })
    }
  } else if (cashTotal > 0) {
    rows.push({ key: 'cash', label: 'cash', kind: 'cash', value: cashTotal })
  }

  rows.sort((a, b) => b.value - a.value)

  const pct = (v) => (totalValue > 0 ? (v / totalValue) * 100 : 0)

  // topN + 1 kalem varsa katlamanın anlamı yok: "diğer (1 kalem)" satırı,
  // kalemin kendisiyle aynı yeri kaplayıp adını saklamaktan ibaret olurdu.
  if (rows.length <= topN + 1) {
    return rows.map((r) => ({ ...r, pct: pct(r.value) }))
  }

  const head = rows.slice(0, topN).map((r) => ({ ...r, pct: pct(r.value) }))
  const tail = rows.slice(topN)
  const tailValue = tail.reduce((sum, r) => sum + r.value, 0)

  head.push({
    key: 'other',
    label: 'other',
    kind: 'other',
    value: tailValue,
    pct: pct(tailValue),
    count: tail.length,
  })

  return head
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
    // Yalnızca deposit/withdraw — ve dışarıda kalan ikisi kasıtlı:
    //
    //   'transfer'  portföyler arası, yani DIŞARIDAN para gelmiyor. Saymak,
    //               parayı bir cebinden diğerine koymayı tasarruf ilan etmek olur.
    //   'opening'   bir başlangıç noktası beyanı. İki yıllık bilinmeyen fonlamayı
    //               tek satıra indiriyor; onu katkı saymak o ayı devasa bir
    //               tasarruf ayı gibi gösterir ve FIRE tahminini bozar.
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
    // 'transfer' ve 'opening' burada da dışarıda — gerekçe contributedUpTo'da.
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
