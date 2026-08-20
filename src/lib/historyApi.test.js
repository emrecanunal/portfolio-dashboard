// Window arithmetic for the backfill.
//
// Getting this wrong loses months silently: the chart still draws, just with a
// hole where a window failed to line up with its neighbour.

import { describe, it, expect } from 'vitest'
import { buildWindows, monthsToCover, earliestTransactionYmd } from './historyApi.js'

// 20 August 2026, local.
const NOW = new Date(2026, 7, 20)

describe('buildWindows', () => {
  it('covers the whole span with no gap between windows', () => {
    const windows = buildWindows(12, 6, NOW)
    expect(windows).toEqual([
      { from: '2025-09', to: '2026-02' },
      { from: '2026-03', to: '2026-08' },
    ])
  })

  it('ends on the current month', () => {
    for (const size of [1, 3, 6, 12, 24]) {
      const windows = buildWindows(33, size, NOW)
      expect(windows[windows.length - 1].to).toBe('2026-08')
    }
  })

  it('starts far enough back to cover the requested span', () => {
    // 33 months back from Aug 2026 is Dec 2023 — the month of the oldest
    // transaction in the real portfolio.
    expect(buildWindows(33, 6, NOW)[0].from).toBe('2023-12')
  })

  it('leaves no month uncovered', () => {
    const windows = buildWindows(33, 6, NOW)
    const covered = new Set()
    for (const w of windows) {
      let [y, m] = w.from.split('-').map(Number)
      const [ty, tm] = w.to.split('-').map(Number)
      while (y < ty || (y === ty && m <= tm)) {
        covered.add(`${y}-${String(m).padStart(2, '0')}`)
        if (++m > 12) {
          m = 1
          y += 1
        }
      }
    }
    expect(covered.size).toBe(33)
    expect(covered.has('2023-12')).toBe(true)
    expect(covered.has('2026-08')).toBe(true)
  })

  it('collapses to a single window when the size covers everything', () => {
    // What TEFAS gets: one request already spans sixty months, and it
    // rate-limits at six a minute, so chunking would be strictly worse.
    expect(buildWindows(33, 60, NOW)).toEqual([{ from: '2023-12', to: '2026-08' }])
  })

  it('handles a one-month span', () => {
    expect(buildWindows(1, 6, NOW)).toEqual([{ from: '2026-08', to: '2026-08' }])
  })

  it('rolls across year boundaries', () => {
    const windows = buildWindows(6, 3, new Date(2026, 1, 15)) // Feb 2026
    expect(windows[0].from).toBe('2025-09')
    expect(windows[windows.length - 1].to).toBe('2026-02')
  })
})

describe('monthsToCover', () => {
  it('spans from the oldest transaction to now, inclusive', () => {
    expect(monthsToCover([{ date: '2026-06-15' }], NOW)).toBe(3) // Jun, Jul, Aug
    expect(monthsToCover([{ date: '2023-12-14' }], NOW)).toBe(33)
  })

  it('caps at the 60 months the sources and the chart both top out at', () => {
    expect(monthsToCover([{ date: '2010-01-01' }], NOW)).toBe(60)
  })

  it('defaults to a year when there is nothing to go on', () => {
    expect(monthsToCover([], NOW)).toBe(12)
  })
})

describe('earliestTransactionYmd', () => {
  it('finds the oldest date by string order', () => {
    expect(
      earliestTransactionYmd([{ date: '2026-06-15' }, { date: '2023-12-14' }, { date: '2025-01-02' }])
    ).toBe('2023-12-14')
  })

  it('ignores entries with no date', () => {
    expect(earliestTransactionYmd([{ date: '' }, {}, { date: '2025-01-02' }])).toBe('2025-01-02')
  })

  it('returns null for an empty list', () => {
    expect(earliestTransactionYmd([])).toBeNull()
  })
})

describe('buildWindows: one request per source, where that is what the source wants', () => {
  const now = new Date('2026-08-20T09:00:00Z')

  it('splits a long BIST range into windows', () => {
    // 36-month windows: measured as costing no more than a 1-month one.
    expect(buildWindows(36, 36, now)).toHaveLength(1)
    expect(buildWindows(72, 36, now)).toHaveLength(2)
  })

  it('never splits a global range, whatever its length', () => {
    // Alpha Vantage bills per REQUEST and returns everything each time, so a
    // second window would spend a second daily request for identical data.
    expect(buildWindows(60, 1200, now)).toHaveLength(1)
    expect(buildWindows(600, 1200, now)).toHaveLength(1)
  })

  it('covers the whole span with no gap between windows', () => {
    const windows = buildWindows(72, 36, now)
    expect(windows[0].from).toBe('2020-09')
    expect(windows[windows.length - 1].to).toBe('2026-08')
  })
})
