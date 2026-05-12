import { useState, useMemo, useEffect } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowDownLeft, ArrowUpRight, Sparkles } from 'lucide-react'
import { useT } from '../../i18n/useT.js'
import { usePortfolioStore } from '../../lib/store.js'
import { computePortfolioSummary } from '../../lib/calculations.js'
import { convertToTRY, formatCurrency } from '../../lib/currency.js'
import { Modal } from '../ui/Modal.jsx'
import { Button } from '../ui/Primitives.jsx'
import { cn } from '../../lib/utils.js'

const TYPE_OPTIONS = [
  { value: 'buy', icon: ArrowDown, color: 'success' },
  { value: 'sell', icon: ArrowUp, color: 'danger' },
  { value: 'deposit', icon: ArrowDownLeft, color: 'info' },
  { value: 'withdraw', icon: ArrowUpRight, color: 'warning' },
]

const ASSET_TYPE_OPTIONS = ['bist', 'tefas', 'global']
const CURRENCY_OPTIONS = ['TRY', 'USD', 'EUR']

// Modal supports two modes:
//   open mode (no editing) — pass existingTxn={null}
//   edit mode               — pass existingTxn={transactionObject}
export function AddTransactionModal({ open, onClose, existingTxn = null }) {
  const { t } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const settings = usePortfolioStore((s) => s.settings)
  const addTransaction = usePortfolioStore((s) => s.addTransaction)
  const updateTransaction = usePortfolioStore((s) => s.updateTransaction)

  const isEdit = Boolean(existingTxn)

  const [form, setForm] = useState(() => initialForm(subPortfolios, existingTxn))
  const [confirmedCashWarning, setConfirmedCashWarning] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [priceAutofilled, setPriceAutofilled] = useState(false)

  // Reset form whenever the modal opens or the txn-being-edited changes
  useEffect(() => {
    if (open) {
      setForm(initialForm(subPortfolios, existingTxn))
      setConfirmedCashWarning(false)
      setSubmitError('')
      setPriceAutofilled(false)
    }
  }, [open, existingTxn, subPortfolios])

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }))

  // === PRICE AUTOFILL from priceCache when symbol matches ===
  // When user types a known symbol and price is empty, auto-fill the price.
  // Once user edits the price, autofill won't override it again.
  useEffect(() => {
    if (form.type !== 'buy' && form.type !== 'sell') return
    const sym = form.symbol.trim().toUpperCase()
    if (!sym) {
      setPriceAutofilled(false)
      return
    }
    const cached = priceCache[sym]
    if (cached && (form.price === '' || priceAutofilled)) {
      // Auto-fill — but mark as autofilled so we know we may overwrite next time
      setForm((prev) => ({ ...prev, price: String(cached.price), currency: cached.currency }))
      setPriceAutofilled(true)
    }
  }, [form.symbol, form.type, priceCache])

  // If user manually changes the price, stop overriding it
  const handlePriceChange = (val) => {
    setPriceAutofilled(false)
    update({ price: val })
  }

  // === Estimated total in TRY ===
  const txnTotalTRY = useMemo(() => {
    const qty = parseFloat(form.quantity) || 0
    const price = parseFloat(form.price) || 0
    const fee = parseFloat(form.fee) || 0
    const local = qty * price + fee
    return convertToTRY(local, form.currency, settings.fxRates)
  }, [form.quantity, form.price, form.fee, form.currency, settings.fxRates])

  // === Cash warning (only for buys, only when adding NEW txn) ===
  const cashWarning = useMemo(() => {
    if (form.type !== 'buy') return null
    if (isEdit) return null  // skip in edit mode for now — too complex to back out & reapply

    const currentSummary = computePortfolioSummary(transactions, priceCache, settings.fxRates)
    const currentCash = currentSummary.cashTotal
    const totalValue = currentSummary.totalValue

    if (totalValue === 0) return null
    const projectedCash = currentCash - txnTotalTRY
    const currentCashPct = (currentCash / totalValue) * 100
    const projectedCashPct = (projectedCash / totalValue) * 100

    if (projectedCashPct < settings.cashThresholdPct && txnTotalTRY > 0) {
      return {
        currentPct: currentCashPct,
        projectedPct: projectedCashPct,
        projectedCash,
        threshold: settings.cashThresholdPct,
      }
    }
    return null
  }, [form.type, txnTotalTRY, transactions, priceCache, settings, isEdit])

  // === Submit ===
  const handleSubmit = () => {
    setSubmitError('')

    const qty = parseFloat(form.quantity)
    const price = parseFloat(form.price)
    if (!form.date || !form.type || !form.portfolioId) {
      setSubmitError(t.txn.pleaseFillRequired)
      return
    }
    if (form.type === 'buy' || form.type === 'sell') {
      if (!form.symbol || !form.assetType || !qty || !price) {
        setSubmitError(t.txn.pleaseFillRequired)
        return
      }
    }
    if (form.type === 'deposit' || form.type === 'withdraw') {
      if (!price) {
        setSubmitError(t.txn.pleaseFillRequired)
        return
      }
    }

    if (cashWarning && !confirmedCashWarning) return

    const tx = {
      date: form.date,
      type: form.type,
      assetType: form.type === 'deposit' || form.type === 'withdraw' ? 'cash' : form.assetType,
      symbol: form.type === 'deposit' || form.type === 'withdraw' ? 'CASH' : form.symbol.toUpperCase(),
      quantity: form.type === 'deposit' || form.type === 'withdraw' ? 1 : qty,
      price,
      fee: parseFloat(form.fee) || 0,
      currency: form.currency,
      portfolioId: form.portfolioId,
      notes: form.notes,
    }

    if (isEdit) {
      updateTransaction(existingTxn.id, tx)
    } else {
      addTransaction(tx)
    }
    onClose?.()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t.txn.editTransaction : t.txn.newTransaction}
      maxWidth="max-w-xl"
    >
      <div className="p-5 space-y-5">
        {/* Type selector */}
        <div>
          <div className="input-label">{t.txn.transactionType}</div>
          <div className="grid grid-cols-4 gap-1.5">
            {TYPE_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const isActive = form.type === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update({ type: opt.value })}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs font-medium transition-all',
                    !isActive && 'bg-bg-tertiary border-border-subtle text-text-secondary hover:border-border-default'
                  )}
                  style={
                    isActive
                      ? {
                          background: `color-mix(in srgb, var(--${opt.color}) 12%, transparent)`,
                          borderColor: `color-mix(in srgb, var(--${opt.color}) 40%, transparent)`,
                          color: `var(--${opt.color})`,
                        }
                      : undefined
                  }
                >
                  <Icon size={14} strokeWidth={2} />
                  {t.txn[opt.value]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Date + Sub-portfolio */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">{t.txn.date} *</label>
            <input
              type="date"
              className="input-field"
              value={form.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          </div>
          <div>
            <label className="input-label">{t.txn.addToPortfolio} *</label>
            <select
              className="input-field"
              value={form.portfolioId}
              onChange={(e) => update({ portfolioId: e.target.value })}
            >
              {subPortfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Asset fields — buy/sell */}
        {(form.type === 'buy' || form.type === 'sell') && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">{t.txn.assetType} *</label>
                <select
                  className="input-field"
                  value={form.assetType}
                  onChange={(e) => update({ assetType: e.target.value })}
                >
                  {ASSET_TYPE_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {t.assets[a]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="input-label">{t.txn.assetSymbol} *</label>
                <input
                  type="text"
                  className="input-field font-mono uppercase"
                  placeholder={t.txn.placeholderSymbol}
                  value={form.symbol}
                  onChange={(e) => update({ symbol: e.target.value.toUpperCase() })}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="input-label">{t.txn.quantity} *</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="input-field tabular-nums"
                  value={form.quantity}
                  onChange={(e) => update({ quantity: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="input-label flex items-center gap-1">
                  {t.txn.price} *
                  {priceAutofilled && (
                    <span title={t.txn.priceHint} className="text-accent">
                      <Sparkles size={11} strokeWidth={2.5} />
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  className={cn(
                    'input-field tabular-nums',
                    priceAutofilled && 'border-accent/40'
                  )}
                  value={form.price}
                  onChange={(e) => handlePriceChange(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="input-label">{t.txn.currency}</label>
                <select
                  className="input-field"
                  value={form.currency}
                  onChange={(e) => update({ currency: e.target.value })}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="input-label">{t.txn.fee}</label>
              <input
                type="number"
                step="any"
                min="0"
                className="input-field tabular-nums"
                value={form.fee}
                onChange={(e) => update({ fee: e.target.value })}
                placeholder="0"
              />
            </div>
          </>
        )}

        {/* Cash flow — deposit/withdraw */}
        {(form.type === 'deposit' || form.type === 'withdraw') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">{t.txn.amount} *</label>
              <input
                type="number"
                step="any"
                min="0"
                className="input-field tabular-nums"
                value={form.price}
                onChange={(e) => update({ price: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="input-label">{t.txn.currency}</label>
              <select
                className="input-field"
                value={form.currency}
                onChange={(e) => update({ currency: e.target.value })}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="input-label">{t.txn.notes}</label>
          <textarea
            className="input-field resize-none"
            rows={2}
            placeholder={t.txn.placeholderNotes}
            value={form.notes}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </div>

        {/* Total preview */}
        {txnTotalTRY > 0 && (
          <div className="bg-bg-tertiary rounded-lg p-3 flex items-center justify-between text-sm">
            <span className="text-text-tertiary">{t.txn.estimatedTotal}</span>
            <span className="text-text-primary font-medium tabular-nums">
              {formatCurrency(txnTotalTRY, 'TRY', { decimals: 2 })}
              {form.currency !== 'TRY' && (
                <span className="text-xs text-text-tertiary ml-2">
                  ({formatCurrency((parseFloat(form.quantity) || 0) * (parseFloat(form.price) || 0) + (parseFloat(form.fee) || 0), form.currency, { decimals: 2 })})
                </span>
              )}
            </span>
          </div>
        )}

        {/* Cash warning */}
        {cashWarning && (
          <CashWarningBox
            warning={cashWarning}
            confirmed={confirmedCashWarning}
            onConfirm={setConfirmedCashWarning}
          />
        )}

        {submitError && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-sm text-danger">
            {submitError}
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle p-4 flex justify-end gap-2 bg-bg-secondary">
        <Button variant="ghost" onClick={onClose}>
          {t.common.cancel}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={cashWarning && !confirmedCashWarning}
          className={cn(cashWarning && !confirmedCashWarning && 'opacity-50 cursor-not-allowed')}
        >
          {t.common.save}
        </Button>
      </div>
    </Modal>
  )
}

function CashWarningBox({ warning, confirmed, onConfirm }) {
  const { t, ti } = useT()
  return (
    <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" strokeWidth={2} />
        <div>
          <div className="text-sm font-medium text-warning mb-1">{t.txn.cashWarning}</div>
          <p className="text-xs text-text-secondary leading-relaxed">
            {ti(t.txn.cashWarningBody, {
              current: warning.currentPct.toFixed(1),
              projected: warning.projectedPct.toFixed(1),
              threshold: warning.threshold,
            })}
          </p>
          <div className="text-2xs text-text-tertiary mt-2 tabular-nums">
            {t.txn.cashAfterTxn}: {formatCurrency(warning.projectedCash, 'TRY', { decimals: 0 })}
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-warning/20">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirm(e.target.checked)}
          className="w-4 h-4 rounded border-border-strong cursor-pointer accent-warning"
        />
        <span className="text-xs text-text-secondary select-none">{t.txn.confirmCheckbox}</span>
      </label>
    </div>
  )
}

function initialForm(subPortfolios, existingTxn) {
  if (existingTxn) {
    return {
      date: existingTxn.date,
      type: existingTxn.type,
      assetType: existingTxn.assetType === 'cash' ? 'bist' : existingTxn.assetType,
      symbol: existingTxn.symbol === 'CASH' ? '' : existingTxn.symbol,
      quantity: String(existingTxn.quantity || ''),
      price: String(existingTxn.price || ''),
      fee: String(existingTxn.fee || ''),
      currency: existingTxn.currency || 'TRY',
      portfolioId: existingTxn.portfolioId,
      notes: existingTxn.notes || '',
    }
  }
  return {
    date: new Date().toISOString().slice(0, 10),
    type: 'buy',
    assetType: 'bist',
    symbol: '',
    quantity: '',
    price: '',
    fee: '',
    currency: 'TRY',
    portfolioId: subPortfolios[0]?.id || '',
    notes: '',
  }
}
