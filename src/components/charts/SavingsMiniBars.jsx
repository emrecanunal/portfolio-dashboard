import { useEffect, useState } from 'react'
import { BarChart, Bar, ResponsiveContainer, Tooltip, Cell, XAxis } from 'recharts'
import { formatCurrency } from '../../lib/currency.js'
import { usePortfolioStore } from '../../lib/store.js'

// Compact 6-month savings bar chart. Last bar is highlighted as "current month".
export function SavingsMiniBars({ data }) {
  const theme = usePortfolioStore((s) => s.settings.theme)
  const [colors, setColors] = useState({ tooltipBg: '#1a1a1f', border: 'rgba(255,255,255,0.1)', textTertiary: '#71717a' })

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement)
    setColors({
      tooltipBg: styles.getPropertyValue('--tooltip-bg').trim() || '#1a1a1f',
      border: styles.getPropertyValue('--border-default').trim() || 'rgba(255,255,255,0.1)',
      textTertiary: styles.getPropertyValue('--text-tertiary').trim() || '#71717a',
    })
  }, [theme])

  if (!data || data.length === 0) return null

  // Truncate to a positive value for display only — negatives still show
  const lastIndex = data.length - 1

  return (
    <div className="h-16 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="20%">
          <XAxis dataKey="label" stroke={colors.textTertiary} fontSize={9} tickLine={false} axisLine={false} interval={0} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              fontSize: '11px',
              padding: '6px 10px',
            }}
            formatter={(v) => [formatCurrency(v, 'TRY', { compact: true, decimals: 1 }), 'Savings']}
            labelFormatter={() => ''}
          />
          <Bar dataKey="savingsTRY" radius={[3, 3, 0, 0]}>
            {data.map((entry, i) => {
              const isCurrent = i === lastIndex
              const isPositive = entry.savingsTRY >= 0
              let fill
              if (isPositive) {
                fill = isCurrent ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 35%, transparent)'
              } else {
                fill = isCurrent ? 'var(--danger)' : 'color-mix(in srgb, var(--danger) 35%, transparent)'
              }
              return <Cell key={i} fill={fill} />
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
