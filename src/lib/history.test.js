import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  monthKeyOfYmd,
  monthKeyOfDate,
  currentMonthKey,
  monthKeysBetween,
  lookupMonth,
  priceAtMonth,
  fxAtMonth,
  recordPriceSnapshot,
  recordFxSnapshot,
  mergeBackfill,
  mergeFxBackfill,
  historyCoverage,
} from './history.js'

const NOW = new Date('2026-08-20T09:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('month keys', () => {
  it('derives a key from a transaction date', () => {
    expect(monthKeyOfYmd('2026-07-31')).toBe('2026-07')
    expect(monthKeyOfYmd('2026-01-01')).toBe('2026-01')
  })

  it('uses local time, not UTC', () => {
    // 1 Aug 00:30 local is still July in UTC — the key must follow the user's
    // calendar, the same rule the rest of the date handling follows.
    expect(monthKeyOfDate(new Date(2026, 7, 1, 0, 30))).toBe('2026-08')
  })

  it('knows the current month', () => {
    expect(currentMonthKey()).toBe('2026-08')
  })

  it('enumerates a range inclusively and rolls over the year', () => {
    expect(monthKeysBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
    expect(monthKeysBetween('2026-03', '2026-03')).toEqual(['2026-03'])
    expect(monthKeysBetween('2026-05', '2026-01')).toEqual([])
  })
})

describe('lookupMonth', () => {
  const archive = { '2026-03': 10, '2026-06': 20 }

  it('reports an exact hit', () => {
    expect(lookupMonth(archive, '2026-06')).toEqual({ value: 20, quality: 'exact' })
  })

  it('carries the most recent earlier month forward', () => {
    expect(lookupMonth(archive, '2026-08')).toEqual({ value: 20, quality: 'near' })
    expect(lookupMonth(archive, '2026-04')).toEqual({ value: 10, quality: 'near' })
  })

  it('reaches forward only when there is nothing earlier', () => {
    expect(lookupMonth(archive, '2026-01')).toEqual({ value: 10, quality: 'near' })
  })

  it('says missing rather than guessing when the archive is empty', () => {
    expect(lookupMonth({}, '2026-06').quality).toBe('missing')
    expect(lookupMonth(undefined, '2026-06').quality).toBe('missing')
  })
})

describe('fxAtMonth', () => {
  const fallback = { TRY: 1, USD: 48 }

  it('returns the archived rates for a known month', () => {
    const hit = fxAtMonth({ '2026-03': { TRY: 1, USD: 38 } }, '2026-03', fallback)
    expect(hit.value.USD).toBe(38)
    expect(hit.quality).toBe('exact')
  })

  it('falls back to current rates when nothing is archived', () => {
    const hit = fxAtMonth({}, '2026-03', fallback)
    expect(hit.value).toBe(fallback)
    expect(hit.quality).toBe('missing')
  })
})

describe('recordPriceSnapshot', () => {
  it('writes one close per symbol for the current month', () => {
    const next = recordPriceSnapshot({}, {
      THYAO: { price: 300, currency: 'TRY' },
      AFA: { price: 1.27, currency: 'TRY' },
    })
    expect(next.THYAO['2026-08']).toBe(300)
    expect(next.AFA['2026-08']).toBe(1.27)
  })

  it('overwrites within the month, so the last refresh becomes the close', () => {
    let h = recordPriceSnapshot({}, { THYAO: { price: 300 } })
    h = recordPriceSnapshot(h, { THYAO: { price: 310 } })
    expect(h.THYAO['2026-08']).toBe(310)
  })

  it('keeps earlier months untouched', () => {
    const h = recordPriceSnapshot({ THYAO: { '2026-07': 280 } }, { THYAO: { price: 300 } })
    expect(h.THYAO['2026-07']).toBe(280)
    expect(h.THYAO['2026-08']).toBe(300)
  })

  it('ignores entries with no usable price', () => {
    const h = recordPriceSnapshot({}, {
      GOOD: { price: 5 },
      ZERO: { price: 0 },
      NUL: { price: null },
      TEXT: { price: 'abc' },
    })
    expect(Object.keys(h)).toEqual(['GOOD'])
  })

  it('returns the original object when nothing was recorded', () => {
    const before = { A: { '2026-01': 1 } }
    expect(recordPriceSnapshot(before, {})).toBe(before)
  })
})

describe('recordFxSnapshot', () => {
  it('stores a copy, not a live reference', () => {
    const rates = { TRY: 1, USD: 47.9 }
    const h = recordFxSnapshot({}, rates)
    rates.USD = 999
    expect(h['2026-08'].USD).toBe(47.9)
  })
})

describe('backfill merging', () => {
  it('never overwrites a first-hand snapshot with backfilled data', () => {
    // A snapshot is something we observed; a backfill is a third party's
    // reconstruction. Where they disagree, trust what we saw.
    const existing = { THYAO: { '2026-08': 300 } }
    const merged = mergeBackfill(existing, { THYAO: { '2026-07': 280, '2026-08': 999 } })
    expect(merged.THYAO['2026-08']).toBe(300)
    expect(merged.THYAO['2026-07']).toBe(280)
  })

  it('adds symbols the archive has never seen', () => {
    const merged = mergeBackfill({ A: { '2026-08': 1 } }, { B: { '2026-08': 2 } })
    expect(merged.A['2026-08']).toBe(1)
    expect(merged.B['2026-08']).toBe(2)
  })

  it('applies the same rule to FX months', () => {
    const merged = mergeFxBackfill(
      { '2026-08': { USD: 47.9 } },
      { '2026-07': { USD: 47.1 }, '2026-08': { USD: 1 } }
    )
    expect(merged['2026-08'].USD).toBe(47.9)
    expect(merged['2026-07'].USD).toBe(47.1)
  })
})

describe('historyCoverage', () => {
  it('summarises what we hold', () => {
    const c = historyCoverage(
      { A: { '2026-06': 1, '2026-07': 2, '2026-08': 3 }, B: { '2026-08': 9 } },
      { '2026-07': {}, '2026-08': {} }
    )
    expect(c.symbols).toBe(2)
    expect(c.months).toBe(3)
    expect(c.earliest).toBe('2026-06')
    expect(c.latest).toBe('2026-08')
    expect(c.fxMonths).toBe(2)
    // The thinnest symbol is what limits an honest chart.
    expect(c.thinnest).toBe(1)
  })

  it('handles an empty archive', () => {
    const c = historyCoverage({}, {})
    expect(c).toMatchObject({ symbols: 0, months: 0, earliest: null, latest: null })
  })
})

describe('historyCoverage: symbols the archive never got', () => {
  // The situation this app is actually in: BIST and TEFAS backfill cleanly,
  // Yahoo refuses global equities outright. A summary that counts only what
  // arrived would call that a full archive.
  const archive = {
    THYAO: { '2026-06': 300, '2026-07': 310 },
    AFA: { '2026-06': 1.2, '2026-07': 1.25 },
  }

  it('names held symbols with no archived month at all', () => {
    const c = historyCoverage(archive, { '2026-07': { USD: 40 } }, ['THYAO', 'AFA', 'AAPL'])
    expect(c.missing).toEqual(['AAPL'])
    expect(c.complete).toBe(false)
  })

  it('is complete when every held symbol is covered', () => {
    const c = historyCoverage(archive, {}, ['THYAO', 'AFA'])
    expect(c.missing).toEqual([])
    expect(c.complete).toBe(true)
  })

  it('counts a symbol present but empty as missing', () => {
    const c = historyCoverage({ ...archive, AAPL: {} }, {}, ['THYAO', 'AFA', 'AAPL'])
    expect(c.missing).toEqual(['AAPL'])
  })

  it('reports nothing about missing symbols when not told what is held', () => {
    // The old two-argument call must keep working and must not invent a claim.
    const c = historyCoverage(archive, {})
    expect(c.missing).toEqual([])
    expect(c.complete).toBeNull()
  })

  it('ignores duplicates in the held list', () => {
    const c = historyCoverage(archive, {}, ['AAPL', 'AAPL', 'THYAO'])
    expect(c.missing).toEqual(['AAPL'])
  })
})
