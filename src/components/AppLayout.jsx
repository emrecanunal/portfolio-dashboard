import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, ListChecks, Wallet, Flame, Settings as SettingsIcon, Languages, Sun, Moon } from 'lucide-react'
import { useT } from '../i18n/useT.js'
import { usePortfolioStore } from '../lib/store.js'
import { cn } from '../lib/utils.js'

export function AppLayout() {
  const { t, lang } = useT()
  const setLanguage = usePortfolioStore((s) => s.setLanguage)
  const theme = usePortfolioStore((s) => s.settings.theme)
  const toggleTheme = usePortfolioStore((s) => s.toggleTheme)

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t.nav.dashboard, end: true },
    { to: '/transactions', icon: ListChecks, label: t.nav.transactions },
    { to: '/portfolios', icon: Wallet, label: t.nav.portfolios },
    { to: '/fire', icon: Flame, label: t.nav.fire },
    { to: '/settings', icon: SettingsIcon, label: t.nav.settings },
  ]

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-border-subtle bg-bg-secondary/50 backdrop-blur-sm flex flex-col sticky top-0 h-screen">
        <div className="p-5 border-b border-border-subtle">
          <div className="display-font text-xl text-text-primary">portfolio</div>
          <div className="text-2xs uppercase tracking-widest text-text-tertiary mt-0.5">FIRE tracker</div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-bg-tertiary text-text-primary'
                    : 'text-text-secondary hover:bg-bg-tertiary/50 hover:text-text-primary'
                )
              }
            >
              <item.icon size={16} strokeWidth={1.75} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-border-subtle space-y-1">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <Moon size={16} strokeWidth={1.75} />
            ) : (
              <Sun size={16} strokeWidth={1.75} />
            )}
            <span className="flex-1 text-left">
              {theme === 'dark' ? t.theme.dark : t.theme.light}
            </span>
          </button>

          {/* Language toggle */}
          <button
            onClick={() => setLanguage(lang === 'en' ? 'tr' : 'en')}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
          >
            <Languages size={16} strokeWidth={1.75} />
            <span className="flex-1 text-left">{lang === 'en' ? 'English' : 'Türkçe'}</span>
            <span className="text-2xs text-text-tertiary uppercase tracking-wider">
              {lang === 'en' ? 'EN' : 'TR'}
            </span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-7xl mx-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
