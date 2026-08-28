// Global state store with automatic localStorage persistence.
// Single source of truth: transactions + subPortfolios + settings.

import { create } from 'zustand'
// subscribeWithSelector: SyncProvider store'un YALNIZCA outbox'ını dinlemek
// istiyor. Bu ara katman olmadan subscribe() her yazmada tetiklenir ve fiyat
// yenilemesi (dakikada bir, 147 sembol) senkron turu başlatırdı — oysa fiyatlar
// senkronlanmıyor bile.
import { persist, subscribeWithSelector } from 'zustand/middleware'
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
  // When a backup file was last written. Describes the MOMENT, not the user,
  // so it is deliberately absent from RESTORABLE_SETTINGS: restoring a file
  // from March would otherwise claim you had backed up in March — the one lie
  // this field exists to prevent.
  lastBackupAt: null,
  // Equity-price live-data metadata
  // KULLANIMDAN KALDIRILDI (Faz 3). Anahtar artık sunucuda bir ortam
  // değişkeninde ve tarayıcıya hiç gitmiyor. Alan duruyor çünkü eski
  // tarayıcıların saklanmış state'inde var; okuyan kod kalmadı. Bir sonraki
  // şema sürümünde migrate ile silinebilir.
  finnhubApiKey: '',
  priceMeta: {
    fetchedAt: null,           // last successful refresh timestamp
    lastError: null,
    lastErrorSymbols: [],      // [{ symbol, error }] from the last batch
  },
}

// What a browser that has never seen this app starts with.
//
// WHY NOT THE DEMO DATA, WHICH IS WHAT THIS USED TO BE
//
// The demo set is deliberately realistic — THYAO, ASELS, VOO, believable
// quantities — which is exactly what makes it dangerous as a starting point.
// Someone who opens the app and starts logging real trades ends up with a book
// that is part real and part invented, and nothing on screen says which row is
// which. That was survivable while the data lived in one browser.
//
// It stops being survivable the moment two devices sync. A phone opening the
// app for the first time would boot full of demo transactions and push them at
// the server as though they were real, and a merge has no way to tell them
// from the trades typed on the laptop. So first run is empty now, and the demo
// set moved behind a button (loadDemoData, Settings → Data management).
//
// One portfolio rather than none: the add-transaction form files a trade under
// subPortfolios[0], so zero portfolios means a trade filed under '' — an
// invisible orphan. One empty portfolio costs nothing and closes that.
const STARTER_PORTFOLIO = { id: 'sub-default', name: 'Portfolio', color: '#10b981' }

export const usePortfolioStore = create(
  subscribeWithSelector(
  persist(
    (set, get) => ({
      transactions: [],
      subPortfolios: [STARTER_PORTFOLIO],
      priceCache: {},
      // Month-end archives behind the performance chart. See history.js for
      // the shape and why they are monthly rather than daily.
      priceHistory: {},
      fxHistory: {},
      settings: defaultSettings,

      // Gönderilmeyi bekleyen değişiklikler; ayrıntısı emptyOutbox()'ın üstünde.
      outbox: emptyOutbox(),
      syncMeta: { cursor: null, lastSyncAt: null, lastError: null, status: 'idle' },

      addTransaction: (tx) =>
        set((s) => {
          const id = crypto.randomUUID()
          return {
            transactions: [...s.transactions, { ...tx, id }],
            outbox: mark(s.outbox, 'transactions', id, 'upsert'),
          }
        }),

      updateTransaction: (id, patch) =>
        set((s) => ({
          transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          outbox: mark(s.outbox, 'transactions', id, 'upsert'),
        })),

      deleteTransaction: (id) =>
        set((s) => ({
          transactions: s.transactions.filter((t) => t.id !== id),
          outbox: mark(s.outbox, 'transactions', id, 'delete'),
        })),

      addSubPortfolio: (name) =>
        set((s) => {
          const id = crypto.randomUUID()
          return {
            subPortfolios: [...s.subPortfolios, { id, name, color: pickColor(s.subPortfolios.length) }],
            outbox: mark(s.outbox, 'portfolios', id, 'upsert'),
          }
        }),

      renameSubPortfolio: (id, name) =>
        set((s) => ({
          subPortfolios: s.subPortfolios.map((p) => (p.id === id ? { ...p, name } : p)),
          outbox: mark(s.outbox, 'portfolios', id, 'upsert'),
        })),

      /**
       * Kasa'yı seç — paranın girip çıktığı portföy.
       *
       * TEK BİR TANE OLABİLİR, ve bu bir kısıt değil bir tanım: "paranın girdiği
       * yer" birden fazla olamaz, olursa soru tekrar cevapsız kalır. Bu yüzden
       * yeni birini işaretlemek diğerinin işaretini kaldırıyor — kullanıcıdan
       * önce eskisini kapatmasını istemek, unutulduğunda iki kasalı ve sessizce
       * anlamsız bir duruma yol açardı.
       *
       * null geçmek hepsini temizler.
       */
      setCashAccount: (id) =>
        set((s) => {
          const outbox = { ...s.outbox, portfolios: { ...s.outbox.portfolios } }
          const subPortfolios = s.subPortfolios.map((p) => {
            const next = p.id === id
            if (Boolean(p.isCashAccount) === next) return p
            outbox.portfolios[p.id] = 'upsert'
            return { ...p, isCashAccount: next }
          })
          return { subPortfolios, outbox }
        }),

      /**
       * Portföyün başlangıç bakiyesi.
       *
       * Bir işlem olarak saklanıyor, portföyün bir alanı olarak değil: aynı
       * zaman çizgisinde duruyor, yedeğe ve CSV'ye kendiliğinden giriyor,
       * senkronda ayrı bir yol gerektirmiyor ve işlem listesinde görünüyor.
       * Portföy alanı olsaydı bunların her biri ayrıca yazılmak zorundaydı.
       *
       * Portföy başına EN FAZLA BİR tane: ikincisi bir düzeltme değil, sessizce
       * ikiye katlanmış bir bakiye olurdu. Bu yüzden varsa güncelleniyor.
       * amount 0 ya da boşsa kayıt siliniyor.
       */
      setOpeningBalance: (portfolioId, { amount, currency = 'TRY', date }) =>
        set((s) => {
          const existing = s.transactions.find(
            (t) => t.type === 'opening' && t.portfolioId === portfolioId,
          )
          const value = Number(amount) || 0

          if (!value) {
            if (!existing) return {}
            return {
              transactions: s.transactions.filter((t) => t.id !== existing.id),
              outbox: mark(s.outbox, 'transactions', existing.id, 'delete'),
            }
          }

          const row = {
            id: existing?.id || crypto.randomUUID(),
            type: 'opening',
            assetType: 'cash',
            symbol: 'CASH',
            portfolioId,
            quantity: 1,
            price: value,
            fee: 0,
            currency,
            date: date || existing?.date || todayIso(),
            notes: existing?.notes || '',
          }

          return {
            transactions: existing
              ? s.transactions.map((t) => (t.id === existing.id ? row : t))
              : [...s.transactions, row],
            outbox: mark(s.outbox, 'transactions', row.id, 'upsert'),
          }
        }),

      deleteSubPortfolio: (id) =>
        set((s) => ({
          subPortfolios: s.subPortfolios.filter((p) => p.id !== id),
          outbox: mark(s.outbox, 'portfolios', id, 'delete'),
        })),

      updateSettings: (patch) =>
        set((s) => ({
          settings: { ...s.settings, ...patch },
          outbox: { ...s.outbox, settings: true },
        })),

      // === SENKRON ===
      //
      // Bu dördünü yalnızca sync.js çağırır. Store'da durmalarının sebebi tek
      // bir set() içinde hem veriyi hem outbox'ı hem imleci güncellemek: ayrı
      // ayrı yazılsalardı arada bir render olur ve arayüz yarı uygulanmış bir
      // senkronu gösterirdi.

      /** Sunucudan gelenleri yerele işle. Yerelde kirli olanlar korunur. */
      applyPulled: ({ transactions, portfolios, settings, cursor }) =>
        set((s) => {
          const next = {}
          if (transactions) {
            next.transactions = mergeRows(s.transactions, transactions, s.outbox.transactions)
          }
          if (portfolios) {
            next.subPortfolios = mergeRows(s.subPortfolios, portfolios, s.outbox.portfolios)
          }
          // Ayarlar tek nesne, son-yazan-kazanır. Yerelde bekleyen bir ayar
          // değişikliği varsa sunucudakini almıyoruz; bizimki birazdan gidip
          // onu ezecek.
          if (settings && !s.outbox.settings) {
            next.settings = { ...s.settings, ...settings }
          }
          next.syncMeta = { ...s.syncMeta, cursor, lastSyncAt: Date.now(), lastError: null }
          return next
        }),

      /** Gönderimi başarılı olan satırları outbox'tan düş. */
      clearOutbox: (sent) =>
        set((s) => {
          const next = emptyOutbox()
          // Gönderim SIRASINDA yapılan değişiklikler kutuda kalmalı. Kutuyu
          // toptan boşaltmak, tam o aralıkta girilen bir işlemi sessizce
          // yutardı: kullanıcı girer, ekranda görür, diğer cihaza hiç ulaşmaz.
          for (const kind of ['transactions', 'portfolios']) {
            for (const [id, op] of Object.entries(s.outbox[kind])) {
              if (sent?.[kind]?.[id] !== op) next[kind][id] = op
            }
          }
          next.settings = sent?.settings ? false : s.outbox.settings
          return { outbox: next }
        }),

      setSyncStatus: (status, error = null) =>
        set((s) => ({ syncMeta: { ...s.syncMeta, status, lastError: error } })),

      /** Her şeyi kirli işaretle — ilk senkron ve "baştan gönder" için. */
      markEverythingDirty: () =>
        set((s) => {
          const outbox = emptyOutbox()
          for (const t of s.transactions) outbox.transactions[t.id] = 'upsert'
          for (const p of s.subPortfolios) outbox.portfolios[p.id] = 'upsert'
          outbox.settings = true
          return { outbox }
        }),

      // Dil ve tema CİHAZA ait, kişiye değil — telefonda karanlık, masaüstünde
      // açık isteyebilirsin. Bu yüzden outbox'a girmiyorlar, SYNCED_SETTINGS de
      // onları dışarıda bırakıyor.
      setLanguage: (lang) =>
        set((s) => ({ settings: { ...s.settings, language: lang } })),

      setTheme: (theme) =>
        set((s) => ({ settings: { ...s.settings, theme } })),

      // Called wherever a backup file actually reaches the disk — including the
      // safety copies taken before a destructive action, which are real backups
      // whether or not the user thought of them as such.
      markBackedUp: (at = new Date().toISOString()) =>
        set((s) => ({ settings: { ...s.settings, lastBackupAt: at } })),

      toggleTheme: () =>
        set((s) => ({
          settings: { ...s.settings, theme: s.settings.theme === 'dark' ? 'light' : 'dark' },
        })),

      // Replace everything with the sample book. Named for what it does rather
      // than "resetToDefaults", which stopped being true when the defaults
      // became empty — a reader of that name would reasonably expect this to
      // clear the app, and it does the opposite.
      //
      // Settings are deliberately NOT reset with it: the FIRE targets, base
      // currency and Finnhub key belong to the person, not to the sample data,
      // and re-entering them is a strange price for pressing "show me a demo".
      loadDemoData: () =>
        set((s) => ({
          transactions: demoTransactions,
          subPortfolios: demoSubPortfolios,
          priceCache: demoPriceCache,
          priceHistory: {},
          fxHistory: {},
          settings: s.settings,
          outbox: outboxForReplacement(s, demoTransactions, demoSubPortfolios),
        })),

      clearAllTransactions: () =>
        set((s) => ({
          transactions: [],
          outbox: outboxForReplacement(s, [], s.subPortfolios),
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
      // Sunucu yazdığı fiyatları okur. Dış kaynağa GİTMEZ — cron ne yazdıysa o.
      //
      // Açılışta çağrılıyor, yani bir cihazı ilk kez açtığında fiyatlar zaten
      // orada. Faz 3'ten önce her yeni tarayıcı boş bir fiyat önbelleğiyle
      // açılıyor, her şeyi maliyetiyle değerliyor ve kullanıcı "P/L neden %0"
      // diye soruyordu.
      loadServerPrices: async () => {
        const { isBackendConfigured, readPrices } = await import('./backend/index.js')
        if (!isBackendConfigured()) return { ok: false, error: 'not-configured' }

        const result = await readPrices()
        if (!result.ok) return result

        set((s) => {
          const merged = { ...s.priceCache }
          for (const [sym, q] of Object.entries(result.quotes)) {
            // Elle girilmiş bir fiyat sunucununkinden yeniyse korunur: kullanıcı
            // bir sembole bilerek değer yazdıysa, arka planda çalışan bir iş onu
            // sessizce ezmemeli.
            const local = merged[sym]
            if (local?.source === 'manual' && (local.fetchedAt || 0) > q.fetchedAt) continue
            merged[sym] = { ...local, ...q }
          }
          return { priceCache: merged }
        })

        return { ok: true, count: Object.keys(result.quotes).length }
      },

      refreshPrices: async (onProgress, options = {}) => {
        const state = get()
        const sources = options.sources || ['bist', 'tefas', 'global']

        // Sunucu varsa kaynaklara ORADAN gidiliyor: anahtar sunucuda, kota tek
        // yerden harcanıyor, ve sonuç herkesin okuduğu tabloya yazılıyor. Üç
        // cihazın aynı sembolü üç kez çekmesi böyle bitiyor.
        const { isBackendConfigured, authorizedFetch } = await import('./backend/index.js')
        if (isBackendConfigured()) {
          const r = await authorizedFetch(`/api/refresh-prices?sources=${sources.join(',')}`, {
            method: 'POST',
          })
          if (r.ok) {
            await get().loadServerPrices()
            set((s) => ({
              settings: {
                ...s.settings,
                priceMeta: {
                  ...s.settings.priceMeta,
                  fetchedAt: Date.now(),
                  lastError: null,
                  lastErrorSymbols: (r.body?.errors || []).slice(0, 20),
                  sourceStats: r.body?.sources || {},
                  sourceFetchedAt: stampSources(s.settings.priceMeta?.sourceFetchedAt, sources),
                },
              },
            }))
            return { ok: true, fetched: r.body?.fetched ?? 0, errors: r.body?.errors || [], sourceStats: r.body?.sources || {} }
          }
          // Sunucu yolu çalışmadıysa doğrudan çekmeye DÜŞMÜYORUZ. Düşseydik,
          // bozuk bir dağıtım fark edilmeden aylarca gizlenir ve kota yine
          // cihaz başına harcanmaya devam ederdi.
          set((s) => ({
            settings: {
              ...s.settings,
              priceMeta: { ...s.settings.priceMeta, lastError: r.error || 'SERVER_REFRESH_FAILED' },
            },
          }))
          return { ok: false, fetched: 0, errors: [{ symbol: '', error: r.error }], sourceStats: {} }
        }

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
                // Keep the reason alongside the name. Five failed tickers with
                // one shared cause is one problem; five names on their own look
                // like five, and point the search at the symbols rather than at
                // whatever they have in common.
                lastErrorSymbols: errors.filter((e) => e.symbol),
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
            // Restoring a file written in March must not claim you backed up
            // in March. RESTORABLE_SETTINGS already excludes this, but the
            // invariant is worth stating where the merge happens, so adding
            // the key to that list later cannot quietly break it.
            lastBackupAt: s.settings.lastBackupAt,
          },
          // Geri yükleme sunucuya da yansımalı, yoksa dosyadan gelen kayıtlar
          // bu cihazda kalır ve bir sonraki çekmede sunucudakiler onları geri
          // getirir — kullanıcı geri yükleme yapar, birkaç dakika sonra eski
          // hâli geri gelir ve neden olduğunu anlayamaz.
          outbox: outboxForReplacement(
            s,
            data.transactions || s.transactions,
            data.subPortfolios || s.subPortfolios,
          ),
        })),
    }),
    {
      name: 'portfolio-dashboard-v1',
      // Bump this whenever a new top-level field is added, and handle the gap
      // in `migrate`. Before this existed, adding a field meant every returning
      // user got `undefined` for it until something happened to write it.
      version: 2,
      migrate: (persisted, fromVersion) => {
        if (!persisted) return persisted
        if (fromVersion < 1) {
          // v0 → v1: the month-end archives did not exist. Start them empty;
          // Settings offers a one-click backfill to populate the past.
          persisted = { ...persisted, priceHistory: {}, fxHistory: {} }
        }
        if (fromVersion < 2) {
          // v1 → v2: sync arrived. The outbox starts EMPTY and the cursor null,
          // which together mean "this browser has never synced". sync.js reads
          // exactly that pair to decide the first run is an adoption rather
          // than an ordinary round, and marks everything dirty itself.
          //
          // Pre-filling the outbox here instead would push on the very first
          // load after an update, before the user has seen a word about it.
          persisted = { ...persisted, outbox: emptyOutbox(), syncMeta: { cursor: null, lastSyncAt: null, lastError: null, status: 'idle' } }
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
)

// === OUTBOX ===
//
// Hangi satırın gönderilmeyi beklediğini tutan defter: { id: 'upsert'|'delete' }.
//
// NEDEN SATIRIN ÜSTÜNDE BİR `_dirty` BAYRAĞI DEĞİL
//
// Bayrak, veri modelinin parçası olurdu: yedek dosyasına girer, CSV'ye girer,
// calculations.js'in gördüğü nesnede durur ve bir gün birinin `_dirty`i gerçek
// bir alan sanmasıyla biter. Ayrı bir defter, senkronun muhasebesini verinin
// kendisinden ayrı tutuyor.
//
// Defter zustand persist ile diske de yazılıyor — kasıtlı. Uçakta girilen üç
// işlem, uygulamayı kapatıp açınca kaybolmasın diye.

function emptyOutbox() {
  return { transactions: {}, portfolios: {}, settings: false }
}

function mark(outbox, kind, id, op) {
  return { ...outbox, [kind]: { ...outbox[kind], [id]: op } }
}

/**
 * Toptan değiştirmelerin (demo yükle, yedekten geri yükle, hepsini temizle)
 * outbox'ı.
 *
 * BURADAKİ İNCELİK: kaybolan satırlar.
 *
 * Yalnızca yeni satırları 'upsert' işaretlemek yetmiyor. 364 işlemi 256'lık bir
 * yedekle değiştirdiğinde, aradaki 108 satır sunucuda öylece duruyor ve bir
 * sonraki çekmede geri geliyor. Kullanıcı geri yükleme yapar, birkaç dakika
 * sonra sildiği kayıtların geri geldiğini görür ve bunu senkronun bozukluğu
 * sanır — oysa hiç kimse onlara "sil" dememiştir.
 *
 * Bu yüzden fark alınıyor: gidenler 'delete', kalanlar ve gelenler 'upsert'.
 */
function outboxForReplacement(state, nextTransactions, nextPortfolios) {
  const outbox = emptyOutbox()
  outbox.settings = state.outbox?.settings ?? false

  const pairs = [
    ['transactions', state.transactions, nextTransactions],
    ['portfolios', state.subPortfolios, nextPortfolios],
  ]

  for (const [kind, before, after] of pairs) {
    const survivors = new Set(after.map((r) => r.id))
    for (const row of before) {
      if (!survivors.has(row.id)) outbox[kind][row.id] = 'delete'
    }
    for (const row of after) outbox[kind][row.id] = 'upsert'
  }

  return outbox
}

/**
 * Sunucudan gelen satırları yerel diziye işle.
 *
 * ÜÇ KURAL:
 *   - Yerelde kirli olan satıra DOKUNMA. Bizim değişikliğimiz henüz gitmedi;
 *     sunucudaki onun eski hâli. Üstüne yazmak, kullanıcının az önce yaptığı
 *     düzenlemeyi geri almak olurdu.
 *   - deleted_at dolu gelen satırı yerelden çıkar.
 *   - Gerisinde sunucu kazanır.
 *
 * Sıra korunuyor: mevcut satırlar yerinde güncelleniyor, yeniler sona
 * ekleniyor. Diziyi baştan kurmak, işlem listesinin her senkronda kendiliğinden
 * yeniden sıralanması demek olurdu.
 *
 * `incoming` uygulama şeklinde gelir, üstünde tek fazladan alan olarak
 * `deleted_at` taşır — sync.js çevirir. O alan yerele YAZILMAZ; mezar taşı
 * sunucunun muhasebesi, uygulamanın veri modeli değil.
 */
function mergeRows(local, incoming, dirty) {
  const byId = new Map(local.map((r) => [r.id, r]))

  for (const row of incoming) {
    if (dirty[row.id]) continue
    if (row.deleted_at) {
      byId.delete(row.id)
    } else {
      const { deleted_at, ...clean } = row
      byId.set(row.id, clean)
    }
  }

  return [...byId.values()]
}

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
