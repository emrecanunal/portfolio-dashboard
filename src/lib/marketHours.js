// When is there actually a new price to fetch?
//
// Polling every five minutes at 3am on a Sunday costs battery, burns the
// sources' goodwill, and returns the identical number every time. These helpers
// let the auto-refresh scheduler back off when nothing can have changed.
//
// All checks are done against wall-clock time in the market's own timezone via
// Intl, not the device's — the app is used from Turkey, but a laptop that
// travels shouldn't change when BIST is deemed open.

/** Wall-clock { weekday (0=Sun), hour, minute } in an IANA timezone. */
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type) => parts.find((p) => p.type === type)?.value
  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

  return {
    weekday: WEEKDAYS[get('weekday')] ?? 1,
    // '24' shows up at midnight in some ICU versions.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  }
}

function isOpen(date, { timeZone, openMinutes, closeMinutes }) {
  const { weekday, hour, minute } = zonedParts(date, timeZone)
  if (weekday === 0 || weekday === 6) return false
  const nowMinutes = hour * 60 + minute
  return nowMinutes >= openMinutes && nowMinutes <= closeMinutes
}

// Borsa İstanbul continuous trading runs 10:00–18:00 with the closing auction
// finishing about 18:10. We add a few minutes on each side so a refresh that
// fires at 09:58 still catches the opening print.
export function isBistOpen(date = new Date()) {
  return isOpen(date, {
    timeZone: 'Europe/Istanbul',
    openMinutes: 9 * 60 + 55,
    closeMinutes: 18 * 60 + 20,
  })
}

// US regular session, 09:30–16:00 New York. Pre/post-market is ignored: the
// free sources don't report it reliably anyway.
export function isUsMarketOpen(date = new Date()) {
  return isOpen(date, {
    timeZone: 'America/New_York',
    openMinutes: 9 * 60 + 25,
    closeMinutes: 16 * 60 + 5,
  })
}

// Neither exchange publishes anything overnight, so if both are shut there is
// no point running the fast loop at all.
export function isAnyEquityMarketOpen(date = new Date()) {
  return isBistOpen(date) || isUsMarketOpen(date)
}

// TEFAS funds publish ONE price per day, in the evening, after the funds value
// their portfolios. Before roughly 19:00 Istanbul the day's price does not
// exist yet — which is why a five-minute fund poll is pure waste and this
// module exists at all.
export function haveFundsPublishedToday(date = new Date()) {
  const { weekday, hour } = zonedParts(date, 'Europe/Istanbul')
  if (weekday === 0 || weekday === 6) return false
  return hour >= 19
}
