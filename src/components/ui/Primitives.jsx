import { cn } from '../../lib/utils.js'

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'bg-bg-secondary border border-border-subtle rounded-xl',
        'transition-all duration-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }) {
  return (
    <div className={cn('p-5 pb-3 flex items-center justify-between', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children }) {
  return <h3 className={cn('text-base font-medium text-text-primary', className)}>{children}</h3>
}

export function CardSubtitle({ className, children }) {
  return <p className={cn('text-xs text-text-tertiary mt-0.5', className)}>{children}</p>
}

export function CardBody({ className, children }) {
  return <div className={cn('p-5 pt-2', className)}>{children}</div>
}

export function Button({ variant = 'default', size = 'default', className, children, ...props }) {
  const variants = {
    default: 'bg-accent text-bg-primary hover:bg-accent-hover',
    ghost: 'bg-transparent border border-border-subtle text-text-secondary hover:bg-bg-tertiary hover:text-text-primary hover:border-border-default',
    outline: 'bg-bg-tertiary border border-border-default text-text-primary hover:bg-bg-elevated',
    danger: 'bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    default: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  }
  return (
    <button
      className={cn(
        'rounded-lg font-medium transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-accent/40',
        'active:scale-[0.98]',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Badge({ variant = 'default', className, children }) {
  const variants = {
    default: 'bg-bg-tertiary text-text-secondary border-border-subtle',
    success: 'bg-success/10 text-success border-success/20',
    danger: 'bg-danger/10 text-danger border-danger/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    info: 'bg-info/10 text-info border-info/20',
    accent: 'bg-accent/10 text-accent border-accent/20',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-medium border tabular-nums',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
