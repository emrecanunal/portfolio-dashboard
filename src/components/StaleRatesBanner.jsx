import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import { isVeryStale } from '../lib/fxApi.js'
import { cn } from '../lib/utils.js'

// Shown at the top of the dashboard if FX rates are stale and user hasn't dismissed it.
// Dismissal is per-session (not persisted) so it returns next time they open the app.
export function StaleRatesBanner() {
  const { t } = useT()
  const fetchedAt = usePortfolioStore((s) => s.settings.fxMeta?.fetchedAt)
  const source = usePortfolioStore((s) => s.settings.fxMeta?.source)
  const refreshFxRates = usePortfolioStore((s) => s.refreshFxRates)
  const [dismissed, setDismissed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Only show if rates were fetched at some point AND are now very stale
  // (don't bother first-time users who haven't fetched anything yet — auto-refresh will handle them)
  const shouldShow =
    !dismissed &&
    source === 'frankfurter' &&
    fetchedAt &&
    isVeryStale(fetchedAt)

  if (!shouldShow) return null

  const handleRefresh = async () => {
    setRefreshing(true)
    await refreshFxRates()
    setRefreshing(false)
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 rounded-lg',
        'bg-warning/10 border border-warning/30',
        'animate-in fade-in slide-in-from-top-1 duration-300'
      )}
    >
      <AlertTriangle size={14} className="text-warning shrink-0" strokeWidth={2} />
      <p className="text-xs text-text-secondary flex-1 leading-relaxed">
        {t.settingsPage.ratesStaleBanner}
      </p>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
          'bg-warning/15 text-warning border border-warning/30',
          'hover:bg-warning/25 transition-colors',
          'disabled:opacity-60 disabled:cursor-wait'
        )}
      >
        <RefreshCw
          size={11}
          strokeWidth={2.25}
          className={refreshing ? 'animate-spin' : ''}
        />
        {refreshing ? t.settingsPage.refreshing : t.settingsPage.refreshNow}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 -m-1 text-text-tertiary hover:text-text-primary transition-colors"
        aria-label={t.common.close}
      >
        <X size={13} />
      </button>
    </div>
  )
}
