// Global hisse fiyatları — sunucu tarafı.
//
// NEDEN İSTEMCİDEKİNİN KOPYASI DEĞİL DE AYRI BİR DOSYA
//
// priceApi.js'te zaten bir Finnhub çağrısı var, ama o anahtarı KULLANICIDAN
// alıyor: her tarayıcı kendi anahtarını Ayarlar'a giriyor ve istek doğrudan
// tarayıcıdan finnhub.io'ya gidiyor. Bunun üç sorunu var ve üçü de Faz 3'ün
// varlık sebebi:
//
//   1. Her yeni cihaza anahtarı elle girmek gerekiyor. Yakın çevrene açtığında
//      insanlardan kendi Finnhub hesaplarını açmalarını isteyemezsin.
//   2. Anahtar tarayıcının ağ isteklerinde açıkta duruyor.
//   3. Her cihaz aynı sembolleri ayrı ayrı çekiyor; kota kullanıcı sayısıyla
//      çarpılıyor.
//
// Buradaki sürüm anahtarı ortam değişkeninden alıyor ve tarayıcı finnhub.io'ya
// hiç gitmiyor.
//
// api/ altında alt çizgiyle başlayan dosyaları Vercel bir uç nokta saymıyor,
// yani bu bir rota değil, paylaşılan bir modül.

import { fetchWithTimeout } from './_http.js'

const BASE = 'https://finnhub.io/api/v1'

// Finnhub ücretsiz katmanda dakikada 60 çağrı veriyor. Altışar gitmek, 39
// sembollük bir portföyü yedi turda bitiriyor ve tavana yaklaşmıyor.
const BATCH = 6
const PACING_MS = 1100

/**
 * Tek sembol için anlık fiyat.
 *
 * Finnhub kotayı aştığında ya da anahtar geçersiz olduğunda 200 ile boş bir
 * gövde döndürebiliyor — HTTP durumuna bakmak yetmiyor. `c` (current price)
 * alanının varlığı asıl sınav.
 */
async function fetchQuote(symbol, apiKey) {
  const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`
  const res = await fetchWithTimeout(url)

  if (res.status === 401 || res.status === 403) throw new Error('INVALID_KEY')
  if (res.status === 429) throw new Error('RATE_LIMITED')
  if (!res.ok) throw new Error(`FINNHUB_HTTP_${res.status}`)

  const data = await res.json()

  // Bilinmeyen bir sembol için Finnhub sıfırlarla dolu bir nesne döndürüyor,
  // hata değil. Sıfırı fiyat sanıp kaydetmek, pozisyonu portföyden silmekle
  // aynı kapıya çıkardı — ve hiçbir uyarı çıkmazdı.
  if (typeof data?.c !== 'number' || data.c === 0) throw new Error('NO_DATA')

  const previousClose = typeof data.pc === 'number' && data.pc > 0 ? data.pc : null

  return {
    price: data.c,
    previousClose,
    dayChangePct: previousClose ? ((data.c - previousClose) / previousClose) * 100 : null,
    currency: 'USD',
    source: 'finnhub',
    fetchedAt: Date.now(),
  }
}

/**
 * Sembol listesi için fiyatlar. Tek bir sembolün hatası diğerlerini düşürmez.
 *
 * @returns {Promise<{results: Object, errors: Array<{symbol, error}>}>}
 */
export async function fetchGlobalQuotes(symbols, apiKey) {
  if (!apiKey) {
    return { results: {}, errors: symbols.map((s) => ({ symbol: s, error: 'NO_API_KEY' })) }
  }

  const results = {}
  const errors = []

  for (let i = 0; i < symbols.length; i += BATCH) {
    if (i > 0) await new Promise((r) => setTimeout(r, PACING_MS))
    const batch = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map((s) => fetchQuote(s, apiKey)))

    settled.forEach((outcome, idx) => {
      const symbol = batch[idx]
      if (outcome.status === 'fulfilled') results[symbol] = outcome.value
      else errors.push({ symbol, error: outcome.reason?.message || 'failed' })
    })

    // Anahtar geçersizse kalan sembolleri denemenin anlamı yok; hepsi aynı
    // hatayı verecek ve kotadan yiyecek.
    if (errors.some((e) => e.error === 'INVALID_KEY')) {
      for (const s of symbols.slice(i + BATCH)) errors.push({ symbol: s, error: 'INVALID_KEY' })
      break
    }
  }

  return { results, errors }
}
