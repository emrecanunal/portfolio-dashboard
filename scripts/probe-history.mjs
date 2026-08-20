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

  const key = process.env.FINNHUB_KEY
  const keyInfo = describeKey(key)

  if (key && !keyInfo.usable) {
    console.log(
      `Finnhub fallback: NOT A KEY — got "${keyInfo.shown}".\n` +
        '  That is the placeholder from the instructions, not your token.\n' +
        '  Fix it with:  npm run probe:funds --help  … or simply rewrite the file:\n' +
        '    printf \'FINNHUB_KEY=%s\\n\' "$(pbpaste)" > .env.local'
    )
  } else if (keyInfo.usable) {
    console.log(`Finnhub key in use: ${keyInfo.fingerprint}`)
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
      'Finnhub fallback: not tested.\n' +
        '  Store the key once:  echo "FINNHUB_KEY=your-key" >> .env.local\n' +
        '  Or just this run:    FINNHUB_KEY=$(pbpaste) npm run probe:history'
    )
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
