// TEFAS fund price fetcher.
//
// Two sources, tried in order:
//
//   1. TEFAS itself — tefas.gov.tr, the official platform every Turkish fund
//      reports to. The site was rebuilt on Next.js in 2026 and grew a JSON API
//      at /api/funds/*; this is what the current tefas-crawler and pytefas
//      libraries talk to. Being the primary source, it is the least likely to
//      quietly disappear.
//
//   2. FonBul (Halk Yatırım) — the previous primary. Kept as a fallback
//      because it works fine from a home connection, but it blocks data-centre
//      IP ranges, so it has never worked from Vercel (see commits 21309b2 /
//      e74258c, where deploying to Frankfurt failed to help).
//
// Which source actually answered is reported per symbol as `source`, so the
// Settings page can show it and you never have to guess again:
//
//   GET /api/tefas?symbols=AFA,TI2
//   → { results: { AFA: { price, currency, name, source } }, errors: [...] }
//
// RATE LIMIT: TEFAS allows roughly 6 requests per minute per IP. One request
// per fund, paced, plus the edge caching in _http.js keeps us under it. Don't
// raise MAX_SYMBOLS without thinking about that ceiling.

import { fetchWithTimeout, setCacheHeaders, applyCors, parseSymbols } from './_http.js'

const TEFAS_BASE = 'https://www.tefas.gov.tr'
const FONBUL_BASE = 'https://fonbul.halkyatirim.com.tr'
const FONBUL_API_BASE = `${FONBUL_BASE}/FonBulPlusServis/fonbul/tr`

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// Six requests a minute is the documented ceiling; at 8 funds a refresh we sit
// inside it, and the response is edge-cached for every other device.
const MAX_SYMBOLS = 8
const PACING_MS = 350

// === Source 1: TEFAS official JSON API ===
//
// POST /api/funds/fonFiyatBilgiGetir
//   body: { fonKodu: "AFA", dil: "TR", periyod: 1 }
//   → { resultList: [ { tarih, fonKodu, fonUnvan, fiyat, ... }, ... ] }
//
// `periyod` is a look-back in months and only accepts 1, 3, 6, 12, 36 or 60.
// We ask for 1 and take the newest row: the smallest window available, and
// still enough to survive a run of market holidays.
async function fetchTefasOfficial(fundCode) {
  const res = await fetchWithTimeout(
    `${TEFAS_BASE}/api/funds/fonFiyatBilgiGetir`,
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Referer: `${TEFAS_BASE}/FonAnaliz.aspx?FonKod=${encodeURIComponent(fundCode)}`,
      },
      body: JSON.stringify({ fonKodu: fundCode, dil: 'TR', periyod: 1 }),
    },
    6000
  )

  if (res.status === 429) throw new Error('TEFAS_RATE_LIMIT')
  if (!res.ok) throw new Error(`TEFAS_HTTP_${res.status}`)

  const body = await res.json()
  const rows = body?.resultList
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('TEFAS_NO_DATA')

  const priced = rows
    .map((r) => ({ raw: r, price: toNumber(r?.fiyat), time: toTime(r?.tarih) }))
    .filter((r) => r.price > 0)
    .sort((a, b) => b.time - a.time)

  if (priced.length === 0) throw new Error('TEFAS_NO_PRICE')

  const latest = priced[0]
  const previous = priced[1]
  const name = latest.raw?.fonUnvan

  return {
    symbol: fundCode,
    price: latest.price,
    // Funds publish one price a day, so "previous close" here is literally the
    // previously published day — the daily-change figure is real, not an
    // approximation from an opening price.
    previousClose: previous?.price ?? latest.price,
    dayChangePct:
      previous?.price > 0 ? ((latest.price - previous.price) / previous.price) * 100 : 0,
    currency: 'TRY',
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    source: 'tefas',
  }
}

// `tarih` has appeared both as epoch milliseconds and as a 'DD.MM.YYYY' string
// across TEFAS revisions. It is only used for ordering, so accept either shape
// and fall back to 0 rather than throwing.
function toTime(value) {
  if (typeof value === 'number' && isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const trimmed = value.trim()
  const dotted = trimmed.match(/^(\d{2})[.\/](\d{2})[.\/](\d{4})$/)
  if (dotted) return new Date(`${dotted[3]}-${dotted[2]}-${dotted[1]}T00:00:00Z`).getTime()
  const parsed = Date.parse(trimmed)
  return isFinite(parsed) ? parsed : 0
}

// TEFAS returns numbers as numbers, but has been known to send the Turkish
// display string ("1,09431") on some endpoints. Handle both.
function toNumber(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const n = parseFloat(value.trim().replace(/\./g, '').replace(',', '.'))
  return isFinite(n) ? n : 0
}

// === Source 2: FonBul (fallback; reachable from home connections only) ===

async function fonbulReport(fundCode, reportName) {
  const res = await fetchWithTimeout(
    `${FONBUL_API_BASE}/RaporTabloHesapla`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${FONBUL_BASE}/YatirimFonlari/FonProfilleri/FonKunye/${encodeURIComponent(fundCode)}`,
        'User-Agent': UA,
      },
      body: JSON.stringify({
        RaporParams: {
          Url: reportName,
          RaporParametreleri: [{ key: 'Kod', value: fundCode }],
        },
      }),
    },
    6000
  )

  if (!res.ok) throw new Error(`FonBul API HTTP ${res.status}`)
  return res.json()
}

// FonBul JSVeriler row structure:
//   { o: { Baslik1: 1.094314 },   // raw numeric value (preferred)
//     s: { Baslik1: "1,09431" },  // Turkish-formatted display string
//     baslik: { Text: "Fiyatı" } }
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
          if (preferNumeric) {
            const numVal = v?.o?.[prop]
            if (typeof numVal === 'number' && !isNaN(numVal)) return numVal
          }
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

async function fetchFonbul(fundCode) {
  const [priceData, nameData] = await Promise.all([
    fonbulReport(fundCode, 'fonbul-fonanalizleri-fondetayanalizleri-kunye-sonfiyatbilgileri'),
    fonbulReport(fundCode, 'fonbul-fonanalizleri-fondetayanalizleri-kunye-fonunkimligi').catch(
      () => null
    ),
  ])

  const priceRaw = extractField(priceData, ['Fiyat', 'Son Fiyat', 'Birim Pay'])
  const price = typeof priceRaw === 'number' && priceRaw > 0 ? priceRaw : toNumber(priceRaw)
  if (!price) throw new Error('FONBUL_NO_PRICE')

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
    previousClose: price, // FonBul's summary view carries no prior close
    dayChangePct: 0,
    currency: 'TRY',
    name: name || null,
    source: 'fonbul',
  }
}

// Try TEFAS, fall back to FonBul. Both error messages survive into the result
// so the Settings page can tell "the source moved" apart from "we're blocked".
export async function fetchFund(fundCode) {
  try {
    return await fetchTefasOfficial(fundCode)
  } catch (errTefas) {
    try {
      return await fetchFonbul(fundCode)
    } catch (errFonbul) {
      throw new Error(`TEFAS:${errTefas.message} | FONBUL:${errFonbul.message}`)
    }
  }
}

// Sequential with a small delay. TEFAS rate-limits per IP, and being the
// official source it is the one worth staying on good terms with.
async function handle(symbolsParam) {
  const parsed = parseSymbols(symbolsParam, MAX_SYMBOLS)
  if (parsed.error) return { results: {}, errors: [{ symbol: '', error: parsed.error }] }

  const results = {}
  const errors = []

  for (const sym of parsed.symbols) {
    try {
      results[sym] = await fetchFund(sym)
    } catch (err) {
      errors.push({ symbol: sym, error: err.message || 'failed' })
    }
    await new Promise((r) => setTimeout(r, PACING_MS))
  }

  return { results, errors }
}

// === Vercel handler ===
export default async function handler(req, res) {
  if (applyCors(req, res)) return

  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const data = await handle(url.searchParams.get('symbols') || '')
    // Funds publish once a day — half an hour of edge cache costs nothing in
    // freshness and keeps us well under the 6-per-minute ceiling.
    setCacheHeaders(res, { maxAge: 1800, swr: 3600 })
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' })
  }
}

export { handle as tefasHandle }
