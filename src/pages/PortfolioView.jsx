// Shared portfolio view used by both the Master Dashboard (no scope) and
// the individual sub-portfolio detail pages (scoped to one portfolioId).
//
// Pass scope = { type: 'master' } for the master view.
// Pass scope = { type: 'sub', portfolioId, portfolio } for a single portfolio.
//
// Behavioral differences:
//   - Master shows the sub-portfolios card; sub-views skip it (no nesting needed)
//   - Sub-views show a header with the portfolio's name + back link
//   - All KPIs/charts/transactions are filtered to the portfolio when scoped
//   - FIRE/savings appear ONLY on master. Para bir alt portföye değil, portföyün
//     bütününe giriyor; alt portföye düşen pay bir hedef değil, bir dağıtım.
//     Eskiden alt görünümlerde de gösteriliyordu ve yanlış okunmaya açıktı:
//     her alt portföy KENDİ değerini AYNI küresel hedefe bölüyor, yani üç
//     portföyün %2,7 + %1,2 + %0,5'i toplanınca gerçek olan %4,4 çıkıyordu —
//     ama ekranda hiçbir şey bunu söylemiyordu. Yerine "toplamın %X'i" geldi:
//     uydurma bir hedef yaratmadan bu portföyün ağırlığını söylüyor.
//   - Dağılım master'da varlık sınıfına göre (halka), alt görünümde tek tek
//     pozisyonlara göre (sıralı çubuklar). Alt portföyde "%97 BIST" bir bilgi
//     değil; "hangi pozisyonlardan oluşuyor" bilgi.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, ArrowRight, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import {
  computePortfolioSummary,
  scopeTransactions,
  computeAllocation,
  computeAllocationDetail,
  computeHoldingAllocation,
  computeCashByCurrency,
  computeDayChange,
  computePerformanceSeries,
  computeFireMetrics,
  computeMonthlySavingsSeries,
  projectMonthsToFire,
  formatEta,
} from '../lib/calculations.js'
import { computeStageTargets, getStageById } from '../lib/fireStages.js'
import { formatCurrency, formatPercent, formatSignedCurrency, convertFromTRY } from '../lib/currency.js'
import { formatRelativeTime } from '../lib/fxApi.js'
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Button, Badge } from '../components/ui/Primitives.jsx'
import { StatCard } from '../components/ui/StatCard.jsx'
import { AllocationDonut } from '../components/charts/AllocationDonut.jsx'
import { HoldingAllocationBars } from '../components/charts/HoldingAllocationBars.jsx'
import { AllocationBreakdown } from '../components/AllocationBreakdown.jsx'
import { PerformanceLine } from '../components/charts/PerformanceLine.jsx'
import { FireProgressCard } from '../components/charts/FireProgressCard.jsx'
import { AddTransactionModal } from '../components/modals/AddTransactionModal.jsx'
import { StaleRatesBanner } from '../components/StaleRatesBanner.jsx'
import { StaleBackupBanner } from '../components/StaleBackupBanner.jsx'
import { DataWarnings } from '../components/DataWarnings.jsx'

export function PortfolioView({ scope = { type: 'master' } }) {
  const { t, ti, lang } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const priceHistory = usePortfolioStore((s) => s.priceHistory)
  const fxHistory = usePortfolioStore((s) => s.fxHistory)
  const settings = usePortfolioStore((s) => s.settings)
  const updateSettings = usePortfolioStore((s) => s.updateSettings)

  const [modalOpen, setModalOpen] = useState(false)

  const isMaster = scope.type === 'master'
  const portfolioId = isMaster ? null : scope.portfolioId

  // Filter transactions to scope (used everywhere)
  const scopedTxns = useMemo(
    () => scopeTransactions(transactions, portfolioId),
    [transactions, portfolioId]
  )

  // === DERIVED ===
  const summary = useMemo(
    () => computePortfolioSummary(transactions, priceCache, settings.fxRates, portfolioId),
    [transactions, priceCache, settings.fxRates, portfolioId]
  )

  // Per-currency cash split (TRY, USD, EUR, …) — feeds both the donut and the
  // breakdown widget so they can show e.g. "$3.272" and "₺96.475" as separate
  // rows/slices.
  const cashByCurrency = useMemo(
    () => computeCashByCurrency(transactions, portfolioId),
    [transactions, portfolioId]
  )

  const allocation = useMemo(
    () => computeAllocation(summary, cashByCurrency, settings.fxRates),
    [summary, cashByCurrency, settings.fxRates]
  )

  const allocationDetail = useMemo(
    () => computeAllocationDetail(summary, priceCache, settings.fxRates, cashByCurrency),
    [summary, priceCache, settings.fxRates, cashByCurrency]
  )

  // Alt görünümün dağılımı: varlık sınıfı değil, tek tek pozisyonlar.
  // İlk 12 + "diğer" — kategorik paletler sekiz renkte tükendiği için tamamını
  // ayrı ayrı boyamak mümkün değil, ama burada kimliği renk değil ETİKET
  // taşıdığı için 12 kalem sorunsuz okunuyor.
  const holdingAllocation = useMemo(
    () => (isMaster ? [] : computeHoldingAllocation(summary, cashByCurrency, settings.fxRates, 12)),
    [isMaster, summary, cashByCurrency, settings.fxRates]
  )

  // Alt görünümde "toplamın %X'i" için gereken payda. Master'da hesaplanmıyor:
  // orada zaten kendisi toplam.
  const masterTotalTRY = useMemo(
    () => (isMaster ? summary.totalValue
                    : computePortfolioSummary(transactions, priceCache, settings.fxRates).totalValue),
    [isMaster, summary.totalValue, transactions, priceCache, settings.fxRates]
  )

  // The same selector that drives FIRE lookback also drives the chart range.
  // A value of 0 means "All time" — computePerformanceSeries handles that by
  // anchoring to the earliest transaction date.
  const performance = useMemo(
    () =>
      computePerformanceSeries(scopedTxns, priceCache, settings.fxRates, settings.fireLookbackMonths, {
        priceHistory,
        fxHistory,
      }),
    [scopedTxns, priceCache, settings.fxRates, settings.fireLookbackMonths, priceHistory, fxHistory]
  )

  const fireMetrics = useMemo(
    () => computeFireMetrics(scopedTxns, priceCache, settings.fxRates, settings.fireLookbackMonths),
    [scopedTxns, priceCache, settings.fxRates, settings.fireLookbackMonths]
  )

  const monthlyExpensesTRY = settings.monthlyExpensesUSD * settings.fxRates.USD
  const savingsSeries = useMemo(
    () => computeMonthlySavingsSeries(scopedTxns, settings.fxRates, monthlyExpensesTRY, 6),
    [scopedTxns, settings.fxRates, monthlyExpensesTRY]
  )

  // Resolve active FIRE stage → target
  const stageTargets = useMemo(
    () => computeStageTargets(settings.monthlyExpensesUSD, settings.withdrawalRate),
    [settings.monthlyExpensesUSD, settings.withdrawalRate]
  )
  const activeStage = stageTargets.find((s) => s.id === settings.activeFireStage) || stageTargets[2]
  const fireTargetUSD = activeStage.targetUSD

  const targetTRY = fireTargetUSD * settings.fxRates.USD
  const currentUSD = convertFromTRY(summary.totalValue, 'USD', settings.fxRates)

  // Net varlığın altındaki satır: "≈ $7.752 · 48,245 ₺/$ · 2 saat önce".
  //
  // Kur cihazlar arası KASTEN senkronlanmıyor (mapping.js · SYNCED_SETTINGS):
  // kaydedilmiş bir kur anı kaydeder, veriyi değil, ve eski bir cihazınki
  // yeninin üzerine yazarsa çevrilmiş her rakam sessizce şaşar. Bunun
  // kaçınılmaz sonucu, iki cihazın aynı veriyle farklı toplam göstermesi — ve
  // bu doğru davranış.
  //
  // Söylenmediği sürece doğru GÖRÜNMÜYOR ama. Telefonda 939 bin, bilgisayarda
  // 926 bin gören biri veri kaybından şüpheleniyor; oysa aradaki tek fark
  // 48,245 ile 49,92. Toplamın hangi kurla ve ne kadar eski bir kurla
  // hesaplandığını yazmak farkı açıklanabilir kılıyor — kuru senkronlamanın
  // bedelini ödemeden.
  //
  // Kur yoksa dolar karşılığı da anlamsız, o yüzden ikisi tek satırda.
  const usdRate = settings.fxRates?.USD
  const fxFetchedAt = settings.fxMeta?.fetchedAt
  const fxSublabel = [
    `≈ $${currentUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    usdRate ? `${usdRate.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 3 })} ₺/$` : null,
    fxFetchedAt ? formatRelativeTime(fxFetchedAt, lang) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const firePct = (currentUSD / fireTargetUSD) * 100
  const monthsToFire = projectMonthsToFire({
    currentValue: summary.totalValue,
    targetValue: targetTRY,
    monthlyContribution: fireMetrics.avgMonthlySavingsTRY,
    monthlyGrowthRate: fireMetrics.avgMonthlyGrowthPct,
  })

  // Her portföyün değeri ve toplam içindeki payı.
  //
  // Eskiden yalnızca master'da hesaplanıyordu; alt görünümdeki pay çubuğu da
  // buna ihtiyaç duyuyor. Payda `summary.totalValue` DEĞİL `masterTotalTRY`:
  // alt görünümde summary o portföye daraltılmış durumda ve payları kendisine
  // bölmek her portföyü %100 gösterirdi.
  const subSummaries = useMemo(() => {
    return subPortfolios.map((p) => {
      const s = computePortfolioSummary(transactions, priceCache, settings.fxRates, p.id)
      return {
        ...p,
        ...s,
        shareOfTotal: masterTotalTRY > 0 ? (s.totalValue / masterTotalTRY) * 100 : 0,
      }
    })
  }, [subPortfolios, transactions, priceCache, settings.fxRates, masterTotalTRY])

  // Recent transactions in scope
  const recentTxns = useMemo(
    () =>
      [...scopedTxns]
        .filter((t) => t.type === 'buy' || t.type === 'sell')
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5),
    [scopedTxns]
  )

  // Today's move, summed from each position's previous close — the same numbers
  // the asset-breakdown card shows, so the two can never disagree.
  // (This used to be one thirtieth of the last monthly delta, labelled "today".)
  const dailyChange = useMemo(() => computeDayChange(allocationDetail), [allocationDetail])

  return (
    <div className="space-y-6">
      <StaleRatesBanner />
      <StaleBackupBanner />
      <DataWarnings portfolioId={portfolioId} />
      {/* === HEADER === */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          {isMaster ? (
            <>
              <p className="text-2xs uppercase tracking-widest text-text-tertiary mb-1">
                {t.dashboard.masterView}
              </p>
              <h1 className="text-3xl font-medium text-text-primary">{t.dashboard.title}</h1>
            </>
          ) : (
            <>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-2xs uppercase tracking-widest text-text-tertiary hover:text-text-primary mb-1 transition-colors"
              >
                <ArrowLeft size={11} strokeWidth={2.5} /> {t.dashboard.title}
              </Link>
              <div className="flex items-center gap-3">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: scope.portfolio?.color || '#888' }}
                />
                <h1 className="text-3xl font-medium text-text-primary">
                  {scope.portfolio?.name || 'Portfolio'}
                </h1>
              </div>
              <p className="text-xs text-text-tertiary mt-1 tabular-nums">
                {scopedTxns.length} {t.transactions.subtitle.replace('{n} ', '').replace('entries', 'transactions').replace('kayıt', 'işlem')}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={settings.fireLookbackMonths}
            onChange={(e) => updateSettings({ fireLookbackMonths: Number(e.target.value) })}
            className="bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-secondary focus:outline-none focus:border-border-default cursor-pointer"
          >
            <option value={3}>{ti(t.dashboard.lastNMonths, { n: 3 })}</option>
            <option value={6}>{ti(t.dashboard.lastNMonths, { n: 6 })}</option>
            <option value={12}>{ti(t.dashboard.lastNMonths, { n: 12 })}</option>
            <option value={0}>{t.dashboard.allTimeRange}</option>
          </select>
          <Button onClick={() => setModalOpen(true)}>
            <span className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.25} />
              {t.dashboard.addTransaction}
            </span>
          </Button>
        </div>
      </div>

      {/* === KPI ROW === */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={t.dashboard.netWorth}
          value={formatCurrency(summary.totalValue, 'TRY', { compact: true, decimals: 2 })}
          sublabel={fxSublabel}
        />
        <StatCard
          label={t.dashboard.dailyChange}
          value={
            dailyChange.known
              ? formatSignedCurrency(dailyChange.absTRY, 'TRY', { compact: true, decimals: 1 })
              : '—'
          }
          sublabel={
            dailyChange.known
              ? `${formatPercent(dailyChange.pct, { withSign: true })} ${t.dashboard.today}`
              : t.dashboard.noDayData
          }
          valueClass={
            !dailyChange.known
              ? 'text-text-tertiary'
              : dailyChange.absTRY >= 0
                ? 'text-success'
                : 'text-danger'
          }
        />
        <StatCard
          label={t.dashboard.totalPL}
          value={formatSignedCurrency(summary.totalPL, 'TRY', { compact: true, decimals: 1 })}
          sublabel={`${formatPercent(summary.plPct, { withSign: true })} ${t.dashboard.allTime}`}
          valueClass={summary.totalPL >= 0 ? 'text-success' : 'text-danger'}
        />
        <StatCard
          label={t.dashboard.cashReserve}
          value={formatCurrency(summary.cashTotal, 'TRY', { compact: true, decimals: 1 })}
          sublabel={`${summary.cashPct.toFixed(1)}% ${t.dashboard.ofPortfolio}`}
          valueClass={summary.cashPct < settings.cashThresholdPct ? 'text-warning' : 'text-text-primary'}
        />
      </div>

      {/* === FIRE (yalnızca master) / PAY SATIRI (alt görünüm) === */}
      {isMaster ? (
        <FireProgressCard
          currentValueTRY={summary.totalValue}
          currentValueUSD={currentUSD}
          targetUSD={fireTargetUSD}
          targetTRY={targetTRY}
          pct={firePct}
          etaText={formatEta(monthsToFire, t)}
          avgSavingsTRY={fireMetrics.avgMonthlySavingsTRY}
          avgGrowthPct={fireMetrics.avgMonthlyGrowthPct}
          annualizedReturn={fireMetrics.annualizedReturn}
          savingsSeries={savingsSeries}
          monthlyExpensesTRY={monthlyExpensesTRY}
          fireMultiplier={activeStage.multiplier}
        />
      ) : (
        <ShareOfTotal
          portfolios={subSummaries}
          currentId={portfolioId}
          color={scope.portfolio?.color}
        />
      )}

      {/* === ALLOCATION + PERFORMANCE === */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>
                {isMaster ? t.dashboard.assetAllocation : t.dashboard.positionBreakdown}
              </CardTitle>
              {!isMaster && (
                <CardSubtitle>{t.dashboard.positionBreakdownDesc}</CardSubtitle>
              )}
            </div>
          </CardHeader>
          <CardBody>
            {isMaster
              ? <AllocationDonut allocation={allocation} />
              : <HoldingAllocationBars allocation={holdingAllocation} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t.dashboard.performance}</CardTitle>
              <CardSubtitle>
                TRY · {settings.fireLookbackMonths
                  ? ti(t.dashboard.lastNMonths, { n: settings.fireLookbackMonths })
                  : t.dashboard.allTimeRange}
              </CardSubtitle>
            </div>
            <label className="tap flex items-center gap-1.5 text-2xs text-text-tertiary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.showContributionsLine !== false}
                onChange={(e) => updateSettings({ showContributionsLine: e.target.checked })}
                className="w-3.5 h-3.5 rounded border-border-strong cursor-pointer accent-accent"
              />
              {t.dashboard.showContributions}
            </label>
          </CardHeader>
          <CardBody>
            <PerformanceLine
              data={performance}
              showContributions={settings.showContributionsLine !== false}
            />
          </CardBody>
        </Card>
      </div>

      {/* === SUB-PORTFOLIOS (master only) === */}
      {isMaster && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t.dashboard.subPortfolios}</CardTitle>
              <CardSubtitle>{t.dashboard.clickToDrillIn}</CardSubtitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {subSummaries.map((p) => (
                <Link
                  key={p.id}
                  to={`/portfolios/${p.id}`}
                  className="block p-4 rounded-lg border border-border-subtle hover:border-border-default hover:bg-bg-tertiary/40 transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
                      <span className="text-sm font-medium text-text-primary">{p.name}</span>
                    </div>
                    {/* Decoration, not a control: it hints the card is a link. Where there is
                        no hover to reveal it, show it outright. */}
                    <ArrowRight
                      size={12}
                      className="text-text-tertiary opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                    />
                  </div>
                  <div className="text-lg font-medium text-text-primary tabular-nums">
                    {formatCurrency(p.totalValue, 'TRY', { compact: true, decimals: 1 })}
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-2xs">
                    {p.totalPL >= 0 ? (
                      <TrendingUp size={10} className="text-success" />
                    ) : (
                      <TrendingDown size={10} className="text-danger" />
                    )}
                    <span className={p.totalPL >= 0 ? 'text-success' : 'text-danger'}>
                      {formatSignedCurrency(p.totalPL, 'TRY', { compact: true, decimals: 1 })} · {formatPercent(p.plPct, { withSign: true })}
                    </span>
                  </div>
                  <div className="text-2xs text-text-tertiary mt-2 tabular-nums">
                    {p.shareOfTotal.toFixed(1)}% {t.dashboard.ofTotal}
                  </div>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* === ASSET BREAKDOWN === */}
      <AllocationBreakdown allocation={allocationDetail} />

      {/* === RECENT TRANSACTIONS === */}
      <Card>
        <CardHeader>
          <CardTitle>{t.dashboard.recentTransactions}</CardTitle>
          <Link
            to="/transactions"
            className="tap text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
          >
            {t.common.viewAll} <ArrowRight size={12} />
          </Link>
        </CardHeader>
        <CardBody>
          {recentTxns.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-tertiary">
              {t.transactions.empty}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-2xs uppercase tracking-wider text-text-tertiary border-b border-border-subtle">
                    <th className="text-left font-medium pb-3">{t.txn.date}</th>
                    <th className="text-left font-medium pb-3">{t.txn.type}</th>
                    <th className="text-left font-medium pb-3">{t.txn.asset}</th>
                    <th className="text-left font-medium pb-3">{t.txn.portfolio}</th>
                    <th className="text-right font-medium pb-3">{t.txn.amount}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTxns.map((tx) => {
                    const subPortfolio = subPortfolios.find((p) => p.id === tx.portfolioId)
                    const amount = tx.quantity * tx.price
                    return (
                      <tr key={tx.id} className="border-b border-border-subtle/50 hover:bg-bg-tertiary/30 transition-colors">
                        <td className="py-3 text-text-secondary tabular-nums">{tx.date}</td>
                        <td className="py-3">
                          <Badge variant={tx.type === 'buy' ? 'success' : 'danger'}>
                            {tx.type === 'buy' ? t.txn.buy : t.txn.sell}
                          </Badge>
                        </td>
                        <td className="py-3 font-mono text-xs text-text-primary">{tx.symbol}</td>
                        <td className="py-3 text-text-secondary">{subPortfolio?.name || '—'}</td>
                        <td className="py-3 text-right tabular-nums text-text-primary">
                          {formatCurrency(amount, tx.currency, { decimals: 0 })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <AddTransactionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultPortfolioId={portfolioId}
      />
    </div>
  )
}

// Alt portföyün toplam içindeki ağırlığı — ve diğerlerinin yanındaki yeri.
//
// FIRE kartının yerini alıyor. Neden aldığı önemli: FIRE hedefi tek ve küresel,
// alt portföyde göstermek her portföyün kendi hedefi varmış izlenimi veriyordu.
//
// NEDEN TEK BİR ÇUBUK DEĞİL, HEPSİ
//
// "Toplamın %36,5'i" doğru ama yalnız bir sayı. Aynı yerde bütün portföyleri
// göstermek, aynı görsel bütçeyle ikinci bir soruyu da cevaplıyor: bu portföy
// diğerlerinin yanında nerede duruyor. Master'daki alt portföy kartına gitmeden
// görülebiliyor.
//
// RENK: bu portföy kendi rengiyle, diğerleri tek bir geri çekilmiş griyle.
// Hepsini kendi renkleriyle boyamak kimliği korurdu ama vurguyu dağıtırdı —
// buradaki soru "hangi portföy hangisi" değil, "BU portföy ne kadarı". Griler
// bağlam; adları ve yüzdeleri altta metin olarak yazılı, yani kimlik renge
// hiç bağlı değil.
function ShareOfTotal({ portfolios, currentId, color }) {
  const { t, ti } = useT()

  const total = portfolios.reduce((sum, p) => sum + Math.max(0, p.totalValue), 0)
  if (!(total > 0)) return null

  const current = portfolios.find((p) => p.id === currentId)
  const pct = current?.shareOfTotal ?? 0
  const others = portfolios.filter((p) => p.id !== currentId && p.totalValue > 0)

  // Büyükten küçüğe: en büyük parça solda, göz soldan başlıyor.
  const segments = [...portfolios]
    .filter((p) => p.totalValue > 0)
    .sort((a, b) => b.totalValue - a.totalValue)

  return (
    <Card>
      <CardBody className="p-5">
        <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
          <div>
            <h3 className="text-base font-medium text-text-primary">{t.dashboard.shareOfTotalTitle}</h3>
            <p className="text-xs text-text-tertiary mt-1">{t.dashboard.shareOfTotalDesc}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-medium tabular-nums text-text-primary">
              {pct.toFixed(1)}%
            </div>
            <div className="text-xs text-text-tertiary mt-0.5">
              {formatCurrency(current?.totalValue || 0, 'TRY', { compact: true, decimals: 2 })}
            </div>
          </div>
        </div>

        {/* Yığılmış çubuk. Parçalar arasında 2px yüzey boşluğu var: bitişik iki
            dolgu boşluksuz durduğunda sınır kaybolur ve iki parça tek bir
            parça gibi okunur. */}
        <div className="flex gap-[2px] h-2.5 mb-3">
          {segments.map((p) => (
            <div
              key={p.id}
              className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-500"
              style={{
                width: `${Math.max((p.totalValue / total) * 100, 0.8)}%`,
                background: p.id === currentId ? (color || 'var(--chart-bar)') : 'var(--chart-bar-muted)',
              }}
              title={`${p.name} · ${p.shareOfTotal.toFixed(1)}%`}
            />
          ))}
        </div>

        {/* Kimlik metinde, renkte değil: renk körü bir okuyucu da, gri
            parçaları birbirinden ayıramayan biri de buradan okuyabiliyor. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: color || 'var(--chart-bar)' }}
            />
            <span className="text-text-primary">{current?.name}</span>
            <span className="text-text-tertiary tabular-nums">{pct.toFixed(1)}%</span>
          </span>
          {others.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: 'var(--chart-bar-muted)' }} />
              <span className="text-text-tertiary">{p.name}</span>
              <span className="text-text-muted tabular-nums">{p.shareOfTotal.toFixed(1)}%</span>
            </span>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
