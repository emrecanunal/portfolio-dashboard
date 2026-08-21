// Pins the one line that decides whether half the app's colours exist.
//
// `bg-bg-secondary/95` was in the markup, looked correct in review, and
// compiled to nothing at all — Tailwind cannot apply an alpha to a bare
// `var(--x)`, and says so by emitting no rule rather than by failing. The
// symptom was a fixed navigation bar you could read the page through.
//
// A build would catch none of this, so the function itself is tested instead.

import { describe, it, expect } from 'vitest'
import { withAlpha } from './tailwind.config.js'

describe('withAlpha', () => {
  const colour = withAlpha('--bg-secondary')

  it('returns the plain variable when no opacity is asked for', () => {
    expect(colour({})).toBe('var(--bg-secondary)')
    expect(colour()).toBe('var(--bg-secondary)')
  })

  it('mixes toward transparent when an opacity is asked for', () => {
    expect(colour({ opacityValue: 0.95 })).toBe(
      'color-mix(in srgb, var(--bg-secondary) 95%, transparent)'
    )
    expect(colour({ opacityValue: 0.05 })).toBe(
      'color-mix(in srgb, var(--bg-secondary) 5%, transparent)'
    )
  })

  it('handles the ends without producing 0.30000000000000004%', () => {
    expect(colour({ opacityValue: 1 })).toContain('100%')
    expect(colour({ opacityValue: 0 })).toContain('0%')
    expect(colour({ opacityValue: 0.3 })).toContain('30%')
  })

  it('falls back to the solid colour when handed a CSS variable', () => {
    // The legacy bg-opacity-* utilities pass `var(--tw-bg-opacity)` rather
    // than a number. Multiplying that by 100 yields NaN%, which is an invalid
    // colour — and an invalid colour is a transparent element, i.e. exactly
    // the bug this function exists to fix.
    expect(colour({ opacityValue: 'var(--tw-bg-opacity)' })).toBe('var(--bg-secondary)')
  })
})
