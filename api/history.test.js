// Backfill turns a stream of daily rows into one close per month. Getting the
// collapse wrong is invisible in the UI — the chart still draws a plausible
// line, just with the wrong number in it — so it is pinned down here.

import { describe, it, expect } from 'vitest'
import { toMonthEnds, normaliseYmd, toNumber } from './history.js'

describe('toMonthEnds', () => {
  it('keeps the last trading day of each month', () => {
    expect(
      toMonthEnds([
        { ymd: '2026-06-01', value: 10 },
        { ymd: '2026-06-30', value: 12 },
        { ymd: '2026-07-01', value: 13 },
        { ymd: '2026-07-31', value: 15 },
      ])
    ).toEqual({ '2026-06': 12, '2026-07': 15 })
  })

  it('does not care what order the rows arrive in', () => {
    const ascending = toMonthEnds([
      { ymd: '2026-06-01', value: 10 },
      { ymd: '2026-06-30', value: 12 },
    ])
    const descending = toMonthEnds([
      { ymd: '2026-06-30', value: 12 },
      { ymd: '2026-06-01', value: 10 },
    ])
    expect(ascending).toEqual(descending)
    expect(ascending['2026-06']).toBe(12)
  })

  it('uses the last day that actually traded, not the calendar last day', () => {
    // August 2026 ends on a Monday; if the 31st is a holiday the 28th is the
    // close. Nothing in the code should assume day 30/31 exists.
    expect(
      toMonthEnds([
        { ymd: '2026-08-27', value: 100 },
        { ymd: '2026-08-28', value: 101 },
      ])['2026-08']
    ).toBe(101)
  })

  it('drops rows with no usable price or date', () => {
    expect(
      toMonthEnds([
        { ymd: '2026-06-30', value: 12 },
        { ymd: '2026-07-31', value: 0 },
        { ymd: '', value: 99 },
        { ymd: '2026-08-31', value: null },
      ])
    ).toEqual({ '2026-06': 12 })
  })

  it('returns keys in chronological order', () => {
    const out = toMonthEnds([
      { ymd: '2026-08-31', value: 3 },
      { ymd: '2025-12-31', value: 1 },
      { ymd: '2026-04-30', value: 2 },
    ])
    expect(Object.keys(out)).toEqual(['2025-12', '2026-04', '2026-08'])
  })

  it('handles an empty input', () => {
    expect(toMonthEnds([])).toEqual({})
  })
})

describe('normaliseYmd', () => {
  it('passes through the ISO form TEFAS uses', () => {
    expect(normaliseYmd('2026-07-20')).toBe('2026-07-20')
    expect(normaliseYmd('2026-07-20T00:00:00Z')).toBe('2026-07-20')
  })

  it('flips the day-first form İş Yatırım uses', () => {
    expect(normaliseYmd('20-07-2026')).toBe('2026-07-20')
    expect(normaliseYmd('20.07.2026')).toBe('2026-07-20')
  })

  it('accepts epoch milliseconds', () => {
    expect(normaliseYmd(Date.UTC(2026, 6, 20))).toBe('2026-07-20')
  })

  it('returns empty for anything unreadable, so the row is dropped', () => {
    expect(normaliseYmd('bilinmiyor')).toBe('')
    expect(normaliseYmd(null)).toBe('')
    expect(normaliseYmd(undefined)).toBe('')
  })
})

describe('toNumber', () => {
  it('reads plain numbers and Turkish-formatted strings alike', () => {
    expect(toNumber(1.27)).toBeCloseTo(1.27, 6)
    expect(toNumber('1,27856')).toBeCloseTo(1.27856, 6)
    expect(toNumber('1.234,56')).toBeCloseTo(1234.56, 6)
  })

  it('returns 0 for anything else, which toMonthEnds then drops', () => {
    expect(toNumber(null)).toBe(0)
    expect(toNumber('abc')).toBe(0)
    expect(toNumber(Infinity)).toBe(0)
  })
})
