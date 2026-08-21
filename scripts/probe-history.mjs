// Check that month-end history can actually be fetched, per source.
//
//   npm run probe:history                      # one known symbol per source
//   npm run probe:history -- THYAO AFA AAPL    # your own symbols
//   npm run probe:history -- --months 60
//
// Run it locally first, then against the deployment:
//   curl -s "https://<your-app>.vercel.app/api/history?type=global&symbols=AAPL&months=12"
//
// Same reasoning as probe-fund-sources.mjs: "works here, fails there" means the
// source blocks data-centre IPs and no retry will help; "fails in both" means
// the source moved and the parser needs updating.
//
// Two things this measures, both learned the hard way in the first run:
//
//   * How wide a window İş Yatırım will actually serve. Twelve months for one
//     symbol took over nine seconds — past Vercel's ceiling. The sweep below
//     finds where the cliff is, so WINDOW_MONTHS in historyApi.js can be set
//     from evidence rather than guessed.
//   * Whether Yahoo answers at all, and if not, WHY — a failed cookie warm-up
//     and an outright block look identical from the caller's side, so the jar
//     is reported separately.
//
// To also test the global fallback, the probe needs a Finnhub key. Copy it
// from the app's Settings, then store it once — reading from the clipboard so
// there is no placeholder to paste literally and no key in shell history:
//
//   printf 'FINNHUB_KEY=%s\n' "$(pbpaste)" > .env.local
//
// Note `>` rather than `>>`: rewriting the file avoids stacking duplicate
// FINNHUB_KEY lines, where the first silently wins. .gitignore already covers
// .env.local, so it cannot reach GitHub.
//
// For a single run without storing anything:
//
//   FINNHUB_KEY=$(pbpaste) npm run probe:history
//
// ALPHAVANTAGE_KEY belongs in the same file. It is what api/history.js uses for
// global equities, and unlike the Finnhub key it is read server-side only, so
// it never reaches the browser or a JSON backup.

import { historyHandle } from '../api/history.js'
import { warmUpYahooCookies, yahooCookieState, yahooCrumb } from '../api/_http.js'
import { buildWindows, fetchFinnhubMonthlyHistory } from '../src/lib/historyApi.js'
import { readFileSync } from 'node:fs'

// Read KEY=value lines from .env.local, if it exists. A real environment
// variable still wins, so a one-off run can override the stored key.
function loadEnvLocal() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!match) continue
      const value = match[2].replace(/^['"]|['"]$/g, '').trim()
      if (value && !process.env[match[1]]) process.env[match[1]] = value
    }
  } catch {
    // No .env.local is the normal case, not an error.
  }
}
loadEnvLocal()

// A key that never left the example is not an invalid key, and reporting it as
// one sends you off to regenerate a perfectly good token. Finnhub keys are long
// ASCII alphanumeric strings; anything else got here by copy-pasting the
// instructions rather than the dashboard.
// Finnhub API keys are 20 characters. The dashboard shows the API key with a
// second value right beneath it, and selecting across both yields a 40-char
// string that is two keys stuck together — which Finnhub rejects wholesale.
// Split it so the halves can be tested individually rather than guessed at.
export function finnhubCandidates(key) {
  const k = (key || '').trim()
  if (k.length !== 40) return [{ label: 'as given', key: k }]
  const first = k.slice(0, 20)
  const second = k.slice(20)
  return [
    { label: 'as given (40 chars)', key: k },
    { label: 'first half', key: first },
    { label: 'second half', key: second },
  ]
}

// Validity has to be tested against /quote, not the candle endpoint: candles
// are premium, so they answer 403 for a perfectly good free-tier key and the
// two failures are indistinguishable. /quote is what the app uses for live
// prices, so it is also the thing that actually matters.
async function finnhubQuoteWorks(key) {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(key)}`,
    { headers: { Accept: 'application/json' } }
  )
  if (res.status === 401 || res.status === 403) return { ok: false, why: `HTTP ${res.status}` }
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` }
  const data = await res.json()
  // Finnhub answers 200 with an all-zero body for an unknown token.
  if (typeof data?.c !== 'number' || data.c === 0) return { ok: false, why: 'empty quote' }
  return { ok: true, price: data.c }
}

function describeKey(key) {
  if (!key) return { usable: false, why: 'none' }
  const trimmed = key.trim()
  if (!/^[A-Za-z0-9_]{15,}$/.test(trimmed)) {
    return { usable: false, why: 'placeholder', shown: trimmed.slice(0, 24) }
  }
  return {
    usable: true,
    // Enough to check against the app's Settings field, not enough to use.
    fingerprint: `${trimmed.slice(0, 4)}…${trimmed.slice(-4)} (${trimmed.length} chars)`,
  }
}

const args = process.argv.slice(2)
const monthsIdx = args.indexOf('--months')
const months = monthsIdx >= 0 ? Number(args[monthsIdx + 1]) : 12
const symbols = args.filter((a) => !a.startsWith('--') && a !== String(months))

// A symbol per source, so an empty invocation still exercises all three.
const DEFAULTS = { bist: 'THYAO', tefas: 'AFA', global: 'AAPL' }

// When the user names symbols we cannot know their asset type, so try each
// symbol against every source and report which one claims it.
const plan = symbols.length
  ? Object.keys(DEFAULTS).flatMap((type) => symbols.map((s) => [type, s]))
  : Object.entries(DEFAULTS)

console.log(`\nProbing ${months} months of history · ${new Date().toISOString()}\n`)

const rows = []
for (const [type, symbol] of plan) {
  const started = Date.now()
  const sizes = { bist: 6, global: 24, tefas: 60 }
  const [firstWindow] = buildWindows(months, sizes[type] ?? 6)
  try {
    const { results, errors } = await historyHandle(type, symbol, months, firstWindow)
    const monthsGot = results[symbol] ? Object.keys(results[symbol]) : []
    rows.push({
      type,
      symbol,
      ms: Date.now() - started,
      ok: monthsGot.length > 0,
      count: monthsGot.length,
      first: monthsGot[0],
      last: monthsGot[monthsGot.length - 1],
      sample: results[symbol],
      error: errors[0]?.error,
    })
  } catch (err) {
    rows.push({ type, symbol, ms: Date.now() - started, ok: false, error: err.message })
  }
}

const pad = Math.max(...rows.map((r) => `${r.type}/${r.symbol}`.length))
console.log('─'.repeat(pad + 44))
for (const r of rows) {
  const name = `${r.type}/${r.symbol}`.padEnd(pad)
  console.log(
    `${r.ok ? 'OK  ' : 'FAIL'}  ${name}  ${String(r.ms).padStart(6)}ms  ` +
      (r.ok ? `${String(r.count).padStart(3)} months  ${r.first} → ${r.last}` : '')
  )
  if (!r.ok) console.log(`      ↳ ${r.error || 'no months returned'}`)
}
console.log('─'.repeat(pad + 44))

// Print one full series so the values can be sanity-checked against reality —
// a source that returns the right SHAPE with wrong numbers is the failure mode
// that survives every automated check.
const firstOk = rows.find((r) => r.ok)
if (firstOk) {
  console.log(`\n${firstOk.type}/${firstOk.symbol} month-end closes:`)
  for (const [month, price] of Object.entries(firstOk.sample)) {
    console.log(`  ${month}  ${price}`)
  }
}

// --- Why is Yahoo refusing? ---------------------------------------------
// A 429 with no cookies means the warm-up failed; a 429 WITH cookies means
// Yahoo is blocking this address regardless. Only the second is unfixable
// from here.
if (rows.some((r) => r.type === 'global' && !r.ok)) {
  await warmUpYahooCookies()
  const jar = yahooCookieState()
  await yahooCrumb()
  const state = yahooCookieState()
  console.log(
    `\nYahoo cookies: ${
      state.hasCookies ? `obtained (${state.length} chars)` : 'EMPTY — the warm-up itself failed'
    }`
  )
  console.log(
    `Yahoo crumb:   ${
      state.hasCrumb
        ? `obtained (${state.crumbLength} chars)`
        : 'EMPTY — Yahoo would not issue one, so the chart API stays closed to us'
    }`
  )
  if (state.hasCookies && state.hasCrumb) {
    console.log('  → both present; if the fetch still fails, Yahoo is blocking this address.')
  }

}

// --- Are the keys we hold actually usable? ---------------------------
// Nothing here depends on whether the history fetches above succeeded.
// This lived inside the "global failed" branch, so the moment Alpha
// Vantage started working the Finnhub check silently stopped running —
// exactly when someone would still be trying to find out why live global
// prices were rejected.
if (!process.env.ALPHAVANTAGE_KEY) {
    console.log(
      'Alpha Vantage: NO KEY — this is the primary global source now that Yahoo,\n' +
        '  Stooq and Finnhub have all closed. Get a free one at\n' +
        '  alphavantage.co/support/#api-key and add it to .env.local as\n' +
        '  ALPHAVANTAGE_KEY=..., then set the same value in the Vercel dashboard.'
    )
  }


{

// Every FINNHUB_KEY* variable is tested, so two candidates can be compared in
// one run instead of one edit-and-rerun cycle each. 401 means the token is
// rejected outright; 403 means it is recognised and the endpoint is not
// included — which is the difference between "get a new key" and "keep this
// one, it just cannot do candles".
const finnhubKeys = Object.entries(process.env)
  .filter(([name, value]) => /^FINNHUB_KEY/.test(name) && value)
  .sort()

for (const [name, candidateKey] of finnhubKeys) {
  console.log(`\n[${name}]`)
  await checkFinnhubKey(candidateKey)
}

async function checkFinnhubKey(key) {
const keyInfo = describeKey(key)

if (key && !keyInfo.usable) {
  console.log(
    `Finnhub fallback: NOT A KEY — got "${keyInfo.shown}".\n` +
      '  That is not a Finnhub token — most likely the clipboard held\n' +
      '  something else, such as the command you just copied to run this.\n' +
      '  Open .env.local in an editor and put the key from the app\'s\n' +
      '  Settings on the FINNHUB_KEY= line. One line, no quotes.'
  )
} else if (keyInfo.usable) {
  console.log(`Finnhub key in use: ${keyInfo.fingerprint}`)

  // Which part of the stored value is actually a key?
  for (const candidate of finnhubCandidates(key)) {
    const verdict = await finnhubQuoteWorks(candidate.key).catch((e) => ({
      ok: false,
      why: e.message,
    }))
    const shown = `${candidate.key.slice(0, 4)}…${candidate.key.slice(-4)}`
    console.log(
      `  live quote · ${candidate.label.padEnd(20)} ${shown}  ` +
        (verdict.ok ? `WORKS (AAPL ${verdict.price})` : `no — ${verdict.why}`)
    )
    await new Promise((r) => setTimeout(r, 1100))
  }
  const started = Date.now()
  try {
    const got = await fetchFinnhubMonthlyHistory(DEFAULTS.global, months, key)
    const keys = Object.keys(got)
    console.log(
      `Finnhub fallback: OK — ${keys.length} months ${keys[0]} → ${keys[keys.length - 1]} ` +
        `(${Date.now() - started}ms)`
    )
  } catch (err) {
    console.log(`Finnhub fallback: FAIL — ${err.message}`)
    if (err.message === 'FINNHUB_INVALID_KEY') {
      console.log(
        '  Finnhub rejected this token. If you regenerated the key recently,\n' +
          "  the app's Settings field still holds the revoked one — live global\n" +
          '  prices will be failing too. Update both.'
      )
    }
  }
} else {
  console.log(
    'Finnhub: no key set. Add FINNHUB_KEY to .env.local to test one.'
  )
}
}

}

// --- How wide a window will İş Yatırım serve? ---------------------------
// Each size is timed for ONE symbol. Anything approaching 9s is unusable in
// production: Vercel kills the function at 10s and several symbols share it.
if (!symbols.length) {
  console.log('\nİş Yatırım window sweep (one symbol, seconds per window size):')
  for (const size of [1, 3, 6, 12, 24, 36]) {
    const [w] = buildWindows(size, size)
    const started = Date.now()
    let note
    try {
      const { results, errors } = await historyHandle('bist', DEFAULTS.bist, size, w)
      const got = results[DEFAULTS.bist]
      note = got ? `${Object.keys(got).length} months` : errors[0]?.error || 'no data'
    } catch (err) {
      note = err.message
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    const verdict = Number(secs) > 6 ? '  ← too slow for Vercel' : ''
    console.log(`  ${String(size).padStart(2)} months  ${secs.padStart(5)}s  ${note}${verdict}`)
  }
}

const failed = rows.filter((r) => !r.ok)
console.log(
  failed.length === 0
    ? '\nEvery source returned history from this machine.'
    : `\nNo history from: ${failed.map((r) => `${r.type}/${r.symbol}`).join(', ')}`
)
console.log(
  'Now check the deployment:\n' +
    `  curl -s "https://<your-app>.vercel.app/api/history?type=global&symbols=AAPL&months=${months}"\n`
)
