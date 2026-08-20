// FIRE stage definitions.
//
// The whole ladder hangs off ONE number: the safe withdrawal rate. A 4% rate
// means a portfolio must be 1/0.04 = 25× annual expenses to cover them forever.
// Drop to 3% and that becomes 33.3×; push to 5% and it is 20×.
//
// Each stage is therefore expressed as two independent dials:
//   coverage     — what fraction of "covered forever" this stage represents
//   expenseScale — whose expenses we are covering (lean / comfortable / luxury)
//
// target = annualExpenses × expenseScale × (coverage / withdrawalRate)
//
// At the default 4% this reproduces the familiar ladder exactly —
// 7×, 12.5×, 25×, 50×, 100× — so nobody's existing numbers move.
//
// Stage philosophy:
//   - Coast FIRE: enough invested that, untouched, it grows to full FIRE by
//     retirement age. Conventionally ~7× at 4%, i.e. 28% of the way there.
//   - Barista FIRE: covers ~50% of expenses passively; part-time work covers
//     the rest.
//   - Lean FIRE: full coverage at a minimal expense level.
//   - Regular FIRE: full coverage at a comfortable expense level (2× lean).
//   - Fat FIRE: full coverage at a luxury expense level (4× lean).

export const DEFAULT_WITHDRAWAL_RATE = 0.04

export const FIRE_STAGES = [
  { id: 'coast',   key: 'coast',   coverage: 0.28, expenseScale: 1.0, color: '#fbbf24' },
  { id: 'barista', key: 'barista', coverage: 0.5,  expenseScale: 1.0, color: '#fb923c' },
  { id: 'lean',    key: 'lean',    coverage: 1.0,  expenseScale: 1.0, color: '#10b981' },
  { id: 'regular', key: 'regular', coverage: 1.0,  expenseScale: 2.0, color: '#3b82f6' },
  { id: 'fat',     key: 'fat',     coverage: 1.0,  expenseScale: 4.0, color: '#a855f7' },
]

// Compute target USD for each stage given monthly expenses (USD, lean baseline)
// and the safe withdrawal rate the user picked on the FIRE page.
export function computeStageTargets(monthlyExpensesUSD, withdrawalRate = DEFAULT_WITHDRAWAL_RATE) {
  const rate = withdrawalRate > 0 ? withdrawalRate : DEFAULT_WITHDRAWAL_RATE
  const annualExpenses = monthlyExpensesUSD * 12
  return FIRE_STAGES.map((stage) => {
    // e.g. coverage 1.0 at 4% → 25×; coverage 0.28 at 4% → 7×
    const multiplier = stage.coverage / rate
    return {
      ...stage,
      multiplier,
      targetUSD: annualExpenses * stage.expenseScale * multiplier,
    }
  })
}

// Find the stage object matching a stage id.
export function getStageById(id) {
  return FIRE_STAGES.find((s) => s.id === id) || FIRE_STAGES.find((s) => s.id === 'lean')
}

// Where is the user on the journey bar?
// Returns { activeStageIndex, percentOnBar, percentToActive } where percentOnBar is 0–1
// representing position along the bar (with stops evenly spaced) and percentToActive is
// progress to the user-selected active stage.
export function computeJourneyPosition({
  currentValueUSD,
  monthlyExpensesUSD,
  activeStageId,
  withdrawalRate = DEFAULT_WITHDRAWAL_RATE,
}) {
  const stages = computeStageTargets(monthlyExpensesUSD, withdrawalRate)
  const activeStageIndex = stages.findIndex((s) => s.id === activeStageId)

  // Find which stage they've passed and where they are between stages
  let lastReached = -1
  for (let i = 0; i < stages.length; i++) {
    if (currentValueUSD >= stages[i].targetUSD) lastReached = i
  }

  // Position on the bar: stops are at 1/n, 2/n, ..., n/n (= 1)
  // The bar starts at 0 (before the first stop), so there is always
  // visible "empty" space to the left when the user hasn't reached Coast FIRE.
  const n = stages.length
  let percentOnBar
  if (lastReached === n - 1) {
    percentOnBar = 1
  } else if (lastReached === -1) {
    // Not yet at Coast — interpolate from 0 to Coast stop (1/n)
    percentOnBar = (currentValueUSD / stages[0].targetUSD) * (1 / n)
  } else {
    const start = stages[lastReached].targetUSD
    const end = stages[lastReached + 1].targetUSD
    const fraction = (currentValueUSD - start) / (end - start)
    const baseSlot = (lastReached + 1) / n   // position of the stop just reached
    percentOnBar = baseSlot + fraction * (1 / n)
  }

  const activeTarget = stages[activeStageIndex]?.targetUSD || stages[2].targetUSD
  const percentToActive = Math.min(100, (currentValueUSD / activeTarget) * 100)

  return {
    stages,
    activeStageIndex,
    activeStage: stages[activeStageIndex],
    percentOnBar: Math.max(0, Math.min(1, percentOnBar)),
    percentToActive,
    lastReachedIndex: lastReached,
  }
}
