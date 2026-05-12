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

export function formatPercent(value, options = {}) {
  const { decimals = 1, withSign = false } = options
  const sign = withSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export function formatSignedCurrency(amount, currency = 'TRY', options = {}) {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : ''
  return `${sign}${formatCurrency(Math.abs(amount), currency, options)}`
}
