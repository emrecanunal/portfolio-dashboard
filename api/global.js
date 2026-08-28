// Global hisse fiyatları — Finnhub, sunucudaki anahtarla.
//
// BU DOSYA NE İDİ, NE OLDU
//
// Eskiden Stooq'a bağlıydı: bedava, anahtarsız, gün sonu verisi. Stooq ücretsiz
// CSV ucunu **Mart 2026'da kapattı** ve bu uç nokta o günden beri hiçbir işe
// yaramıyordu — ama dosyanın başındaki yorum hâlâ Stooq'u anlatıyordu, ki bu
// ölü koddan daha kötüsü: yanlış yönlendiren ölü kod.
//
// Boşluğu istemci doldurmuştu: kullanıcı kendi Finnhub anahtarını Ayarlar'a
// giriyor, tarayıcı doğrudan finnhub.io'ya gidiyordu. O çözümün üç sorunu vardı
// — her yeni cihaza anahtarı elle girmek, anahtarın tarayıcının ağ isteklerinde
// açıkta durması, ve her cihazın aynı sembolü ayrı ayrı çekerek kotayı kullanıcı
// sayısıyla çarpması.
//
// Faz 3 anahtarı sunucuya taşıdı. Artık burası da onu kullanıyor, yani:
//
//   - Tarayıcıda anahtar diye bir şey kalmadı.
//   - Lokal geliştirme (.env.local + dev-proxy) global fiyatları görebiliyor.
//   - Sunucusuz "yalnız-yerel" kip çalışmaya devam ediyor: istemci /api/global'ı
//     anahtarsız çağırıyor, anahtar sunucunun kendisinde.
//
// refresh-prices.js'ten FARKI: orası sonucu prices_latest'e YAZAR ve zamanlayıcı
// onu çağırır. Burası hiçbir şey yazmaz, yalnızca okur. İkisi aynı fetch
// katmanını (_finnhub.js) paylaşıyor — Finnhub davranışı tek yerde tarif edili.

import { fetchGlobalQuotes } from './_finnhub.js'
import { setCacheHeaders, applyCors, parseSymbols } from './_http.js'

async function handle(symbolsParam) {
  const parsed = parseSymbols(symbolsParam, 40)
  if (parsed.error) return { results: {}, errors: [{ symbol: '', error: parsed.error }] }

  return fetchGlobalQuotes(parsed.symbols, process.env.FINNHUB_KEY)
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return

  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const data = await handle(url.searchParams.get('symbols') || '')
    // Finnhub ücretsiz katmanda dakikada 60 çağrı veriyor. Beş dakikalık
    // paylaşımlı kenar önbelleği, birkaç cihazın aynı anda yenilemesini tek bir
    // tura indiriyor.
    setCacheHeaders(res, { maxAge: 300, swr: 600 })
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' })
  }
}

export { handle as globalHandle }
