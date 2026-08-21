// Ask a price source about specific symbols and print exactly what it said.
//
//   npm run probe:symbols bist SKBNK INVES PAHOL
//   npm run probe:symbols tefas AFA TI2
//   npm run probe:symbols global AAPL
//
// WHY THIS EXISTS
//
// The obvious way to debug a failing symbol is to curl the dev proxy. But
// `npm run dev:full` holds the terminal, so curling it means stopping the very
// server you are curling — which is how two diagnostic attempts in this project
// came back empty. This calls the handler directly: no server, no second
// terminal, and the full upstream error string instead of a name in a list.
//
// The app deliberately shows a short reason. This shows everything.

import { bistHandle } from '../api/bist.js'
import { tefasHandle } from '../api/tefas.js'
import { globalHandle } from '../api/global.js'

const HANDLERS = { bist: bistHandle, tefas: tefasHandle, global: globalHandle }

const [type, ...symbols] = process.argv.slice(2)

if (!HANDLERS[type] || symbols.length === 0) {
  console.error('Usage: npm run probe:symbols <bist|tefas|global> SYM1 SYM2 ...')
  process.exit(1)
}

console.log(`\nAsking ${type} about: ${symbols.join(', ')}\n`)

const started = Date.now()
const { results, errors } = await HANDLERS[type](symbols.join(','))
const elapsed = Date.now() - started

const width = Math.max(...symbols.map((s) => s.length), 6)

for (const symbol of symbols) {
  const hit = results[symbol]
  if (hit) {
    const extra = [
      hit.previousClose && hit.previousClose !== hit.price ? `prev ${hit.previousClose}` : null,
      hit.source ? `via ${hit.source}` : null,
      hit.name || null,
    ]
      .filter(Boolean)
      .join(' · ')
    console.log(`OK    ${symbol.padEnd(width)}  ${hit.price} ${hit.currency}${extra ? '  ' + extra : ''}`)
  } else {
    const failure = errors.find((e) => e.symbol === symbol)
    console.log(`FAIL  ${symbol.padEnd(width)}  ${failure?.error || 'no result, no error'}`)
  }
}

console.log(`\n${Object.keys(results).length}/${symbols.length} priced in ${elapsed}ms`)

// The BIST handler tries İş Yatırım and falls back to Yahoo, reporting both
// failures joined. Reading that pair is the whole diagnosis, so spell it out.
if (type === 'bist' && errors.length > 0) {
  console.log(
    '\nReading a BIST failure:\n' +
      '  IS_NO_DATA      İş Yatırım knows the endpoint but returned no rows for\n' +
      '                  this code — often a symbol that is not on the main\n' +
      '                  market, or one that has been renamed.\n' +
      '  IS_HTTP_4xx     the request itself was rejected.\n' +
      '  TIMEOUT_*       the source hung; it does this unpredictably, so try\n' +
      '                  again before concluding anything.\n' +
      '  YH_*            the Yahoo fallback, which has been blocked since\n' +
      '                  August 2026 and will fail regardless.\n'
  )
}
