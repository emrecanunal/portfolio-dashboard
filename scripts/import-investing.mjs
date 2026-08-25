// Turn an Investing.com portfolio export into transactions, and rewrite a
// backup file around them.
//
//   node scripts/import-investing.mjs \
//     --backup portfolio-backup.json \
//     --csv investing-export.csv \
//     --into "T3" \
//     --drop "Claude T3" \
//     --deposit 2025-07-20=100000 \
//     --deposit 2026-02-17=100000 \
//     --out portfolio-backup-imported.json
//
//   ... and for a US export, where the money and the tickers are different:
//
//     --into "Amerika" --asset-type global --currency USD
//
// WHY A SCRIPT AND NOT THE UI
//
// A year of trading is ~170 lots — 310 transactions once each closed lot becomes a
// buy and a sell. That is not something to type, and a typo in it is a wrong
// number that looks right.
//
// VERIFICATION IS THE POINT
//
// The export carries its own totals, and this checks against them rather than
// trusting the parse:
//
//   * every closed lot:  (close − open) × qty  must equal the file's Net K/Z
//   * all open lots:     Σ qty × current price must equal the file's total
//
// If the numbers were misread — a decimal comma taken for a thousands dot, a
// column off by one — those sums stop matching and the run aborts. Financial
// data that parses without error is not the same as financial data that parsed
// correctly.
//
// NUMBER FORMATS: the export mixes conventions in the same row. Prices are
// Turkish ("1.771,000" = 1771.0), quantities are English ("446.37600000" =
// 446.376). Read each with the rule that fits its column, not a shared guess.
// This holds even for dollar amounts: a US position prints as "$1.223,72",
// which is 1223.72 and not 122372.
//
// COMMISSION: where the export charges one, it is already inside the P/L it
// declares — an open lot nets one commission, a closed lot two. Verifying
// without it puts every row off by exactly the fee, which is small enough to
// look like rounding and is not.

import { readFileSync, writeFileSync } from 'node:fs'

// --- CSV --------------------------------------------------------------------

// Investing quotes every field and embeds commas inside quotes, so a split on
// commas would tear "1.771,000" in half.
function parseCsvLine(line) {
  const cells = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cell += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(cell)
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell)
  return cells
}

// --- numbers ----------------------------------------------------------------

/**
 * Turkish price: dot groups thousands, comma is the decimal point.
 *
 * Currency marks are stripped wherever they sit, because the export puts the
 * minus sign outside them ("-$13,12"). Left in, that parses as NaN, and a NaN
 * silently poisons every sum it touches.
 */
export function parsePrice(text) {
  if (typeof text === 'number') return text
  const cleaned = String(text ?? '')
    .replace(/[₺$€£%\s]/g, '')
    .trim()
  if (!cleaned) return NaN
  const negative = cleaned.startsWith('-')
  const digits = cleaned.replace(/^-/, '').split('.').join('').replace(',', '.')
  const value = parseFloat(digits)
  return negative ? -value : value
}

/** Quantity: plain English decimal, e.g. "446.37600000". */
export function parseQuantity(text) {
  const value = parseFloat(String(text ?? '').trim())
  return isFinite(value) ? value : NaN
}

/** "20/08/2026" → "2026-08-20". Day-first; never hand this to new Date(). */
export function parseDate(text) {
  const m = String(text ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/**
 * Investing's ticker → the one the app prices with.
 *
 *   RALYH.IS → RALYH    BIST codes are stored bare
 *   GOOGL.O  → GOOGL    .O/.OQ/.K/.N/.P are exchange tags, not part of the ticker
 *   HIMS.K   → HIMS
 *   BRKb     → BRK.B    a trailing lowercase letter is a share class
 *
 * The share-class case has to run before upper-casing, or the lowercase b that
 * marks it is gone. Getting this wrong does not throw: it produces a symbol the
 * price source has never heard of, and the position quietly values at cost with
 * a profit of exactly 0%.
 */
export function normaliseSymbol(text) {
  const trimmed = String(text ?? '').trim()
  const withoutExchange = trimmed.replace(/\.(OQ|O|K|N|P)$/, '')
  // Uppercase prefix, single lowercase tail — that contrast IS the signal. Allow
  // a lowercase prefix too and "nok" becomes "NO.K", a symbol for nothing.
  const withClass = withoutExchange.replace(/^([A-Z]{1,5})([a-z])$/, '$1.$2')
  return withClass.toUpperCase().replace(/\.IS$/, '')
}

// --- the export -------------------------------------------------------------

// Two sections matter: open lots (one buy each) and closed lots (a buy and a
// sell). The summary section at the top is ignored — it has no open dates.
export function parseInvestingExport(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())

  const open = []
  const closed = []
  let section = null
  let header = null

  for (const line of lines) {
    const cells = parseCsvLine(line).map((c) => c.trim())
    const first = cells[0]

    if (first === 'Açık Pozisyonlar') {
      section = 'open'
      header = null
      continue
    }
    if (first === 'Kapalı Pozisyonlar') {
      section = 'closed'
      header = null
      continue
    }
    if (first === 'Açık Pozisyonların Özeti') {
      section = 'summary'
      header = null
      continue
    }
    // Trailing total rows such as "Kapanıştaki K/Z".
    if (first && cells.length < 4) continue
    if (!section || section === 'summary') continue

    // The row after a section marker is its header.
    if (!header) {
      header = cells
      continue
    }

    const at = (name) => {
      const idx = header.indexOf(name)
      return idx === -1 ? '' : cells[idx]
    }

    const symbol = normaliseSymbol(at('Sembol'))
    if (!symbol) continue

    const row = {
      symbol,
      name: at('İsim'),
      openDate: parseDate(at('Açılış Tar.')),
      quantity: parseQuantity(at('Miktar')),
      openPrice: parsePrice(at('Açılış F.')),
      side: at('Çeşidi'),
    }

    if (section === 'open') {
      row.currentPrice = parsePrice(at('Mevcut Fiyat'))
      row.commission = parsePrice(at('Komisyon'))
      row.declaredPL = parsePrice(at('Net K/Z'))
      open.push(row)
    } else {
      row.closeDate = parseDate(at('Kapanış Tarihi'))
      row.closePrice = parsePrice(at('Kapanış F.'))
      row.declaredPL = parsePrice(at('Net K/Z'))
      closed.push(row)
    }
  }

  return { open, closed }
}

// --- verification -----------------------------------------------------------

// Per-row arithmetic the export itself asserts. A misread decimal separator
// changes a number by a factor of a thousand, which this catches instantly;
// an off-by-one column shift changes it by more.
//
// Commission is part of the assertion, not a detail: the declared P/L is net of
// it. One leg for a position still open, two for one that was closed.

/**
 * The commission charged per leg, taken from the export rather than assumed.
 *
 * Returns null when the export has no commission column at all (the BIST ones
 * do not), and throws when the rows disagree — at that point a single number
 * cannot describe the closed lots, which carry no commission column of their
 * own, and guessing one would corrupt every closed row by the difference.
 */
export function perLegCommission(open) {
  const values = open.map((r) => r.commission).filter((c) => isFinite(c) && c > 0)
  if (values.length === 0) return null
  const distinct = [...new Set(values.map((v) => v.toFixed(4)))]
  if (distinct.length > 1) {
    throw new Error(
      `open lots declare more than one commission (${distinct.join(', ')}); ` +
        'pass --commission to say which applies to the closed lots'
    )
  }
  return values[0]
}

export function verify({ open, closed }, { openTotal, closedTotal, openPL, commission = 0 } = {}) {
  const problems = []
  const near = (a, b) => Math.abs(a - b) <= 0.05

  for (const row of open) {
    if (!isFinite(row.declaredPL)) continue
    // One leg: the position has been bought and not yet sold.
    const fee = isFinite(row.commission) && row.commission > 0 ? row.commission : commission
    const computed = (row.currentPrice - row.openPrice) * row.quantity - fee
    if (!near(computed, row.declaredPL)) {
      problems.push(
        `${row.symbol} open ${row.openDate}: ` +
          `(${row.currentPrice} − ${row.openPrice}) × ${row.quantity} − ${fee} = ${computed.toFixed(2)}, ` +
          `file says ${row.declaredPL}`
      )
    }
  }

  for (const row of closed) {
    if (!row.closeDate || !isFinite(row.closePrice)) {
      problems.push(`${row.symbol} ${row.openDate}: unreadable close`)
      continue
    }
    // Two legs: bought and sold.
    const computed = (row.closePrice - row.openPrice) * row.quantity - 2 * commission
    // A cent of rounding per lot is expected; anything more is a misread.
    if (isFinite(row.declaredPL) && !near(computed, row.declaredPL)) {
      problems.push(
        `${row.symbol} ${row.openDate}→${row.closeDate}: ` +
          `(${row.closePrice} − ${row.openPrice}) × ${row.quantity} − ${2 * commission} = ${computed.toFixed(2)}, ` +
          `file says ${row.declaredPL}`
      )
    }
  }

  const openValue = open.reduce((sum, r) => sum + r.quantity * r.currentPrice, 0)
  const openPLSum = open.reduce((sum, r) => sum + (isFinite(r.declaredPL) ? r.declaredPL : 0), 0)
  const closedPL = closed.reduce((sum, r) => sum + (r.declaredPL || 0), 0)

  if (openTotal != null && Math.abs(openValue - openTotal) > 1) {
    problems.push(`open positions total ${openValue.toFixed(2)}, file says ${openTotal}`)
  }
  if (openPL != null && Math.abs(openPLSum - openPL) > 1) {
    problems.push(`unrealised P/L total ${openPLSum.toFixed(2)}, file says ${openPL}`)
  }
  if (closedTotal != null && Math.abs(closedPL - closedTotal) > 1) {
    problems.push(`closed P/L total ${closedPL.toFixed(2)}, file says ${closedTotal}`)
  }

  return { problems, openValue, openPLSum, closedPL }
}

// --- funding ----------------------------------------------------------------

/**
 * "2026-02-17=100000" → { date, amount }.
 *
 * Deposits are DECLARED, never derived. The export records trades, not funding,
 * and a deposit invented to make the arithmetic close would be a number in the
 * app that the user never made.
 */
export function parseDeposit(text) {
  const [date, amount] = String(text ?? '').split('=')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '').trim())) return null
  const value = parsePrice(amount)
  if (!isFinite(value) || value <= 0) return null
  return { date: date.trim(), amount: value }
}

/**
 * End-of-day cash, walked forward through every transaction.
 *
 * Worth printing even when it stays positive: a portfolio whose cash goes
 * negative in the middle of its history is not a rounding artefact, it is a
 * missing deposit. The app will flag it later anyway (computeDataWarnings), but
 * by then the number is buried in a screen instead of sitting in front of the
 * person who knows when the money actually arrived.
 */
export function cashRunway(transactions) {
  const sorted = [...transactions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  )
  let cash = 0
  let min = Infinity
  let minDate = null
  let firstNegative = null
  const negativeDays = []

  // Settled at the END of each day, not after each fill. Within one day the
  // order of two trades is an artefact of how the export was sorted, not of
  // what happened, so an intraday dip between a buy and the sell that funded it
  // is noise. A day that CLOSES short is the real thing.
  for (let i = 0; i < sorted.length; i++) {
    const tx = sorted[i]
    const gross = tx.quantity * tx.price
    if (tx.type === 'deposit') cash += gross
    else if (tx.type === 'withdraw') cash -= gross
    else if (tx.type === 'buy') cash -= gross + (tx.fee || 0)
    else if (tx.type === 'sell') cash += gross - (tx.fee || 0)

    const dayEnds = i === sorted.length - 1 || sorted[i + 1].date !== tx.date
    if (!dayEnds) continue

    if (cash < 0) {
      negativeDays.push(tx.date)
      if (!firstNegative) firstNegative = { date: tx.date, cash }
    }
    if (cash < min) {
      min = cash
      minDate = tx.date
    }
  }

  return {
    closing: cash,
    min,
    minDate,
    firstNegative,
    lastNegative: negativeDays[negativeDays.length - 1] || null,
    negativeDays: negativeDays.length,
  }
}

// --- transactions -----------------------------------------------------------

// Only `buy` and `sell` come from the export. Cash arrives separately, via
// --deposit, from what the user says they actually paid in.
//
// The commission rides on each leg as a fee, where the app already knows what
// to do with it: it raises the cost basis of a buy and reduces the proceeds of
// a sell, which is exactly how the export's own P/L was computed.
//
// idPrefix'in ARTIK VARSAYILANI YOK, ve bunun bir bedeli oldu.
//
// Eskiden 'inv' idi. İki ayrı Investing.com dosyasını varsayılanla içe aktarmak
// ikisini de inv-1'den başlatıyordu, yani ikinci içe aktarmanın her satırı
// birincisinden biriyle aynı id'yi taşıyordu. Ağustos 2026'da tam bu oldu: 364
// işlemin 39'u çift id'liydi — inv-39 hem sub-t3'te bir CRDFA alımı hem
// sub-global'de bir TEM satışıydı.
//
// Tek tarayıcıda hiçbir belirtisi yok; hiçbir ekran id'ye bakmıyor. Senkron ise
// tamamen id'ye bakıyor ve çakışan iki satırdan biri sessizce diğerinin üstüne
// yazılıyor.
//
// Zorunlu hale getirmek, "varsayılanı benzersiz yapmak"tan iyi: çağıran ne
// yazdığını görüyor ve aynı dosyayı iki kez aktarmak hâlâ aynı id'leri üretiyor
// (yani tekrar aktarmak kayıtları ikizlemiyor). Kaybolan tek şey, sessizce
// yanlış olanı seçme imkânı.
export function toTransactions(
  { open, closed },
  portfolioId,
  { assetType = 'bist', currency = 'TRY', commission = 0, idPrefix } = {}
) {
  if (!idPrefix) {
    throw new Error(
      'toTransactions: idPrefix zorunlu. Her kaynak dosya kendi onekini almali ' +
      '(orn. "t3", "amerika"), yoksa iki ice aktarma ayni id\'leri uretir.'
    )
  }

  const transactions = []
  let n = 0
  const push = (tx) => transactions.push({ id: `${idPrefix}-${++n}`, ...tx })

  const base = { assetType, currency, portfolioId }
  const feeFor = (row) =>
    isFinite(row.commission) && row.commission > 0 ? row.commission : commission

  for (const row of open) {
    push({
      ...base,
      date: row.openDate,
      type: 'buy',
      symbol: row.symbol,
      quantity: row.quantity,
      price: row.openPrice,
      fee: feeFor(row),
      notes: row.name,
    })
  }

  for (const row of closed) {
    push({
      ...base,
      date: row.openDate,
      type: 'buy',
      symbol: row.symbol,
      quantity: row.quantity,
      price: row.openPrice,
      fee: commission,
      notes: row.name,
    })
    push({
      ...base,
      date: row.closeDate,
      type: 'sell',
      symbol: row.symbol,
      quantity: row.quantity,
      price: row.closePrice,
      fee: commission,
      notes: row.name,
    })
  }

  // Chronological, so a sell never precedes the buy that supplies it.
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return transactions
}

/** Declared funding, in the shape the app stores cash in. */
export function toDeposits(deposits, portfolioId, currency = 'TRY', idPrefix) {
  if (!idPrefix) {
    throw new Error('toDeposits: idPrefix zorunlu — bkz. toTransactions.')
  }
  return deposits.map((d, i) => ({
    id: `${idPrefix}-${i + 1}`,
    date: d.date,
    type: 'deposit',
    assetType: 'cash',
    symbol: 'CASH',
    quantity: 1,
    price: d.amount,
    fee: 0,
    currency,
    portfolioId,
    notes: 'Para girişi',
  }))
}

// --- CLI --------------------------------------------------------------------

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

/** Every occurrence of a repeatable flag, e.g. --deposit given twice. */
function argAll(name) {
  const values = []
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) values.push(process.argv[i + 1])
  })
  return values
}

const fmtTRY = (n) => '₺' + n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })

if (process.argv[1] && process.argv[1].endsWith('import-investing.mjs')) {
  const backupPath = arg('backup')
  const csvPath = arg('csv')
  const intoName = arg('into')
  const dropName = arg('drop')
  const outPath = arg('out')
  const assetType = arg('asset-type', 'bist')
  const currency = (arg('currency', 'TRY') || 'TRY').toUpperCase()
  const openTotal = arg('open-total') ? parsePrice(arg('open-total')) : null
  const closedTotal = arg('closed-total') ? parsePrice(arg('closed-total')) : null
  const openPL = arg('open-pl') ? parsePrice(arg('open-pl')) : null

  if (!backupPath || !csvPath || !intoName || !outPath) {
    console.error(
      'Usage: node scripts/import-investing.mjs --backup B.json --csv E.csv ' +
        '--into "T3" [--drop "Claude T3"] --out OUT.json ' +
        '[--asset-type bist|global] [--currency TRY|USD] [--commission 1.50] ' +
        '[--deposit 2025-07-20=100000] [--open-total "234.554,24"] ' +
        '[--open-pl "331,36"] [--closed-total "29.592,05"]'
    )
    process.exit(1)
  }

  const depositArgs = argAll('deposit')
  const deposits = []
  for (const raw of depositArgs) {
    const parsed = parseDeposit(raw)
    if (!parsed) {
      console.error(`Unreadable --deposit "${raw}". Expected YYYY-MM-DD=amount.`)
      process.exit(1)
    }
    deposits.push(parsed)
  }
  deposits.sort((a, b) => (a.date < b.date ? -1 : 1))

  const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
  const parsed = parseInvestingExport(readFileSync(csvPath, 'utf8'))

  // Taken from the export when it carries one, so the closed lots — which have
  // no commission column — are charged what the open ones actually were.
  let commission = arg('commission') ? parsePrice(arg('commission')) : null
  if (commission == null) {
    try {
      commission = perLegCommission(parsed.open)
    } catch (err) {
      console.error(err.message)
      process.exit(1)
    }
  }
  commission = commission || 0

  const money = (n) =>
    (currency === 'TRY' ? '₺' : currency === 'USD' ? '$' : currency + ' ') +
    n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })

  console.log(`\nParsed ${parsed.open.length} open lots, ${parsed.closed.length} closed lots.`)
  if (commission > 0) console.log(`Commission per leg  : ${money(commission)}`)

  const { problems, openValue, openPLSum, closedPL } = verify(parsed, {
    openTotal,
    closedTotal,
    openPL,
    commission,
  })
  console.log(`Open positions value: ${money(openValue)}`)
  // Only when the export declares it — the BIST exports carry no such column,
  // and printing a summed-nothing as a confident 0 would be a small lie.
  if (parsed.open.some((r) => isFinite(r.declaredPL))) {
    console.log(`Unrealised P/L      : ${money(openPLSum)}`)
  }
  console.log(`Realised P/L        : ${money(closedPL)}`)

  if (problems.length > 0) {
    console.error(`\n${problems.length} row(s) failed verification — NOT writing an output file:\n`)
    for (const p of problems.slice(0, 20)) console.error('  ' + p)
    if (problems.length > 20) console.error(`  … and ${problems.length - 20} more`)
    console.error('\nThe export contradicts itself, or it was read wrong. Either way, stop here.')
    process.exit(1)
  }
  console.log('Verification: every row and every declared total agrees.\n')

  const target = backup.subPortfolios.find((p) => p.name === intoName)
  if (!target) {
    console.error(`No sub-portfolio named "${intoName}". Found: ` +
      backup.subPortfolios.map((p) => p.name).join(', '))
    process.exit(1)
  }

  let transactions = backup.transactions

  if (dropName) {
    const doomed = backup.subPortfolios.find((p) => p.name === dropName)
    if (!doomed) {
      console.error(`No sub-portfolio named "${dropName}" to drop.`)
      process.exit(1)
    }
    const removed = transactions.filter((t) => t.portfolioId === doomed.id).length
    transactions = transactions.filter((t) => t.portfolioId !== doomed.id)
    backup.subPortfolios = backup.subPortfolios.filter((p) => p.id !== doomed.id)
    console.log(`Dropped "${dropName}" and its ${removed} transactions.`)
  }

  // Replace only the traded positions of the kind this export describes. Its
  // cash is replaced too, but only when funding was declared on the command
  // line — otherwise whatever the portfolio already had is left alone.
  const drops = new Set([assetType])
  if (deposits.length > 0) drops.add('cash')

  const kept = transactions.filter(
    (t) => t.portfolioId !== target.id || !drops.has(t.assetType)
  )
  const replaced = transactions.length - kept.length
  // Önek hedef portföyden türüyor: aynı dosyayı aynı portföye tekrar aktarmak
  // aynı id'leri üretir (ikizlenme yok), farklı portföylere aktarmak farklı
  // id'ler üretir (çakışma yok).
  const prefix = target.id.replace(/[^a-z0-9]+/gi, '-')
  const imported = toTransactions(parsed, target.id, { assetType, currency, commission, idPrefix: `${prefix}-tx` })
  const funding = toDeposits(deposits, target.id, currency, `${prefix}-cash`)

  console.log(
    `"${intoName}": replaced ${replaced} ${assetType} transactions with ` +
      `${imported.length + funding.length}, kept ` +
      `${kept.filter((t) => t.portfolioId === target.id).length} others.`
  )
  for (const d of funding) console.log(`  deposit ${d.date}  ${money(d.price)}`)

  const targetTxns = [...kept.filter((t) => t.portfolioId === target.id), ...funding, ...imported]

  // Does the funding on record actually cover the trading? Reported in the
  // portfolio's own currency, so no exchange rate can distort the answer.
  const single = new Set(targetTxns.map((t) => t.currency))
  if (single.size === 1) {
    const runway = cashRunway(targetTxns)
    console.log(
      `\nCash: closing ${money(runway.closing)}, low ${money(runway.min)} on ${runway.minDate}`
    )
    if (runway.firstNegative) {
      console.log(
        `\n  WARNING: ${runway.negativeDays} day(s) close with negative cash, from ` +
          `${runway.firstNegative.date} to ${runway.lastNegative}, worst ` +
          `${money(runway.min)} on ${runway.minDate}.\n` +
          '  The trades are real, so the shortfall means funding is missing or dated\n' +
          '  later than it arrived. Written anyway — this is a question for the person\n' +
          '  who knows when the money moved, not something to paper over with a\n' +
          '  deposit nobody made.'
      )
    }
  } else {
    // Mixed currencies need exchange rates to add up, and this script has none.
    // The app does; it will report on this portfolio itself.
    console.log(
      `\nCash: not walked — this portfolio holds ${[...single].sort().join(' and ')} ` +
        'and converting between them needs rates the app has and this does not.'
    )
  }

  backup.transactions = [...kept.filter((t) => t.portfolioId !== target.id), ...targetTxns]
  backup.exportedAt = new Date().toISOString()

  writeFileSync(outPath, JSON.stringify(backup, null, 2))
  console.log(`\nWrote ${outPath} — ${backup.transactions.length} transactions total.`)
  console.log('Restore it from Settings → Restore from backup.\n')
}
