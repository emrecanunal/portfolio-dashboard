import { useMemo, useState } from 'react'
import { Plus, Search, Pencil, Trash2, ArrowUpDown, ArrowUp, ArrowDown, ArrowRight, X as XIcon } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { scopeTransactions } from '../lib/calculations.js'
import { useT } from '../i18n/useT.js'
import { convertToTRY, formatCurrency, formatFxRate, formatSignedCurrency, quoteFxRate } from '../lib/currency.js'
import { Card, CardBody, Button, Badge } from '../components/ui/Primitives.jsx'
import { AddTransactionModal } from '../components/modals/AddTransactionModal.jsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { cn } from '../lib/utils.js'
import { useMediaQuery, NARROW } from '../lib/useMediaQuery.js'

const TYPE_FILTERS = ['all', 'buy', 'sell', 'deposit', 'withdraw', 'exchange', 'transfer']

export default function Transactions() {
  const { t, ti } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const settings = usePortfolioStore((s) => s.settings)
  const deleteTransaction = usePortfolioStore((s) => s.deleteTransaction)
  // Cards or table — chosen here rather than with `md:hidden`, so only one
  // of the two is ever built. See useMediaQuery.js for why that matters at
  // several hundred transactions.
  const isNarrow = useMediaQuery(NARROW)

  // === UI state ===
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [portfolioFilter, setPortfolioFilter] = useState('all')
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingTxn, setEditingTxn] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  // === Filtering + sorting ===
  const filtered = useMemo(() => {
    let list = [...transactions]

    if (typeFilter !== 'all') {
      list = list.filter((tx) => tx.type === typeFilter)
    }
    if (portfolioFilter !== 'all') {
      // Gelen transfer de bu portföyün kaydı: parayı o aldı. Süzgeç yalnızca
      // tx.portfolioId'ye baksaydı, hedef portföyün listesinde bakiyeyi
      // açıklayan satır hiç görünmezdi.
      list = scopeTransactions(list, portfolioFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (tx) =>
          tx.symbol.toLowerCase().includes(q) ||
          (tx.notes || '').toLowerCase().includes(q)
      )
    }

    list.sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'date':
          av = a.date; bv = b.date
          break
        case 'type':
          av = a.type; bv = b.type
          break
        case 'symbol':
          av = a.symbol; bv = b.symbol
          break
        case 'portfolio': {
          const pa = subPortfolios.find((p) => p.id === a.portfolioId)?.name || ''
          const pb = subPortfolios.find((p) => p.id === b.portfolioId)?.name || ''
          av = pa; bv = pb
          break
        }
        case 'qty':
          av = a.quantity; bv = b.quantity
          break
        case 'price':
          av = a.price; bv = b.price
          break
        case 'total':
          av = convertToTRY(a.quantity * a.price + (a.fee || 0), a.currency, settings.fxRates)
          bv = convertToTRY(b.quantity * b.price + (b.fee || 0), b.currency, settings.fxRates)
          break
        case 'fee':
          av = convertToTRY(a.fee || 0, a.currency, settings.fxRates)
          bv = convertToTRY(b.fee || 0, b.currency, settings.fxRates)
          break
        default:
          av = a.date; bv = b.date
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [transactions, typeFilter, portfolioFilter, search, sortKey, sortDir, subPortfolios, settings.fxRates])

  // === Aggregates over the filtered set ===
  const aggregates = useMemo(() => {
    let bought = 0, sold = 0, fees = 0
    for (const tx of filtered) {
      const totalLocal = (tx.quantity || 0) * (tx.price || 0)
      const totalTRY = convertToTRY(totalLocal, tx.currency, settings.fxRates)
      const feeTRY = convertToTRY(tx.fee || 0, tx.currency, settings.fxRates)
      fees += feeTRY
      if (tx.type === 'buy') bought += totalTRY
      if (tx.type === 'sell') sold += totalTRY
    }
    return { count: filtered.length, bought, sold, fees }
  }, [filtered, settings.fxRates])

  // === Sort header click ===
  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'date' ? 'desc' : 'asc')
    }
  }

  // === Filter reset ===
  const hasFilters = search || typeFilter !== 'all' || portfolioFilter !== 'all'
  const resetFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setPortfolioFilter('all')
  }

  // === Open edit modal ===
  const openEdit = (tx) => {
    setEditingTxn(tx)
    setModalOpen(true)
  }
  const openAdd = () => {
    setEditingTxn(null)
    setModalOpen(true)
  }
  const closeModal = () => {
    setModalOpen(false)
    setEditingTxn(null)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-2xs uppercase tracking-widest text-text-tertiary mb-1">
            {ti(t.transactions.subtitle, { n: transactions.length })}
          </p>
          <h1 className="text-3xl font-medium text-text-primary">{t.transactions.title}</h1>
        </div>
        <Button onClick={openAdd}>
          <span className="flex items-center gap-1.5">
            <Plus size={14} strokeWidth={2.25} />
            {t.dashboard.addTransaction}
          </span>
        </Button>
      </div>

      {/* Filters bar */}
      <Card>
        <CardBody className="p-4 pt-4 space-y-3">
          {/* Search + portfolio filter row */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.transactions.searchPlaceholder}
                className="input-field pl-9"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>

            <select
              value={portfolioFilter}
              onChange={(e) => setPortfolioFilter(e.target.value)}
              className="input-field w-auto cursor-pointer"
            >
              <option value="all">{t.transactions.allPortfolios}</option>
              {subPortfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {hasFilters && (
              <button
                onClick={resetFilters}
                className="text-xs text-text-tertiary hover:text-text-primary px-2 py-1 transition-colors"
              >
                {t.common.reset}
              </button>
            )}
          </div>

          {/* Type filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={cn(
                  'tap px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                  typeFilter === f
                    ? 'bg-bg-elevated border-border-strong text-text-primary'
                    : 'bg-bg-tertiary border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-default'
                )}
              >
                {f === 'all' ? t.transactions.filterAll : t.txn[f]}
              </button>
            ))}
          </div>

          {/* Sorting lives in the table header, which the phone does not show.
              Without this the cards would be stuck on whatever the last sort
              was, and a control that silently disappears on one device is
              worse than one that was never there. */}
          <div className="md:hidden flex items-center gap-2">
            <label className="text-2xs uppercase tracking-wider text-text-tertiary shrink-0">
              {t.transactions.sortBy}
            </label>
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value)
                setSortDir(e.target.value === 'date' ? 'desc' : 'asc')
              }}
              className="input-field w-auto flex-1 cursor-pointer"
            >
              <option value="date">{t.transactions.colDate}</option>
              <option value="type">{t.transactions.colType}</option>
              <option value="symbol">{t.transactions.colSymbol}</option>
              <option value="portfolio">{t.transactions.colPortfolio}</option>
              <option value="total">{t.transactions.colTotal}</option>
            </select>
            <button
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              className="tap-icon p-2 rounded-lg border border-border-subtle text-text-secondary active:bg-bg-tertiary transition-colors"
              aria-label={t.transactions.sortDirection}
              title={t.transactions.sortDirection}
            >
              {sortDir === 'asc' ? <ArrowUp size={14} strokeWidth={2} /> : <ArrowDown size={14} strokeWidth={2} />}
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Table */}
      <Card>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <EmptyState hasFilters={hasFilters} t={t} />
          ) : (
            /* PHONE: one card per transaction.
               The table is ten columns and about 900px wide. Inside a 358px
               viewport it scrolls sideways, which means reading one
               transaction takes two swipes and the edit and delete buttons
               sit permanently off-screen. Same data, stacked. */
            isNarrow ? (
            <ul className="divide-y divide-border-subtle/50">
              {filtered.map((tx) => (
                <TransactionCard
                  key={tx.id}
                  tx={tx}
                  subPortfolio={subPortfolios.find((p) => p.id === tx.portfolioId)}
                  toPortfolio={tx.toPortfolioId ? subPortfolios.find((p) => p.id === tx.toPortfolioId) : null}
                  totalTRY={convertToTRY(tx.quantity * tx.price + (tx.fee || 0), tx.currency, settings.fxRates)}
                  t={t}
                  onEdit={() => openEdit(tx)}
                  onDelete={() => setDeleteTarget(tx)}
                />
              ))}
            </ul>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-2xs uppercase tracking-wider text-text-tertiary border-b border-border-subtle bg-bg-secondary">
                    <SortHeader label={t.transactions.colDate} sortKey="date" current={sortKey} dir={sortDir} onClick={handleSort} />
                    <SortHeader label={t.transactions.colType} sortKey="type" current={sortKey} dir={sortDir} onClick={handleSort} />
                    <SortHeader label={t.transactions.colSymbol} sortKey="symbol" current={sortKey} dir={sortDir} onClick={handleSort} />
                    <SortHeader label={t.transactions.colPortfolio} sortKey="portfolio" current={sortKey} dir={sortDir} onClick={handleSort} />
                    <SortHeader label={t.transactions.colQty} sortKey="qty" current={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                    <SortHeader label={t.transactions.colPrice} sortKey="price" current={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                    <SortHeader label={t.transactions.colTotal} sortKey="total" current={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                    <SortHeader label={t.transactions.colFee} sortKey="fee" current={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                    <th className="text-left font-medium px-3 py-3">{t.transactions.colNotes}</th>
                    <th className="w-20 px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx) => {
                    const subPortfolio = subPortfolios.find((p) => p.id === tx.portfolioId)
                    const toPortfolio = tx.toPortfolioId
                      ? subPortfolios.find((p) => p.id === tx.toPortfolioId)
                      : null
                    const totalLocal = tx.quantity * tx.price + (tx.fee || 0)
                    const totalTRY = convertToTRY(totalLocal, tx.currency, settings.fxRates)
                    return (
                      <tr key={tx.id} className="group border-b border-border-subtle/50 hover:bg-bg-tertiary/40 transition-colors">
                        <td className="px-3 py-3 text-text-secondary tabular-nums whitespace-nowrap">{tx.date}</td>
                        <td className="px-3 py-3">
                          <Badge variant={typeBadgeVariant(tx.type)}>{t.txn[tx.type]}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-mono text-xs text-text-primary">{tx.symbol}</div>
                          {tx.assetType !== 'cash' && (
                            <div className="text-2xs text-text-tertiary mt-0.5">{t.assets[tx.assetType]}</div>
                          )}
                          {tx.type === 'exchange' && (
                            <div className="text-2xs text-text-tertiary mt-0.5 tabular-nums">
                              → {formatCurrency(tx.toAmount || 0, tx.toCurrency || 'USD', { decimals: 2 })}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-text-secondary whitespace-nowrap">
                          {/* Transferin İKİ ucu birden yazılıyor. Tek uç yazılırken
                              hedefe süzülmüş listede satır kaynağın adını taşıyordu
                              ve "bu para nereden geldi" cevapsız kalıyordu. */}
                          <span className="inline-flex items-center gap-1.5">
                            <PortfolioTag p={subPortfolio} />
                            {toPortfolio && (
                              <>
                                <ArrowRight size={11} className="text-text-tertiary shrink-0" />
                                <PortfolioTag p={toPortfolio} />
                              </>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-text-primary">
                          {tx.type === 'exchange'
                            ? formatCurrency(tx.quantity, tx.currency, { decimals: 2 })
                            : tx.assetType === 'cash'
                              ? '—'
                              : formatNum(tx.quantity)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-text-primary whitespace-nowrap">
                          {/* For an exchange the stored price is a placeholder 1 —
                              show the rate the two amounts imply, quoted in the
                              readable direction (1 USD = 47.9120 TRY). */}
                          {tx.type === 'exchange' ? (
                            (() => {
                              const q = quoteFxRate(tx.quantity, tx.toAmount, tx.currency, tx.toCurrency)
                              if (!q) return '—'
                              return (
                                <>
                                  <div>{formatFxRate(q.rate)}</div>
                                  {/* Base first, per FX convention: USD/TRY
                                      reads as "1 USD costs this many TRY". */}
                                  <div className="text-2xs text-text-tertiary mt-0.5">
                                    {q.base}/{q.quote}
                                  </div>
                                </>
                              )
                            })()
                          ) : (
                            formatCurrency(tx.price, tx.currency, { decimals: 2 })
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-text-primary whitespace-nowrap">
                          {formatCurrency(totalTRY, 'TRY', { decimals: 0 })}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-text-tertiary whitespace-nowrap">
                          {tx.fee ? formatCurrency(tx.fee, tx.currency, { decimals: 0 }) : '—'}
                        </td>
                        <td className="px-3 py-3 text-text-tertiary text-xs max-w-[180px] truncate" title={tx.notes}>
                          {tx.notes || ''}
                        </td>
                        <td className="px-3 py-3">
                          <div className="row-actions justify-end">
                            <button
                              onClick={() => openEdit(tx)}
                              className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                              aria-label={t.common.edit}
                              title={t.common.edit}
                            >
                              <Pencil size={13} strokeWidth={1.75} />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(tx)}
                              className="p-1.5 rounded text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
                              aria-label={t.common.delete}
                              title={t.common.delete}
                            >
                              <Trash2 size={13} strokeWidth={1.75} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )
          )}
        </CardBody>
      </Card>

      {/* Aggregates footer */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <FooterStat label={ti(t.transactions.footerCount, { n: aggregates.count })} value="" />
          <FooterStat label={t.transactions.footerBought} value={formatCurrency(aggregates.bought, 'TRY', { compact: true, decimals: 1 })} valueClass="text-success" />
          <FooterStat label={t.transactions.footerSold} value={formatCurrency(aggregates.sold, 'TRY', { compact: true, decimals: 1 })} valueClass="text-danger" />
          <FooterStat label={t.transactions.footerFees} value={formatCurrency(aggregates.fees, 'TRY', { decimals: 0 })} valueClass="text-text-secondary" />
        </div>
      )}

      {/* Modals */}
      <AddTransactionModal open={modalOpen} onClose={closeModal} existingTxn={editingTxn} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteTransaction(deleteTarget.id)}
        title={t.common.delete}
        message={t.transactions.deleteConfirm}
        confirmLabel={t.transactions.deleteAction}
        cancelLabel={t.common.cancel}
        variant="danger"
      />
    </div>
  )
}

function SortHeader({ label, sortKey, current, dir, onClick, align = 'left' }) {
  const isActive = current === sortKey
  const Icon = !isActive ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      className={cn(
        'font-medium px-3 py-3 cursor-pointer select-none whitespace-nowrap',
        'hover:text-text-primary transition-colors',
        align === 'right' ? 'text-right' : 'text-left',
        isActive && 'text-text-primary'
      )}
      onClick={() => onClick(sortKey)}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}
        <Icon size={10} strokeWidth={2} className={isActive ? 'text-accent' : 'text-text-muted'} />
      </span>
    </th>
  )
}

function FooterStat({ label, value, valueClass = 'text-text-primary' }) {
  return (
    <div className="bg-bg-secondary border border-border-subtle rounded-xl p-3">
      <div className="text-2xs uppercase tracking-wider text-text-tertiary font-medium">{label}</div>
      {value && <div className={cn('text-base font-medium tabular-nums mt-1', valueClass)}>{value}</div>}
    </div>
  )
}

function EmptyState({ hasFilters, t }) {
  return (
    <div className="py-16 px-5 text-center">
      <div className="display-font text-4xl text-text-tertiary mb-2 italic">
        {hasFilters ? '~' : 'soon'}
      </div>
      <div className="text-sm font-medium text-text-primary mb-1">
        {hasFilters ? t.transactions.noMatches : t.transactions.empty}
      </div>
      <div className="text-xs text-text-tertiary">
        {hasFilters ? t.transactions.tryAdjusting : t.transactions.emptyHint}
      </div>
    </div>
  )
}

// One transaction as a card. Everything the table row carries, arranged for a
// column instead of a line: identity and date on the left, the number that
// matters on the right, and the controls under it where the thumb already is.
function PortfolioTag({ p }) {
  if (!p) return <span className="text-text-tertiary">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
      {p.name}
    </span>
  )
}

function TransactionCard({ tx, subPortfolio, toPortfolio, totalTRY, t, onEdit, onDelete }) {
  const detail =
    tx.type === 'exchange'
      ? `${formatCurrency(tx.quantity, tx.currency, { decimals: 2 })} → ${formatCurrency(tx.toAmount || 0, tx.toCurrency || 'USD', { decimals: 2 })}`
      : tx.assetType === 'cash'
        ? null
        : `${formatNum(tx.quantity)} × ${formatCurrency(tx.price, tx.currency, { decimals: 2 })}`

  return (
    <li className="group px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={typeBadgeVariant(tx.type)}>{t.txn[tx.type]}</Badge>
            <span className="font-mono text-xs text-text-primary">{tx.symbol}</span>
            <span className="text-2xs text-text-tertiary tabular-nums">{tx.date}</span>
          </div>

          {detail && (
            <div className="mt-1 text-2xs text-text-secondary tabular-nums">{detail}</div>
          )}

          <div className="mt-1 flex items-center gap-2 flex-wrap text-2xs text-text-tertiary">
            <span className="inline-flex items-center gap-1.5">
              <PortfolioTag p={subPortfolio} />
              {toPortfolio && (
                <>
                  <ArrowRight size={10} className="text-text-tertiary shrink-0" />
                  <PortfolioTag p={toPortfolio} />
                </>
              )}
            </span>
            {tx.assetType !== 'cash' && <span>{t.assets[tx.assetType]}</span>}
            {tx.fee ? (
              <span className="tabular-nums">
                {t.transactions.colFee} {formatCurrency(tx.fee, tx.currency, { decimals: 0 })}
              </span>
            ) : null}
          </div>

          {tx.notes && <div className="mt-1 text-2xs text-text-tertiary truncate">{tx.notes}</div>}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1">
          <div className="text-sm font-medium tabular-nums text-text-primary whitespace-nowrap">
            {formatCurrency(totalTRY, 'TRY', { decimals: 0 })}
          </div>
          <div className="row-actions justify-end">
            <button
              onClick={onEdit}
              className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
              aria-label={t.common.edit}
            >
              <Pencil size={14} strokeWidth={1.75} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
              aria-label={t.common.delete}
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

function typeBadgeVariant(type) {
  return { buy: 'success', sell: 'danger', deposit: 'info', withdraw: 'warning', exchange: 'accent' }[type] || 'default'
}

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 10_000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}
