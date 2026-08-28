// Bir yedekteki POZİSYON YAPISINI raporlar.
//
// NEDEN AYRI BİR BETİK
//
// 28 Ağustos'taki veri kaybında toplam değer yanıltıcıydı: fiyat önbelleği
// cihazlar arası senkronlanmadığı için iki cihazda aynı veri farklı toplam
// gösterebiliyor. Ayırt edici sinyal toplam değil, PORTFÖY BAŞINA POZİSYON
// SAYISI ve işlem id'lerinin benzersizliği. Bu betik onları söylüyor.
//
// Kullanım:  node scripts/check-positions.mjs <yedek.json> [beklenen-toplam-TRY]

import { readFileSync } from 'node:fs'
import { computePortfolioSummary, computeHoldings } from '../src/lib/calculations.js'

const path = process.argv[2]
if (!path) {
  console.error('Kullanım: node scripts/check-positions.mjs <yedek.json> [beklenen-toplam-TRY]')
  process.exit(1)
}
const expectedTotal = process.argv[3] ? Number(process.argv[3]) : null

const backup = JSON.parse(readFileSync(path, 'utf8'))
const txns = backup.transactions || []
const ports = backup.subPortfolios || []
const priceCache = backup.priceCache || {}
const fx = backup.settings?.fxRates || {}
const tl = (n) => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' ₺'

let problems = 0
const bad = (m) => { problems++; console.log(`  ✗ ${m}`) }

console.log(`\nDosya       : ${path}`)
console.log(`Dışa aktarım: ${backup.exportedAt || '?'}`)
console.log(`İşlem       : ${txns.length}   Portföy: ${ports.length}   Fiyat önbelleği: ${Object.keys(priceCache).length} sembol`)

// --- 1. id benzersizliği ----------------------------------------------------
// Veri kaybının kökü buydu: iki içe aktarım aynı 'inv' önekini kullandı,
// sunucudaki (user_id, id) anahtarı her çiftten birini yuttu.
console.log('\n=== İŞLEM ID BENZERSİZLİĞİ ===')
const seen = new Map()
const dupes = []
for (const t of txns) {
  if (seen.has(t.id)) dupes.push([t.id, seen.get(t.id), t])
  else seen.set(t.id, t)
}
console.log(`  ${seen.size} benzersiz id / ${txns.length} işlem`)
if (dupes.length) {
  bad(`${dupes.length} ÇAKIŞAN id — senkronda veri kaybı riski!`)
  for (const [id, a, b] of dupes.slice(0, 10)) {
    console.log(`      ${id}: ${a.date} ${a.symbol} (${a.portfolioId})  ↔  ${b.date} ${b.symbol} (${b.portfolioId})`)
  }
} else {
  console.log('  ✓ Çakışan id yok.')
}

// --- 2. Portföy başına pozisyon --------------------------------------------
console.log('\n=== PORTFÖY BAŞINA POZİSYON ===')
let sumTotals = 0
for (const p of ports) {
  const s = computePortfolioSummary(txns, priceCache, fx, p.id)
  const n = s.holdings.length
  const noPrice = s.holdings.filter((h) => !h.marketValueTRY).length
  sumTotals += s.totalValue
  console.log(
    `  ${(p.isCashAccount ? '[KASA] ' : '') + p.name}`.padEnd(22) +
    `${String(n).padStart(3)} pozisyon` +
    `   yatırım ${tl(s.investedValue).padStart(14)}` +
    `   nakit ${tl(s.cashTotal).padStart(12)}` +
    `   toplam ${tl(s.totalValue).padStart(14)}` +
    (noPrice ? `   ⚠ ${noPrice} sembolün fiyatı yok` : '')
  )
  if (s.cashShortfallTRY > 0) bad(`${p.name}: ${tl(s.cashShortfallTRY)} nakit açığı (eksi bakiye kırpıldı)`)
}

// --- 3. Genel toplam --------------------------------------------------------
const all = computePortfolioSummary(txns, priceCache, fx, null)
console.log('\n=== GENEL ===')
console.log(`  Toplam pozisyon : ${computeHoldings(txns).length}`)
console.log(`  Toplam değer    : ${tl(all.totalValue)}   (yatırım ${tl(all.investedValue)} + nakit ${tl(all.cashTotal)})`)
if (expectedTotal !== null) {
  const diff = all.totalValue - expectedTotal
  const pct = Math.abs(diff) / expectedTotal * 100
  console.log(`  Beklenen        : ${tl(expectedTotal)}   fark ${tl(diff)} (%${pct.toFixed(2)})`)
  if (pct > 1) bad('Fark %1\'in üstünde — fiyat önbelleği farkından fazlası olabilir.')
}

console.log(problems === 0 ? '\n✓ Yapısal sorun bulunamadı.\n' : `\n✗ ${problems} sorun.\n`)
process.exit(problems ? 1 : 0)
