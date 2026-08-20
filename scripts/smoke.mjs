// Headless click-through of the built app.
//
//   npm run build
//   npm run preview            # in one terminal
//   npm run smoke              # in another
//
// Not a test suite — `npm test` covers the maths. This covers the thing unit
// tests structurally cannot: does the app actually render, and does every route
// still work? It exists because a dependency upgrade can leave `vite build`
// perfectly green and still produce a blank page in the browser, and because
// the pages that changed least are the ones nobody thinks to open.
//
// Playwright is deliberately NOT in devDependencies — it downloads a browser
// and this runs rarely. Install it when you need it:
//
//   npm i -D playwright && npx playwright install chromium
//
// Set CHROME_PATH to use a browser you already have.

const BASE = process.env.BASE || 'http://localhost:4173'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error(
    'Playwright is not installed. Run:\n' +
      '  npm i -D playwright && npx playwright install chromium\n'
  )
  process.exit(2)
}

// Anything the app legitimately cannot reach in a bare `vite preview`: there is
// no dev proxy for /api/*, and a machine offline (or a CI box) reaches neither
// Google Fonts nor the FX API. Those are the harness failing, not the app.
const EXPECTED_OFFLINE = /fonts\.googleapis|fonts\.gstatic|frankfurter|\/api\//

const errors = []
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
)
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  if (EXPECTED_OFFLINE.test(text) || /Failed to load resource/.test(text)) return
  errors.push(`console.error: ${text}`)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('requestfailed', (r) => {
  if (!EXPECTED_OFFLINE.test(r.url())) {
    errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`)
  }
})

const ROUTES = [
  ['dashboard', '/'],
  ['transactions', '/transactions'],
  ['portfolios', '/portfolios'],
  ['fire', '/fire'],
  ['settings', '/settings'],
]

console.log(`\nSmoke-testing ${BASE}\n`)

for (const [name, path] of ROUTES) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const heading = await page.locator('h1').first().textContent().catch(() => null)
  const textLength = (await page.locator('body').innerText()).length
  console.log(`  ${name.padEnd(13)} h1=${JSON.stringify(heading)}  ${textLength} chars`)
  // A white-screen crash still serves a 200 with an empty <div id="root">, so
  // check for actual content rather than trusting the status code.
  if (textLength < 200) errors.push(`${name}: page is effectively blank (${textLength} chars)`)
  await page.screenshot({ path: `/tmp/portfolio-smoke-${name}.png` })
}

// Client-side navigation — the part a router upgrade breaks.
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.getByRole('link', { name: /transactions|işlemler/i }).first().click()
await page.waitForTimeout(500)
if (!page.url().includes('/transactions')) errors.push('in-app navigation did not change route')

// The only route with a URL parameter.
await page.goto(BASE + '/portfolios', { waitUntil: 'networkidle' })
const card = page.locator('a[href^="/portfolios/"]').first()
if (await card.count()) {
  await card.click()
  await page.waitForTimeout(500)
  if (!/\/portfolios\/.+/.test(page.url())) errors.push('sub-portfolio param route failed')
}

// The demo data ships clean, so a warning banner here means either the demo
// data drifted or a calculation regressed. Either way, worth failing on.
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const body = await page.locator('body').innerText()
if (/below zero|eksiye düşmüş/.test(body)) {
  errors.push('dashboard shows a data warning on demo data — see demoData.test.js')
}

await browser.close()

console.log(
  '\n' + (errors.length ? `PROBLEMS (${errors.length}):` : 'All routes render, no console errors.')
)
for (const e of errors) console.log('  ' + e)
console.log('\nScreenshots: /tmp/portfolio-smoke-*.png\n')
process.exit(errors.length ? 1 : 0)
