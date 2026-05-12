// FIRE stage definitions.
// Each stage is a multiplier applied to annual expenses.
// 25x = 4% safe-withdrawal rule (standard FIRE math).
//
// Stage philosophy:
//   - Coast FIRE: enough invested that, untouched, it grows to full FIRE by retirement age. ~7×.
//   - Barista FIRE: covers ~50% of expenses passively; part-time work covers the rest. ~12.5×.
//   - Lean FIRE: full coverage at minimal expense level. 25×.
//   - Regular FIRE: full coverage at comfortable expense level. 25× of comfort budget (≈ 2× lean).
//   - Fat FIRE: full coverage at luxury expense level. 25× of luxury budget (≈ 4× lean).

export const FIRE_STAGES = [
  { id: 'coast',   key: 'coast',   multiplier: 7,    expenseScale: 1.0, color: '#fbbf24' },
  { id: 'barista', key: 'barista', multiplier: 12.5, expenseScale: 1.0, color: '#fb923c' },
  { id: 'lean',    key: 'lean',    multiplier: 25,   expenseScale: 1.0, color: '#10b981' },
  { id: 'regular', key: 'regular', multiplier: 25,   expenseScale: 2.0, color: '#3b82f6' },
  { id: 'fat',     key: 'fat',     multiplier: 25,   expenseScale: 4.0, color: '#a855f7' },
]

// Compute target USD for each stage given monthly expenses (USD, lean baseline).
export function computeStageTargets(monthlyExpensesUSD) {
  const annualExpenses = monthlyExpensesUSD * 12
  return FIRE_STAGES.map((stage) => ({
    ...stage,
    targetUSD: annualExpenses * stage.expenseScale * stage.multiplier,
  }))
}

// Find the stage object matching a stage id.
export function getStageById(id) {
  return FIRE_STAGES.find((s) => s.id === id) || FIRE_STAGES.find((s) => s.id === 'lean')
}

// Where is the user on the journey bar?
// Returns { activeStageIndex, percentOnBar, percentToActive } where percentOnBar is 0–1
// representing position along the bar (with stops evenly spaced) and percentToActive is
// progress to the user-selected active stage.
export function computeJourneyPosition({ currentValueUSD, monthlyExpensesUSD, activeStageId }) {
  const stages = computeStageTargets(monthlyExpensesUSD)
  const activeStageIndex = stages.findIndex((s) => s.id === activeStageId)

  // Find which stage they've passed and where they are between stages
  let lastReached = -1
  for (let i = 0; i < stages.length; i++) {
    if (currentValueUSD >= stages[i].targetUSD) lastReached = i
  }

  // Position on the bar: stops are at 0, 1/(n-1), 2/(n-1), ..., 1
  // Between two stops, interpolate based on $-progress between them.
  const n = stages.length
  let percentOnBar
  if (lastReached === n - 1) {
    percentOnBar = 1
  } else if (lastReached === -1) {
    // Not even at coast — interpolate from 0 to coast
    percentOnBar = (currentValueUSD / stages[0].targetUSD) * (1 / (n - 1))
  } else {
    const start = stages[lastReached].targetUSD
    const end = stages[lastReached + 1].targetUSD
    const fraction = (currentValueUSD - start) / (end - start)
    const baseSlot = lastReached / (n - 1)
    percentOnBar = baseSlot + fraction * (1 / (n - 1))
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
