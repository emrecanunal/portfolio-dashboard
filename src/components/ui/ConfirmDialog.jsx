import { Modal } from './Modal.jsx'
import { Button } from './Primitives.jsx'
import { AlertTriangle } from 'lucide-react'

// Lightweight confirmation dialog for destructive actions.
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, cancelLabel, variant = 'danger' }) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-sm">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-danger/10 flex items-center justify-center">
            <AlertTriangle size={18} className="text-danger" strokeWidth={2} />
          </div>
          <p className="text-sm text-text-secondary pt-1.5 leading-relaxed whitespace-pre-line">{message}</p>
        </div>
      </div>
      <div className="border-t border-border-subtle p-4 flex justify-end gap-2 bg-bg-secondary">
        <Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
        <Button
          variant={variant}
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
