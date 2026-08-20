import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useT } from '../../i18n/useT.js'
import { formatCurrency, formatSignedCurrency } from '../../lib/currency.js'
import { Card, CardBody } from '../ui/Primitives.jsx'
import { SavingsMiniBars } from './SavingsMiniBars.jsx'
import { cn } from '../../lib/utils.js'

export function FireProgressCard({
  currentValueTRY,
  currentValueUSD,
  targetUSD,
  targetTRY,
  pct,
  etaText,
  avgSavingsTRY,
  avgGrowthPct,
  annualizedReturn,
  // New savings props
  savingsSeries,
  monthlyExpensesTRY,
  // Multiplier implied by the chosen withdrawal rate: 25× at 4%, 33.3× at 3%.
  // Used only for the caption, but it must track the real target or the card
  // says "25× rule" above a number computed at some other rate.
  fireMultiplier = 25,
}) {
  const { t, ti } = useT()

  // Current month is the last entry; previous month is second-to-last
  const currentMonth = savingsSeries?.[savingsSeries.length - 1]
  const previousMonth = savingsSeries?.[savingsSeries.length - 2]

  const thisMonthSavings = currentMonth?.savingsTRY || 0
  const lastMonthSavings = previousMonth?.savingsTRY || 0
  const fireRatio = currentMonth?.fireRatio || 0

  const monthDelta = thisMonthSavings - lastMonthSavings
  const monthDeltaPct = lastMonthSavings !== 0 ? (monthDelta / Math.abs(lastMonthSavings)) * 100 : 0

  return (
    <Card>
      <CardBody className="p-5">
        {/* === HEADER === */}
        <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-base font-medium text-text-primary">{t.fire.progress}</h3>
              <span className="display-font text-xl text-accent">FIRE</span>
            </div>
            <p className="text-xs text-text-tertiary mt-1">
              {ti(t.fire.target, { n: formatMultiplier(fireMultiplier) })} ${targetUSD.toLocaleString()} USD · {formatCurrency(targetTRY, 'TRY', { compact: true, decimals: 2 })}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-medium tabular-nums text-text-primary">
              {pct.toFixed(1)}%
            </div>
            <div className="text-xs text-text-tertiary mt-0.5">
              {t.fire.etaPrefix} {etaText} {t.fire.etaSuffix}
            </div>
          </div>
        </div>

        {/* === USD progress bar === */}
        <div className="mb-3">
          <div className="flex justify-between text-2xs text-text-tertiary mb-1.5 tabular-nums">
            <span>USD · ${currentValueUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })} / ${targetUSD.toLocaleString()}</span>
            <span>{((currentValueUSD / targetUSD) * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (currentValueUSD / targetUSD) * 100)}%` }}
            />
          </div>
        </div>

        {/* === TRY progress bar === */}
        <div>
          <div className="flex justify-between text-2xs text-text-tertiary mb-1.5 tabular-nums">
            <span>TRY · {formatCurrency(currentValueTRY, 'TRY', { compact: true, decimals: 2 })} / {formatCurrency(targetTRY, 'TRY', { compact: true, decimals: 2 })}</span>
            <span>{((currentValueTRY / targetTRY) * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-info rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (currentValueTRY / targetTRY) * 100)}%` }}
            />
          </div>
        </div>

        {/* === MONTHLY SAVINGS SECTION === */}
        <div className="mt-5 pt-5 border-t border-border-subtle">
          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="text-2xs uppercase tracking-wider text-text-tertiary font-medium mb-1">
                {t.fire.monthlySavings}
              </div>
              <div className="flex items-baseline gap-3">
                <span className={cn(
                  'text-2xl font-medium tabular-nums',
                  thisMonthSavings > 0 ? 'text-success' : thisMonthSavings < 0 ? 'text-danger' : 'text-text-primary'
                )}>
                  {formatSignedCurrency(thisMonthSavings, 'TRY', { compact: true, decimals: 1 })}
                </span>
                <span className="text-xs text-text-tertiary">{t.fire.thisMonth}</span>
              </div>
            </div>

            {/* FIRE ratio chip */}
            <FireRatioChip ratio={fireRatio} t={t} />
          </div>

          {/* Comparison to last month */}
          <div className="flex items-center gap-2 text-xs mb-3 tabular-nums">
            <DeltaIndicator value={monthDelta} />
            <span className="text-text-tertiary">
              {monthDelta === 0
                ? `= ${t.fire.lastMonth}`
                : `${formatSignedCurrency(monthDelta, 'TRY', { compact: true, decimals: 1 })} ${t.fire.vsLastMonth}`}
            </span>
            <span className="text-text-muted ml-auto">
              {t.fire.lastMonth}: {formatCurrency(lastMonthSavings, 'TRY', { compact: true, decimals: 1 })}
            </span>
          </div>

          {/* Mini 6-month bar chart */}
          <SavingsMiniBars data={savingsSeries} />
        </div>

        {/* === DRIVERS (existing) === */}
        <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-border-subtle">
          <Driver label={t.fire.avgMonthlySavings} value={formatCurrency(avgSavingsTRY, 'TRY', { compact: true, decimals: 1 })} />
          <Driver label={t.fire.avgPortfolioGrowth} value={`${avgGrowthPct >= 0 ? '+' : ''}${avgGrowthPct.toFixed(1)}% ${t.fire.perMonth}`} valueClass={avgGrowthPct >= 0 ? 'text-success' : 'text-danger'} />
          <Driver label={t.fire.annualizedReturn} value={`${annualizedReturn >= 0 ? '+' : ''}${annualizedReturn.toFixed(1)}%`} valueClass={annualizedReturn >= 0 ? 'text-success' : 'text-danger'} />
        </div>
      </CardBody>
    </Card>
  )
}

// FIRE ratio interpretation chip — color and label change with the value
function FireRatioChip({ ratio, t }) {
  let label, colorVar, intensity
  if (ratio < 0.5) {
    label = t.fire.buildingHabit; colorVar = '--text-secondary'; intensity = 8
  } else if (ratio < 1.0) {
    label = t.fire.steadyProgress; colorVar = '--info'; intensity = 12
  } else if (ratio < 2.0) {
    label = t.fire.strongMomentum; colorVar = '--accent'; intensity = 14
  } else {
    label = t.fire.fireAccelerating; colorVar = '--accent'; intensity = 18
  }

  return (
    <div
      className="flex flex-col items-end px-3 py-2 rounded-lg border"
      style={{
        background: `color-mix(in srgb, var(${colorVar}) ${intensity}%, transparent)`,
        borderColor: `color-mix(in srgb, var(${colorVar}) 30%, transparent)`,
        color: `var(${colorVar})`,
      }}
      title={t.fire.fireRatioHint}
    >
      <div className="text-2xs uppercase tracking-wider opacity-80 leading-tight">{t.fire.fireRatio}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-medium tabular-nums leading-tight">{ratio.toFixed(2)}×</span>
      </div>
      <div className="text-2xs opacity-80 leading-tight">{label}</div>
    </div>
  )
}

function DeltaIndicator({ value }) {
  if (value > 0) return <TrendingUp size={12} className="text-success" strokeWidth={2.5} />
  if (value < 0) return <TrendingDown size={12} className="text-danger" strokeWidth={2.5} />
  return <Minus size={12} className="text-text-tertiary" strokeWidth={2.5} />
}

function Driver({ label, value, valueClass = 'text-text-primary' }) {
  return (
    <div>
      <div className="text-2xs text-text-tertiary mb-1">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${valueClass}`}>{value}</div>
    </div>
  )
}

// 25 rather than 25.0, but 33.3 rather than 33 — a whole-number rate deserves
// a whole-number caption.
function formatMultiplier(m) {
  return Number.isInteger(m) ? String(m) : m.toFixed(1)
}
