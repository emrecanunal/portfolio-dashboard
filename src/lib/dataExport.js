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

// Restore state from a JSON backup file.
// Returns: { ok: true, summary: {...} } | { ok: false, error: '...' }
export function parseJsonBackup(text) {
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Invalid file format' }
    }
    if (!Array.isArray(data.transactions) || !Array.isArray(data.subPortfolios)) {
      return { ok: false, error: 'Missing required fields (transactions or subPortfolios)' }
    }
    return {
      ok: true,
      data: {
        transactions: data.transactions,
        subPortfolios: data.subPortfolios,
        priceCache: data.priceCache || {},
        priceHistory: data.priceHistory || null,
        fxHistory: data.fxHistory || null,
        settings: data.settings || {},
      },
      summary: {
        transactions: data.transactions.length,
        portfolios: data.subPortfolios.length,
        exportedAt: data.exportedAt,
      },
    }
  } catch (err) {
    return { ok: false, error: 'Failed to parse JSON: ' + err.message }
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
