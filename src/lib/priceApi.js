// Multi-source price API.
//
// Sources by asset type:
//   - global → /api/global (proxy to Stooq, EOD data, NO KEY)
//             → optionally Finnhub (intraday, requires user key) if provided
//   - bist   → /api/bist (proxy to İş Yatırım, NO KEY)
//   - tefas  → /api/tefas (proxy to FonBul, NO KEY)
//
// Stooq is the default for global because it requires zero setup — perfect
// for sharing the app publicly. If a user provides a Finnhub API key in
// Settings, intraday prices are used instead (Finnhub takes priority).

const FINNHUB_BASE = 'https://finnhub.io/api/v1'

export const PRICE_STALE_AFTER_MS = 60 * 60 * 1000
export const PRICE_VERY_STALE_AFTER_MS = 24 * 60 * 60 * 1000

// === FINNHUB (optional, only if user provides key) ===

async function fetchFinnhubQuote(symbol, apiKey) {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('INVALID_KEY')
    if (res.status === 429) throw new Error('RATE_LIMIT')
    throw new Error(`HTTP ${res.status}`)
  }
  const data = await res.json()
  if (!data || typeof data.c !== 'number' || data.c === 0) {
    throw new Error('NOT_FOUND')
  }
  return {
    symbol,
    price: data.c,
    previousClose: data.pc,
    dayChangePct: data.dp,
    currency: 'USD',
    fetchedAt: Date.now(),
  }
}

async function fetchFinnhubBatch(symbols, apiKey, onProgress) {
  if (!apiKey) throw new Error('NO_API_KEY')
  const results = {}
  const errors = []
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]
    try {
      results[sym] = await fetchFinnhubQuote(sym, apiKey)
    } catch (err) {
      errors.push({ symbol: sym, error: err.message })
      if (err.message === 'INVALID_KEY' && i === 0) throw err
      if (err.message === 'RATE_LIMIT') break
    }
    onProgress?.(i + 1, symbols.length)
    if (i < symbols.length - 1) await sleep(1100)
  }
  return { results, errors }
}

// === GLOBAL via proxy/Stooq (default, no key) ===

async function fetchGlobalBatch(symbols) {
  if (symbols.length === 0) return { results: {}, errors: [] }
  const url = `/api/global?symbols=${encodeURIComponent(symbols.join(','))}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Global proxy HTTP ${res.status}`)
  const data = await res.json()
  const results = {}
  for (const [sym, quote] of Object.entries(data.results || {})) {
    results[sym] = { ...quote, fetchedAt: Date.now() }
  }
  return { results, errors: data.errors || [] }
}

// === BIST (via proxy /api/bist) ===

async function fetchBistBatch(symbols) {
  if (symbols.length === 0) return { results: {}, errors: [] }
  const url = `/api/bist?symbols=${encodeURIComponent(symbols.join(','))}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`BIST proxy HTTP ${res.status}`)
  const data = await res.json()
  const results = {}
  for (const [sym, quote] of Object.entries(data.results || {})) {
    results[sym] = { ...quote, fetchedAt: Date.now() }
  }
  return { results, errors: data.errors || [] }
}

// === TEFAS (via proxy /api/tefas) ===

async function fetchTefasBatch(symbols) {
  if (symbols.length === 0) return { results: {}, errors: [] }
  const url = `/api/tefas?symbols=${encodeURIComponent(symbols.join(','))}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`TEFAS proxy HTTP ${res.status}`)
  const data = await res.json()
  const results = {}
  for (const [sym, quote] of Object.entries(data.results || {})) {
    results[sym] = { ...quote, fetchedAt: Date.now() }
  }
  return { results, errors: data.errors || [] }
}

// === UNIFIED ENTRY POINT ===

// Refresh all assets in one call. Routes each symbol to its appropriate source.
//   - Global: Stooq via /api/global (default, no key needed)
//   - Global: Finnhub (only if user provided a key — takes priority for intraday data)
//   - BIST: /api/bist
//   - TEFAS: /api/tefas
export async function fetchAllPrices({ holdings, finnhubApiKey, onProgress }) {
  const globalSyms = []
  const bistSyms = []
  const tefasSyms = []

  for (const h of holdings) {
    if (h.assetType === 'global' && !h.symbol.includes('.')) {
      globalSyms.push(h.symbol)
    } else if (h.assetType === 'bist') {
      bistSyms.push(h.symbol)
    } else if (h.assetType === 'tefas') {
      tefasSyms.push(h.symbol)
    }
  }

  const allResults = {}
  const allErrors = []
  const sourceStats = {}

  // BIST first
  if (bistSyms.length > 0) {
    onProgress?.('bist', 0, bistSyms.length)
    try {
      const { results, errors } = await fetchBistBatch(bistSyms)
      Object.assign(allResults, results)
      allErrors.push(...errors)
      sourceStats.bist = { ok: Object.keys(results).length, failed: errors.length }
      onProgress?.('bist', bistSyms.length, bistSyms.length)
    } catch (err) {
      sourceStats.bist = { ok: 0, failed: bistSyms.length, error: err.message }
      allErrors.push(...bistSyms.map((s) => ({ symbol: s, error: err.message })))
    }
  }

  // TEFAS
  if (tefasSyms.length > 0) {
    onProgress?.('tefas', 0, tefasSyms.length)
    try {
      const { results, errors } = await fetchTefasBatch(tefasSyms)
      Object.assign(allResults, results)
      allErrors.push(...errors)
      sourceStats.tefas = { ok: Object.keys(results).length, failed: errors.length }
      onProgress?.('tefas', tefasSyms.length, tefasSyms.length)
    } catch (err) {
      sourceStats.tefas = { ok: 0, failed: tefasSyms.length, error: err.message }
      allErrors.push(...tefasSyms.map((s) => ({ symbol: s, error: err.message })))
    }
  }

  // Global — Finnhub if key provided (intraday), otherwise Stooq via proxy (EOD, no key)
  if (globalSyms.length > 0) {
    if (finnhubApiKey?.trim()) {
      // User opted in to Finnhub for intraday prices
      try {
        const { results, errors } = await fetchFinnhubBatch(globalSyms, finnhubApiKey, (cur, tot) =>
          onProgress?.('global', cur, tot)
        )
        Object.assign(allResults, results)
        allErrors.push(...errors)
        sourceStats.global = { ok: Object.keys(results).length, failed: errors.length, source: 'finnhub' }
      } catch (err) {
        sourceStats.global = { ok: 0, failed: globalSyms.length, error: err.message, source: 'finnhub' }
        allErrors.push(...globalSyms.map((s) => ({ symbol: s, error: err.message })))
      }
    } else {
      // Default path: Stooq via proxy
      onProgress?.('global', 0, globalSyms.length)
      try {
        const { results, errors } = await fetchGlobalBatch(globalSyms)
        Object.assign(allResults, results)
        allErrors.push(...errors)
        sourceStats.global = { ok: Object.keys(results).length, failed: errors.length, source: 'stooq' }
        onProgress?.('global', globalSyms.length, globalSyms.length)
      } catch (err) {
        sourceStats.global = { ok: 0, failed: globalSyms.length, error: err.message, source: 'stooq' }
        allErrors.push(...globalSyms.map((s) => ({ symbol: s, error: err.message })))
      }
    }
  }

  return { results: allResults, errors: allErrors, sourceStats }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Helper used by Settings table — kept for backward compatibility
export function isFetchableViaFinnhub(symbol, assetType) {
  return assetType === 'global' && symbol && !symbol.includes('.')
}
