// How safe is the data, really.
//
// Everything this app knows lives in one browser's localStorage. There is no
// server copy, no second device, no undo. Two separate things can take it:
//
//   1. EVICTION. A browser may clear a site's storage on its own when the disk
//      gets tight, and Safari goes further — it erases script-writable storage
//      for any site not visited in seven days. navigator.storage.persist() asks
//      for exemption from the first, and installing to the home screen exempts
//      from the second.
//
//   2. THE USER. Clearing site data, a fresh browser, a new laptop. Nothing in
//      the browser survives that, and no API pretends otherwise. The only
//      answer is a backup file that lives somewhere else, which is why the age
//      of the last one is worth putting on screen next to all of this.
//
// So this module reports rather than reassures: what was granted, what was not,
// and how long ago the data was last written somewhere it cannot be evicted
// from.

/**
 * Ask the browser to exempt this origin from automatic eviction.
 *
 * Chrome grants it silently when the site looks important — installed, or
 * bookmarked, or used often — and refuses otherwise. Firefox prompts. Safari
 * does not implement it at all and reports false. All three are fine; the
 * point is to ask once and then say plainly which happened, rather than
 * assuming it worked.
 *
 * Never throws: this runs at startup and a storage question must not be able
 * to stop the app from rendering.
 */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return { supported: false, persisted: false }
    // Already granted? Asking again is a no-op, but skipping the call avoids
    // a second permission prompt in browsers that show one.
    if (await navigator.storage.persisted()) return { supported: true, persisted: true }
    const persisted = await navigator.storage.persist()
    return { supported: true, persisted }
  } catch {
    return { supported: false, persisted: false }
  }
}

/** Current state without asking for anything. */
export async function persistenceStatus() {
  try {
    if (!navigator.storage?.persisted) return { supported: false, persisted: false }
    return { supported: true, persisted: await navigator.storage.persisted() }
  } catch {
    return { supported: false, persisted: false }
  }
}

/** Is this running as an installed app rather than a browser tab? */
export function isInstalled() {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
    // iOS Safari's own spelling, which predates the standard one.
    return window.navigator?.standalone === true
  } catch {
    return false
  }
}

/**
 * Whole days since a timestamp, or null when there is no timestamp at all.
 *
 * Null and 0 mean very different things here — "never backed up" against
 * "backed up today" — so they must not collapse into the same falsy value.
 */
export function daysSince(timestamp, now = Date.now()) {
  if (!timestamp) return null
  const ms = now - new Date(timestamp).getTime()
  if (!isFinite(ms)) return null
  return Math.max(0, Math.floor(ms / 86400000))
}

/**
 * A month without a backup is the point worth mentioning.
 *
 * Not a week: a nagging banner is one people learn to dismiss without reading,
 * and this app is used daily, so a week would be permanent. Not a year either,
 * by which time the loss it warns about is a year of transactions.
 */
export const BACKUP_STALE_DAYS = 30

export function backupIsStale(lastBackupAt, now = Date.now()) {
  const days = daysSince(lastBackupAt, now)
  return days === null || days >= BACKUP_STALE_DAYS
}
