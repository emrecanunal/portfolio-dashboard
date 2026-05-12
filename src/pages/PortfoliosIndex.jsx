import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import { usePortfolioStore } from '../lib/store.js'
import { useT } from '../i18n/useT.js'
import { computePortfolioSummary } from '../lib/calculations.js'
import { formatCurrency, formatPercent, formatSignedCurrency } from '../lib/currency.js'
import { Card, CardBody } from '../components/ui/Primitives.jsx'

export default function PortfoliosIndex() {
  const { t } = useT()
  const transactions = usePortfolioStore((s) => s.transactions)
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const priceCache = usePortfolioStore((s) => s.priceCache)
  const settings = usePortfolioStore((s) => s.settings)

  // Master totals (for share-of-portfolio calc)
  const masterSummary = useMemo(
    () => computePortfolioSummary(transactions, priceCache, settings.fxRates),
    [transactions, priceCache, settings.fxRates]
  )

  const subSummaries = useMemo(
    () =>
      subPortfolios.map((p) => {
        const s = computePortfolioSummary(transactions, priceCache, settings.fxRates, p.id)
        return {
          ...p,
          ...s,
          shareOfTotal: masterSummary.totalValue > 0 ? (s.totalValue / masterSummary.totalValue) * 100 : 0,
        }
      }),
    [subPortfolios, transactions, priceCache, settings.fxRates, masterSummary.totalValue]
  )

  return (
    <div className="space-y-6">
      <div>
        <p className="text-2xs uppercase tracking-widest text-text-tertiary mb-1">
          {subPortfolios.length} {t.nav.portfolios.toLowerCase()}
        </p>
        <h1 className="text-3xl font-medium text-text-primary">{t.nav.portfolios}</h1>
        <p className="text-sm text-text-tertiary mt-1">{t.dashboard.clickToDrillIn}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {subSummaries.map((p) => (
          <Link
            key={p.id}
            to={`/portfolios/${p.id}`}
            className="group"
          >
            <Card className="hover:border-border-default transition-all">
              <CardBody className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                    <span className="text-base font-medium text-text-primary">{p.name}</span>
                  </div>
                  <ArrowRight
                    size={14}
                    className="text-text-tertiary group-hover:text-text-primary group-hover:translate-x-0.5 transition-all"
                  />
                </div>

                {/* Total value */}
                <div className="text-2xl font-medium text-text-primary tabular-nums mb-1">
                  {formatCurrency(p.totalValue, 'TRY', { compact: true, decimals: 2 })}
                </div>
                <div className="text-xs text-text-tertiary tabular-nums mb-4">
                  {p.shareOfTotal.toFixed(1)}% {t.dashboard.ofTotal}
                </div>

                {/* P/L */}
                <div className="flex items-center gap-1.5 text-sm tabular-nums pt-3 border-t border-border-subtle">
                  {p.totalPL >= 0 ? (
                    <TrendingUp size={12} className="text-success" />
                  ) : (
                    <TrendingDown size={12} className="text-danger" />
                  )}
                  <span className={p.totalPL >= 0 ? 'text-success' : 'text-danger'}>
                    {formatSignedCurrency(p.totalPL, 'TRY', { compact: true, decimals: 1 })}
                  </span>
                  <span className="text-text-tertiary">
                    · {formatPercent(p.plPct, { withSign: true })}
                  </span>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
