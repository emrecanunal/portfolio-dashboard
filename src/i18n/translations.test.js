// The two languages have to stay the same shape.
//
// Nothing in the app fails loudly when they do not. A key present only in
// English renders as `undefined` for a Turkish user; a `{n}` that exists in one
// string and not the other renders the literal braces. Both are silent, and
// both landed in confirmation dialogs for actions that delete data — the exact
// place a sentence has to be right.

import { describe, it, expect } from 'vitest'
import { translations, interpolate } from './translations.js'

/** Every leaf key as a dotted path: 'settingsPage.resetDemo'. */
function leafPaths(obj, prefix = '') {
  const out = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...leafPaths(value, path))
    else out.push(path)
  }
  return out
}

function at(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

const placeholders = (str) =>
  [...String(str).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

const LANGS = Object.keys(translations)

describe('translations', () => {
  it('ships more than one language, or this file is testing nothing', () => {
    expect(LANGS.length).toBeGreaterThan(1)
    expect(LANGS).toContain('en')
    expect(LANGS).toContain('tr')
  })

  it('defines exactly the same keys in every language', () => {
    const reference = leafPaths(translations.en).sort()
    for (const lang of LANGS) {
      const theirs = leafPaths(translations[lang]).sort()
      // Named explicitly so a failure says WHICH key, not just that a count differs.
      expect({ lang, missing: reference.filter((k) => !theirs.includes(k)) }).toEqual({
        lang,
        missing: [],
      })
      expect({ lang, extra: theirs.filter((k) => !reference.includes(k)) }).toEqual({
        lang,
        extra: [],
      })
    }
  })

  it('uses the same placeholders in every language', () => {
    for (const path of leafPaths(translations.en)) {
      const expected = placeholders(at(translations.en, path))
      for (const lang of LANGS) {
        expect({ path, lang, vars: placeholders(at(translations[lang], path)) }).toEqual({
          path,
          lang,
          vars: expected,
        })
      }
    }
  })

  it('leaves no string empty', () => {
    for (const lang of LANGS) {
      for (const path of leafPaths(translations[lang])) {
        const value = at(translations[lang], path)
        if (typeof value === 'string') expect({ path, lang, empty: value.trim() === '' }).toEqual({
          path,
          lang,
          empty: false,
        })
      }
    }
  })
})

describe('interpolate', () => {
  it('substitutes every placeholder it is given', () => {
    expect(interpolate('{a} and {b}', { a: 1, b: 2 })).toBe('1 and 2')
  })

  it('is what the confirmation dialogs depend on', () => {
    // These four sentences precede an action that cannot be undone. If a count
    // fails to substitute, the user is asked to confirm "delete all {n}".
    const cases = [
      ['settingsPage.resetDemoConfirm', { n: 364, p: 3 }],
      ['settingsPage.clearAllConfirm', { n: 364 }],
      ['settingsPage.deleteWithTxns', { n: 12 }],
      ['settingsPage.restoreSuccess', { n: 364, p: 3 }],
    ]
    for (const lang of LANGS) {
      for (const [path, vars] of cases) {
        const rendered = interpolate(at(translations[lang], path), vars)
        expect({ path, lang, leftover: /\{\w+\}/.test(rendered) }).toEqual({
          path,
          lang,
          leftover: false,
        })
      }
    }
  })
})
