// A nudge to write the portfolio somewhere it cannot be evicted from.
//
// The Settings panel already reports how old the last backup is, but Settings
// is a page people visit when something is wrong. This is the only place the
// fact reaches someone who is not looking for it — and losing a year of
// transactions is exactly the kind of thing nobody looks for in advance.
//
// Two rules keep it from becoming furniture. It waits thirty days, not seven,
// because this app is opened most days and a weekly banner would simply always
// be there. And dismissal lasts the session only, so it comes back tomorrow if
// the backup still has not been taken — a permanent dismissal would turn one
// impatient tap into silence for good.

import { useState } from 'react'
import { Download, ShieldAlert, X } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import { exportJsonBackup } from '../lib/dataExport.js'
import { backupIsStale, daysSince } from '../lib/persistence.js'
import { cn } from '../lib/utils.js'

export function StaleBackupBanner() {
  const { t, ti } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const priceHistory = usePortfolioStore((s) => s.priceHistory)
  const fxHistory = usePortfolioStore((s) => s.fxHistory)
  const settings = usePortfolioStore((s) => s.settings)
  const markBackedUp = usePortfolioStore((s) => s.markBackedUp)
  const [dismissed, setDismissed] = useState(false)

  // Nothing to lose yet. A brand-new install showing "back up your data" before
  // there is any data is noise, and it trains the reader to dismiss the banner
  // on sight — including the time it matters.
  if (dismissed || transactions.length === 0) return null
  if (!backupIsStale(settings.lastBackupAt)) return null

  const days = daysSince(settings.lastBackupAt)

  const handleDownload = () => {
    exportJsonBackup({ transactions, subPortfolios, priceCache, priceHistory, fxHistory, settings })
    markBackedUp()
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 rounded-lg',
        'bg-warning/10 border border-warning/30',
        'animate-in fade-in slide-in-from-top-1 duration-300'
      )}
    >
      <ShieldAlert size={14} className="text-warning shrink-0" strokeWidth={2} />
      <p className="text-xs text-text-secondary flex-1 leading-relaxed">
        {days === null
          ? t.settingsPage.backupBannerNever
          : ti(t.settingsPage.backupBannerStale, { n: days })}
      </p>
      <button
        onClick={handleDownload}
        className="tap shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-warning/15 border border-warning/30 text-text-primary hover:bg-warning/25 transition-colors"
      >
        <Download size={12} strokeWidth={2} />
        {t.settingsPage.backupBannerAction}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="tap-icon shrink-0 p-1 text-text-tertiary hover:text-text-primary transition-colors"
        aria-label={t.warnings.dismiss}
        title={t.warnings.dismiss}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
