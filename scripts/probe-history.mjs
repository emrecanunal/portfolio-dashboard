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
//   * Whether Yahoo answers at all. It 429s any request that arrives without
//     cookies, which is what the first run hit; api/_http.js now warms a jar
//     first, exactly as the BIST fallback has always done.

import { historyHandle } from '../api/history.js'
import { buildWindows } from '../src/lib/historyApi.js'

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

// --- How wide a window will İş Yatırım serve? ---------------------------
// Each size is timed for ONE symbol. Anything approaching 9s is unusable in
// production: Vercel kills the function at 10s and several symbols share it.
if (!symbols.length) {
  console.log('\nİş Yatırım window sweep (one symbol, seconds per window size):')
  for (const size of [1, 3, 6, 12]) {
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
