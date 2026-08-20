// These decide when the auto-refresh loop is allowed to do network work, so a
// mistake here is either a dead price (too conservative) or a flat battery and
// a rate-limited source (too eager).
//
// Every assertion uses an explicit UTC instant and asserts against the market's
// own local time, so the results do not depend on where the test runs.

import { describe, it, expect } from 'vitest'
import {
  isBistOpen,
  isUsMarketOpen,
  isAnyEquityMarketOpen,
  haveFundsPublishedToday,
} from './marketHours.js'

// Istanbul is UTC+3 year round. New York is UTC-4 in August (EDT).
const at = (iso) => new Date(iso)

describe('isBistOpen', () => {
  it('is open during the Thursday session', () => {
    // 2026-08-20 is a Thursday. 12:00 Istanbul = 09:00 UTC.
    expect(isBistOpen(at('2026-08-20T09:00:00Z'))).toBe(true)
  })

  it('is shut before the opening auction', () => {
    // 08:00 Istanbul
    expect(isBistOpen(at('2026-08-20T05:00:00Z'))).toBe(false)
  })

  it('covers the closing auction but not the evening', () => {
    expect(isBistOpen(at('2026-08-20T15:10:00Z'))).toBe(true) // 18:10 Istanbul
    expect(isBistOpen(at('2026-08-20T16:00:00Z'))).toBe(false) // 19:00 Istanbul
  })

  it('is shut at the weekend', () => {
    expect(isBistOpen(at('2026-08-22T09:00:00Z'))).toBe(false) // Saturday noon
    expect(isBistOpen(at('2026-08-23T09:00:00Z'))).toBe(false) // Sunday noon
  })
})

describe('isUsMarketOpen', () => {
  it('is open during the New York session', () => {
    // 15:00 UTC = 11:00 New York (EDT)
    expect(isUsMarketOpen(at('2026-08-20T15:00:00Z'))).toBe(true)
  })

  it('is shut before the open and after the close', () => {
    expect(isUsMarketOpen(at('2026-08-20T12:00:00Z'))).toBe(false) // 08:00 NY
    expect(isUsMarketOpen(at('2026-08-20T21:00:00Z'))).toBe(false) // 17:00 NY
  })

  it('is shut at the weekend', () => {
    expect(isUsMarketOpen(at('2026-08-22T15:00:00Z'))).toBe(false)
  })
})

describe('isAnyEquityMarketOpen', () => {
  it('is true while only BIST is trading', () => {
    // 08:00 UTC → 11:00 Istanbul (open), 04:00 New York (shut)
    expect(isAnyEquityMarketOpen(at('2026-08-20T08:00:00Z'))).toBe(true)
  })

  it('is true while only New York is trading', () => {
    // 19:00 UTC → 22:00 Istanbul (shut), 15:00 New York (open)
    expect(isAnyEquityMarketOpen(at('2026-08-20T19:00:00Z'))).toBe(true)
  })

  it('is false overnight, which is when the loop should back off', () => {
    // 02:00 UTC → 05:00 Istanbul, 22:00 New York — both shut
    expect(isAnyEquityMarketOpen(at('2026-08-20T02:00:00Z'))).toBe(false)
  })
})

describe('haveFundsPublishedToday', () => {
  it('is false during the trading day, before funds are valued', () => {
    expect(haveFundsPublishedToday(at('2026-08-20T09:00:00Z'))).toBe(false) // 12:00 Istanbul
  })

  it('is true in the evening', () => {
    expect(haveFundsPublishedToday(at('2026-08-20T16:30:00Z'))).toBe(true) // 19:30 Istanbul
  })

  it('is false at the weekend — no valuation happens', () => {
    expect(haveFundsPublishedToday(at('2026-08-22T18:00:00Z'))).toBe(false) // Sat 21:00
  })
})
