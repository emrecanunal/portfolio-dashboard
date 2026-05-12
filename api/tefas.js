// TEFAS fund price fetcher via FonBul (Halk Yatırım) API.
// Ported from the V7.3 Python reference implementation:
//   1. Load FonBul fund page
//   2. Extract Servisurl + sessionKey from inline JS
//   3. POST to RaporTabloHesapla with fund-specific report names
//   4. Parse the response for the price field
//
// Works as both a Vercel serverless function and an Express route handler.
//
// Usage:  GET /api/tefas?symbols=AFA,TI2,GAF
// Returns: { results: { AFA: { price, currency, name }, ... }, errors: [...] }

const FONBUL_BASE = 'https://fonbul.halkyatirim.com.tr'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// The FonBul API endpoint accepts POST requests directly without authentication.
// Discovered via curl test: the ?key= parameter is no longer required.
// As of May 2026, the Servisurl in the page is "/FonBulPlusServis/fonbul/tr"
// which we hardcode here for stability.
const FONBUL_API_BASE = `${FONBUL_BASE}/FonBulPlusServis/fonbul/tr`

// Call the report endpoint directly — no session/sessionKey needed
async function fonbulReport(fundCode, reportName) {
  const apiUrl = `${FONBUL_API_BASE}/RaporTabloHesapla`
  const payload = {
    RaporParams: {
      Url: reportName,
      RaporParametreleri: [{ key: 'Kod', value: fundCode }],
    },
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${FONBUL_BASE}/YatirimFonlari/FonProfilleri/FonKunye/${encodeURIComponent(fundCode)}`,
      'User-Agent': UA,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error(`FonBul API HTTP ${res.status}`)
  }

  return res.json()
}

// Step 3: extract a value from the report by field label
// FonBul JSVeriler row structure (as of May 2026):
//   {
//     "o": { Baslik1: 1.094314 },        // raw numeric value (preferred)
//     "s": { Baslik1: "1,09431" },        // Turkish-formatted display string
//     "baslik": { Text: "Fiyatı" }        // human label
//   }
// We try the raw numeric first; fall back to the string if needed.
function extractField(reportData, fieldKeywords, opts = {}) {
  const preferNumeric = opts.preferNumeric !== false
  try {
    const tablo = reportData?.TabloListesi?.[0]
    if (!tablo) return null
    const veriler = tablo.JSVeriler || []
    const prop = tablo.BaslikListe?.[0]?.PropertyName || ''
    for (const v of veriler) {
      const label = v?.baslik?.Text || ''
      for (const kw of fieldKeywords) {
        if (label.toLowerCase().includes(kw.toLowerCase())) {
          // Try raw numeric (o.Baslik1) first — already parsed as a number
          if (preferNumeric) {
            const numVal = v?.o?.[prop]
            if (typeof numVal === 'number' && !isNaN(numVal)) return numVal
          }
          // Fall back to formatted string (s.Baslik1)
          const strVal = v?.s?.[prop]
          if (strVal !== undefined && strVal !== null && strVal !== '') return strVal
        }
      }
    }
  } catch {
    // fall through
  }
  return null
}

// Parse Turkish-formatted number: "1.234,56" → 1234.56
function parseTurkishNumber(str) {
  if (str === null || str === undefined) return null
  const s = String(str).trim().replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return isFinite(n) && n > 0 ? n : null
}

// Fetch one fund — name + price
async function fetchTefasFund(fundCode) {
  // Run name + price reports in parallel for speed
  const [priceData, nameData] = await Promise.all([
    fonbulReport(fundCode, 'fonbul-fonanalizleri-fondetayanalizleri-kunye-sonfiyatbilgileri'),
    fonbulReport(fundCode, 'fonbul-fonanalizleri-fondetayanalizleri-kunye-fonunkimligi').catch(() => null),
  ])

  // Extract price (try several common labels)
  // extractField now prefers numeric values, but may still return a string from older formats
  const priceRaw = extractField(priceData, ['Fiyat', 'Son Fiyat', 'Birim Pay'])
  let price = null
  if (typeof priceRaw === 'number' && priceRaw > 0) {
    price = priceRaw
  } else {
    price = parseTurkishNumber(priceRaw)
  }
  if (!price) {
    throw new Error('NO_PRICE')
  }

  // Extract name — explicitly prefer string here (we want text not numbers)
  let name = extractField(nameData, ['Unvan', 'Ticari', 'Fon Ad'], { preferNumeric: false })
  if (!name && nameData) {
    try {
      const tablo = nameData.TabloListesi?.[0]
      const veriler = tablo?.JSVeriler || []
      const prop = tablo?.BaslikListe?.[0]?.PropertyName || ''
      const candidates = veriler
        .map((v) => v?.s?.[prop])
        .filter((v) => typeof v === 'string' && v.length > 10)
      if (candidates.length > 0) {
        name = candidates.reduce((a, b) => (b.length > a.length ? b : a))
      }
    } catch {
      // ignore
    }
  }

  return {
    symbol: fundCode,
    price,
    currency: 'TRY',
    name: name || null,
  }
}

// Common handler — sequential for FonBul (the page has session cookies, parallel risks issues)
async function handle(symbolsParam) {
  const symbols = (symbolsParam || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

  if (symbols.length === 0) {
    return { results: {}, errors: [{ symbol: '', error: 'No symbols provided' }] }
  }
  if (symbols.length > 20) {
    return { results: {}, errors: [{ symbol: '', error: 'Max 20 symbols per request' }] }
  }

  const results = {}
  const errors = []

  // Sequential pacing — FonBul scraping should be polite
  for (const sym of symbols) {
    try {
      const data = await fetchTefasFund(sym)
      results[sym] = data
    } catch (err) {
      errors.push({ symbol: sym, error: err.message || 'failed' })
    }
    // small pacing delay between calls
    await new Promise((r) => setTimeout(r, 200))
  }

  return { results, errors }
}

// === Vercel handler ===
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const symbolsParam = url.searchParams.get('symbols') || ''
    const data = await handle(symbolsParam)
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' })
  }
}

export { handle as tefasHandle }
