// Surfaces the checks from computeDataWarnings().
//
// These are not app errors — they are "your data says something impossible"
// notices. Each one used to be invisible: negative cash was clamped to zero,
// an over-sold position simply vanished, a missing price masqueraded as a
// perfectly flat 0.00% P/L. Every line here should tell the user what is wrong
// AND what to do about it.

import { useMemo, useState } from 'react'
import { AlertTriangle, X as XIcon } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import { computeDataWarnings } from '../lib/calculations.js'
import { formatCurrency } from '../lib/currency.js'

export function DataWarnings({ portfolioId = null }) {
  const { t, ti } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const fxRates = usePortfolioStore((s) => s.settings.fxRates)
  const [dismissed, setDismissed] = useState(false)

  const scoped = useMemo(
    () => (portfolioId ? transactions.filter((tx) => tx.portfolioId === portfolioId) : transactions),
    [transactions, portfolioId]
  )

  const warnings = useMemo(
    () => computeDataWarnings(scoped, priceCache, fxRates),
    [scoped, priceCache, fxRates]
  )

  const messages = useMemo(() => {
    const portfolioName = (id) => subPortfolios.find((p) => p.id === id)?.name || id

    // Missing prices are collapsed into one line — a dead data source takes out
    // every symbol at once, and twenty identical rows is noise, not signal.
    const missing = warnings.filter((w) => w.code === 'missing_price').map((w) => w.symbol)
    const out = []

    for (const w of warnings) {
      if (w.code === 'negative_cash') {
        out.push({
          key: `neg-${w.portfolioId}`,
          text: ti(t.warnings.negativeCash, {
            portfolio: portfolioName(w.portfolioId),
            amount: formatCurrency(Math.abs(w.amountTRY), 'TRY', { decimals: 0 }),
          }),
        })
      } else if (w.code === 'oversold') {
        out.push({
          key: `over-${w.portfolioId}-${w.symbol}`,
          text: ti(t.warnings.oversold, {
            symbol: w.symbol,
            portfolio: portfolioName(w.portfolioId),
          }),
        })
      } else if (w.code === 'mixed_currency') {
        out.push({
          key: `ccy-${w.symbol}`,
          text: ti(t.warnings.mixedCurrency, {
            symbol: w.symbol,
            currencies: w.currencies.join(' + '),
            first: w.currencies[0],
          }),
        })
      }
    }

    if (missing.length === 1) {
      out.push({ key: 'price', text: ti(t.warnings.missingPrice, { symbol: missing[0] }) })
    } else if (missing.length > 1) {
      out.push({
        key: 'price',
        text: ti(t.warnings.missingPriceMany, { symbols: missing.join(', ') }),
      })
    }

    return out
  }, [warnings, subPortfolios, t, ti])

  if (dismissed || messages.length === 0) return null

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} strokeWidth={2} className="text-warning shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-warning">{t.warnings.title}</div>
          <p className="text-xs text-text-tertiary mt-0.5">{t.warnings.subtitle}</p>
          <ul className="mt-2.5 space-y-1.5">
            {messages.map((m) => (
              <li key={m.key} className="text-xs text-text-secondary leading-relaxed flex gap-2">
                <span className="text-warning/60 select-none">·</span>
                <span>{m.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 p-1 -m-1 rounded text-text-tertiary hover:text-text-primary transition-colors"
          aria-label={t.warnings.dismiss}
          title={t.warnings.dismiss}
        >
          <XIcon size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
