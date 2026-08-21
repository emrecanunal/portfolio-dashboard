import { useMemo, useState, useEffect, useRef } from 'react'
import { Plus, Pencil, Trash2, RotateCcw, Eraser, Check, X as XIcon, RefreshCw, AlertCircle, CheckCircle2, Download, Upload, FileText, FileJson } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import { formatRelativeTime, isStale, isVeryStale } from '../lib/fxApi.js'
import { historyCoverage } from '../lib/history.js'
import { computeHoldings } from '../lib/calculations.js'
import { exportJsonBackup, parseJsonBackup, exportTransactionsCsv } from '../lib/dataExport.js'
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Button, Badge } from '../components/ui/Primitives.jsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { Modal } from '../components/ui/Modal.jsx'
import { cn } from '../lib/utils.js'

const PORTFOLIO_COLORS = [
  '#10b981', '#3b82f6', '#a855f7', '#f59e0b',
  '#ec4899', '#14b8a6', '#ef4444', '#6366f1',
]

export default function SettingsPage() {
  const { t, ti } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const settings = usePortfolioStore((s) => s.settings)
  const updateSettings = usePortfolioStore((s) => s.updateSettings)
  const addSubPortfolio = usePortfolioStore((s) => s.addSubPortfolio)
  const renameSubPortfolio = usePortfolioStore((s) => s.renameSubPortfolio)
  const deleteSubPortfolio = usePortfolioStore((s) => s.deleteSubPortfolio)
  const resetToDefaults = usePortfolioStore((s) => s.resetToDefaults)
  const clearAllTransactions = usePortfolioStore((s) => s.clearAllTransactions)

  // FX rates: keep local mirror so user can type without instant write
  const [fxLocal, setFxLocal] = useState({
    USD: settings.fxRates.USD,
    EUR: settings.fxRates.EUR,
  })

  // When rates change in store (e.g. from API refresh), sync local state
  useEffect(() => {
    setFxLocal({
      USD: settings.fxRates.USD,
      EUR: settings.fxRates.EUR,
    })
  }, [settings.fxRates.USD, settings.fxRates.EUR])

  const updateFx = (ccy, val) => {
    const num = Math.max(0, parseFloat(val) || 0)
    setFxLocal((prev) => ({ ...prev, [ccy]: num }))
    updateSettings({
      fxRates: { ...settings.fxRates, [ccy]: num },
      fxMeta: {
        ...settings.fxMeta,
        source: 'manual',
        // keep fetchedAt as-is — user knows what they're doing
      },
    })
  }

  // Cash threshold
  const setCashThreshold = (val) => {
    const num = Math.min(50, Math.max(0, parseFloat(val) || 0))
    updateSettings({ cashThresholdPct: num })
  }

  // Sub-portfolios: count txns per portfolio
  const txnsByPortfolio = useMemo(() => {
    const m = new Map()
    for (const tx of transactions) {
      m.set(tx.portfolioId, (m.get(tx.portfolioId) || 0) + 1)
    }
    return m
  }, [transactions])

  // Add modal
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newPortfolioName, setNewPortfolioName] = useState('')
  const handleAdd = () => {
    const name = newPortfolioName.trim()
    if (!name) return
    addSubPortfolio(name)
    setNewPortfolioName('')
    setAddModalOpen(false)
  }

  // Rename modal
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const openRename = (p) => {
    setRenameTarget(p)
    setRenameValue(p.name)
  }
  const handleRename = () => {
    const name = renameValue.trim()
    if (!name || !renameTarget) return
    renameSubPortfolio(renameTarget.id, name)
    setRenameTarget(null)
  }

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null)
  const handleDelete = () => {
    if (!deleteTarget) return
    deleteSubPortfolio(deleteTarget.id)
    // Also remove transactions in that portfolio
    const portfolioId = deleteTarget.id
    const remaining = transactions.filter((t) => t.portfolioId !== portfolioId)
    usePortfolioStore.setState({ transactions: remaining })
  }

  // Data management confirm dialogs
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-2xs uppercase tracking-widest text-text-tertiary mb-1">
          {t.nav.settings}
        </p>
        <h1 className="text-3xl font-medium text-text-primary">{t.settingsPage.title}</h1>
        <p className="text-sm text-text-tertiary mt-1">{t.settingsPage.subtitle}</p>
      </div>

      {/* === EXCHANGE RATES === */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t.settingsPage.exchangeRates}</CardTitle>
            <CardSubtitle>{t.settingsPage.exchangeRatesDesc}</CardSubtitle>
          </div>
          <RefreshButton />
        </CardHeader>
        <CardBody>
          <FxStatusBar />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <FxRateInput
              ccy="USD"
              value={fxLocal.USD}
              onChange={(v) => updateFx('USD', v)}
              label={ti(t.settingsPage.perUnit, { ccy: 'USD' })}
            />
            <FxRateInput
              ccy="EUR"
              value={fxLocal.EUR}
              onChange={(v) => updateFx('EUR', v)}
              label={ti(t.settingsPage.perUnit, { ccy: 'EUR' })}
            />
          </div>
        </CardBody>
      </Card>

      {/* === ASSET PRICES === */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t.settingsPage.assetPrices}</CardTitle>
            <CardSubtitle>{t.settingsPage.bistTefasNote}</CardSubtitle>
          </div>
          <RefreshPricesButton />
        </CardHeader>
        <CardBody className="space-y-4">
          <PriceStatusBar />
          <AutoRefreshControl />
          <FinnhubKeyInput />
          <PriceHistoryPanel />
          <PriceCacheTable />
        </CardBody>
      </Card>

      {/* === CASH WARNING === */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t.settingsPage.cashWarning}</CardTitle>
            <CardSubtitle>{t.settingsPage.cashWarningDesc}</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <label className="input-label">{t.settingsPage.thresholdLabel}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="25"
                  step="1"
                  value={settings.cashThresholdPct}
                  onChange={(e) => setCashThreshold(e.target.value)}
                  className="flex-1 accent-accent cursor-pointer"
                />
                <div className="bg-bg-tertiary border border-border-subtle rounded-lg px-3 py-2 text-sm tabular-nums min-w-[60px] text-center">
                  {settings.cashThresholdPct}%
                </div>
              </div>
              <p className="text-2xs text-text-tertiary mt-2">{t.settingsPage.thresholdNote}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* === SUB-PORTFOLIOS === */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t.settingsPage.subPortfolios}</CardTitle>
            <CardSubtitle>{t.settingsPage.subPortfoliosDesc}</CardSubtitle>
          </div>
          <Button onClick={() => setAddModalOpen(true)} size="sm">
            <span className="flex items-center gap-1.5">
              <Plus size={12} strokeWidth={2.5} />
              {t.settingsPage.addSubPortfolio}
            </span>
          </Button>
        </CardHeader>
        <CardBody>
          <div className="space-y-2">
            {subPortfolios.map((p) => {
              const txnCount = txnsByPortfolio.get(p.id) || 0
              return (
                <div
                  key={p.id}
                  className="group flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-border-default transition-colors"
                >
                  <ColorSwatch
                    color={p.color}
                    onChange={(newColor) => {
                      // Inline color update via store mutation
                      const updated = subPortfolios.map((sp) =>
                        sp.id === p.id ? { ...sp, color: newColor } : sp
                      )
                      usePortfolioStore.setState({ subPortfolios: updated })
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary">{p.name}</div>
                    <div className="text-2xs text-text-tertiary tabular-nums">
                      {ti(t.settingsPage.txnCount, { n: txnCount })}
                    </div>
                  </div>
                  {txnCount > 0 && (
                    <Badge variant="info" className="text-2xs">
                      {t.settingsPage.portfolioInUse}
                    </Badge>
                  )}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openRename(p)}
                      className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                      title={t.settingsPage.renamePortfolio}
                    >
                      <Pencil size={13} strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={() => {
                        if (subPortfolios.length <= 1) return
                        setDeleteTarget(p)
                      }}
                      disabled={subPortfolios.length <= 1}
                      className={cn(
                        'p-1.5 rounded transition-colors',
                        subPortfolios.length <= 1
                          ? 'text-text-muted cursor-not-allowed'
                          : 'text-text-tertiary hover:text-danger hover:bg-danger/10'
                      )}
                      title={subPortfolios.length <= 1 ? t.settingsPage.cannotDeleteLast : t.settingsPage.deletePortfolio}
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* === EXPORT & BACKUP (Phase 7) === */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t.settingsPage.exportImport}</CardTitle>
            <CardSubtitle>{t.settingsPage.exportImportDesc}</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <ExportBackupActions />
        </CardBody>
      </Card>

      {/* === DATA MANAGEMENT === */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t.settingsPage.dataManagement}</CardTitle>
            <CardSubtitle>{t.settingsPage.dataManagementDesc}</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-2">
            <DangerAction
              icon={RotateCcw}
              title={t.settingsPage.resetDemo}
              description={t.settingsPage.resetDemoDesc}
              onClick={() => setResetConfirmOpen(true)}
            />
            <DangerAction
              icon={Eraser}
              title={t.settingsPage.clearAll}
              description={t.settingsPage.clearAllDesc}
              onClick={() => setClearConfirmOpen(true)}
              variant="danger"
            />
          </div>
        </CardBody>
      </Card>

      {/* === ADD PORTFOLIO MODAL === */}
      <Modal
        open={addModalOpen}
        onClose={() => {
          setAddModalOpen(false)
          setNewPortfolioName('')
        }}
        title={t.settingsPage.addSubPortfolio}
        maxWidth="max-w-md"
      >
        <div className="p-5 space-y-4">
          <div>
            <label className="input-label">{t.settingsPage.newPortfolioName}</label>
            <input
              type="text"
              className="input-field"
              placeholder={t.settingsPage.portfolioPlaceholder}
              value={newPortfolioName}
              onChange={(e) => setNewPortfolioName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              autoFocus
            />
          </div>
        </div>
        <div className="border-t border-border-subtle p-4 flex justify-end gap-2 bg-bg-secondary">
          <Button variant="ghost" onClick={() => { setAddModalOpen(false); setNewPortfolioName('') }}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleAdd} disabled={!newPortfolioName.trim()}>
            {t.common.add}
          </Button>
        </div>
      </Modal>

      {/* === RENAME MODAL === */}
      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title={t.settingsPage.renamePortfolio}
        maxWidth="max-w-md"
      >
        <div className="p-5 space-y-4">
          <div>
            <label className="input-label">{t.settingsPage.newPortfolioName}</label>
            <input
              type="text"
              className="input-field"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              autoFocus
            />
          </div>
        </div>
        <div className="border-t border-border-subtle p-4 flex justify-end gap-2 bg-bg-secondary">
          <Button variant="ghost" onClick={() => setRenameTarget(null)}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleRename} disabled={!renameValue.trim()}>
            {t.common.save}
          </Button>
        </div>
      </Modal>

      {/* === DELETE CONFIRM === */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t.settingsPage.deletePortfolio}
        message={
          deleteTarget && (txnsByPortfolio.get(deleteTarget.id) || 0) > 0
            ? ti(t.settingsPage.deleteWithTxns, { n: txnsByPortfolio.get(deleteTarget.id) })
            : t.settingsPage.deleteEmpty
        }
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        variant="danger"
      />

      {/* === RESET CONFIRM === */}
      <ConfirmDialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={resetToDefaults}
        title={t.settingsPage.resetDemo}
        message={t.settingsPage.resetDemoConfirm}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        variant="danger"
      />

      {/* === CLEAR CONFIRM === */}
      <ConfirmDialog
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={clearAllTransactions}
        title={t.settingsPage.clearAll}
        message={t.settingsPage.clearAllConfirm}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        variant="danger"
      />
    </div>
  )
}

// === Sub-components ===

function RefreshButton() {
  const { t } = useT()
  const refreshFxRates = usePortfolioStore((s) => s.refreshFxRates)
  const [refreshing, setRefreshing] = useState(false)

  const handleClick = async () => {
    setRefreshing(true)
    await refreshFxRates()
    setRefreshing(false)
  }

  return (
    <button
      onClick={handleClick}
      disabled={refreshing}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
        'bg-bg-tertiary border border-border-subtle text-text-secondary',
        'hover:bg-bg-elevated hover:text-text-primary hover:border-border-default',
        'transition-colors',
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
  )
}

function FxStatusBar() {
  const { t, lang } = useT()
  const fxMeta = usePortfolioStore((s) => s.settings.fxMeta) || {}

  const { fetchedAt, source, lastError, apiDate } = fxMeta
  const hasFetched = Boolean(fetchedAt)
  const veryStale = isVeryStale(fetchedAt)

  // Three visual states: error, manual/never, live (fresh or stale)
  let icon, iconColor, statusText, secondaryText

  if (lastError) {
    icon = AlertCircle
    iconColor = 'text-danger'
    statusText = t.settingsPage.refreshFailed
    secondaryText = lastError.length > 50 ? t.settingsPage.offlineHint : lastError
  } else if (!hasFetched || source === 'manual') {
    icon = AlertCircle
    iconColor = 'text-text-tertiary'
    statusText = t.settingsPage.ratesManual
    secondaryText = t.settingsPage.ratesSource
  } else {
    icon = veryStale ? AlertCircle : CheckCircle2
    iconColor = veryStale ? 'text-warning' : 'text-success'
    statusText = t.settingsPage.ratesLive
    secondaryText = `${t.settingsPage.lastUpdated}: ${formatRelativeTime(fetchedAt, lang)}${apiDate ? ` (${apiDate})` : ''}`
  }

  const Icon = icon

  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 bg-bg-tertiary/50 border border-border-subtle rounded-lg">
      <Icon size={14} strokeWidth={2} className={cn('shrink-0', iconColor)} />
      <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
        <span className="text-xs font-medium text-text-primary">{statusText}</span>
        <span className="text-2xs text-text-tertiary truncate">{secondaryText}</span>
      </div>
    </div>
  )
}

function RefreshPricesButton() {
  const { t, ti } = useT()
  const refreshPrices = usePortfolioStore((s) => s.refreshPrices)
  const [refreshing, setRefreshing] = useState(false)
  const [progress, setProgress] = useState({ source: '', current: 0, total: 0 })

  const handleClick = async () => {
    setRefreshing(true)
    setProgress({ source: '', current: 0, total: 0 })
    await refreshPrices((source, current, total) =>
      setProgress({ source, current, total })
    )
    setRefreshing(false)
  }

  // Translate the source key for display
  const getSourceLabel = (src) => {
    if (src === 'global') return 'Global'
    if (src === 'bist') return 'BIST'
    if (src === 'tefas') return 'TEFAS'
    return ''
  }

  return (
    <button
      onClick={handleClick}
      disabled={refreshing}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
        'bg-bg-tertiary border border-border-subtle text-text-secondary',
        'hover:bg-bg-elevated hover:text-text-primary hover:border-border-default',
        'transition-colors',
        'disabled:opacity-60 disabled:cursor-wait'
      )}
    >
      <RefreshCw
        size={11}
        strokeWidth={2.25}
        className={refreshing ? 'animate-spin' : ''}
      />
      {refreshing
        ? progress.total > 0
          ? ti(t.settingsPage.refreshingSource, {
              source: getSourceLabel(progress.source),
              current: progress.current,
              total: progress.total,
            })
          : t.settingsPage.refreshing
        : t.settingsPage.refreshPrices}
    </button>
  )
}

function PriceStatusBar() {
  const { t, ti, lang } = useT()
  const priceMeta = usePortfolioStore((s) => s.settings.priceMeta) || {}
  const apiKey = usePortfolioStore((s) => s.settings.finnhubApiKey)

  const { fetchedAt, lastError, lastErrorSymbols, sourceStats } = priceMeta

  // Determine top-line state
  let icon, iconColor, statusText, secondaryText

  if (lastError === 'INVALID_KEY') {
    icon = AlertCircle
    iconColor = 'text-danger'
    statusText = t.settingsPage.errInvalidKey
    secondaryText = t.settingsPage.finnhubKeyHint
  } else if (
    // Parenthesised deliberately: && binds tighter than ||, so the original
    // read correctly by luck rather than by intent.
    (lastError && /proxy|Failed to fetch|NetworkError|ECONNREFUSED/i.test(lastError)) ||
    lastError === 'Failed to fetch'
  ) {
    icon = AlertCircle
    iconColor = 'text-warning'
    statusText = t.settingsPage.refreshFailed
    secondaryText = t.settingsPage.errProxyOffline
  } else if (lastError === 'RATE_LIMIT') {
    icon = AlertCircle
    iconColor = 'text-warning'
    statusText = t.settingsPage.errRateLimit
    secondaryText = ''
  } else if (lastError === 'NO_API_KEY' || lastError === 'NO_API_KEY_GLOBAL') {
    // Special case — only global symbols failed because no key
    icon = AlertCircle
    iconColor = 'text-warning'
    statusText = t.settingsPage.noKeyState
    secondaryText = t.settingsPage.noKeyHint
  } else if (fetchedAt) {
    icon = CheckCircle2
    iconColor = 'text-success'
    statusText = t.settingsPage.pricesUpdated
    secondaryText = `${t.settingsPage.lastUpdated}: ${formatRelativeTime(fetchedAt, lang)}`
  } else {
    icon = AlertCircle
    iconColor = 'text-text-tertiary'
    statusText = t.settingsPage.ratesManual
    secondaryText = t.settingsPage.manualPricesNote
  }

  const Icon = icon

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-bg-tertiary/50 border border-border-subtle rounded-lg">
        <Icon size={14} strokeWidth={2} className={cn('shrink-0', iconColor)} />
        <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-medium text-text-primary">{statusText}</span>
          <span className="text-2xs text-text-tertiary truncate">{secondaryText}</span>
        </div>
      </div>

      {/* Per-source breakdown */}
      {sourceStats && Object.keys(sourceStats).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {sourceStats.global && (
            <SourceStatChip label={t.settingsPage.sourceGlobal} stat={sourceStats.global} t={t} ti={ti} />
          )}
          {sourceStats.bist && (
            <SourceStatChip label={t.settingsPage.sourceBist} stat={sourceStats.bist} t={t} ti={ti} />
          )}
          {sourceStats.tefas && (
            <SourceStatChip label={t.settingsPage.sourceTefas} stat={sourceStats.tefas} t={t} ti={ti} />
          )}
        </div>
      )}

      {lastErrorSymbols && lastErrorSymbols.length > 0 && (
        <div className="text-2xs text-warning px-1">
          {ti(t.settingsPage.somePricesFailed, { symbols: lastErrorSymbols.join(', ') })}
        </div>
      )}
    </div>
  )
}

function SourceStatChip({ label, stat, t, ti }) {
  const total = (stat.ok || 0) + (stat.failed || 0)
  const allOk = stat.failed === 0 && stat.ok > 0
  const hasError = stat.error || stat.failed > 0

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-2xs',
        allOk
          ? 'bg-success/5 border-success/20'
          : hasError
          ? 'bg-warning/5 border-warning/20'
          : 'bg-bg-tertiary border-border-subtle'
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          allOk ? 'bg-success' : hasError ? 'bg-warning' : 'bg-text-tertiary'
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-text-secondary truncate">{label}</div>
        <div className="text-text-tertiary tabular-nums">
          {ti(t.settingsPage.sourceStatsLine, { ok: stat.ok || 0, failed: stat.failed || 0 })}
        </div>
      </div>
    </div>
  )
}

// On/off plus the equity polling interval.
//
// Deliberately does NOT offer a fund interval. TEFAS publishes one price per
// evening, so any number the user could pick there would be either wasteful or
// meaningless — the note explains that rather than exposing a dial that cannot
// help. Per-source timestamps are shown instead, which is the thing you
// actually want to know when a price looks stale.
const REFRESH_CHOICES = [1, 5, 15, 30]

function AutoRefreshControl() {
  const { t, ti, lang } = useT()
  const enabled = usePortfolioStore((s) => s.settings.autoRefreshEnabled)
  const minutes = usePortfolioStore((s) => s.settings.autoRefreshMinutes) ?? 5
  const sourceFetchedAt = usePortfolioStore((s) => s.settings.priceMeta?.sourceFetchedAt)
  const sourceStats = usePortfolioStore((s) => s.settings.priceMeta?.sourceStats)
  const updateSettings = usePortfolioStore((s) => s.updateSettings)

  const SOURCE_LABELS = { bist: 'BIST', tefas: 'TEFAS', global: 'Global' }
  const stamps = Object.entries(SOURCE_LABELS).filter(([key]) => sourceFetchedAt?.[key])

  // The timestamp records an ATTEMPT, because the scheduler needs it either way
  // — without it a dead source would be retried in a tight loop. But "Global:
  // 1 min ago" next to "0 updated, 5 failed" reads as success, so a failed
  // attempt has to say so here rather than borrowing the look of a good one.
  const attemptFailed = (key) => {
    const stat = sourceStats?.[key]
    return Boolean(stat) && (stat.ok || 0) === 0 && ((stat.failed || 0) > 0 || stat.error)
  }

  return (
    <div className="rounded-lg border border-border-subtle p-3 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">{t.settingsPage.autoRefresh}</div>
          <div className="text-2xs text-text-tertiary mt-0.5">
            {t.settingsPage.autoRefreshDesc}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => updateSettings({ autoRefreshEnabled: !enabled })}
          className={cn(
            'relative w-11 h-6 rounded-full transition-colors shrink-0',
            enabled ? 'bg-accent' : 'bg-bg-elevated border border-border-default'
          )}
        >
          <span
            className={cn(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
              enabled ? 'left-6' : 'left-1'
            )}
          />
          <span className="sr-only">
            {enabled ? t.settingsPage.autoRefreshOn : t.settingsPage.autoRefreshOff}
          </span>
        </button>
      </div>

      {enabled && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xs text-text-tertiary">{t.settingsPage.autoRefreshEvery}</span>
            {REFRESH_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => updateSettings({ autoRefreshMinutes: m })}
                className={cn(
                  'px-2.5 py-1 rounded-md text-2xs font-medium border transition-colors tabular-nums',
                  minutes === m
                    ? 'bg-bg-elevated border-border-strong text-text-primary'
                    : 'bg-bg-tertiary border-border-subtle text-text-secondary hover:text-text-primary'
                )}
              >
                {ti(t.settingsPage.autoRefreshMinutes, { n: m })}
              </button>
            ))}
          </div>

          <p className="text-2xs text-text-tertiary leading-relaxed">
            {ti(t.settingsPage.autoRefreshNote, { n: minutes })}
          </p>

          {stamps.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-border-subtle">
              {stamps.map(([key, label]) => (
                <span key={key} className="text-2xs text-text-tertiary">
                  {label}:{' '}
                  <span className={attemptFailed(key) ? 'text-warning' : 'text-text-secondary'}>
                    {formatRelativeTime(sourceFetchedAt[key], lang)}
                    {attemptFailed(key) && ` · ${t.settingsPage.lastAttemptFailed}`}
                  </span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FinnhubKeyInput() {
  const { t } = useT()
  const apiKey = usePortfolioStore((s) => s.settings.finnhubApiKey) || ''
  const setFinnhubApiKey = usePortfolioStore((s) => s.setFinnhubApiKey)
  const [showKey, setShowKey] = useState(false)
  const [localKey, setLocalKey] = useState(apiKey)

  // Keep local in sync if changed externally
  useEffect(() => {
    setLocalKey(apiKey)
  }, [apiKey])

  const handleBlur = () => {
    if (localKey.trim() !== apiKey) {
      setFinnhubApiKey(localKey.trim())
    }
  }

  return (
    <div>
      <label className="input-label">{t.settingsPage.finnhubKeyLabel}</label>
      <div className="relative">
        <input
          type={showKey ? 'text' : 'password'}
          className="input-field font-mono text-xs pr-20"
          placeholder={t.settingsPage.finnhubKeyPlaceholder}
          value={localKey}
          onChange={(e) => setLocalKey(e.target.value)}
          onBlur={handleBlur}
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-2xs text-text-tertiary hover:text-text-primary transition-colors"
        >
          {showKey ? 'hide' : 'show'}
        </button>
      </div>
      <p className="text-2xs text-text-tertiary mt-1.5">
        {t.settingsPage.finnhubKeyHint}
      </p>
    </div>
  )
}

// Seeds the month-end archive behind the performance chart.
//
// Worth its own panel rather than a hidden action: until this has run, the
// chart values every past month at today's prices and therefore cannot slope
// down. The empty state says exactly that, because a chart that only goes up
// looks like good news rather than like missing data.
function PriceHistoryPanel() {
  const { t, ti, lang } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const priceHistory = usePortfolioStore((s) => s.priceHistory)
  const fxHistory = usePortfolioStore((s) => s.fxHistory)
  const historyMeta = usePortfolioStore((s) => s.settings.historyMeta) || {}
  const backfillHistory = usePortfolioStore((s) => s.backfillHistory)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)

  // Held symbols go in so coverage can name what it does NOT have. Counting
  // only what arrived would call a Yahoo-shaped hole a complete archive.
  const heldSymbols = useMemo(
    () => computeHoldings(transactions).map((h) => h.symbol),
    [transactions]
  )

  const coverage = useMemo(
    () => historyCoverage(priceHistory, fxHistory, heldSymbols),
    [priceHistory, fxHistory, heldSymbols]
  )

  // Group the stored failures by message: five symbols throttled by the same
  // source is one fact, not five.
  const failureReasons = useMemo(() => {
    const byReason = new Map()
    for (const entry of historyMeta.errors || []) {
      if (!entry?.error) continue
      const list = byReason.get(entry.error) || []
      list.push(entry.symbol)
      byReason.set(entry.error, list)
    }
    return [...byReason.entries()].map(([reason, syms]) => `${reason} (${syms.join(', ')})`)
  }, [historyMeta.errors])

  const run = async () => {
    setRunning(true)
    setProgress(null)
    await backfillHistory((type, done, total) => setProgress({ type, done, total }))
    setRunning(false)
    setProgress(null)
  }

  const label = { fx: 'FX', bist: 'BIST', tefas: 'TEFAS', global: 'Global' }

  return (
    <div className="rounded-lg border border-border-subtle p-3 space-y-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">
            {t.settingsPage.priceHistory}
          </div>
          <div className="text-2xs text-text-tertiary mt-0.5">
            {t.settingsPage.priceHistoryDesc}
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0',
            'bg-bg-tertiary border border-border-subtle text-text-secondary',
            'hover:bg-bg-elevated hover:text-text-primary hover:border-border-default',
            'transition-colors disabled:opacity-60 disabled:cursor-wait'
          )}
        >
          <Download size={11} strokeWidth={2.25} className={running ? 'animate-pulse' : ''} />
          {running
            ? progress
              ? `${label[progress.type] || ''} ${progress.done}/${progress.total}`
              : t.settingsPage.backfilling
            : t.settingsPage.backfill}
        </button>
      </div>

      {coverage.months === 0 ? (
        <p className="text-2xs text-warning leading-relaxed">{t.settingsPage.historyEmpty}</p>
      ) : (
        <p className="text-2xs text-text-tertiary tabular-nums">
          {ti(t.settingsPage.historyCoverage, {
            symbols: coverage.symbols,
            months: coverage.months,
            earliest: coverage.earliest,
            latest: coverage.latest,
            fxMonths: coverage.fxMonths,
          })}
        </p>
      )}

      {coverage.missing.length > 0 && (
        <>
          <p className="text-2xs text-warning leading-relaxed">
            {ti(t.settingsPage.historyMissing, { symbols: coverage.missing.join(', ') })}
          </p>
          {/* The reason matters more than the list. A rate limit means wait and
              retry; a bad symbol means fix the ticker; a dead source means find
              another one. Naming the symbols without naming the cause sends you
              to investigate the symbol, which is usually the innocent party. */}
          {failureReasons.length > 0 && (
            <p className="text-2xs text-text-tertiary leading-relaxed">
              {ti(t.settingsPage.historyReason, { reasons: failureReasons.join(' · ') })}
            </p>
          )}
        </>
      )}

      {historyMeta.backfilledAt && (
        <p className="text-2xs text-text-tertiary">
          {t.settingsPage.lastUpdated}: {formatRelativeTime(historyMeta.backfilledAt, lang)}
        </p>
      )}

      {historyMeta.errors?.length > 0 && (
        <p className="text-2xs text-warning">
          {ti(t.settingsPage.historyPartial, { symbols: historyMeta.errors.join(', ') })}
        </p>
      )}

      <p className="text-2xs text-text-tertiary leading-relaxed pt-1 border-t border-border-subtle">
        {t.settingsPage.historyNote}
      </p>
    </div>
  )
}

function PriceCacheTable() {
  const { t } = useT()
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const setManualPrice = usePortfolioStore((s) => s.setManualPrice)
  const transactions = usePortfolioStore((s) => s.transactions)

  // Only show symbols that the user actually holds
  const heldSymbols = useMemo(() => {
    const m = new Map()
    for (const tx of transactions) {
      if (tx.assetType === 'cash') continue
      const cur = m.get(tx.symbol) || { qty: 0, currency: tx.currency, assetType: tx.assetType }
      if (tx.type === 'buy') cur.qty += tx.quantity
      else if (tx.type === 'sell') cur.qty -= tx.quantity
      m.set(tx.symbol, cur)
    }
    return [...m.entries()]
      .filter(([_, v]) => v.qty > 0.0001)
      .map(([sym, v]) => ({ symbol: sym, ...v }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [transactions])

  if (heldSymbols.length === 0) {
    return (
      <div className="text-2xs text-text-tertiary text-center py-4">
        {t.settingsPage.noPricesYet}
      </div>
    )
  }

  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-text-tertiary font-medium mb-2">
        {t.settingsPage.priceCacheTitle}
      </div>
      <div className="space-y-1">
        {heldSymbols.map((h) => {
          const cached = priceCache[h.symbol]
          const price = cached?.price ?? 0
          const currency = cached?.currency ?? h.currency
          const isFromApi = cached?.fetchedAt && cached?.source !== 'manual'
          return (
            <div
              key={h.symbol}
              className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-subtle hover:border-border-default transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-text-primary">{h.symbol}</div>
                <div className="text-2xs text-text-tertiary">
                  {t.assets[h.assetType]}
                </div>
              </div>
              <PriceInput
                value={price}
                onCommit={(val) => setManualPrice(h.symbol, val, currency)}
              />
              <span className="text-2xs text-text-tertiary w-8">{currency}</span>
              {isFromApi && (
                <Badge variant="success" className="text-2xs shrink-0">
                  live
                </Badge>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// A manual price field that keeps what you typed until you leave it.
//
// Writing straight to the store on every keystroke made "1." impossible to
// type — parseFloat('1.') is 1, which was written back and re-rendered over the
// cursor — and hammered localStorage on the way. Local state while editing,
// one write on blur or Enter.
function PriceInput({ value, onCommit }) {
  const [draft, setDraft] = useState(String(value ?? ''))
  const [editing, setEditing] = useState(false)

  // Adopt refreshed prices from the API, but never yank the field mid-edit.
  useEffect(() => {
    if (!editing) setDraft(String(value ?? ''))
  }, [value, editing])

  const commit = () => {
    setEditing(false)
    const parsed = parseFloat(draft)
    const next = isFinite(parsed) && parsed >= 0 ? parsed : 0
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <input
      type="number"
      step="any"
      min="0"
      className="input-field tabular-nums text-right w-32 py-1 text-xs"
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(String(value ?? ''))
          setEditing(false)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function FxRateInput({ ccy, value, onChange, label }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary text-sm font-mono">
          1 {ccy} =
        </span>
        <input
          type="number"
          step="0.0001"
          min="0"
          className="input-field pl-[5.5rem] tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-sm">
          ₺
        </span>
      </div>
    </div>
  )
}

function ColorSwatch({ color, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-5 h-5 rounded-full ring-2 ring-offset-2 ring-offset-bg-secondary transition-all hover:scale-110"
        style={{ background: color, '--tw-ring-color': 'var(--border-default)' }}
        aria-label="Change color"
      />
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-7 left-0 z-50 bg-bg-elevated border border-border-default rounded-lg p-2 shadow-xl">
            <div className="grid grid-cols-4 gap-1.5">
              {PORTFOLIO_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    onChange(c)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-6 h-6 rounded-full transition-all hover:scale-110 flex items-center justify-center',
                    color === c && 'ring-2 ring-offset-2 ring-offset-bg-elevated ring-text-primary'
                  )}
                  style={{ background: c }}
                >
                  {color === c && <Check size={10} strokeWidth={3} className="text-white" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function DangerAction({ icon: Icon, title, description, onClick, variant = 'default' }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-4 p-3 rounded-lg border text-left transition-colors',
        variant === 'danger'
          ? 'border-danger/20 hover:bg-danger/5 hover:border-danger/40'
          : 'border-border-subtle hover:bg-bg-tertiary hover:border-border-default'
      )}
    >
      <div
        className={cn(
          'shrink-0 w-9 h-9 rounded-lg flex items-center justify-center',
          variant === 'danger' ? 'bg-danger/10 text-danger' : 'bg-bg-tertiary text-text-secondary'
        )}
      >
        <Icon size={16} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-medium', variant === 'danger' ? 'text-danger' : 'text-text-primary')}>
          {title}
        </div>
        <div className="text-2xs text-text-tertiary mt-0.5">{description}</div>
      </div>
    </button>
  )
}

function ExportBackupActions() {
  const { t, ti } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const priceHistory = usePortfolioStore((s) => s.priceHistory)
  const fxHistory = usePortfolioStore((s) => s.fxHistory)
  const settings = usePortfolioStore((s) => s.settings)
  const restoreFromBackup = usePortfolioStore((s) => s.restoreFromBackup)

  const fileInputRef = useRef(null)
  const [restoreConfirm, setRestoreConfirm] = useState(null) // { data, summary } or null
  const [restoreError, setRestoreError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const handleExportJson = () => {
    exportJsonBackup({ transactions, subPortfolios, priceCache, priceHistory, fxHistory, settings })
  }

  const handleExportCsv = () => {
    exportTransactionsCsv(transactions, subPortfolios)
  }

  const handlePickFile = () => {
    setRestoreError(null)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting same file later
    if (!file) return
    try {
      const text = await file.text()
      const result = parseJsonBackup(text)
      if (result.ok) {
        setRestoreConfirm(result)
      } else {
        setRestoreError(result.error)
      }
    } catch (err) {
      setRestoreError(err.message || 'Failed to read file')
    }
  }

  const handleRestoreConfirm = () => {
    if (!restoreConfirm) return
    // Download the current state first. Restore replaces everything and has no
    // undo, so the one thing that must not depend on the user having thought
    // ahead is being able to get back.
    exportJsonBackup({ transactions, subPortfolios, priceCache, priceHistory, fxHistory, settings })
    restoreFromBackup(restoreConfirm.data)
    setSuccessMessage(
      ti(t.settingsPage.restoreSuccess, {
        n: restoreConfirm.summary.transactions,
        p: restoreConfirm.summary.portfolios,
      })
    )
    setRestoreConfirm(null)
    setTimeout(() => setSuccessMessage(null), 4000)
  }

  return (
    <div className="space-y-2">
      <ExportAction
        icon={FileJson}
        title={t.settingsPage.exportJson}
        description={t.settingsPage.exportJsonDesc}
        onClick={handleExportJson}
      />
      <ExportAction
        icon={FileText}
        title={t.settingsPage.exportCsv}
        description={t.settingsPage.exportCsvDesc}
        onClick={handleExportCsv}
      />
      <ExportAction
        icon={Upload}
        title={t.settingsPage.restoreBackup}
        description={t.settingsPage.restoreBackupDesc}
        onClick={handlePickFile}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {restoreError && (
        <div className="text-2xs text-danger px-3 py-2 bg-danger/5 border border-danger/20 rounded-lg flex items-center gap-2">
          <AlertCircle size={12} strokeWidth={2} />
          {t.settingsPage.restoreFailed}: {restoreError}
        </div>
      )}

      {successMessage && (
        <div className="text-2xs text-success px-3 py-2 bg-success/5 border border-success/20 rounded-lg flex items-center gap-2">
          <CheckCircle2 size={12} strokeWidth={2} />
          {successMessage}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(restoreConfirm)}
        onClose={() => setRestoreConfirm(null)}
        onConfirm={handleRestoreConfirm}
        title={t.settingsPage.restoreBackup}
        message={[
          t.settingsPage.restoreConfirm,
          restoreConfirm?.summary?.dropped
            ? ti(t.settingsPage.restoreDropped, {
                n: restoreConfirm.summary.dropped,
                total: restoreConfirm.summary.dropped + restoreConfirm.summary.transactions,
              })
            : null,
          // Name the offending fields. "3 rows could not be read" is a dead
          // end; "3 rows: date, quantity" tells you what to fix in the file.
          restoreConfirm?.issues?.length
            ? ti(t.settingsPage.restoreProblems, {
                list: [...new Set(restoreConfirm.issues.flatMap((i) => i.problems))].join(', '),
              })
            : null,
          t.settingsPage.restoreKeepsRates,
          t.settingsPage.restoreSafetyCopy,
        ]
          .filter(Boolean)
          .join('\n\n')}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        variant="danger"
      />
    </div>
  )
}

function ExportAction({ icon: Icon, title, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-3 rounded-lg border border-border-subtle hover:bg-bg-tertiary hover:border-border-default transition-colors text-left"
    >
      <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-bg-tertiary text-text-secondary">
        <Icon size={16} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        <div className="text-2xs text-text-tertiary mt-0.5">{description}</div>
      </div>
      <Download size={13} strokeWidth={1.75} className="text-text-tertiary shrink-0" />
    </button>
  )
}
