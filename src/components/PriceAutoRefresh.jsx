// Keeps prices fresh on their own, without the user pressing anything.
//
// Mounted once, near the root. Renders nothing.
//
// THE SHAPE OF THE PROBLEM
//
// "Refresh every 5 minutes" is the right instinct but the wrong rule, because
// the three sources move on three different clocks:
//
//   BIST     — ticks through the trading day, 10:00–18:10 Istanbul
//   Global   — ticks 09:30–16:00 New York
//   TEFAS    — publishes ONE price per day, in the evening
//
// Polling funds every five minutes re-fetches an unchanged number ~200 times a
// day and eats TEFAS's 6-requests-per-minute allowance for nothing. Polling
// equities every five minutes overnight is the same waste with no upside. So
// each source gets its own cadence, and the loop backs off when the markets it
// covers are shut.
//
// Three more things this has to get right:
//
//   Hidden tabs. A phone with the PWA in the background should not be doing
//   network work. We skip ticks while hidden, and catch up on the way back —
//   which is also when the user is actually looking at the number.
//
//   Failure. A dead source must not be retried every 5 minutes forever. Each
//   consecutive failure doubles the wait, up to an hour; one success resets it.
//
//   Overlap. Refreshes are asynchronous and a slow source can outlive its own
//   interval. A ref guard means a tick that arrives mid-flight is dropped
//   rather than stacking a second request on top of the first.

import { useEffect, useRef } from 'react'
import { usePortfolioStore } from '../lib/store.js'
import { isAnyEquityMarketOpen, haveFundsPublishedToday } from '../lib/marketHours.js'

// How often the scheduler wakes up to ask "is anything due?". This is not the
// refresh interval — it's the resolution of the check, deliberately coarse.
const TICK_MS = 30 * 1000

// Equities, while a market is open. User-configurable (autoRefreshMinutes).
const DEFAULT_EQUITY_MINUTES = 5
// Equities, when every market is shut: one slow poll to pick up the closing
// print and any late correction.
const CLOSED_MARKET_MS = 60 * 60 * 1000
// Funds. Three hours means the evening publication is picked up the same
// evening, at a cost of a handful of requests per day.
const FUND_INTERVAL_MS = 3 * 60 * 60 * 1000

const BACKOFF_CAP_MS = 60 * 60 * 1000

export function PriceAutoRefresh() {
  const refreshPrices = usePortfolioStore((s) => s.refreshPrices)
  const enabled = usePortfolioStore((s) => s.settings.autoRefreshEnabled)
  const intervalMinutes = usePortfolioStore((s) => s.settings.autoRefreshMinutes)

  // Kept in refs, not state: these change on every tick and must never cause a
  // re-render or restart the interval.
  const inFlight = useRef(false)
  const failures = useRef(0)

  useEffect(() => {
    if (!enabled) return

    const equityIntervalMs =
      Math.max(1, Number(intervalMinutes) || DEFAULT_EQUITY_MINUTES) * 60 * 1000

    // 1 failure → wait 2×, 2 → 4×, and so on, but never more than an hour.
    // Any success resets the counter.
    const withBackoff = (baseMs) => Math.min(baseMs * 2 ** failures.current, BACKOFF_CAP_MS)

    const dueSources = () => {
      const { settings } = usePortfolioStore.getState()
      const stamps = settings.priceMeta?.sourceFetchedAt || {}
      const now = Date.now()
      const age = (source) => now - (stamps[source] || 0)

      const equityWait = withBackoff(
        isAnyEquityMarketOpen() ? equityIntervalMs : CLOSED_MARKET_MS
      )

      const due = []
      if (age('bist') >= equityWait) due.push('bist')
      if (age('global') >= equityWait) due.push('global')

      // Funds: only once the day's price can exist. The 20-hour escape hatch
      // covers someone who only ever opens the app in the morning — a slightly
      // stale fund price beats none for days.
      if (
        age('tefas') >= withBackoff(FUND_INTERVAL_MS) &&
        (haveFundsPublishedToday() || age('tefas') > 20 * 60 * 60 * 1000)
      ) {
        due.push('tefas')
      }

      return due
    }

    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      if (inFlight.current) return

      const sources = dueSources()
      if (sources.length === 0) return

      inFlight.current = true
      try {
        const result = await refreshPrices(undefined, { sources })
        // `ok: false` means the whole call threw. Individual symbol errors are
        // not a reason to back off the entire loop — one delisted ticker
        // shouldn't stop the other twenty from updating.
        if (result?.ok === false) failures.current += 1
        else failures.current = 0
      } catch {
        failures.current += 1
      } finally {
        inFlight.current = false
      }
    }

    // Coming back to the tab is the moment the number matters most, so check
    // immediately rather than waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }

    tick()
    const timer = setInterval(tick, TICK_MS)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, intervalMinutes, refreshPrices])

  return null
}
