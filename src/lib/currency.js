// Currency conversion and formatting.
// All transactions store amount in their original currency; we convert at display time.

export function convertToTRY(amount, fromCurrency, fxRates) {
  if (fromCurrency === 'TRY') return amount
  const rate = fxRates[fromCurrency]
  if (!rate) return amount
  return amount * rate
}

export function convertFromTRY(amountTRY, toCurrency, fxRates) {
  if (toCurrency === 'TRY') return amountTRY
  const rate = fxRates[toCurrency]
  if (!rate) return amountTRY
  return amountTRY / rate
}

export function formatCurrency(amount, currency = 'TRY', options = {}) {
  const { decimals = 0, compact = false } = options
  const symbol = { TRY: '₺', USD: '$', EUR: '€' }[currency] || ''
  if (compact && Math.abs(amount) >= 1_000_000) {
    return `${symbol}${(amount / 1_000_000).toFixed(2)}M`
  }
  if (compact && Math.abs(amount) >= 1_000) {
    return `${symbol}${(amount / 1_000).toFixed(1)}K`
  }
  return `${symbol}${amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

// Quote an FX conversion the way people actually read rates: in whichever
// direction produces a number ≥ 1. Converting 47.912 TRY into 1.000 USD is
// "1 USD = 47.912 TRY", not "1 TRY = 0.020872 USD" — the second is arithmetically
// identical but unreadable. Falls out correctly for other pairs too
// (1 EUR = 1.16 USD rather than 1 USD = 0.86 EUR).
//
// Returns { base, quote, rate } — read as "1 {base} = {rate} {quote}" — or null
// when either side is missing or zero.
export function quoteFxRate(fromAmount, toAmount, fromCurrency, toCurrency) {
  const from = Number(fromAmount) || 0
  const to = Number(toAmount) || 0
  if (from <= 0 || to <= 0) return null

  const direct = to / from
  return direct >= 1
    ? { base: fromCurrency, quote: toCurrency, rate: direct }
    : { base: toCurrency, quote: fromCurrency, rate: from / to }
}

export function formatFxRate(rate) {
  return rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export function formatPercent(value, options = {}) {
  const { decimals = 1, withSign = false } = options
  const sign = withSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export function formatSignedCurrency(amount, currency = 'TRY', options = {}) {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : ''
  return `${sign}${formatCurrency(Math.abs(amount), currency, options)}`
}
