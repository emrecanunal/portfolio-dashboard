// Dikişin bekçisi.
//
// SENKRON-PLANI.md §4'te bir söz var: "@supabase/supabase-js'i yalnızca
// supabase.js import eder, taşımak gerekirse değişen dosya sayısı bir olur."
// Bu tür sözler yorum olarak yazıldığında altı ay dayanıyor — birinin bir
// sayfada hızlıca `supabase.from('transactions')` yazması yetiyor ve kimse fark
// etmiyor, çünkü çalışıyor.
//
// Burada test olarak yazılı, yani fark ediliyor.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../..', import.meta.url).pathname          // src/
const ALLOWED = 'lib/backend/supabase.js'

function jsFilesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full))
    else if (/\.(js|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('backend dikisi', () => {
  it('supabase-js yalnizca supabase.js icinde import edilir', () => {
    const offenders = jsFilesUnder(SRC).filter((file) => {
      const rel = relative(SRC, file)
      if (rel === ALLOWED) return false
      return /from\s+['"]@supabase\/supabase-js['"]/.test(readFileSync(file, 'utf8'))
    })

    expect(
      offenders.map((f) => relative(SRC, f)),
      'Bu dosyalar supabase-js\'i dogrudan import ediyor. Ihtiyacin olan seyi ' +
      'src/lib/backend/index.js sozlesmesine ekle ve oradan cagir.',
    ).toEqual([])
  })

  it('index.js supabase kelimesini disari sizdirmayan bir sozlesme sunar', async () => {
    const api = await import('./index.js')
    for (const name of ['isBackendConfigured', 'sendMagicLink', 'signOut', 'getSession', 'onAuthChange']) {
      expect(typeof api[name], `${name} eksik`).toBe('function')
    }
  })
})

describe('yapilandirilmamis kip', () => {
  // Bu, uygulamanın anahtarsız bir kurulumda (ve bu testlerin koştuğu node
  // ortamında) çökmemesinin garantisi. isConfigured() false döndüğü sürece
  // hiçbir çağrı ağa çıkmamalı ve hiçbiri throw etmemeli.
  it('anahtarsizken cagrilar sessizce basarisiz olur, patlamaz', async () => {
    const { isBackendConfigured, getSession, sendMagicLink, onAuthChange } = await import('./index.js')

    expect(isBackendConfigured()).toBe(false)
    await expect(getSession()).resolves.toBeNull()
    await expect(sendMagicLink('a@b.com')).resolves.toEqual({ ok: false, error: 'not-configured' })
    expect(typeof onAuthChange(() => {})).toBe('function')   // no-op abonelik
  })
})
