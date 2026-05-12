// Global state store with automatic localStorage persistence.
// Single source of truth: transactions + subPortfolios + settings.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { demoTransactions, demoSubPortfolios, demoPriceCache } from '../data/demoData.js'

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
      // Refreshes equity prices via Finnhub. Only fetches symbols that look fetchable
      // (assetType === 'global', no exchange suffix).
      // onProgress: optional callback (current, total) for UI progress display.
      // Returns: { ok: boolean, fetched: number, errors: array, errorMessage?: string }
      refreshPrices: async (onProgress) => {
        const state = get()
        const apiKey = state.settings.finnhubApiKey?.trim()

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
          const heldHoldings = [...holdingsByKey.values()].filter((h) => h.qty > 0.0001)

          if (heldHoldings.length === 0) {
            set((s) => ({
              settings: {
                ...s.settings,
                priceMeta: {
                  fetchedAt: Date.now(),
                  lastError: null,
                  lastErrorSymbols: [],
                  sourceStats: {},
                },
              },
            }))
            return { ok: true, fetched: 0, errors: [], sourceStats: {} }
          }

          const { results, errors, sourceStats } = await fetchAllPrices({
            holdings: heldHoldings,
            finnhubApiKey: apiKey,
            onProgress,
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
              ...(quote.name ? { name: quote.name } : {}),
            }
          }

          // Determine top-level error message: prioritize INVALID_KEY > NO_API_KEY > generic
          let topLevelError = null
          if (sourceStats.global?.error === 'INVALID_KEY') topLevelError = 'INVALID_KEY'
          else if (sourceStats.global?.error === 'NO_API_KEY') topLevelError = 'NO_API_KEY_GLOBAL'

          set((s) => ({
            priceCache: updatedCache,
            settings: {
              ...s.settings,
              priceMeta: {
                fetchedAt: Date.now(),
                lastError: topLevelError,
                lastErrorSymbols: errors.map((e) => e.symbol),
                sourceStats,
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
      restoreFromBackup: (data) =>
        set((s) => ({
          transactions: data.transactions || s.transactions,
          subPortfolios: data.subPortfolios || s.subPortfolios,
          priceCache: data.priceCache || s.priceCache,
          settings: {
            ...s.settings,
            ...(data.settings || {}),
            // Keep current API key — don't overwrite with empty string from backup
            finnhubApiKey: s.settings.finnhubApiKey,
          },
        })),
    }),
    {
      name: 'portfolio-dashboard-v1',
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

const PORTFOLIO_COLORS = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6']
function pickColor(idx) {
  return PORTFOLIO_COLORS[idx % PORTFOLIO_COLORS.length]
}
