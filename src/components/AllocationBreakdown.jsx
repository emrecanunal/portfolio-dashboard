// Asset-category breakdown card. Sits between the Allocation donut and the
// Recent Transactions section. Each category (TL/Cash, BIST, TEFAS, Global)
// renders as a collapsible row with value, daily change and share %.
// Tapping the chevron expands the row to list the individual positions
// inside that category, sorted by market value (largest first).

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useT } from '../i18n/useT.js'
import { formatCurrency, formatPercent, formatSignedCurrency } from '../lib/currency.js'
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody } from './ui/Primitives.jsx'
import { cn } from '../lib/utils.js'

// Match the colour palette already in AllocationDonut so the visual language
// stays consistent across the donut and these rows.
const CATEGORY_COLORS = {
  bist: '#3b82f6',
  global: '#10b981',
  tefas: '#a855f7',
  cash: '#71717a',
}

function PositionsCount({ n, t, ti }) {
  if (n === 1) return <>{t.dashboard.onePosition}</>
  return <>{ti(t.dashboard.positions, { n })}</>
}

function ChangeChip({ amount, pct }) {
  // Cash has no day-change; skip the chip entirely so the row stays clean.
  if (amount === 0 && pct === 0) return null
  const positive = amount > 0
  const negative = amount < 0
  return (
    <div className="flex items-center gap-1.5 text-2xs tabular-nums shrink-0">
      <span className={cn(positive && 'text-success', negative && 'text-danger', !positive && !negative && 'text-text-tertiary')}>
        {formatSignedCurrency(amount, 'TRY', { decimals: 0 })}
      </span>
      <span
        className={cn(
          'px-1.5 py-0.5 rounded-md',
          positive && 'bg-success/15 text-success',
          negative && 'bg-danger/15 text-danger',
          !positive && !negative && 'bg-bg-tertiary text-text-tertiary'
        )}
      >
        {formatPercent(pct, { withSign: true, decimals: 1 })}
      </span>
    </div>
  )
}

function HoldingRow({ h }) {
  const positive = h.dayChangeTRY > 0
  const negative = h.dayChangeTRY < 0
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-tertiary/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-text-primary truncate">{h.symbol}</div>
        <div className="text-2xs text-text-tertiary tabular-nums">
          {h.qty.toLocaleString('en-US', { maximumFractionDigits: 4 })} × {formatCurrency(h.currentPrice, h.currency, { decimals: 2 })}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs text-text-primary tabular-nums">
          {formatCurrency(h.marketValueTRY, 'TRY', { decimals: 0 })}
        </div>
        {(positive || negative) && (
          <div className={cn('text-2xs tabular-nums', positive && 'text-success', negative && 'text-danger')}>
            {formatSignedCurrency(h.dayChangeTRY, 'TRY', { decimals: 0 })} · {formatPercent(h.dayChangePct, { withSign: true, decimals: 1 })}
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryRow({ entry, expanded, onToggle, t, ti }) {
  const color = CATEGORY_COLORS[entry.key] || '#71717a'
  const label = t.assets[entry.key] || entry.key
  const isCash = entry.key === 'cash'
  const expandable = !isCash && entry.holdings && entry.holdings.length > 0

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      expanded ? 'border-border-default bg-bg-tertiary/40' : 'border-border-subtle'
    )}>
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 text-left',
          expandable ? 'cursor-pointer hover:bg-bg-tertiary/40' : 'cursor-default'
        )}
        aria-expanded={expanded}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: color }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">{label}</div>
          <div className="text-2xs text-text-tertiary tabular-nums">
            {entry.pct.toFixed(1)}%
            {expandable && (
              <>
                {' · '}
                <PositionsCount n={entry.holdings.length} t={t} ti={ti} />
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base text-text-primary tabular-nums font-medium">
            {formatCurrency(entry.value, 'TRY', { decimals: 0 })}
          </div>
          {!isCash && (
            <div className="mt-0.5">
              <ChangeChip amount={entry.dayChangeTRY} pct={entry.dayChangePct} />
            </div>
          )}
        </div>
        {expandable && (
          <ChevronDown
            size={16}
            className={cn(
              'text-text-tertiary shrink-0 transition-transform duration-200',
              expanded && 'rotate-180'
            )}
          />
        )}
      </button>
      {expandable && expanded && (
        <div className="px-2 pb-3 pt-1 border-t border-border-subtle/60 space-y-0.5">
          {entry.holdings.map((h) => (
            <HoldingRow key={h.symbol} h={h} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AllocationBreakdown({ allocation }) {
  const { t, ti } = useT()
  const [expandedKey, setExpandedKey] = useState(null)

  if (!allocation || allocation.length === 0) {
    return null
  }

  // Display order: BIST → TEFAS → Global → Cash (mirrors typical Turkish broker UIs).
  const ORDER = ['bist', 'tefas', 'global', 'cash']
  const sorted = [...allocation].sort(
    (a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
  )

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t.dashboard.assetBreakdown}</CardTitle>
          <CardSubtitle>{t.dashboard.assetBreakdownDesc}</CardSubtitle>
        </div>
      </CardHeader>
      <CardBody>
        <div className="space-y-2">
          {sorted.map((entry) => (
            <CategoryRow
              key={entry.key}
              entry={entry}
              expanded={expandedKey === entry.key}
              onToggle={() => setExpandedKey((k) => (k === entry.key ? null : entry.key))}
              t={t}
              ti={ti}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
