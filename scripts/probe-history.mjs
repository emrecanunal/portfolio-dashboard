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
// The one to watch is `global`. TEFAS and BIST reuse endpoints the live price
// path already proves every day, but global history goes to Yahoo, which is a
// new dependency — Finnhub's free tier does not reliably expose historical
// candles and Stooq closed its free CSV in March 2026.

import { historyHandle } from '../api/history.js'

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
  try {
    const { results, errors } = await historyHandle(type, symbol, months)
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
