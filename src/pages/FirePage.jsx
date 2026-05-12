import { useMemo } from 'react'
import { Check, Info } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import {
  computePortfolioSummary,
  computeFireMetrics,
  projectMonthsToFire,
  formatEta,
} from '../lib/calculations.js'
import { computeJourneyPosition, FIRE_STAGES } from '../lib/fireStages.js'
import { formatCurrency, convertFromTRY } from '../lib/currency.js'
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Button, Badge } from '../components/ui/Primitives.jsx'
import { FireJourneyBar } from '../components/charts/FireJourneyBar.jsx'
import { cn } from '../lib/utils.js'

const WITHDRAWAL_RATES = [
  { value: 0.03, key: 'conservative' },
  { value: 0.035, key: 'standard' },
  { value: 0.04, key: 'standard' },
  { value: 0.05, key: 'aggressive' },
]

export default function FirePage() {
  const { t, ti } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const settings = usePortfolioStore((s) => s.settings)
  const updateSettings = usePortfolioStore((s) => s.updateSettings)

  // === DERIVED ===
  const summary = useMemo(
    () => computePortfolioSummary(transactions, priceCache, settings.fxRates),
    [transactions, priceCache, settings.fxRates]
  )

  const fireMetrics = useMemo(
    () => computeFireMetrics(transactions, priceCache, settings.fxRates, settings.fireLookbackMonths),
    [transactions, priceCache, settings.fxRates, settings.fireLookbackMonths]
  )

  const currentUSD = convertFromTRY(summary.totalValue, 'USD', settings.fxRates)
  const monthlyExpensesTRY = settings.monthlyExpensesUSD * settings.fxRates.USD
  const annualExpensesUSD = settings.monthlyExpensesUSD * 12

  // FIRE journey computation
  const journey = useMemo(
    () =>
      computeJourneyPosition({
        currentValueUSD: currentUSD,
        monthlyExpensesUSD: settings.monthlyExpensesUSD,
        activeStageId: settings.activeFireStage,
      }),
    [currentUSD, settings.monthlyExpensesUSD, settings.activeFireStage]
  )

  // ETA per stage (helps users compare)
  const stageETAs = useMemo(() => {
    const ret = {}
    for (const stage of journey.stages) {
      const targetTRY = stage.targetUSD * settings.fxRates.USD
      const months = projectMonthsToFire({
        currentValue: summary.totalValue,
        targetValue: targetTRY,
        monthlyContribution: fireMetrics.avgMonthlySavingsTRY,
        monthlyGrowthRate: fireMetrics.avgMonthlyGrowthPct,
      })
      ret[stage.id] = months
    }
    return ret
  }, [journey.stages, settings.fxRates.USD, summary.totalValue, fireMetrics])

  // === Handlers ===
  const setActiveStage = (stageId) => updateSettings({ activeFireStage: stageId })
  const setMonthlyExpenses = (val) => {
    const num = Math.max(0, parseFloat(val) || 0)
    updateSettings({ monthlyExpensesUSD: num })
  }
  const setWithdrawalRate = (rate) => updateSettings({ withdrawalRate: rate })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-2xs uppercase tracking-widest text-text-tertiary mb-1">
          {t.nav.fire}
        </p>
        <h1 className="text-3xl font-medium text-text-primary">{t.firePage.title}</h1>
        <p className="text-sm text-text-tertiary mt-1">{t.firePage.subtitle}</p>
      </div>

      {/* === FIRE JOURNEY BAR === */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t.firePage.journey}</CardTitle>
            <CardSubtitle>{t.firePage.journeySubtitle}</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody className="pt-2 pb-6">
          <FireJourneyBar
            stages={journey.stages}
            percentOnBar={journey.percentOnBar}
            activeStageId={settings.activeFireStage}
            lastReachedIndex={journey.lastReachedIndex}
            currentValueUSD={currentUSD}
            currentValueTRY={summary.totalValue}
            fxRates={settings.fxRates}
            onStageClick={setActiveStage}
          />
        </CardBody>
      </Card>

      {/* === STAGE CARDS GRID === */}
      <div>
        <h2 className="text-base font-medium text-text-primary mb-3">{t.firePage.activeTarget}</h2>
        <p className="text-xs text-text-tertiary mb-4">{t.firePage.activeTargetHelp}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {journey.stages.map((stage, i) => {
            const isActive = stage.id === settings.activeFireStage
            const isReached = i <= journey.lastReachedIndex
            const eta = stageETAs[stage.id]
            const targetTRY = stage.targetUSD * settings.fxRates.USD
            const pct = (currentUSD / stage.targetUSD) * 100
            return (
              <button
                key={stage.id}
                onClick={() => setActiveStage(stage.id)}
                className={cn(
                  'text-left p-4 rounded-xl border transition-all',
                  'hover:border-border-default',
                  isActive
                    ? 'bg-bg-secondary'
                    : 'bg-bg-secondary/40 border-border-subtle'
                )}
                style={
                  isActive
                    ? {
                        borderColor: stage.color,
                        boxShadow: `0 0 0 1px ${stage.color}40, 0 0 24px ${stage.color}15`,
                      }
                    : undefined
                }
              >
                {/* Stage header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: stage.color }}
                    />
                    <span className="text-sm font-medium text-text-primary">
                      {t.firePage[`${stage.key}Title`]}
                    </span>
                  </div>
                  {isActive && (
                    <Badge variant="success" className="text-2xs">
                      <Check size={9} strokeWidth={3} className="mr-0.5" />
                      {t.firePage.currentlyActive}
                    </Badge>
                  )}
                </div>

                {/* Description */}
                <p className="text-2xs text-text-tertiary leading-relaxed mb-3 min-h-[2.5em]">
                  {t.firePage[`${stage.key}Desc`]}
                </p>

                {/* Target */}
                <div className="space-y-1 mb-3">
                  <div className="text-lg font-medium text-text-primary tabular-nums">
                    ${stage.targetUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-2xs text-text-tertiary tabular-nums">
                    {formatCurrency(targetTRY, 'TRY', { compact: true, decimals: 1 })}
                  </div>
                </div>

                {/* Progress + ETA */}
                <div className="space-y-1.5 pt-3 border-t border-border-subtle">
                  <div className="flex justify-between text-2xs">
                    <span className="text-text-tertiary">
                      {isReached ? t.firePage.reached : `${Math.min(100, pct).toFixed(0)}%`}
                    </span>
                    <span className="text-text-secondary tabular-nums">
                      {isReached ? '—' : formatEta(eta, t)}
                    </span>
                  </div>
                  <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, pct)}%`,
                        background: stage.color,
                      }}
                    />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* === SETTINGS GRID: Expenses + Withdrawal Rate === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Monthly expenses */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t.firePage.monthlyExpenses}</CardTitle>
              <CardSubtitle>{t.firePage.expensesHint}</CardSubtitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {/* USD input */}
              <div>
                <label className="input-label">USD</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    className="input-field pl-7 tabular-nums"
                    value={settings.monthlyExpensesUSD}
                    onChange={(e) => setMonthlyExpenses(e.target.value)}
                  />
                </div>
              </div>

              {/* TRY display (read-only, auto-computed) */}
              <div>
                <label className="input-label">TRY ({t.firePage.currentValue})</label>
                <div className="bg-bg-tertiary border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-secondary tabular-nums">
                  {formatCurrency(monthlyExpensesTRY, 'TRY', { decimals: 0 })}
                  <span className="text-2xs text-text-tertiary ml-2">
                    @ ₺{settings.fxRates.USD}/$
                  </span>
                </div>
              </div>

              {/* Annual */}
              <div className="pt-3 border-t border-border-subtle">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-tertiary">{t.firePage.annualExpenses}</span>
                  <span className="text-text-primary font-medium tabular-nums">
                    ${annualExpensesUSD.toLocaleString()}
                    <span className="text-2xs text-text-tertiary ml-2">
                      ({formatCurrency(monthlyExpensesTRY * 12, 'TRY', { compact: true, decimals: 1 })})
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Withdrawal rate */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t.firePage.withdrawalRate}</CardTitle>
              <CardSubtitle>{t.firePage.withdrawalRateHelp}</CardSubtitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {WITHDRAWAL_RATES.map((r) => {
                const pct = r.value * 100
                const isActive = Math.abs(settings.withdrawalRate - r.value) < 0.001
                return (
                  <button
                    key={r.value}
                    onClick={() => setWithdrawalRate(r.value)}
                    className={cn(
                      'py-3 rounded-lg border text-center transition-all',
                      isActive
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'bg-bg-tertiary border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary'
                    )}
                  >
                    <div className="text-base font-medium tabular-nums leading-tight">
                      {pct.toFixed(pct % 1 === 0 ? 0 : 1)}%
                    </div>
                    <div className="text-2xs uppercase tracking-wider mt-0.5 opacity-80">
                      {pct <= 3 ? t.firePage.conservative : pct >= 5 ? t.firePage.aggressive : t.firePage.standard}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="bg-bg-tertiary rounded-lg p-3 flex items-center justify-between text-sm">
              <span className="text-text-tertiary">Multiplier</span>
              <span className="text-text-primary font-medium tabular-nums">
                {(1 / settings.withdrawalRate).toFixed(1)}× annual expenses
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* === ETA PREVIEW === */}
      <Card>
        <CardBody className="p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="text-2xs uppercase tracking-wider text-text-tertiary font-medium mb-1">
                {ti(t.firePage.etaToActive, { stage: t.firePage[`${journey.activeStage.key}Title`] })}
              </div>
              <div className="text-3xl font-medium text-text-primary tabular-nums">
                {formatEta(stageETAs[settings.activeFireStage], t)}
              </div>
              <div className="text-xs text-text-tertiary mt-1">
                {ti(t.firePage.basedOnSavings, { months: settings.fireLookbackMonths })}
              </div>
            </div>

            <div className="flex-1 min-w-[200px]">
              <div className="text-2xs uppercase tracking-wider text-text-tertiary font-medium mb-1">
                {t.fire.avgMonthlySavings}
              </div>
              <div className="text-xl font-medium text-text-primary tabular-nums">
                {formatCurrency(fireMetrics.avgMonthlySavingsTRY, 'TRY', { compact: true, decimals: 1 })}
              </div>
              <div className="text-xs text-text-tertiary mt-1">
                {fireMetrics.avgMonthlyGrowthPct >= 0 ? '+' : ''}
                {fireMetrics.avgMonthlyGrowthPct.toFixed(1)}% / mo growth
              </div>
            </div>

            <div className="flex-1 min-w-[200px]">
              <div className="text-2xs uppercase tracking-wider text-text-tertiary font-medium mb-1">
                {t.dashboard.netWorth}
              </div>
              <div className="text-xl font-medium text-text-primary tabular-nums">
                {formatCurrency(summary.totalValue, 'TRY', { compact: true, decimals: 1 })}
              </div>
              <div className="text-xs text-text-tertiary mt-1">
                ${currentUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* === METHODOLOGY === */}
      <div className="bg-bg-secondary/40 border border-border-subtle rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-text-tertiary shrink-0 mt-0.5" strokeWidth={1.75} />
        <div>
          <div className="text-xs font-medium text-text-secondary mb-1">{t.firePage.methodology}</div>
          <p className="text-2xs text-text-tertiary leading-relaxed">
            {ti(t.firePage.methodologyBody, { rate: (settings.withdrawalRate * 100).toFixed(1) })}
          </p>
        </div>
      </div>
    </div>
  )
}
