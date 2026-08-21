// Data import/export utilities for backup and CSV export.

// === DOWNLOAD HELPERS ===

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so browser can finish download
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function timestampSuffix() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

// === JSON BACKUP ===

// Export the full app state (settings + portfolios + transactions + priceCache).
// Excludes anything sensitive: NEVER includes the Finnhub API key.
export function exportJsonBackup(state) {
  const sanitized = {
    version: 2,
    exportedAt: new Date().toISOString(),
    transactions: state.transactions,
    subPortfolios: state.subPortfolios,
    priceCache: state.priceCache,
    // The month-end archives are re-derivable from the sources, but only
    // while those sources still answer — and they are small. Back them up.
    priceHistory: state.priceHistory,
    fxHistory: state.fxHistory,
    settings: {
      ...state.settings,
      // Strip API key from backup file for safety
      finnhubApiKey: '',
    },
  }
  const json = JSON.stringify(sanitized, null, 2)
  downloadBlob(`portfolio-backup-${timestampSuffix()}.json`, json, 'application/json')
}

// === RESTORE ===
//
// Restore is the most destructive thing this app can do: it replaces every
// transaction, cannot be undone, and feeds the data that every calculation in
// calculations.js reads. A file written months ago will not match today's
// schema, and one malformed row is enough to make a downstream figure wrong
// while still looking entirely plausible. So nothing is trusted here.

const TXN_TYPES = ['buy', 'sell', 'deposit', 'withdraw', 'exchange']
const ASSET_TYPES = ['bist', 'tefas', 'global', 'cash']

// Settings that describe the USER and belong in a backup.
//
// Deliberately an allowlist. A backup also contains a snapshot of things that
// describe the MOMENT it was taken — exchange rates, when prices were last
// fetched — and restoring a three-month-old USD rate over today's would
// silently rewrite every converted figure in the app. That is the worst kind
// of damage: invisible, and everywhere at once. A blocklist would let the next
// field of that sort through by default; this way it has to be added on purpose.
export const RESTORABLE_SETTINGS = [
  'baseCurrency',
  'language',
  'theme',
  'monthlyExpensesUSD',
  'withdrawalRate',
  'activeFireStage',
  'fireTargetUSD',
  'cashThresholdPct',
  'fireLookbackMonths',
  'autoRefreshEnabled',
  'autoRefreshMinutes',
]

const isPositiveNumber = (v) => typeof v === 'number' && isFinite(v) && v >= 0
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

// Returns the list of field names that are wrong. Empty means the row is sound.
export function validateTransaction(tx, knownPortfolioIds = null) {
  const problems = []
  if (!tx || typeof tx !== 'object') return ['record']

  // Calendar day, no time, no zone — the format every date comparison assumes.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tx.date || ''))) problems.push('date')
  if (!TXN_TYPES.includes(tx.type)) problems.push('type')
  if (!ASSET_TYPES.includes(tx.assetType)) problems.push('assetType')
  if (!isNonEmptyString(tx.symbol)) problems.push('symbol')
  if (!isNonEmptyString(tx.currency)) problems.push('currency')
  if (!isNonEmptyString(tx.portfolioId)) problems.push('portfolioId')
  if (!isPositiveNumber(tx.quantity)) problems.push('quantity')
  if (!isPositiveNumber(tx.price)) problems.push('price')
  if (tx.fee != null && !isPositiveNumber(tx.fee)) problems.push('fee')

  if (tx.type === 'exchange') {
    // Both sides are required: computeCashByCurrency debits `quantity` from one
    // currency and credits `toAmount` to another, so a missing half destroys
    // money rather than moving it.
    if (!isPositiveNumber(Number(tx.toAmount)) || Number(tx.toAmount) <= 0) {
      problems.push('toAmount')
    }
    if (!isNonEmptyString(tx.toCurrency) || tx.toCurrency === tx.currency) {
      problems.push('toCurrency')
    }
  }

  // An orphaned portfolioId leaves a transaction that is counted in totals but
  // belongs to no portfolio the user can see.
  if (
    knownPortfolioIds &&
    isNonEmptyString(tx.portfolioId) &&
    !knownPortfolioIds.has(tx.portfolioId)
  ) {
    problems.push('portfolioId')
  }

  return problems
}

// Restore state from a JSON backup file.
//
// Returns { ok: true, data, summary, issues } | { ok: false, error }
//   data.settings   only the allowlisted keys that were present in the file
//   data.priceHistory / fxHistory  null when the file predates them, so the
//                     caller can keep what it already has rather than wiping
//                     months that cost API calls — against a 25-a-day quota —
//                     to rebuild
//   issues          one entry per rejected transaction, naming the bad fields
export function parseJsonBackup(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: 'Failed to parse JSON: ' + err.message }
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Invalid file format' }
  }
  if (!Array.isArray(data.transactions) || !Array.isArray(data.subPortfolios)) {
    return { ok: false, error: 'Missing required fields (transactions or subPortfolios)' }
  }

  const subPortfolios = data.subPortfolios.filter(
    (p) => p && isNonEmptyString(p.id) && isNonEmptyString(p.name)
  )
  const knownIds = new Set(subPortfolios.map((p) => p.id))

  const transactions = []
  const issues = []
  data.transactions.forEach((tx, index) => {
    const problems = validateTransaction(tx, knownIds)
    if (problems.length === 0) transactions.push(tx)
    else issues.push({ index, id: tx?.id ?? null, symbol: tx?.symbol ?? null, problems })
  })

  // A file where nothing survived is not a partial restore, it is the wrong
  // file — or one this version cannot read. Either way, do not touch the data.
  if (transactions.length === 0 && data.transactions.length > 0) {
    return {
      ok: false,
      error: 'No usable transactions in this file',
      issues,
    }
  }

  const settings = {}
  for (const key of RESTORABLE_SETTINGS) {
    if (data.settings && data.settings[key] !== undefined) settings[key] = data.settings[key]
  }

  return {
    ok: true,
    data: {
      transactions,
      subPortfolios,
      priceCache: data.priceCache || {},
      priceHistory: data.priceHistory || null,
      fxHistory: data.fxHistory || null,
      settings,
    },
    issues,
    summary: {
      transactions: transactions.length,
      dropped: issues.length,
      portfolios: subPortfolios.length,
      exportedAt: data.exportedAt,
      // Backups written before versioning claim nothing. Treat that as 0
      // rather than assuming they match today's schema.
      version: Number(data.version) || 0,
    },
  }
}

// === CSV EXPORT (transactions) ===

// CSV-escape a single cell: wrap in quotes if it contains comma, quote, or newline
function csvCell(val) {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function exportTransactionsCsv(transactions, subPortfolios) {
  const headers = [
    'date',
    'type',
    'asset_type',
    'symbol',
    'quantity',
    'price',
    'currency',
    // Populated for type='exchange' only — the credited side of an FX conversion.
    'to_amount',
    'to_currency',
    'fee',
    'portfolio',
    'notes',
  ]

  const portfolioById = new Map(subPortfolios.map((p) => [p.id, p.name]))

  const rows = [...transactions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((tx) =>
      [
        tx.date,
        tx.type,
        tx.assetType,
        tx.symbol,
        tx.quantity,
        tx.price,
        tx.currency,
        tx.toAmount ?? '',
        tx.toCurrency ?? '',
        tx.fee || 0,
        portfolioById.get(tx.portfolioId) || tx.portfolioId,
        tx.notes || '',
      ]
        .map(csvCell)
        .join(',')
    )

  // Prepend BOM so Excel recognizes UTF-8 (handles Turkish characters correctly)
  const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
  downloadBlob(`transactions-${timestampSuffix()}.csv`, csv, 'text/csv;charset=utf-8')
}
