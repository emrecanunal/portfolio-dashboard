import { Check } from 'lucide-react'
import { useT } from '../../i18n/useT.js'
import { formatCurrency } from '../../lib/currency.js'
import { cn } from '../../lib/utils.js'

// The FIRE journey: a horizontal stepper with room for it, a vertical list
// without.
//
// The stepper places five stops across the bar and hangs a two-line label under
// each. At 1280px those labels are 120px apart and read cleanly. At 390px they
// are 71px apart and collide into "COAST FIRBARISTA FIRE" — and the stops
// themselves are 28px circles, well under a thumb.
//
// Squeezing the same layout smaller does not fix that; five labels along a
// 358px line is not a legible thing to draw. So below sm the same data becomes
// a vertical list: one tappable row per stage, the connecting line running down
// the left, and the "you are here" marker sitting between the last stage
// reached and the next one — which is the one piece of information the whole
// component exists to convey.
//
// Both layouts read the same props and neither changes the position maths in
// computeJourneyPosition; stops stay at 1/n … n/n.
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

  // Where the "you are here" marker belongs in the vertical list: after the
  // last stage reached, i.e. before the first one still ahead.
  const markerBefore = lastReachedIndex + 1

  return (
    <div className="w-full">
      {/* ===== PHONE: vertical journey ===== */}
      <ol className="sm:hidden relative py-1">
        {/* The line the stops sit on. Inset to the circle's centre (16px of a
            32px circle) so it runs through them rather than beside them. */}
        <div className="absolute left-4 top-4 bottom-4 w-px bg-border-default -translate-x-1/2" aria-hidden="true" />

        {stages.map((stage, i) => {
          const reached = i <= lastReachedIndex
          const isActive = stage.id === activeStageId
          return (
            <li key={stage.id}>
              {markerBefore === i && (
                <YouAreHereRow label={t.firePage.youAreHere} valueUSD={currentValueUSD} />
              )}
              <button
                onClick={() => onStageClick?.(stage.id)}
                className="w-full flex items-center gap-3 py-2 text-left rounded-lg active:bg-bg-tertiary/40 transition-colors"
                aria-current={isActive ? 'true' : undefined}
              >
                <span
                  className="relative z-10 w-8 h-8 shrink-0 rounded-full border-2 flex items-center justify-center text-2xs font-semibold tabular-nums"
                  style={{
                    background: reached ? stage.color : 'var(--bg-tertiary)',
                    borderColor: reached || isActive ? stage.color : 'var(--border-default)',
                    color: reached ? 'white' : 'var(--text-tertiary)',
                    boxShadow: isActive
                      ? `0 0 0 3px color-mix(in srgb, ${stage.color} 25%, transparent)`
                      : 'none',
                  }}
                >
                  {reached ? <Check size={13} strokeWidth={3} /> : i + 1}
                </span>

                <span className="flex-1 min-w-0">
                  <span
                    className={cn(
                      'block text-xs uppercase tracking-wider font-medium truncate',
                      isActive ? 'text-text-primary' : 'text-text-secondary'
                    )}
                  >
                    {t.firePage[`${stage.key}Title`]}
                  </span>
                  <span className="block text-2xs tabular-nums text-text-tertiary">
                    ${stage.targetUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                </span>

                {isActive && (
                  <span className="shrink-0 text-2xs uppercase tracking-wider text-accent border border-accent/40 rounded px-1.5 py-0.5">
                    {t.firePage.currentlyActive}
                  </span>
                )}
              </button>
            </li>
          )
        })}

        {/* Past the last stage — the marker has nowhere left to sit above. */}
        {markerBefore >= stages.length && (
          <li>
            <YouAreHereRow label={t.firePage.youAreHere} valueUSD={currentValueUSD} />
          </li>
        )}
      </ol>

      {/* ===== TABLET AND UP: the stepper ===== */}
      {/* Bar wrapper — needs vertical room for floating "You are here" label */}
      <div className="hidden sm:block relative pt-12 pb-3">
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
            const xPct = ((i + 1) / n) * 100

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
            const xPct = ((i + 1) / n) * 100
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

// One row of the vertical journey. Not a stage — the reader's own position
// between two of them, which is why it has no number and no tap target.
function YouAreHereRow({ label, valueUSD }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-8 shrink-0 flex justify-center">
        <span className="relative z-10 w-2.5 h-2.5 rounded-full bg-accent ring-4 ring-accent/25" />
      </span>
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="text-2xs uppercase tracking-wider text-accent font-medium">{label}</span>
        <span className="text-xs font-medium text-text-primary tabular-nums truncate">
          ${valueUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>
      </span>
    </div>
  )
}
