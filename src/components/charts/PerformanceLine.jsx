import { CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, XAxis, YAxis } from 'recharts'
import { useEffect, useState } from 'react'
import { formatCurrency } from '../../lib/currency.js'
import { usePortfolioStore } from '../../lib/store.js'

function useThemeColors() {
  const theme = usePortfolioStore((s) => s.settings.theme)
  const [colors, setColors] = useState({ tooltipBg: '#1a1a1f', grid: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)', textTertiary: '#71717a' })

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement)
    setColors({
      tooltipBg: styles.getPropertyValue('--tooltip-bg').trim() || '#1a1a1f',
      grid: styles.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,0.04)',
      border: styles.getPropertyValue('--border-default').trim() || 'rgba(255,255,255,0.1)',
      textTertiary: styles.getPropertyValue('--text-tertiary').trim() || '#71717a',
    })
  }, [theme])

  return colors
}

export function PerformanceLine({ data }) {
  const colors = useThemeColors()

  if (!data || data.length === 0) {
    return <div className="h-[240px] flex items-center justify-center text-text-tertiary text-sm">No data</div>
  }

  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="label" stroke={colors.textTertiary} fontSize={11} tickLine={false} axisLine={false} />
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
            formatter={(v) => [formatCurrency(v, 'TRY'), 'Value']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#perfGradient)"
            dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: 'var(--accent)', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
