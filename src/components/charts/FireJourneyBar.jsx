import { Check } from 'lucide-react'
import { useT } from '../../i18n/useT.js'
import { formatCurrency } from '../../lib/currency.js'
import { cn } from '../../lib/utils.js'

// Multi-stop FIRE journey bar.
// Visual reference: "Completeness" stepper (numbered milestones along a connecting bar).
//
// Receives:
//   stages: array of { id, key, targetUSD, color }
//   percentOnBar: 0-1, where the user-position dot sits
//   activeStageId: which stage is the user's current goal (highlighted)
//   lastReachedIndex: -1 means before stage 0, otherwise index of last stage hit
//   currentValueUSD/TRY for the floating "you are here" pill
//   fxRates for currency formatting
//   onStageClick: callback for changing the active target by tapping a stop
export function FireJourneyBar({
  stages,
  percentOnBar,
  activeStageId,
  lastReachedIndex,
  currentValueUSD,
  currentValueTRY,
  fxRates,
  onStageClick,
}) {
  const { t } = useT()
  const n = stages.length

  return (
    <div className="w-full">
      {/* Bar wrapper — needs vertical room for floating "You are here" label */}
      <div className="relative pt-12 pb-3">
        {/* "You are here" floating pill */}
        <div
          className="absolute top-0 -translate-x-1/2 transition-all duration-500"
          style={{ left: `${percentOnBar * 100}%` }}
        >
          <div className="flex flex-col items-center gap-1.5">
            <div className="bg-bg-elevated border border-accent/40 rounded-md px-2.5 py-1 shadow-lg whitespace-nowrap">
              <div className="text-2xs uppercase tracking-wider text-accent font-medium">
                {t.firePage.youAreHere}
              </div>
              <div className="text-xs font-medium text-text-primary tabular-nums leading-tight">
                ${currentValueUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            </div>
            {/* Pointer triangle */}
            <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-accent/60 -mt-1.5" />
          </div>
        </div>

        {/* The bar itself */}
        <div className="relative h-3 mx-3">
          {/* Track (background) */}
          <div className="absolute inset-0 bg-bg-tertiary rounded-full overflow-hidden">
            {/* Filled portion — extends from 0 to user position */}
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-warning via-accent to-info transition-all duration-700"
              style={{ width: `${percentOnBar * 100}%` }}
            />
          </div>

          {/* Stop circles */}
          {stages.map((stage, i) => {
            const reached = i <= lastReachedIndex
            const isActive = stage.id === activeStageId
            const xPct = (i / (n - 1)) * 100

            return (
              <button
                key={stage.id}
                onClick={() => onStageClick?.(stage.id)}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 -translate-x-1/2',
                  'w-7 h-7 rounded-full flex items-center justify-center',
                  'border-2 transition-all duration-300',
                  'text-2xs font-semibold tabular-nums cursor-pointer',
                  'hover:scale-110 hover:z-10 focus:outline-none focus:ring-2 focus:ring-accent/40'
                )}
                style={{
                  left: `${xPct}%`,
                  background: reached ? stage.color : 'var(--bg-tertiary)',
                  borderColor: isActive ? stage.color : reached ? stage.color : 'var(--border-default)',
                  color: reached ? 'white' : 'var(--text-tertiary)',
                  boxShadow: isActive ? `0 0 0 4px color-mix(in srgb, ${stage.color} 25%, transparent)` : 'none',
                }}
                aria-label={t.firePage[`${stage.key}Title`]}
                title={t.firePage[`${stage.key}Title`]}
              >
                {reached ? <Check size={12} strokeWidth={3} /> : i + 1}
              </button>
            )
          })}
        </div>

        {/* Labels under each stop */}
        <div className="relative h-12 mt-3 mx-3">
          {stages.map((stage, i) => {
            const xPct = (i / (n - 1)) * 100
            const isActive = stage.id === activeStageId
            return (
              <button
                key={stage.id}
                onClick={() => onStageClick?.(stage.id)}
                className={cn(
                  'absolute top-0 -translate-x-1/2 text-center',
                  'transition-colors duration-200 cursor-pointer focus:outline-none',
                  'min-w-[64px]'
                )}
                style={{ left: `${xPct}%` }}
              >
                <div
                  className={cn(
                    'text-2xs uppercase tracking-wider font-medium leading-tight',
                    isActive ? 'text-text-primary' : 'text-text-tertiary'
                  )}
                >
                  {t.firePage[`${stage.key}Title`]}
                </div>
                <div className={cn(
                  'text-2xs tabular-nums mt-0.5 leading-tight',
                  isActive ? 'text-text-secondary' : 'text-text-muted'
                )}>
                  ${(stage.targetUSD / 1000).toFixed(0)}K
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
