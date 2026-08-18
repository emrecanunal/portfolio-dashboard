import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { useEffect, useState } from 'react'
import { useT } from '../../i18n/useT.js'
import { usePortfolioStore } from '../../lib/store.js'

const COLORS = {
  bist: '#3b82f6',
  global: '#10b981',
  tefas: '#a855f7',
  cash: '#71717a',
  cash_TRY: '#6b7280',
  cash_USD: '#9ca3af',
  cash_EUR: '#a3a3a3',
}

// Derive a friendly slice label that handles per-currency cash buckets.
function labelFor(entry, t) {
  if (entry.key?.startsWith('cash_')) {
    return `${t.assets.cash} (${entry.currency || entry.key.replace('cash_', '')})`
  }
  return t.assets[entry.key] || entry.key
}

export function AllocationDonut({ allocation }) {
  const { t } = useT()
  const theme = usePortfolioStore((s) => s.settings.theme)
  const [tooltipColors, setTooltipColors] = useState({ bg: '#1a1a1f', border: 'rgba(255,255,255,0.1)' })

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement)
    setTooltipColors({
      bg: styles.getPropertyValue('--tooltip-bg').trim() || '#1a1a1f',
      border: styles.getPropertyValue('--border-default').trim() || 'rgba(255,255,255,0.1)',
    })
  }, [theme])

  const data = allocation.map((a) => ({
    name: labelFor(a, t),
    key: a.key,
    value: a.value,
    pct: a.pct,
  }))

  if (data.length === 0) {
    return <div className="h-[200px] flex items-center justify-center text-text-tertiary text-sm">No data</div>
  }

  return (
    <div className="space-y-4">
      <div className="h-[200px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={88} paddingAngle={2} dataKey="value" stroke="none">
              {data.map((entry) => (
                <Cell key={entry.key} fill={COLORS[entry.key] || '#888'} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: tooltipColors.bg,
                border: `1px solid ${tooltipColors.border}`,
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(_, __, props) => [`${props.payload.pct.toFixed(1)}%`, props.payload.name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-1.5">
        {data.map((entry) => (
          <div key={entry.key} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[entry.key] || '#888' }} />
              <span className="text-text-secondary">{entry.name}</span>
            </div>
            <span className="text-text-tertiary tabular-nums">{entry.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
