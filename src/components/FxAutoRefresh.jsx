import { useEffect } from 'react'
import { usePortfolioStore } from '../lib/store.js'
import { isStale } from '../lib/fxApi.js'

// Mount-once side-effect component.
// On app load: if FX rates are missing or older than 12h, silently kick off a refresh.
// Errors are stored in fxMeta.lastError but don't block the UI — existing rates keep working.
export function FxAutoRefresh() {
  const fetchedAt = usePortfolioStore((s) => s.settings.fxMeta?.fetchedAt)
  const refreshFxRates = usePortfolioStore((s) => s.refreshFxRates)

  useEffect(() => {
    if (isStale(fetchedAt)) {
      refreshFxRates()
    }
    // Only on mount — checking once per session is enough (manual refresh available)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
