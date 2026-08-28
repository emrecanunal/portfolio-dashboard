// Multi-source price API.
//
// Sources by asset type — all three go through our own /api/* proxies, and
// none of them needs a key from the user:
//   - global → /api/global (Finnhub, key lives on the server)
//   - bist   → /api/bist   (İş Yatırım)
//   - tefas  → /api/tefas  (tefas.gov.tr → FonBul)
//
// THE USER-SUPPLIED FINNHUB KEY IS GONE
//
// Until phase 3 this file also spoke to finnhub.io directly with a key the user
// pasted into Settings. That existed because Stooq — the keyless global source —
// closed in March 2026 and something had to fill the gap.
//
// It filled it badly: the key had to be re-entered on every device, it sat in
// plain view in the browser's network requests, and every device spent the same
// quota fetching the same symbol. The key now lives in a server env var and
// api/global.js uses it, so the browser never sees one.
//
// This path is what runs when there is no backend configured (local-only mode).
// With a backend, store.js goes to /api/refresh-prices instead, which also
// writes the shared prices_latest table that every device reads.

export const PRICE_STALE_AFTER_MS = 60 * 60 * 1000
export const PRICE_VERY_STALE_AFTER_MS = 24 * 60 * 60 * 1000

// === GLOBAL (via proxy /api/global — Finnhub, server-side key) ===

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
//   - Global: /api/global
//   - BIST:   /api/bist
//   - TEFAS:  /api/tefas
// `sources` limits the refresh to a subset, e.g. ['bist', 'global'].
// Auto-refresh uses this because the three sources move on completely
// different clocks: BIST and global equities tick through the trading day,
// while TEFAS funds publish a single price per day. Polling funds every five
// minutes would re-fetch the same number all day and burn through TEFAS's
// 6-requests-per-minute allowance for nothing.
export async function fetchAllPrices({
  holdings,
  onProgress,
  sources = ['bist', 'tefas', 'global'],
}) {
  const wanted = new Set(sources)
  const globalSyms = []
  const bistSyms = []
  const tefasSyms = []

  for (const h of holdings) {
    if (!wanted.has(h.assetType)) continue
    // Note: dotted US tickers like BRK.B, BF.B are legitimate global symbols.
    // BIST/TEFAS already routed below by assetType, so no need to exclude here.
    if (h.assetType === 'global') {
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

  // Global — tek yol kaldı: kendi proxy'miz, anahtar sunucuda.
  if (globalSyms.length > 0) {
    onProgress?.('global', 0, globalSyms.length)
    try {
      const { results, errors } = await fetchGlobalBatch(globalSyms)
      Object.assign(allResults, results)
      allErrors.push(...errors)
      sourceStats.global = { ok: Object.keys(results).length, failed: errors.length, source: 'finnhub' }
      onProgress?.('global', globalSyms.length, globalSyms.length)
    } catch (err) {
      sourceStats.global = { ok: 0, failed: globalSyms.length, error: err.message, source: 'finnhub' }
      allErrors.push(...globalSyms.map((s) => ({ symbol: s, error: err.message })))
    }
  }

  return { results: allResults, errors: allErrors, sourceStats }
}

// Ayarlar'daki fiyat tablosu kullanıyor: bir sembolün otomatik fiyatlanıp
// fiyatlanamayacağı. Adı tarihsel — artık "Finnhub'a uygun mu" değil, "global
// bir hisse mi" sorusunu soruyor, ki cevabı belirleyen tek şey zaten oydu.
export function isFetchableViaFinnhub(symbol, assetType) {
  return assetType === 'global' && !!symbol
}
