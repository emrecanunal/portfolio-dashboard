import { useMemo, useState, useEffect, useRef } from 'react'
import { Plus, Pencil, Trash2, RotateCcw, Eraser, Check, X as XIcon, RefreshCw, AlertCircle, CheckCircle2, Download, Upload, FileText, FileJson } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import { formatRelativeTime, isStale, isVeryStale } from '../lib/fxApi.js'
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
          <FinnhubKeyInput />
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
  } else if (lastError && lastError.includes('proxy') || lastError === 'Failed to fetch') {
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
              <input
                type="number"
                step="any"
                min="0"
                className="input-field tabular-nums text-right w-32 py-1 text-xs"
                value={price}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0
                  setManualPrice(h.symbol, val, currency)
                }}
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
          step="0.01"
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
  const settings = usePortfolioStore((s) => s.settings)
  const restoreFromBackup = usePortfolioStore((s) => s.restoreFromBackup)

  const fileInputRef = useRef(null)
  const [restoreConfirm, setRestoreConfirm] = useState(null) // { data, summary } or null
  const [restoreError, setRestoreError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const handleExportJson = () => {
    exportJsonBackup({ transactions, subPortfolios, priceCache, settings })
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
        message={t.settingsPage.restoreConfirm}
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
