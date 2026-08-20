// Portfolio value over time, optionally against the money actually paid in.
//
// The gap between the two lines IS the growth — for a FIRE tracker that is the
// single most useful thing this chart can say, and it reads at a glance without
// anyone doing arithmetic.
//
// Both series are lira, so they share ONE axis. Two y-scales on one plot would
// let the chart invent a relationship that isn't in the data.
//
// Series colours come from --chart-series-1/2 rather than --accent: they have
// to clear the OKLCH lightness band, the chroma floor and colour-vision
// separation against each surface, and --accent does not. See index.css.
//
// Reconstructed months are drawn as hollow rings and counted in a caption. A
// month whose price had to be inferred is a weaker claim than one we recorded,
// and the chart should not present the two identically.

import {
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
} from 'recharts'
import { useEffect, useState } from 'react'
import { formatCurrency } from '../../lib/currency.js'
import { usePortfolioStore } from '../../lib/store.js'
import { useT } from '../../i18n/useT.js'

function useThemeColors() {
  const theme = usePortfolioStore((s) => s.settings.theme)
  const [colors, setColors] = useState({
    tooltipBg: '#1a1a1f',
    grid: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.1)',
    textTertiary: '#71717a',
    series1: '#059669',
    series2: '#3b82f6',
    surface: '#111114',
  })

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement)
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback
    setColors({
      tooltipBg: read('--tooltip-bg', '#1a1a1f'),
      grid: read('--chart-grid', 'rgba(255,255,255,0.04)'),
      border: read('--border-default', 'rgba(255,255,255,0.1)'),
      textTertiary: read('--text-tertiary', '#71717a'),
      series1: read('--chart-series-1', '#059669'),
      series2: read('--chart-series-2', '#3b82f6'),
      surface: read('--bg-secondary', '#111114'),
    })
  }, [theme])

  return colors
}

// Solid dot for a month we recorded, hollow ring for one we reconstructed.
// The ring is filled with the surface colour so it stays legible where the two
// lines cross.
function ValueDot({ cx, cy, payload, fill, surface }) {
  if (cx == null || cy == null) return null
  const estimated = payload?.estimated
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={estimated ? surface : fill}
      stroke={fill}
      strokeWidth={estimated ? 1.5 : 0}
    />
  )
}

export function PerformanceLine({ data, showContributions = true }) {
  const colors = useThemeColors()
  const { t, ti } = useT()

  if (!data || data.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center text-text-tertiary text-sm">
        {t.dashboard.noChartData}
      </div>
    )
  }

  const estimatedCount = data.filter((d) => d.estimated).length
  const last = data[data.length - 1]

  const seriesLabel = {
    value: t.dashboard.seriesValue,
    contributed: t.dashboard.seriesContributed,
  }

  return (
    <div>
      {/* Legend, always present with two series — identity must never rest on
          colour alone. It doubles as the endpoint direct-label, so the two
          numbers that matter most are readable without hovering anything. */}
      <div className="flex items-center gap-4 flex-wrap mb-2 text-2xs">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: colors.series1 }}
          />
          <span className="text-text-secondary">{seriesLabel.value}</span>
          <span className="text-text-primary tabular-nums font-medium">
            {formatCurrency(last.value, 'TRY', { compact: true, decimals: 1 })}
          </span>
        </span>
        {showContributions && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: colors.series2 }}
            />
            <span className="text-text-secondary">{seriesLabel.contributed}</span>
            <span className="text-text-primary tabular-nums font-medium">
              {formatCurrency(last.contributed ?? 0, 'TRY', { compact: true, decimals: 1 })}
            </span>
          </span>
        )}
      </div>

      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.series1} stopOpacity={0.22} />
                <stop offset="100%" stopColor={colors.series1} stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* Solid hairline: a dashed grid reads as "threshold" or
                "projection" when it is only a grid. */}
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="label"
              stroke={colors.textTertiary}
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke={colors.textTertiary}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatCurrency(v, 'TRY', { compact: true, decimals: 1 })}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: colors.tooltipBg,
                border: `1px solid ${colors.border}`,
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelFormatter={(label, payload) => {
                const row = payload?.[0]?.payload
                return row?.estimated ? `${label} · ${t.dashboard.reconstructed}` : label
              }}
              formatter={(v, key) => [formatCurrency(v, 'TRY'), seriesLabel[key] || key]}
            />
            {showContributions && (
              <Line
                type="monotone"
                dataKey="contributed"
                stroke={colors.series2}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: colors.series2, stroke: colors.surface, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={colors.series1}
              strokeWidth={2}
              fill="url(#perfGradient)"
              dot={<ValueDot fill={colors.series1} surface={colors.surface} />}
              activeDot={{ r: 5, fill: colors.series1, stroke: colors.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {estimatedCount > 0 && (
        <p className="text-2xs text-text-tertiary mt-2 leading-relaxed">
          {ti(t.dashboard.reconstructedNote, { n: estimatedCount })}
        </p>
      )}
    </div>
  )
}
