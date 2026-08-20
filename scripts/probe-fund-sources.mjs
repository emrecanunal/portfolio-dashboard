// Probe every candidate source for Turkish fund (TEFAS) prices and report
// which ones actually answer from wherever you run it.
//
//   npm run probe:funds                 # defaults to AFA
//   npm run probe:funds AFA TI2         # specific funds
//   npm run probe:funds AFA -- --raw    # dump full JSON responses
//   npm run probe:funds AFA -- --bulk   # also try the undocumented bulk endpoint (slow)
//
// WHY THIS EXISTS
//
// "The fund prices don't update" has two completely different causes and they
// need completely different fixes:
//
//   (a) the source changed or died          → the code needs updating
//   (b) the source blocks data-centre IPs   → the code is fine, the *host* is
//                                             wrong, and no amount of retrying
//                                             from Vercel will ever work
//
// You cannot tell these apart from one machine. So run this twice:
//
//   1. On your Mac        → does the source work at all?
//   2. From Vercel        → curl "https://<your-app>.vercel.app/api/tefas?symbols=AFA"
//                           and look at the `source` field in the response
//
// Same result both times → it's (a), the source moved.
// Works locally, fails on Vercel → it's (b), and that source can only ever be
// refreshed from your own machine.
//
// This is exactly how FonBul was diagnosed: fine at home, blocked from every
// Vercel region including Frankfurt (commits 21309b2 / e74258c).
//
// IMPORTANT: this imports the REAL parser from api/tefas.js rather than
// reimplementing it. A probe that proves "the endpoint answers" while the app
// still shows a stale number is worse than no probe at all — what matters is
// the price the app would actually store, so that is what gets printed.

import { fetchFund } from '../api/tefas.js'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const args = process.argv.slice(2)
const RAW = args.includes('--raw')
const TRY_BULK = args.includes('--bulk')
const FUNDS = args.filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase())
const CODES = FUNDS.length > 0 ? FUNDS : ['AFA']

async function timed(label, fn) {
  const started = Date.now()
  try {
    const value = await fn()
    return { label, ok: true, ms: Date.now() - started, value }
  } catch (err) {
    return { label, ok: false, ms: Date.now() - started, error: err.message || String(err) }
  }
}

function withTimeout(url, options, ms = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal })
    .catch((err) => {
      if (err?.name === 'AbortError') throw new Error(`timeout after ${ms}ms`)
      // Network-level refusals are the interesting signal — surface the code.
      throw new Error(err?.cause?.code ? `${err.message} (${err.cause.code})` : err.message)
    })
    .finally(() => clearTimeout(timer))
}

// --- Candidate 1: TEFAS official, per-fund price history -------------------
//
// The response is a month of daily rows. They arrive OLDEST FIRST, so reading
// rows[0] shows you a price from four weeks ago — which is exactly the trap
// this probe used to fall into. We report the span and the newest row, and
// separately what api/tefas.js makes of the whole thing.
async function tefasPerFund(code) {
  const res = await withTimeout('https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify({ fonKodu: code, dil: 'TR', periyod: 1 }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  const rows = body?.resultList
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('no resultList')

  const dated = rows.filter((r) => r?.tarih)
  const sorted = [...dated].sort((a, b) => String(a.tarih).localeCompare(String(b.tarih)))

  return {
    rows: rows.length,
    oldest: sorted[0],
    newest: sorted[sorted.length - 1],
    raw: body,
  }
}

// --- Candidate 2: what the app would actually store -------------------------
// The real thing: api/tefas.js, primary source with its fallback.
async function appParser(code) {
  return await fetchFund(code)
}

// --- Candidate 3: FonBul (the fallback) -------------------------------------
async function fonbul(code) {
  const res = await withTimeout(
    'https://fonbul.halkyatirim.com.tr/FonBulPlusServis/fonbul/tr/RaporTabloHesapla',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': UA,
        Referer: `https://fonbul.halkyatirim.com.tr/YatirimFonlari/FonProfilleri/FonKunye/${code}`,
      },
      body: JSON.stringify({
        RaporParams: {
          Url: 'fonbul-fonanalizleri-fondetayanalizleri-kunye-sonfiyatbilgileri',
          RaporParametreleri: [{ key: 'Kod', value: code }],
        },
      }),
    }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const rows = json?.TabloListesi?.[0]?.JSVeriler
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('no JSVeriler')
  const priceRow = rows.find((r) => /fiyat/i.test(r?.baslik?.Text || ''))
  const prop = json.TabloListesi[0]?.BaslikListe?.[0]?.PropertyName || 'Baslik1'
  return { rows: rows.length, price: priceRow?.o?.[prop] ?? null, sample: priceRow || rows[0], raw: json }
}

// --- Candidate 4: TEFAS bulk, undocumented (opt-in with --bulk) -------------
// One request covering every fund would be strictly better than one per fund
// under a 6-req/min limit, but the request shape isn't published anywhere and
// none of the plausible bodies returned data as of August 2026. Kept, behind a
// flag, because it costs 45 seconds of sleeps to retest and is worth rechecking
// after any TEFAS redesign.
async function tefasBulk() {
  const attempts = [
    { fonTuru: 'YAT', dil: 'TR' },
    { fonTuru: 'YAT', dil: 'TR', periyod: 1 },
    { kind: 'YAT', dil: 'TR' },
    {},
  ]
  const failures = []
  for (const body of attempts) {
    try {
      const res = await withTimeout('https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        failures.push(`${JSON.stringify(body)} → HTTP ${res.status}`)
        continue
      }
      const json = await res.json()
      const list = json?.resultList || json?.data
      if (Array.isArray(list) && list.length > 0) {
        return { body, count: list.length, newest: list[0], raw: json }
      }
      failures.push(`${JSON.stringify(body)} → empty`)
    } catch (err) {
      failures.push(`${JSON.stringify(body)} → ${err.message}`)
    }
    await new Promise((r) => setTimeout(r, 11000)) // stay under 6 req/min
  }
  throw new Error(failures.join(' ; '))
}

// --- Candidate 5: plain reachability ---------------------------------------
// Separates "the API changed" from "this host is unreachable from here".
async function reachable(host) {
  const res = await withTimeout(`https://${host}/`, { headers: { 'User-Agent': UA } }, 8000)
  return { status: res.status }
}

const results = []

console.log(`\nProbing fund price sources for: ${CODES.join(', ')}`)
console.log(`Node ${process.version} · ${new Date().toISOString()}\n`)

results.push(await timed('reach tefas.gov.tr', () => reachable('www.tefas.gov.tr')))
results.push(
  await timed('reach fonbul.halkyatirim.com.tr', () => reachable('fonbul.halkyatirim.com.tr'))
)

for (const code of CODES) {
  results.push(await timed(`TEFAS raw (${code})`, () => tefasPerFund(code)))
  await new Promise((r) => setTimeout(r, 11000)) // 6 req/min ceiling
  results.push(await timed(`api/tefas.js parser (${code})`, () => appParser(code)))
  await new Promise((r) => setTimeout(r, 11000))
  results.push(await timed(`FonBul (${code})`, () => fonbul(code)))
}

if (TRY_BULK) {
  results.push(await timed('TEFAS bulk (undocumented)', () => tefasBulk()))
}

// --- Report ----------------------------------------------------------------

const pad = Math.max(...results.map((r) => r.label.length))
console.log('─'.repeat(pad + 32))
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.label.padEnd(pad)}  ${String(r.ms).padStart(6)}ms`)
  if (!r.ok) console.log(`      ↳ ${r.error}`)
}
console.log('─'.repeat(pad + 32))

for (const r of results) {
  if (!r.ok) continue
  const v = r.value

  if (r.label.startsWith('TEFAS raw')) {
    console.log(`\n${r.label} — ${v.rows} daily rows`)
    console.log(`  oldest: ${v.oldest?.tarih}  →  ${v.oldest?.fiyat}`)
    console.log(`  newest: ${v.newest?.tarih}  →  ${v.newest?.fiyat}   ← the one that matters`)
    if (RAW) console.log(JSON.stringify(v.raw, null, 2))
  } else if (r.label.startsWith('api/tefas.js')) {
    console.log(`\n${r.label} — what the app would store:`)
    console.log(JSON.stringify(v, null, 2))
  } else if (r.label.startsWith('FonBul')) {
    console.log(`\n${r.label} — price: ${v.price}`)
    if (RAW) console.log(JSON.stringify(v.raw, null, 2))
  } else if (v?.newest) {
    console.log(`\n${r.label} — ${v.count} funds`)
    console.log(`  request body that worked: ${JSON.stringify(v.body)}`)
    console.log(JSON.stringify(v.newest, null, 2).slice(0, RAW ? 100000 : 1200))
  }
}

// --- Verdict ---------------------------------------------------------------
//
// The single most useful line: do the two independent sources agree? If they
// disagree by more than a rounding error, one of them is serving a stale or
// wrong price and the app would silently pick whichever answered first.
console.log('\n' + '─'.repeat(pad + 32))
for (const code of CODES) {
  const app = results.find((r) => r.label === `api/tefas.js parser (${code})` && r.ok)?.value
  const fb = results.find((r) => r.label === `FonBul (${code})` && r.ok)?.value

  if (!app) {
    console.log(`${code}: the app cannot price this fund from here.`)
    continue
  }

  let line = `${code}: app would store ${app.price} (via ${app.source})`
  if (fb?.price) {
    const diffPct = Math.abs((app.price - fb.price) / fb.price) * 100
    line +=
      diffPct < 0.5
        ? `; FonBul agrees (${fb.price}).`
        : `; FonBul says ${fb.price} — ${diffPct.toFixed(1)}% apart, INVESTIGATE.`
  }
  console.log(line)
}

console.log(
  '\nNow run the same check against your deployment:\n' +
    `  curl -s "https://<your-app>.vercel.app/api/tefas?symbols=${CODES[0]}"\n` +
    'The `source` field says which one served it ("tefas" or "fonbul").\n'
)
