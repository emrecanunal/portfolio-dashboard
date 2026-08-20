// Probe every candidate source for Turkish fund (TEFAS) prices and report
// which ones actually answer from wherever you run it.
//
//   node scripts/probe-fund-sources.mjs            # defaults to AFA
//   node scripts/probe-fund-sources.mjs AFA TI2    # specific funds
//   node scripts/probe-fund-sources.mjs --raw      # dump full JSON responses
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

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const args = process.argv.slice(2)
const RAW = args.includes('--raw')
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
// This is what api/tefas.js now uses as its primary source.
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
  return { rows: rows.length, sample: rows[0], raw: body }
}

// --- Candidate 2: TEFAS official, all funds for one date -------------------
// Would be strictly better than per-fund (one request covers the whole
// portfolio, which matters under a 6-req/min limit), but the request shape is
// not documented anywhere public. We try the plausible bodies; if one comes
// back with data, api/tefas.js should switch to it.
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
        return { body, count: list.length, sample: list[0], raw: json }
      }
      failures.push(`${JSON.stringify(body)} → empty`)
    } catch (err) {
      failures.push(`${JSON.stringify(body)} → ${err.message}`)
    }
    await new Promise((r) => setTimeout(r, 11000)) // stay under 6 req/min
  }
  throw new Error(failures.join(' ; '))
}

// --- Candidate 3: FonBul (the current fallback) ----------------------------
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
  return { rows: rows.length, sample: rows[0], raw: json }
}

// --- Candidate 4: plain reachability ---------------------------------------
// Separates "the API changed" from "this host is unreachable from here".
async function reachable(host) {
  const res = await withTimeout(`https://${host}/`, { headers: { 'User-Agent': UA } }, 8000)
  return { status: res.status }
}

const results = []

console.log(`\nProbing fund price sources for: ${CODES.join(', ')}`)
console.log(`Node ${process.version} · ${new Date().toISOString()}\n`)

results.push(await timed('reach tefas.gov.tr', () => reachable('www.tefas.gov.tr')))
results.push(await timed('reach fonbul.halkyatirim.com.tr', () => reachable('fonbul.halkyatirim.com.tr')))

for (const code of CODES) {
  results.push(await timed(`TEFAS per-fund (${code})`, () => tefasPerFund(code)))
  await new Promise((r) => setTimeout(r, 11000)) // 6 req/min ceiling
  results.push(await timed(`FonBul (${code})`, () => fonbul(code)))
}

results.push(await timed('TEFAS bulk (undocumented)', () => tefasBulk()))

// --- Report ----------------------------------------------------------------

const pad = Math.max(...results.map((r) => r.label.length))
console.log('─'.repeat(pad + 32))
for (const r of results) {
  const mark = r.ok ? 'OK  ' : 'FAIL'
  console.log(`${mark}  ${r.label.padEnd(pad)}  ${String(r.ms).padStart(6)}ms`)
  if (!r.ok) console.log(`      ↳ ${r.error}`)
}
console.log('─'.repeat(pad + 32))

for (const r of results) {
  if (!r.ok || !r.value?.sample) continue
  console.log(`\n${r.label} — first record:`)
  console.log(JSON.stringify(r.value.sample, null, 2).slice(0, RAW ? 100000 : 1200))
  if (r.value.count) console.log(`  (${r.value.count} funds in response)`)
  if (r.value.body) console.log(`  (request body that worked: ${JSON.stringify(r.value.body)})`)
}

const anyFundSource = results.some((r) => r.ok && /per-fund|FonBul|bulk/.test(r.label))
console.log(
  anyFundSource
    ? '\nAt least one fund source answered from this machine.'
    : '\nNo fund source answered from this machine — check the failures above.'
)
console.log(
  'Now run the same check from your deployment:\n' +
    '  curl -s "https://<your-app>.vercel.app/api/tefas?symbols=' +
    CODES[0] +
    '" | head -40\n' +
    'The `source` field says which one served it ("tefas" or "fonbul").\n'
)
