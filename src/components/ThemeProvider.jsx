import { useEffect } from 'react'
import { usePortfolioStore } from '../lib/store.js'

// Applies the current theme class ('dark' | 'light') to <html>.
export function ThemeProvider({ children }) {
  const theme = usePortfolioStore((s) => s.settings.theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'light')
    root.classList.add(theme || 'dark')
  }, [theme])

  return children
}
