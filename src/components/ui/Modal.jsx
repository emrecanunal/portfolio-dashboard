import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.js'

// Generic modal with overlay, close on Escape / overlay click, body-scroll lock.
export function Modal({ open, onClose, title, subtitle, children, maxWidth = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className={cn(
          'relative w-full bg-bg-secondary border border-border-default rounded-xl shadow-2xl',
          'max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden',
          maxWidth
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between p-5 border-b border-border-subtle shrink-0">
          <div>
            <h2 className="text-base font-medium text-text-primary">{title}</h2>
            {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors p-1 -m-1 rounded"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}
