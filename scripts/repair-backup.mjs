// 28 Ağustos hasarını onarıp tek bir sağlam yedek üretir.
//
// NE OLMUŞTU
//
// 25 Ağustos yedeği 364 satır taşıyordu ama yalnızca 325 benzersiz id: 39 id
// hem bir T3 satırına hem bir Amerika satırına aitti (içe aktarım betiği iki
// Investing.com dosyasına da 'inv' önekini vermişti). Sunucudaki birincil
// anahtar (user_id, id) olduğu için her çiftte tek satır kaldı — Amerika kazandı.
// Sonraki çekişte sunucu sürümü yereldeki T3 satırının üstüne yazdı ve T3'ün
// 28 pozisyonunun tamamı yok oldu; Amerika'nın 39 işlemi ise çift göründü.
//
// ONARIM İLKESİ: HAKİKAT KAYNAĞI 25 AĞUSTOS YEDEĞİ
//
// O dosya hasardan önceki tam kümeyi içeriyor. Bu yüzden "28 Ağustos'a ne
// ekleyeyim" diye değil, "25 Ağustos'ta ne vardı" diye soruyoruz: her işlem
// İÇERİĞİYLE (tarih+portföy+tip+sembol+adet+fiyat+kur+masraf) eşleştiriliyor,
// id ile değil. Id zaten güvenilmez olan alan; onarımı ona dayandırmak, hatayı
// hatanın kendisiyle düzeltmeye çalışmak olurdu.
//
// Sonuçta her içerik, 25 Ağustos'ta kaç kez geçiyorsa o kadar kez var — ne eksik
// (T3 geri geldi) ne fazla (Amerika kopyaları düştü) — ve her satırın kendine
// ait bir id'si var.

import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const [, , beforePath, afterPath, outPath] = process.argv
if (!beforePath || !afterPath || !outPath) {
  console.error('Kullanım: node scripts/repair-backup.mjs <25agu.json> <28agu.json> <cikti.json>')
  process.exit(1)
}

const before = JSON.parse(readFileSync(beforePath, 'utf8'))
const after = JSON.parse(readFileSync(afterPath, 'utf8'))

// Id HARİÇ her şey. Onarımın tamamı buna dayanıyor.
const key = (t) =>
  [t.date, t.portfolioId, t.type, t.symbol || '', t.quantity, t.price, t.currency, t.fee || 0].join('|')

const tally = (rows) => {
  const m = new Map()
  for (const t of rows) m.set(key(t), (m.get(key(t)) || 0) + 1)
  return m
}

const WANTED = tally(before.transactions)

// --- 1. 28 Ağustos'tan sağlam olanları al ----------------------------------
// Açılışlar ve sub-default satırları hasar sonrası eklendi; onları burada
// tutmuyoruz, doğrularını aşağıda kendimiz koyuyoruz.
const seen = new Map()
const repaired = []
const dropped = { extraCopy: 0, opening: 0, starter: 0 }

for (const t of after.transactions) {
  if (t.type === 'opening') { dropped.opening++; continue }
  if (t.portfolioId === 'sub-default') { dropped.starter++; continue }
  const k = key(t)
  const n = (seen.get(k) || 0) + 1
  seen.set(k, n)
  if (n > (WANTED.get(k) || 0)) { dropped.extraCopy++; continue }
  repaired.push(t)
}

// --- 2. Eksikleri 25 Ağustos'tan geri koy ----------------------------------
const have = tally(repaired)
const restored = []
for (const t of before.transactions) {
  const k = key(t)
  if ((have.get(k) || 0) < WANTED.get(k)) {
    // Yeni id: eski id zaten bir başka satırla çakışıyordu, aynısını geri
    // koymak aynı çarpışmayı sunucuya tekrar götürürdü.
    const row = { ...t, id: randomUUID() }
    repaired.push(row)
    restored.push(row)
    have.set(k, (have.get(k) || 0) + 1)
  }
}

// --- 3. Doğru açılış bakiyeleri --------------------------------------------
// Her tutar, o portföyün gün sonu nakdinin tarihteki EN DİP noktası. Daha azı
// eksiyi kapatmaz, daha fazlası yoktan para yaratır. Tarih ilk işlemden bir gün
// önce: açılış, defterin başladığı andaki durumu beyan ediyor.
//
// Amerika iki satır alıyor. Nakit para birimi bazında tutuluyor ve orada hem
// TRY hem USD ayrı ayrı eksiye düşmüş; tek satır ikisini birden kapatamaz.
const OPENINGS = [
  { portfolioId: 'sub-t3', amount: 35575, currency: 'TRY', date: '2025-07-19' },
  { portfolioId: 'sub-mixed', amount: 125732, currency: 'TRY', date: '2025-11-13' },
  { portfolioId: 'sub-global', amount: 103839, currency: 'TRY', date: '2023-12-13' },
  { portfolioId: 'sub-global', amount: 1005, currency: 'USD', date: '2023-12-13' },
]

for (const o of OPENINGS) {
  repaired.push({
    id: randomUUID(),
    type: 'opening',
    assetType: 'cash',
    symbol: 'CASH',
    portfolioId: o.portfolioId,
    quantity: 1,
    price: o.amount,
    fee: 0,
    currency: o.currency,
    date: o.date,
    notes: 'Açılış bakiyesi (onarım)',
  })
}

// --- 4. Portföyler ----------------------------------------------------------
// sub-default 'Portfolio' boş bir cihazın sunucuya ittiği başlangıç portföyü;
// içinde yalnızca test satırları vardı. Kasa işaretli portföy korunuyor.
const portfolios = after.subPortfolios.filter((p) => p.id !== 'sub-default')

const out = {
  ...after,
  version: 2,
  exportedAt: new Date().toISOString(),
  transactions: repaired,
  subPortfolios: portfolios,
}

writeFileSync(outPath, JSON.stringify(out, null, 2))

// --- Rapor ------------------------------------------------------------------
const ids = new Set(repaired.map((t) => t.id))
const byPort = {}
for (const t of repaired) byPort[t.portfolioId] = (byPort[t.portfolioId] || 0) + 1

console.log(`\nGirdi   : ${before.transactions.length} (25 Ağu) / ${after.transactions.length} (28 Ağu)`)
console.log(`Atılan  : ${dropped.extraCopy} fazla kopya, ${dropped.opening} yanlış açılış, ${dropped.starter} test satırı`)
console.log(`Geri konan: ${restored.length} işlem`)
console.log(`Eklenen : ${OPENINGS.length} açılış bakiyesi`)
console.log(`Çıktı   : ${repaired.length} işlem, ${ids.size} benzersiz id`)
console.log(`Portföy : ${portfolios.length} — ${portfolios.map((p) => p.name).join(', ')}`)
console.log(`Dağılım : ${JSON.stringify(byPort)}`)
if (ids.size !== repaired.length) {
  console.error('\n⚠ ÇİFT ID VAR — bu dosya geri yüklenmemeli.')
  process.exit(1)
}
console.log(`\nYazıldı : ${outPath}\n`)
