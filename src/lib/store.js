// Global state store with automatic localStorage persistence.
// Single source of truth: transactions + subPortfolios + settings.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { demoTransactions, demoSubPortfolios, demoPriceCache } from '../data/demoData.js'
import {
  recordPriceSnapshot,
  recordFxSnapshot,
  mergeBackfill,
  mergeFxBackfill,
} from './history.js'

const defaultSettings = {
  baseCurrency: 'TRY',
  language: 'en',
  theme: 'dark',
  // FIRE config
  monthlyExpensesUSD: 1000,
  withdrawalRate: 0.04,
  activeFireStage: 'lean',
  fireTargetUSD: 300000,
  // Cash & lookback
  cashThresholdPct: 5,
  fireLookbackMonths: 6,
  fxRates: {
    TRY: 1,
    USD: 34.5,
    EUR: 37.2,
  },
  // FX live-data metadata
  fxMeta: {
    fetchedAt: null,
    apiDate: null,
    source: 'manual',
    lastError: null,
  },
  // Automatic price refresh. The interval applies to BIST and global equities
  // while their markets are open; funds run on their own much slower clock
  // (see PriceAutoRefresh.jsx) because TEFAS publishes once a day.
  autoRefreshEnabled: true,
  autoRefreshMinutes: 5,
  // Performance chart: overlay the "money I put in" line. Needs no price
  // history, so it is accurate even before any backfill.
  showContributionsLine: true,
  // Result of the last history backfill, for the Settings panel.
  historyMeta: {
    backfilledAt: null,
    months: 0,
    symbols: 0,
    fxMonths: 0,
    errors: [],
  },
  // Equity-price live-data metadata
  finnhubApiKey: '',           // user-provided; empty = manual prices only
  priceMeta: {
    fetchedAt: null,           // last successful refresh timestamp
    lastError: null,
    lastErrorSymbols: [],      // symbols that failed in the last batch
  },
}

export const usePortfolioStore = create(
  persist(
    (set, get) => ({
      transactions: demoTransactions,
      subPortfolios: demoSubPortfolios,
      priceCache: demoPriceCache,
      // Month-end archives behind the performance chart. See history.js for
      // the shape and why they are monthly rather than daily.
      priceHistory: {},
      fxHistory: {},
      settings: defaultSettings,

      addTransaction: (tx) =>
        set((s) => ({
          transactions: [...s.transactions, { ...tx, id: crypto.randomUUID() }],
        })),

      updateTransaction: (id, patch) =>
        set((s) => ({
          transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      deleteTransaction: (id) =>
        set((s) => ({
          transactions: s.transactions.filter((t) => t.id !== id),
        })),

      addSubPortfolio: (name) =>
        set((s) => ({
          subPortfolios: [...s.subPortfolios, { id: crypto.randomUUID(), name, color: pickColor(s.subPortfolios.length) }],
        })),

      renameSubPortfolio: (id, name) =>
        set((s) => ({
          subPortfolios: s.subPortfolios.map((p) => (p.id === id ? { ...p, name } : p)),
        })),

      deleteSubPortfolio: (id) =>
        set((s) => ({
          subPortfolios: s.subPortfolios.filter((p) => p.id !== id),
        })),

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      setLanguage: (lang) =>
        set((s) => ({ settings: { ...s.settings, language: lang } })),

      setTheme: (theme) =>
        set((s) => ({ settings: { ...s.settings, theme } })),

      toggleTheme: () =>
        set((s) => ({
          settings: { ...s.settings, theme: s.settings.theme === 'dark' ? 'light' : 'dark' },
        })),

      resetToDefaults: () =>
        set({
          transactions: demoTransactions,
          subPortfolios: demoSubPortfolios,
          priceCache: demoPriceCache,
          priceHistory: {},
          fxHistory: {},
          settings: defaultSettings,
        }),

      clearAllTransactions: () =>
        set((s) => ({
          transactions: [],
        })),

      // === FX REFRESH ===
      // Calls Frankfurter API and updates fxRates + fxMeta atomically.
      // On error, keeps existing rates and records the error in fxMeta.lastError.
      // Returns the updated rates object on success, or null on failure.
      refreshFxRates: async () => {
        try {
          const { fetchLiveFxRates } = await import('./fxApi.js')
          const result = await fetchLiveFxRates()
          set((s) => ({
            // Archive this month's rates as we go, so next year's chart can
            // value this month properly instead of at whatever the rate is then.
            fxHistory: recordFxSnapshot(s.fxHistory, result.rates),
            settings: {
              ...s.settings,
              fxRates: result.rates,
              fxMeta: {
                fetchedAt: result.fetchedAt,
                apiDate: result.apiDate,
                source: result.source,
                lastError: null,
              },
            },
          }))
          return result.rates
        } catch (err) {
          set((s) => ({
            settings: {
              ...s.settings,
              fxMeta: {
                ...s.settings.fxMeta,
                lastError: err.message || 'Failed to fetch rates',
              },
            },
          }))
          return null
        }
      },

      // === PRICE REFRESH ===
      // Refreshes held-asset prices from whichever source each asset type uses.
      // onProgress: optional callback (source, current, total) for UI progress.
      // options.sources: limit to a subset, e.g. ['bist','global']. Auto-refresh
      //   passes this so funds aren't re-fetched on an equity tick.
      // Returns: { ok: boolean, fetched: number, errors: array, errorMessage?: string }
      refreshPrices: async (onProgress, options = {}) => {
        const state = get()
        const apiKey = state.settings.finnhubApiKey?.trim()
        const sources = options.sources || ['bist', 'tefas', 'global']

        try {
          const { fetchAllPrices } = await import('./priceApi.js')

          // Collect held symbols by asset type
          const holdingsByKey = new Map()
          for (const tx of state.transactions) {
            if (tx.assetType === 'cash') continue
            const key = tx.symbol
            const h = holdingsByKey.get(key) || {
              symbol: tx.symbol,
              assetType: tx.assetType,
              qty: 0,
            }
            if (tx.type === 'buy') h.qty += tx.quantity
            else if (tx.type === 'sell') h.qty -= tx.quantity
            holdingsByKey.set(key, h)
          }
          const heldHoldings = [...holdingsByKey.values()]
            .filter((h) => h.qty > 0.0001)
            .filter((h) => sources.includes(h.assetType))

          if (heldHoldings.length === 0) {
            // Nothing to fetch. Record the attempt per source so the auto-
            // refresh scheduler stops asking, but only clear the top-level
            // status on a full refresh — a fund-only tick finding no funds
            // must not erase the error from the last equity refresh.
            const isFullRefresh = sources.length === 3
            set((s) => ({
              settings: {
                ...s.settings,
                priceMeta: {
                  ...s.settings.priceMeta,
                  ...(isFullRefresh
                    ? { fetchedAt: Date.now(), lastError: null, lastErrorSymbols: [], sourceStats: {} }
                    : {}),
                  sourceFetchedAt: stampSources(s.settings.priceMeta?.sourceFetchedAt, sources),
                },
              },
            }))
            return { ok: true, fetched: 0, errors: [], sourceStats: {} }
          }

          const { results, errors, sourceStats } = await fetchAllPrices({
            holdings: heldHoldings,
            finnhubApiKey: apiKey,
            onProgress,
            sources,
          })

          // Merge into priceCache, preserving any names from FonBul
          const updatedCache = { ...state.priceCache }
          for (const [sym, quote] of Object.entries(results)) {
            updatedCache[sym] = {
              ...updatedCache[sym],
              price: quote.price,
              previousClose: quote.previousClose,
              dayChangePct: quote.dayChangePct,
              currency: quote.currency || updatedCache[sym]?.currency || 'TRY',
              fetchedAt: quote.fetchedAt,
              // Always overwrite `source`. A symbol the user once typed a price
              // for was stuck on source:'manual' forever, so the "live" badge
              // never came back even after a successful fetch.
              source: quote.source || 'api',
              ...(quote.name ? { name: quote.name } : {}),
            }
          }

          // Determine top-level error message: prioritize INVALID_KEY > NO_API_KEY > generic
          let topLevelError = null
          if (sourceStats.global?.error === 'INVALID_KEY') topLevelError = 'INVALID_KEY'
          else if (sourceStats.global?.error === 'NO_API_KEY') topLevelError = 'NO_API_KEY_GLOBAL'
          else {
            // A source that returned NOTHING is a source that is down, and the
            // status line has to say so. Reporting "prices updated" in green
            // above a list of eight failed symbols invites hunting for what is
            // wrong with ASELS, when the answer is that the local proxy is not
            // running — which is also why the symbol list is the wrong shape of
            // message for this: it is one fact about one source, not eight
            // facts about eight symbols.
            const dead = Object.entries(sourceStats).find(
              ([, stat]) => stat?.error && (stat.ok || 0) === 0
            )
            if (dead) topLevelError = dead[1].error
          }

          set((s) => ({
            priceCache: updatedCache,
            // Repeated writes within a month overwrite, so the final refresh
            // before the month turns over becomes that month's close.
            priceHistory: recordPriceSnapshot(s.priceHistory, updatedCache),
            fxHistory: recordFxSnapshot(s.fxHistory, s.settings.fxRates),
            settings: {
              ...s.settings,
              priceMeta: {
                ...s.settings.priceMeta,
                fetchedAt: Date.now(),
                lastError: topLevelError,
                lastErrorSymbols: errors.map((e) => e.symbol),
                // Merge rather than replace: a fund-only tick shouldn't wipe
                // the equity sources' stats out of the Settings panel.
                sourceStats: { ...s.settings.priceMeta?.sourceStats, ...sourceStats },
                sourceFetchedAt: stampSources(s.settings.priceMeta?.sourceFetchedAt, sources),
              },
            },
          }))

          return {
            ok: true,
            fetched: Object.keys(results).length,
            errors,
            sourceStats,
          }
        } catch (err) {
          set((s) => ({
            settings: {
              ...s.settings,
              priceMeta: {
                ...s.settings.priceMeta,
                lastError: err.message || 'Failed to fetch prices',
              },
            },
          }))
          return {
            ok: false,
            fetched: 0,
            errors: [],
            errorMessage: err.message || 'Failed',
          }
        }
      },

      // === HISTORY BACKFILL ===
      //
      // Seeds the month-end archives from the sources, so the performance chart
      // has a real past instead of waiting months for snapshots to accumulate.
      // One-off and user-triggered; nothing calls this on a timer.
      //
      // Backfilled months never overwrite a snapshot we took ourselves — see
      // mergeBackfill() for why.
      backfillHistory: async (onProgress) => {
        const state = get()
        try {
          const { fetchFxHistory, fetchPriceHistory, monthsToCover, earliestTransactionYmd } =
            await import('./historyApi.js')

          const months = monthsToCover(state.transactions)

          // Held symbols, deduped by symbol+type — the archive is keyed by
          // symbol, so the same holding in two sub-portfolios is one fetch.
          const held = new Map()
          for (const tx of state.transactions) {
            if (tx.assetType === 'cash') continue
            const cur = held.get(tx.symbol) || { symbol: tx.symbol, assetType: tx.assetType, qty: 0 }
            if (tx.type === 'buy') cur.qty += tx.quantity
            else if (tx.type === 'sell') cur.qty -= tx.quantity
            held.set(tx.symbol, cur)
          }
          const holdings = [...held.values()].filter((h) => h.qty > 0.0001)

          // FX first: it is one request, it never fails for a bad symbol, and
          // the chart needs it even for an all-TRY portfolio.
          let fxMonths = {}
          let fxError = null
          try {
            onProgress?.('fx', 0, 1)
            const from = earliestTransactionYmd(state.transactions) || todayIso()
            fxMonths = await fetchFxHistory(from, todayIso())
            onProgress?.('fx', 1, 1)
          } catch (err) {
            fxError = err.message || 'FX history failed'
          }

          const { results, errors, sourceStats } = await fetchPriceHistory({
            holdings,
            months,
            onProgress,
            // Used only as a fallback, if Yahoo refuses a global symbol.
            finnhubApiKey: state.settings.finnhubApiKey,
          })

          set((s) => ({
            priceHistory: mergeBackfill(s.priceHistory, results),
            fxHistory: mergeFxBackfill(s.fxHistory, fxMonths),
            settings: {
              ...s.settings,
              historyMeta: {
                backfilledAt: Date.now(),
                months,
                symbols: Object.keys(results).length,
                fxMonths: Object.keys(fxMonths).length,
                // Keep the reason, not just the name. "AAPL failed" sends you
                // looking at AAPL; "AV_RATE_LIMIT" tells you to wait and that
                // nothing is wrong with the symbol at all.
                errors: errors.filter((e) => e.symbol),
                sourceStats,
                fxError,
              },
            },
          }))

          return { ok: true, symbols: Object.keys(results).length, errors, sourceStats, fxError }
        } catch (err) {
          set((s) => ({
            settings: {
              ...s.settings,
              historyMeta: { ...s.settings.historyMeta, lastError: err.message || 'Failed' },
            },
          }))
          return { ok: false, errorMessage: err.message || 'Failed' }
        }
      },

      setFinnhubApiKey: (key) =>
        set((s) => ({
          settings: { ...s.settings, finnhubApiKey: key },
        })),

      // Manual price edit for a single symbol
      setManualPrice: (symbol, price, currency) =>
        set((s) => ({
          priceCache: {
            ...s.priceCache,
            [symbol]: {
              ...s.priceCache[symbol],
              price,
              currency: currency || s.priceCache[symbol]?.currency || 'USD',
              source: 'manual',
            },
          },
        })),

      // Restore state from a parsed JSON backup. Preserves Finnhub key (it's stripped from backups).
      // `data` must come from parseJsonBackup, which validates every row and
      // strips the settings that describe the moment rather than the user —
      // exchange rates above all. Restoring a months-old USD rate would rewrite
      // every converted figure in the app without changing a single visible
      // label. Do not call this with a raw parsed file.
      restoreFromBackup: (data) =>
        set((s) => ({
          transactions: data.transactions || s.transactions,
          subPortfolios: data.subPortfolios || s.subPortfolios,
          priceCache: data.priceCache || s.priceCache,
          // Older backups predate the archives; keep whatever is in memory
          // rather than wiping months that would cost API calls to rebuild.
          priceHistory: data.priceHistory || s.priceHistory,
          fxHistory: data.fxHistory || s.fxHistory,
          settings: {
            ...s.settings,
            ...(data.settings || {}),
            // Live rates, fetch timestamps and the API key stay as they are:
            // they belong to this browser now, not to the file.
            fxRates: s.settings.fxRates,
            fxMeta: s.settings.fxMeta,
            priceMeta: s.settings.priceMeta,
            finnhubApiKey: s.settings.finnhubApiKey,
          },
        })),
    }),
    {
      name: 'portfolio-dashboard-v1',
      // Bump this whenever a new top-level field is added, and handle the gap
      // in `migrate`. Before this existed, adding a field meant every returning
      // user got `undefined` for it until something happened to write it.
      version: 1,
      migrate: (persisted, fromVersion) => {
        if (!persisted) return persisted
        if (fromVersion < 1) {
          // v0 → v1: the month-end archives did not exist. Start them empty;
          // Settings offers a one-click backfill to populate the past.
          return { ...persisted, priceHistory: {}, fxHistory: {} }
        }
        return persisted
      },
      merge: (persisted, current) => {
        if (!persisted) return current
        return {
          ...current,
          ...persisted,
          settings: { ...current.settings, ...persisted.settings },
        }
      },
    }
  )
)

// Record "we tried this source just now" for the sources a refresh covered.
// The auto-refresh scheduler reads these to decide what is due: equities every
// few minutes, funds every few hours.
// Local calendar day as 'YYYY-MM-DD' — never toISOString(), which would give
// yesterday to anyone in Turkey between midnight and 03:00.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function stampSources(previous, sources) {
  const now = Date.now()
  const next = { ...(previous || {}) }
  for (const s of sources) next[s] = now
  return next
}

const PORTFOLIO_COLORS = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6']
function pickColor(idx) {
  return PORTFOLIO_COLORS[idx % PORTFOLIO_COLORS.length]
}
