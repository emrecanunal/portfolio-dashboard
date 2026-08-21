// The shell: a sidebar on a desktop, a bottom tab bar on a phone.
//
// WHY A BOTTOM BAR AND NOT A DRAWER
//
// The sidebar was 240px of a 390px screen, leaving 86px of usable width once
// the 32px padding took its share — and `overflow-x-hidden` on <main> then
// clipped whatever spilled instead of letting it scroll, so the app did not
// even look broken. It looked empty.
//
// A drawer would have been less work and would have kept one layout for both.
// It also puts every page change behind two taps and hides which page you are
// on while it is shut. A tracker is something you open to glance at one number
// and then switch tabs; that is the case a tab bar is for, and it sits where
// the thumb already is.
//
// SAFE AREAS
//
// The bar is fixed to the bottom edge, which on an iPhone is where the home
// indicator lives. env(safe-area-inset-bottom) keeps the tabs above it, and
// the same inset is added to the content's bottom padding so the last row of a
// page is not left underneath the bar. These only report real values when the
// viewport meta carries viewport-fit=cover — see index.html.

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

  const nextTheme = theme === 'dark' ? t.theme.light : t.theme.dark

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* === DESKTOP SIDEBAR === */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border-subtle bg-bg-secondary/50 backdrop-blur-sm flex-col sticky top-0 h-screen">
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
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
            aria-label={nextTheme}
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

      {/* === MOBILE HEADER ===
          Theme and language lose their home when the sidebar goes away, so they
          come up here as icons. 44px hit areas: anything smaller is a coin flip
          with a thumb, and these two sit next to each other. */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 h-14 px-4 border-b border-border-subtle bg-bg-secondary/80 backdrop-blur-sm">
        <div className="min-w-0">
          <div className="display-font text-lg leading-none text-text-primary">portfolio</div>
          <div className="text-2xs uppercase tracking-widest text-text-tertiary">FIRE tracker</div>
        </div>
        <div className="flex items-center shrink-0">
          <button
            onClick={toggleTheme}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-text-secondary active:bg-bg-tertiary transition-colors"
            aria-label={nextTheme}
          >
            {theme === 'dark' ? <Moon size={18} strokeWidth={1.75} /> : <Sun size={18} strokeWidth={1.75} />}
          </button>
          <button
            onClick={() => setLanguage(lang === 'en' ? 'tr' : 'en')}
            className="w-11 h-11 flex items-center justify-center gap-1 rounded-lg text-text-secondary active:bg-bg-tertiary transition-colors"
            aria-label={lang === 'en' ? 'Türkçe' : 'English'}
          >
            <Languages size={18} strokeWidth={1.75} />
            <span className="text-2xs uppercase tracking-wider">{lang === 'en' ? 'EN' : 'TR'}</span>
          </button>
        </div>
      </header>

      {/* min-w-0 is load-bearing: without it this flex child refuses to shrink
          below the intrinsic width of its widest content, and one wide table
          pushes the whole page sideways instead of scrolling inside its own
          box. It is the reason overflow-x-hidden was there, and why it is gone
          now — a problem should be visible enough to fix. */}
      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto p-4 md:p-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8">
          <Outlet />
        </div>
      </main>

      {/* === MOBILE TAB BAR ===
          z-30, deliberately below the z-50 modals: a confirmation about
          deleting transactions must not have a navigation bar sitting on top
          of its buttons. */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-border-subtle bg-bg-secondary/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors',
                isActive ? 'text-text-primary' : 'text-text-tertiary active:text-text-secondary'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={20} strokeWidth={isActive ? 2 : 1.75} />
                <span className="text-2xs leading-none truncate max-w-full px-1">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
