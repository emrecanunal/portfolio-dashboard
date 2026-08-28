// Bir yedek dosyasını okuyup nakit sağlığını raporlar.
//
// NEDEN AYRI BİR BETİK
//
// Kasa ve açılış bakiyesi işi "girdim, oldu mu?" sorusunu doğuruyor ve ekranda
// bu sorunun cevabı dağınık: bir portföyün nakdi bugün pozitif görünürken
// geçmişte aylarca eksi kalmış olabilir. Bu betik uygulamanın KENDİ hesap
// fonksiyonlarını çağırıyor — ayrı bir kopya değil — ve tek sayfada söylüyor:
// hangi portföy ne zamandan beri eksi, en dip nerede, bugün ne durumda.
//
// Kullanım:  node scripts/check-cash.mjs <yedek.json>

import { readFileSync } from 'node:fs'
import {
  computeCashRuns,
  computeCashByPortfolio,
  computeCashByCurrency,
} from '../src/lib/calculations.js'

const path = process.argv[2]
if (!path) {
  console.error('Kullanım: node scripts/check-cash.mjs <yedek.json>')
  process.exit(1)
}

const backup = JSON.parse(readFileSync(path, 'utf8'))
const txns = backup.transactions || []
const ports = backup.subPortfolios || []
const fx = backup.settings?.fxRates || {}
const nameOf = Object.fromEntries(ports.map((p) => [p.id, p.name]))
const label = (id) => nameOf[id] || `(bilinmeyen: ${id})`
const tl = (n) => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' ₺'

console.log(`\nDosya      : ${path}`)
console.log(`Dışa aktarım: ${backup.exportedAt || '?'}`)
console.log(`İşlem      : ${txns.length}   Portföy: ${ports.length}`)
console.log(`Kur        : ${Object.entries(fx).map(([k, v]) => `${k}=${v}`).join('  ') || '(yok)'}`)

// --- 1. Portföyler ve kasa işareti -----------------------------------------
console.log('\n=== PORTFÖYLER ===')
const cashAccounts = ports.filter((p) => p.isCashAccount)
for (const p of ports) {
  console.log(`  ${p.isCashAccount ? '[KASA]' : '      '} ${p.name}  (${p.id})`)
}
if (cashAccounts.length === 0) console.log('  ⚠ Kasa olarak işaretlenmiş portföy YOK.')
if (cashAccounts.length > 1) console.log(`  ⚠ Birden fazla kasa işaretli (${cashAccounts.length}).`)

// --- 2. Açılış bakiyeleri ---------------------------------------------------
console.log('\n=== AÇILIŞ BAKİYELERİ (type=opening) ===')
const openings = txns.filter((t) => t.type === 'opening')
if (openings.length === 0) console.log('  (hiç yok)')
for (const o of openings.sort((a, b) => (a.date < b.date ? -1 : 1))) {
  const v = (o.quantity || 1) * (o.price || 0)
  console.log(`  ${o.date}  ${label(o.portfolioId).padEnd(18)} ${v.toLocaleString('tr-TR')} ${o.currency}`)
}
// Bir portföy PARA BİRİMİ BAŞINA tek açılış taşımalı. Portföy başına tek değil:
// nakit para birimi bazında tutuluyor ve bir hesabın hem TRY hem USD tarafı
// ayrı ayrı eksiye düşebiliyor — Amerika'da olan tam olarak buydu. Tek satır
// ikisini birden kapatamaz.
const perPortCcy = {}
for (const o of openings) {
  const k = `${o.portfolioId}|${o.currency}`
  perPortCcy[k] = (perPortCcy[k] || 0) + 1
}
for (const [k, n] of Object.entries(perPortCcy)) {
  const [pid, ccy] = k.split('|')
  if (n > 1) console.log(`  ⚠ ${label(pid)} / ${ccy} için ${n} açılış kaydı var; bir tane olmalı.`)
}

// --- 3. Transferler ---------------------------------------------------------
console.log('\n=== TRANSFERLER (type=transfer) ===')
const transfers = txns.filter((t) => t.type === 'transfer')
if (transfers.length === 0) console.log('  (hiç yok)')
for (const t of transfers.sort((a, b) => (a.date < b.date ? -1 : 1))) {
  const bad = !t.toPortfolioId
    ? '  ⚠ HEDEF YOK'
    : t.toPortfolioId === t.portfolioId
      ? '  ⚠ KENDİNE TRANSFER'
      : ''
  console.log(
    `  ${t.date}  ${label(t.portfolioId)} → ${t.toPortfolioId ? label(t.toPortfolioId) : '?'}` +
    `  ${((t.quantity || 1) * (t.price || 0)).toLocaleString('tr-TR')} ${t.currency}` +
    `${t.fee ? ` (masraf ${t.fee})` : ''}${bad}`,
  )
}

// --- 4. Bugünkü nakit -------------------------------------------------------
console.log('\n=== BUGÜNKÜ NAKİT (portföy başına) ===')
const byPort = computeCashByPortfolio(txns, fx)
let anyNegative = false
for (const p of ports) {
  const v = byPort.get(p.id) || 0
  const cur = computeCashByCurrency(txns, p.id)
  const detail = [...cur.entries()]
    .filter(([, a]) => Math.abs(a) > 0.005)
    .map(([c, a]) => `${a.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${c}`)
    .join(' · ')
  if (v < -0.01) anyNegative = true
  console.log(`  ${v < -0.01 ? '⚠' : ' '} ${p.name.padEnd(18)} ${tl(v).padStart(16)}   ${detail}`)
}
if (!anyNegative) console.log('  ✓ Hiçbir portföyün nakdi bugün eksi değil.')

// --- 5. Geçmişteki eksi dönemler -------------------------------------------
console.log('\n=== EKSİ NAKİT DÖNEMLERİ ===')
const runs = computeCashRuns(txns, fx)
const real = runs.filter((r) => !r.transient)
if (real.length === 0) {
  console.log('  ✓ Takas penceresinden uzun süren eksi dönem yok.')
} else {
  for (const r of real) {
    console.log(
      `  ${r.open ? 'AÇIK  ' : 'kapalı'} ${label(r.portfolioId).padEnd(18)}` +
      ` ${r.since} → ${r.resolvedOn || 'bugün'}  (${r.days} gün)` +
      `  en dip ${tl(r.worstTRY)} @ ${r.worstDate}`,
    )
  }
}
const transient = runs.length - real.length
if (transient) console.log(`  (${transient} kısa takas boşluğu göz ardı edildi)`)
console.log('')
