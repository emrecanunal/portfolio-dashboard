import { useState, useMemo, useEffect } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowDownLeft, ArrowUpRight, Sparkles, ArrowLeftRight } from 'lucide-react'
import { useT } from '../../i18n/useT.js'
import { usePortfolioStore } from '../../lib/store.js'
import { computePortfolioSummary } from '../../lib/calculations.js'
import { convertToTRY, formatCurrency, formatFxRate, quoteFxRate } from '../../lib/currency.js'
import { Modal } from '../ui/Modal.jsx'
import { Button } from '../ui/Primitives.jsx'
import { cn } from '../../lib/utils.js'

const TYPE_OPTIONS = [
  { value: 'buy', icon: ArrowDown, color: 'success' },
  { value: 'sell', icon: ArrowUp, color: 'danger' },
  { value: 'deposit', icon: ArrowDownLeft, color: 'info' },
  { value: 'withdraw', icon: ArrowUpRight, color: 'warning' },
  { value: 'exchange', icon: ArrowLeftRight, color: 'accent' },
]

const ASSET_TYPE_OPTIONS = ['bist', 'tefas', 'global']
const CURRENCY_OPTIONS = ['TRY', 'USD', 'EUR']

// Modal supports two modes:
//   open mode (no editing) — pass existingTxn={null}
//   edit mode               — pass existingTxn={transactionObject}
//
// `defaultPortfolioId` pre-selects a specific sub-portfolio when opening from
// a portfolio detail page. The user can still change it via the dropdown.
export function AddTransactionModal({ open, onClose, existingTxn = null, defaultPortfolioId = null }) {
  const { t } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const settings = usePortfolioStore((s) => s.settings)
  const addTransaction = usePortfolioStore((s) => s.addTransaction)
  const updateTransaction = usePortfolioStore((s) => s.updateTransaction)

  const isEdit = Boolean(existingTxn)

  const [form, setForm] = useState(() => initialForm(subPortfolios, existingTxn, defaultPortfolioId))
  const [confirmedCashWarning, setConfirmedCashWarning] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [priceAutofilled, setPriceAutofilled] = useState(false)

  // Reset form whenever the modal opens or the txn-being-edited changes
  useEffect(() => {
    if (open) {
      setForm(initialForm(subPortfolios, existingTxn, defaultPortfolioId))
      setConfirmedCashWarning(false)
      setSubmitError('')
      setPriceAutofilled(false)
    }
  }, [open, existingTxn, subPortfolios, defaultPortfolioId])

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

  // Keep the FX pair valid: if the source currency is switched onto the target,
  // push the target to the first remaining currency so the <select> never ends
  // up on a value that was filtered out of its own option list.
  useEffect(() => {
    if (form.type !== 'exchange') return
    if (form.currency !== form.toCurrency) return
    const next = CURRENCY_OPTIONS.find((c) => c !== form.currency)
    if (next) setForm((prev) => ({ ...prev, toCurrency: next }))
  }, [form.type, form.currency, form.toCurrency])

  // === Estimated total ===
  // For an exchange this is the amount leaving the source currency — the
  // conversion itself is value-neutral, so there is nothing else to total up.
  const txnLocalTotal = useMemo(() => {
    const qty = parseFloat(form.quantity) || 0
    if (form.type === 'exchange') return qty
    const price = parseFloat(form.price) || 0
    const fee = parseFloat(form.fee) || 0
    return qty * price + fee
  }, [form.type, form.quantity, form.price, form.fee])

  const txnTotalTRY = useMemo(
    () => convertToTRY(txnLocalTotal, form.currency, settings.fxRates),
    [txnLocalTotal, form.currency, settings.fxRates]
  )

  const impliedQuote = useMemo(
    () =>
      form.type === 'exchange'
        ? quoteFxRate(form.quantity, form.toAmount, form.currency, form.toCurrency)
        : null,
    [form.type, form.quantity, form.toAmount, form.currency, form.toCurrency]
  )

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

    const toAmount = parseFloat(form.toAmount)
    if (form.type === 'exchange') {
      if (!qty || !toAmount) {
        setSubmitError(t.txn.pleaseFillRequired)
        return
      }
      if (form.currency === form.toCurrency) {
        setSubmitError(t.txn.exchangeSameCurrency)
        return
      }
    }

    if (cashWarning && !confirmedCashWarning) return

    const isCashMove = form.type === 'deposit' || form.type === 'withdraw'

    let tx
    if (form.type === 'exchange') {
      tx = {
        date: form.date,
        type: 'exchange',
        // Cash-class so computeHoldings skips it and it never becomes a position.
        assetType: 'cash',
        symbol: `${form.currency}→${form.toCurrency}`,
        quantity: qty,       // amount debited, denominated in `currency`
        price: 1,            // keeps quantity × price = the source amount for the
                             // generic total/sort code paths in the txn table
        fee: 0,              // no separate fee — the FX cost lives in the rate
        currency: form.currency,
        toAmount,            // amount credited, denominated in `toCurrency`
        toCurrency: form.toCurrency,
        portfolioId: form.portfolioId,
        notes: form.notes,
      }
    } else {
      tx = {
        date: form.date,
        type: form.type,
        assetType: isCashMove ? 'cash' : form.assetType,
        symbol: isCashMove ? 'CASH' : form.symbol.toUpperCase(),
        quantity: isCashMove ? 1 : qty,
        price,
        fee: parseFloat(form.fee) || 0,
        currency: form.currency,
        portfolioId: form.portfolioId,
        notes: form.notes,
      }
      // updateTransaction shallow-merges, so an exchange retyped as something
      // else would keep stale FX fields unless we explicitly clear them.
      if (isEdit && existingTxn.type === 'exchange') {
        tx.toAmount = null
        tx.toCurrency = null
      }
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
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
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

        {/* Currency exchange — convert between TRY / USD / EUR within a portfolio */}
        {form.type === 'exchange' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">{t.txn.fromAmount} *</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="input-field tabular-nums"
                  value={form.quantity}
                  onChange={(e) => update({ quantity: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="input-label">{t.txn.fromCurrency}</label>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">{t.txn.toAmount} *</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="input-field tabular-nums"
                  value={form.toAmount}
                  onChange={(e) => update({ toAmount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="input-label">{t.txn.toCurrency}</label>
                <select
                  className="input-field"
                  value={form.toCurrency}
                  onChange={(e) => update({ toCurrency: e.target.value })}
                >
                  {CURRENCY_OPTIONS.filter((c) => c !== form.currency).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Implied rate hint — always quoted in the ≥ 1 direction, so a
                TRY→USD conversion reads "1 USD = 47.9120 TRY". */}
            {impliedQuote && (
              <div className="bg-bg-tertiary rounded-lg p-3 text-xs text-text-tertiary flex items-center justify-between">
                <span>{t.txn.impliedRate}</span>
                <span className="text-text-secondary tabular-nums">
                  1 {impliedQuote.base} = {formatFxRate(impliedQuote.rate)} {impliedQuote.quote}
                </span>
              </div>
            )}
            {/* No fee field: an FX conversion's cost is already baked into the
                rate the user types, so a separate fee would double-count it. */}
            <p className="text-2xs text-text-tertiary leading-relaxed">{t.txn.exchangeHint}</p>
          </>
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
                  ({formatCurrency(txnLocalTotal, form.currency, { decimals: 2 })})
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

function initialForm(subPortfolios, existingTxn, defaultPortfolioId = null) {
  if (existingTxn) {
    return {
      date: existingTxn.date,
      type: existingTxn.type,
      assetType: existingTxn.assetType === 'cash' ? 'bist' : existingTxn.assetType,
      // 'CASH' and the "TRY→USD" pair label are synthetic — never show them in
      // the symbol field, or retyping the txn would carry them into a position.
      symbol:
        existingTxn.symbol === 'CASH' || existingTxn.type === 'exchange'
          ? ''
          : existingTxn.symbol,
      quantity: String(existingTxn.quantity || ''),
      price: String(existingTxn.price || ''),
      fee: String(existingTxn.fee || ''),
      currency: existingTxn.currency || 'TRY',
      toAmount: String(existingTxn.toAmount || ''),
      toCurrency: existingTxn.toCurrency || 'USD',
      portfolioId: existingTxn.portfolioId,
      notes: existingTxn.notes || '',
    }
  }
  // Pre-select the caller's portfolio if it still exists; fall back to first.
  const preferred = defaultPortfolioId && subPortfolios.some((p) => p.id === defaultPortfolioId)
    ? defaultPortfolioId
    : subPortfolios[0]?.id || ''
  return {
    date: new Date().toISOString().slice(0, 10),
    type: 'buy',
    assetType: 'bist',
    symbol: '',
    quantity: '',
    price: '',
    fee: '',
    currency: 'TRY',
    toAmount: '',
    toCurrency: 'USD',
    portfolioId: preferred,
    notes: '',
  }
}
