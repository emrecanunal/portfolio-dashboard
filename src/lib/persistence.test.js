// The two functions here decide when the app tells someone their data is at
// risk. Getting them wrong is silent in both directions: warn every day and the
// warning is furniture, warn never and the first sign of trouble is an empty
// portfolio.

import { describe, it, expect } from 'vitest'
import { daysSince, backupIsStale, BACKUP_STALE_DAYS } from './persistence.js'

const NOW = new Date('2026-08-22T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString()

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince(daysAgo(0), NOW)).toBe(0)
    expect(daysSince(daysAgo(1), NOW)).toBe(1)
    expect(daysSince(daysAgo(45), NOW)).toBe(45)
  })

  it('separates "never" from "today"', () => {
    // Both are falsy in JavaScript and mean opposite things here: one portfolio
    // has never been written to a file, the other was written this morning.
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince(undefined, NOW)).toBeNull()
    expect(daysSince(daysAgo(0), NOW)).toBe(0)
  })

  it('returns null rather than NaN for an unreadable timestamp', () => {
    // A NaN would spread into the comparison below and make it false, which
    // reads as "recently backed up" — the wrong side to fail on.
    expect(daysSince('not a date', NOW)).toBeNull()
  })

  it('never goes negative when a clock disagrees', () => {
    expect(daysSince(new Date(NOW + 86400000).toISOString(), NOW)).toBe(0)
  })
})

describe('backupIsStale', () => {
  it('treats a portfolio that was never backed up as stale', () => {
    expect(backupIsStale(null, NOW)).toBe(true)
  })

  it('is quiet until the threshold and speaks on it', () => {
    expect(backupIsStale(daysAgo(BACKUP_STALE_DAYS - 1), NOW)).toBe(false)
    expect(backupIsStale(daysAgo(BACKUP_STALE_DAYS), NOW)).toBe(true)
  })

  it('stays stale as it gets older', () => {
    expect(backupIsStale(daysAgo(400), NOW)).toBe(true)
  })
})
