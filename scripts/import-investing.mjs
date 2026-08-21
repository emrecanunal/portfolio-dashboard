// Turn an Investing.com portfolio export into transactions, and rewrite a
// backup file around them.
//
//   node scripts/import-investing.mjs \
//     --backup portfolio-backup.json \
//     --csv investing-export.csv \
//     --into "T3" \
//     --drop "Claude T3" \
//     --out portfolio-backup-imported.json
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

/** Turkish price: dot groups thousands, comma is the decimal point. */
export function parsePrice(text) {
  if (typeof text === 'number') return text
  const cleaned = String(text ?? '')
    .replace(/[₺%\s]/g, '')
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

/** "RALYH.IS" → "RALYH". The app stores BIST codes bare. */
export function normaliseSymbol(text) {
  return String(text ?? '')
    .trim()
    .toUpperCase()
    .replace(/\.IS$/, '')
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
export function verify({ open, closed }, { openTotal, closedTotal } = {}) {
  const problems = []

  for (const row of closed) {
    if (!row.closeDate || !isFinite(row.closePrice)) {
      problems.push(`${row.symbol} ${row.openDate}: unreadable close`)
      continue
    }
    const computed = (row.closePrice - row.openPrice) * row.quantity
    // A cent of rounding per lot is expected; anything more is a misread.
    if (isFinite(row.declaredPL) && Math.abs(computed - row.declaredPL) > 0.05) {
      problems.push(
        `${row.symbol} ${row.openDate}→${row.closeDate}: ` +
          `(${row.closePrice} − ${row.openPrice}) × ${row.quantity} = ${computed.toFixed(2)}, ` +
          `file says ${row.declaredPL}`
      )
    }
  }

  const openValue = open.reduce((sum, r) => sum + r.quantity * r.currentPrice, 0)
  const closedPL = closed.reduce((sum, r) => sum + (r.declaredPL || 0), 0)

  if (openTotal != null && Math.abs(openValue - openTotal) > 1) {
    problems.push(`open positions total ${openValue.toFixed(2)}, file says ${openTotal}`)
  }
  if (closedTotal != null && Math.abs(closedPL - closedTotal) > 1) {
    problems.push(`closed P/L total ${closedPL.toFixed(2)}, file says ${closedTotal}`)
  }

  return { problems, openValue, closedPL }
}

// --- transactions -----------------------------------------------------------

// Only `buy` and `sell`. No cash: the export records trades, not funding, and
// inventing deposits to balance them would put numbers in the app that the
// user never entered. computeDataWarnings will flag the resulting negative
// cash, which is honest — the deposits genuinely are missing until they add
// them.
export function toTransactions({ open, closed }, portfolioId, idPrefix = 'inv') {
  const transactions = []
  let n = 0
  const push = (tx) => transactions.push({ id: `${idPrefix}-${++n}`, ...tx })

  const base = {
    assetType: 'bist',
    currency: 'TRY',
    fee: 0,
    portfolioId,
  }

  for (const row of open) {
    push({
      ...base,
      date: row.openDate,
      type: 'buy',
      symbol: row.symbol,
      quantity: row.quantity,
      price: row.openPrice,
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
      notes: row.name,
    })
    push({
      ...base,
      date: row.closeDate,
      type: 'sell',
      symbol: row.symbol,
      quantity: row.quantity,
      price: row.closePrice,
      notes: row.name,
    })
  }

  // Chronological, so a sell never precedes the buy that supplies it.
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return transactions
}

// --- CLI --------------------------------------------------------------------

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

if (process.argv[1] && process.argv[1].endsWith('import-investing.mjs')) {
  const backupPath = arg('backup')
  const csvPath = arg('csv')
  const intoName = arg('into')
  const dropName = arg('drop')
  const outPath = arg('out')
  const openTotal = arg('open-total') ? parsePrice(arg('open-total')) : null
  const closedTotal = arg('closed-total') ? parsePrice(arg('closed-total')) : null

  if (!backupPath || !csvPath || !intoName || !outPath) {
    console.error(
      'Usage: node scripts/import-investing.mjs --backup B.json --csv E.csv ' +
        '--into "T3" [--drop "Claude T3"] --out OUT.json ' +
        '[--open-total "234.554,24"] [--closed-total "29.592,05"]'
    )
    process.exit(1)
  }

  const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
  const parsed = parseInvestingExport(readFileSync(csvPath, 'utf8'))

  console.log(`\nParsed ${parsed.open.length} open lots, ${parsed.closed.length} closed lots.`)

  const { problems, openValue, closedPL } = verify(parsed, { openTotal, closedTotal })
  console.log(`Open positions value : ₺${openValue.toLocaleString('tr-TR')}`)
  console.log(`Realised P/L         : ₺${closedPL.toLocaleString('tr-TR')}`)

  if (problems.length > 0) {
    console.error(`\n${problems.length} row(s) failed verification — NOT writing an output file:\n`)
    for (const p of problems.slice(0, 20)) console.error('  ' + p)
    if (problems.length > 20) console.error(`  … and ${problems.length - 20} more`)
    console.error('\nThe export contradicts itself, or it was read wrong. Either way, stop here.')
    process.exit(1)
  }
  console.log('Verification: every row and both totals agree with the file.\n')

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

  // Replace the target's traded positions; leave its cash and fund entries
  // alone, since the export contains neither and the user adds those by hand.
  const kept = transactions.filter(
    (t) => t.portfolioId !== target.id || t.assetType !== 'bist'
  )
  const replaced = transactions.length - kept.length
  const imported = toTransactions(parsed, target.id)

  console.log(
    `"${intoName}": replaced ${replaced} BIST transactions with ${imported.length}, ` +
      `kept ${kept.filter((t) => t.portfolioId === target.id).length} non-BIST.`
  )

  backup.transactions = [...kept, ...imported]
  backup.exportedAt = new Date().toISOString()

  writeFileSync(outPath, JSON.stringify(backup, null, 2))
  console.log(`\nWrote ${outPath} — ${backup.transactions.length} transactions total.`)
  console.log('Restore it from Settings → Restore from backup.\n')
}
