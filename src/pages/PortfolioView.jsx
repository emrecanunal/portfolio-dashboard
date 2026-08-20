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
//   - FIRE/savings stay GLOBAL (FIRE goal is across all portfolios) on master,
//     and are also computed against the scoped slice on sub-views for context

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, ArrowRight, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import {
  computePortfolioSummary,
  computeAllocation,
  computeAllocationDetail,
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
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Button, Badge } from '../components/ui/Primitives.jsx'
import { StatCard } from '../components/ui/StatCard.jsx'
import { AllocationDonut } from '../components/charts/AllocationDonut.jsx'
import { AllocationBreakdown } from '../components/AllocationBreakdown.jsx'
import { PerformanceLine } from '../components/charts/PerformanceLine.jsx'
import { FireProgressCard } from '../components/charts/FireProgressCard.jsx'
import { AddTransactionModal } from '../components/modals/AddTransactionModal.jsx'
import { StaleRatesBanner } from '../components/StaleRatesBanner.jsx'
import { DataWarnings } from '../components/DataWarnings.jsx'

export function PortfolioView({ scope = { type: 'master' } }) {
  const { t, ti } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const settings = usePortfolioStore((s) => s.settings)
  const updateSettings = usePortfolioStore((s) => s.updateSettings)

  const [modalOpen, setModalOpen] = useState(false)

  const isMaster = scope.type === 'master'
  const portfolioId = isMaster ? null : scope.portfolioId

  // Filter transactions to scope (used everywhere)
  const scopedTxns = useMemo(
    () => (isMaster ? transactions : transactions.filter((tx) => tx.portfolioId === portfolioId)),
    [transactions, isMaster, portfolioId]
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

  // The same selector that drives FIRE lookback also drives the chart range.
  // A value of 0 means "All time" — computePerformanceSeries handles that by
  // anchoring to the earliest transaction date.
  const performance = useMemo(
    () => computePerformanceSeries(scopedTxns, priceCache, settings.fxRates, settings.fireLookbackMonths),
    [scopedTxns, priceCache, settings.fxRates, settings.fireLookbackMonths]
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
  const firePct = (currentUSD / fireTargetUSD) * 100
  const monthsToFire = projectMonthsToFire({
    currentValue: summary.totalValue,
    targetValue: targetTRY,
    monthlyContribution: fireMetrics.avgMonthlySavingsTRY,
    monthlyGrowthRate: fireMetrics.avgMonthlyGrowthPct,
  })

  // Master-only: per-sub-portfolio breakdown
  const subSummaries = useMemo(() => {
    if (!isMaster) return []
    return subPortfolios.map((p) => {
      const s = computePortfolioSummary(transactions, priceCache, settings.fxRates, p.id)
      return {
        ...p,
        ...s,
        shareOfTotal: summary.totalValue > 0 ? (s.totalValue / summary.totalValue) * 100 : 0,
      }
    })
  }, [isMaster, subPortfolios, transactions, priceCache, settings.fxRates, summary.totalValue])

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
          sublabel={`≈ $${currentUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD`}
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

      {/* === FIRE CARD (with embedded savings) === */}
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

      {/* === ALLOCATION + PERFORMANCE === */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-3">
        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.assetAllocation}</CardTitle>
          </CardHeader>
          <CardBody>
            <AllocationDonut allocation={allocation} />
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
          </CardHeader>
          <CardBody>
            <PerformanceLine data={performance} />
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
                    <ArrowRight size={12} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
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
            className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
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
