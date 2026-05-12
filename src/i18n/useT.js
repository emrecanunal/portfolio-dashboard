import { usePortfolioStore } from '../lib/store.js'
import { translations, interpolate } from './translations.js'

export function useT() {
  const lang = usePortfolioStore((s) => s.settings.language)
  const t = translations[lang] || translations.en
  return {
    t,
    ti: (str, vals) => interpolate(str, vals),
    lang,
  }
}
