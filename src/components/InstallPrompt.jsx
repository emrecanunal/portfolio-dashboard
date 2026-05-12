import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useT } from '../i18n/useT.js'
import { cn } from '../lib/utils.js'

// Floating "Install app" prompt.
//
// Listens for the browser's beforeinstallprompt event (Chrome/Edge/Brave on
// desktop, Chrome on Android). When fired, browsers consider the app installable
// — we save the event so we can call .prompt() on user action.
//
// Once installed (display-mode: standalone matches), the prompt hides itself.
// Users who dismiss it once won't see it again for the rest of the session
// (and we persist a flag so it stays hidden across sessions until they ask).
//
// iOS Safari doesn't fire beforeinstallprompt — those users go to share menu →
// "Add to Home Screen". We show a brief one-time hint for them.

const DISMISS_STORAGE_KEY = 'pwa-install-dismissed'

function isStandalone() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari
  if (window.navigator?.standalone === true) return true
  return false
}

function isIos() {
  if (typeof window === 'undefined') return false
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream
}

export function InstallPrompt() {
  const { t } = useT()
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Skip entirely if already installed or previously dismissed
    if (isStandalone()) return
    if (localStorage.getItem(DISMISS_STORAGE_KEY) === '1') {
      setDismissed(true)
      return
    }

    // Standard PWA install path (Chrome, Edge, etc.)
    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // iOS hint (no install event support there)
    if (isIos()) {
      setShowIosHint(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    setDeferredPrompt(null)
    setShowIosHint(false)
    localStorage.setItem(DISMISS_STORAGE_KEY, '1')
  }

  if (dismissed) return null
  if (!deferredPrompt && !showIosHint) return null

  // iOS users see a hint instead of an install button
  if (showIosHint && !deferredPrompt) {
    return (
      <Banner onDismiss={handleDismiss} title={t.installPrompt.iosTitle}>
        <p className="text-2xs text-text-tertiary leading-relaxed">
          {t.installPrompt.iosHint}
        </p>
      </Banner>
    )
  }

  // Desktop / Android — show the install button
  return (
    <Banner onDismiss={handleDismiss} title={t.installPrompt.desktopTitle}>
      <p className="text-2xs text-text-tertiary leading-relaxed mb-2">
        {t.installPrompt.desktopHint}
      </p>
      <button
        onClick={handleInstall}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
          'bg-accent text-white',
          'hover:opacity-90 transition-opacity'
        )}
      >
        <Download size={11} strokeWidth={2.25} />
        {t.installPrompt.installBtn}
      </button>
    </Banner>
  )
}

function Banner({ children, title, onDismiss }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-bg-elevated border border-border-default rounded-xl shadow-xl p-4 relative">
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1 text-text-tertiary hover:text-text-primary transition-colors"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
        <div className="text-xs font-medium text-text-primary mb-1.5 pr-4">
          {title}
        </div>
        {children}
      </div>
    </div>
  )
}
