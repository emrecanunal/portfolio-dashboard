import { cn } from '../../lib/utils.js'

export function StatCard({ label, value, sublabel, valueClass, className }) {
  return (
    <div
      className={cn(
        'bg-bg-secondary border border-border-subtle rounded-xl p-4',
        'hover:border-border-default transition-colors duration-200',
        className
      )}
    >
      <div className="text-2xs uppercase tracking-wider text-text-tertiary font-medium mb-2">
        {label}
      </div>
      <div className={cn('text-2xl font-medium tabular-nums', valueClass || 'text-text-primary')}>
        {value}
      </div>
      {sublabel && <div className="text-xs text-text-tertiary mt-1 tabular-nums">{sublabel}</div>}
    </div>
  )
}
