/**
 * A theme colour that survives Tailwind's /opacity modifier.
 *
 * Every colour here is a CSS variable holding a hex string, because the two
 * themes swap the variables and nothing has to know which one is live. The
 * cost, discovered by finding a navigation bar with no background at all: a
 * bare `var(--x)` cannot take an alpha. Tailwind quietly emits NO RULE for
 * `bg-bg-secondary/95` — not a wrong colour, not a warning, just nothing. The
 * class name sits in the markup looking correct and does not exist in the CSS.
 *
 * Sixty-six such classes were written across this app and every one of them
 * was doing nothing: warning banners with no tint, hover states that never
 * lit up, overlays you could read straight through.
 *
 * color-mix restores the alpha without touching the variables. It needs
 * Chrome 111 / Safari 16.2 / Firefox 113, a bar index.css already clears —
 * see the focus ring there, which uses the same function.
 *
 * The guard matters: with the legacy `bg-opacity-*` utilities Tailwind passes
 * a CSS variable rather than a number, and `var(--tw-bg-opacity) * 100` is
 * NaN. Falling back to the solid colour is the honest answer there.
 */
export const withAlpha = (variable) => ({ opacityValue } = {}) => {
  const alpha = Number(opacityValue)
  if (!Number.isFinite(alpha)) return `var(${variable})`
  return `color-mix(in srgb, var(${variable}) ${alpha * 100}%, transparent)`
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: withAlpha('--bg-primary'),
          secondary: withAlpha('--bg-secondary'),
          tertiary: withAlpha('--bg-tertiary'),
          elevated: withAlpha('--bg-elevated'),
        },
        border: {
          subtle: withAlpha('--border-subtle'),
          default: withAlpha('--border-default'),
          strong: withAlpha('--border-strong'),
        },
        text: {
          primary: withAlpha('--text-primary'),
          secondary: withAlpha('--text-secondary'),
          tertiary: withAlpha('--text-tertiary'),
          muted: withAlpha('--text-muted'),
        },
        accent: {
          DEFAULT: withAlpha('--accent'),
          hover: withAlpha('--accent-hover'),
        },
        success: withAlpha('--success'),
        danger: withAlpha('--danger'),
        warning: withAlpha('--warning'),
        info: withAlpha('--info'),
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        display: ['Instrument Serif', 'Georgia', 'serif'],
      },
      fontSize: {
        '2xs': '0.6875rem',
      },
    },
  },
  plugins: [],
}
