// Bir alt portföyün pozisyonları, büyükten küçüğe sıralı çubuklar.
//
// NEDEN HALKA DEĞİL
//
// Ana sayfadaki halka dört-beş dilim gösteriyor ve orada doğru form o: az
// sayıda parçanın bütüne oranı. Alt portföyde 12+ pozisyon var ve halka iki
// yerde birden çuvallıyor:
//
//   RENK. Kategorik paletler sekiz renkte tükeniyor. Halka "her dilim her
//   dilimle karşılaştırılabilir" bir form olduğu için eşik daha da sert —
//   kullandığımız paletin kendi ölçümü, bu koşulda sekizinin bile ayrım
//   tabanını geçemediğini söylüyor. 13 dilim demek, beş rengi uydurmak ve renk
//   körü bir okuyucu için birbirine karıştırmak demek.
//
//   OKUMA. Halkada iki bitişik dilimden hangisinin büyük olduğunu gözle
//   kestiremezsin; açıyı karşılaştırmak insan gözünün kötü olduğu işlerden.
//   Uzunluk karşılaştırmak ise iyi olduğu işlerden.
//
// Sıralı çubuklarda kimlik RENKTEN DEĞİL ETİKETTEN geliyor. Bu yüzden tek hue
// yetiyor ve kalem sayısının bir üst sınırı kalmıyor — 12 de olur, 30 da.
//
// Nakit ayrı bir tonda: bir varlık değil, henüz yatırılmamış para. Aradaki fark
// bu ekranda anlamlı, o yüzden görsel olarak da ayrılıyor.

import { useT } from '../../i18n/useT.js'
import { formatCurrency } from '../../lib/currency.js'

// Tek hue, üç ton. Kategorik bir palet DEĞİL: bu renkler kimliği taşımıyor,
// yalnızca kalem türünü ayırıyor. Kimlik etiketin kendisinde.
const TONE = {
  asset: 'var(--chart-bar)',
  cash: 'var(--chart-bar-cash)',
  other: 'var(--chart-bar-muted)',
}

export function HoldingAllocationBars({ allocation }) {
  const { t, ti } = useT()

  if (!allocation || allocation.length === 0) {
    return (
      <div className="h-[120px] flex items-center justify-center text-text-tertiary text-sm">
        {t.dashboard.noChartData}
      </div>
    )
  }

  // Çubuk uzunlukları EN BÜYÜK KALEME göre ölçekleniyor, %100'e göre değil.
  // Yüzde 4'ün altında kalan bir sürü pozisyonun hepsi, %100'lük bir eksende
  // ayırt edilemeyen kırıntılara dönüşürdü. Yüzde değeri zaten satırda yazılı;
  // çubuğun işi kalemleri BİRBİRİYLE karşılaştırmak.
  const max = Math.max(...allocation.map((a) => a.value)) || 1

  return (
    <div className="space-y-2.5">
      {allocation.map((row) => (
        <div key={row.key}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-xs text-text-secondary truncate">
              {row.kind === 'cash'
                ? `${t.assets.cash} · ${row.label}`
                : row.kind === 'other'
                  ? ti(t.dashboard.otherPositions, { n: row.count })
                  : row.label}
            </span>
            <span className="text-xs text-text-tertiary tabular-nums shrink-0">
              {row.pct.toFixed(1)}%
              <span className="text-text-muted ml-2">
                {formatCurrency(row.value, 'TRY', { compact: true, decimals: 1 })}
              </span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.max((row.value / max) * 100, 1.5)}%`,
                background: TONE[row.kind === 'cash' ? 'cash' : row.kind === 'other' ? 'other' : 'asset'],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
