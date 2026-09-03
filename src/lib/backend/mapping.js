// Uygulamanın satır şekli ile veritabanının satır şekli arasındaki çeviri.
//
// NEDEN AYRI BİR DOSYA
//
// İki isimlendirme var ve ikisi de haklı: uygulama camelCase konuşuyor çünkü
// JavaScript öyle, veritabanı snake_case çünkü SQL öyle. Aradaki eşleme üç
// alanda isim değiştiriyor ve biri de tip adıyla çakıştığı için (`date`) yeniden
// adlandırılmak zorunda kaldı.
//
// Bu çeviri iki yönlü ve iki yönün birbirinin tersi olduğunu bir yerde görmek
// gerekiyor. Push ile pull ayrı dosyalara dağılsaydı, birine alan eklenip
// diğerine eklenmemesi hiçbir hata vermeden mümkün olurdu: alan sunucuya gider,
// geri gelirken düşer, ve kullanıcı notunun kaybolduğunu ancak aylar sonra fark
// eder. Yan yana durunca eksik olan göze çarpıyor — mapping.test.js de gidip
// gelmenin aynı nesneyi verdiğini her koşuda doğruluyor.

export function txToDb(tx, userId) {
  return {
    user_id: userId,
    id: tx.id,
    portfolio_id: tx.portfolioId,
    // Transferin hedefi. Diğer tiplerde null — PostgREST toplu eklemede her
    // satırın aynı anahtar kümesini istediği için alan HER ZAMAN yazılıyor,
    // sadece değeri değişiyor. undefined bırakmak satırı JSON'dan düşürür ve
    // tüm yazmayı reddettirir (bkz. api/refresh-prices.js, PGRST102).
    to_portfolio_id: tx.toPortfolioId ?? null,
    type: tx.type,
    asset_type: tx.assetType,
    symbol: tx.symbol,
    quantity: tx.quantity,
    price: tx.price,
    fee: tx.fee ?? 0,
    currency: tx.currency,
    // Takasın karşı bacağı: ne kadar, hangi para biriminde girdi. Bunlar
    // taşınmazsa satır sunucudan çevrilen tutar OLMADAN döner ve cashDeltaTRY
    // çıkışı sayıp girişi sıfır kabul eder — takas, portföyün nakdini
    // çevrilen tutar kadar yer. Hiçbir hata çıkmaz, sayı makul görünür.
    to_amount: tx.toAmount ?? null,
    to_currency: tx.toCurrency ?? null,
    trade_date: tx.date,
    notes: tx.notes ?? '',
  }
}

export function txFromDb(row) {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    ...(row.to_portfolio_id ? { toPortfolioId: row.to_portfolio_id } : {}),
    type: row.type,
    assetType: row.asset_type,
    symbol: row.symbol,
    // Postgres numeric'i JSON'a metin olarak gelir. Number'a çevirmezsek
    // calculations.js'in her toplaması sessizce string birleştirmesine döner:
    // "10" + "5" = "105" ve portföy değeri saçmalar.
    quantity: Number(row.quantity),
    price: Number(row.price),
    fee: Number(row.fee ?? 0),
    currency: row.currency,
    // to_portfolio_id ile aynı düzen: yalnızca doluyken taşınıyor, yoksa
    // her alım satırı toAmount: null taşır ve gidip-gelme testi bozulur.
    ...(row.to_amount != null ? { toAmount: Number(row.to_amount) } : {}),
    ...(row.to_currency ? { toCurrency: row.to_currency } : {}),
    date: row.trade_date,
    notes: row.notes ?? '',
  }
}

export function portfolioToDb(p, userId, sortOrder = 0) {
  return {
    user_id: userId,
    id: p.id,
    name: p.name,
    color: p.color,
    sort_order: sortOrder,
    is_cash_account: Boolean(p.isCashAccount),
  }
}

export function portfolioFromDb(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    // Yalnızca doğruyken taşınıyor: her portföye isCashAccount:false yazmak,
    // mapping.test.js'in gidip-gelme testini de bozardı ve veri modeline hiçbir
    // şey katmazdı — bayrağın yokluğu zaten "kasa değil" demek.
    ...(row.is_cash_account ? { isCashAccount: true } : {}),
  }
}

/**
 * Sunucuya giden ayarlar — izin listesi.
 *
 * dataExport.js'in RESTORABLE_SETTINGS'i ile aynı ruh: anı değil kişiyi
 * tanımlayan alanlar. İki fark var ve ikisi de kasıtlı:
 *
 *   theme, language — senkronlanmıyor. Telefonda karanlık, masaüstünde açık
 *   isteyebilirsin; bunlar kişiyi değil CİHAZI tanımlıyor.
 *
 * fxRates, priceMeta, finnhubApiKey burada asla olmamalı: ilk ikisi anı
 * kaydeder (Mayıs'taki 34,5'lik kur bugünün 48,1'inin üzerine yazılırsa
 * çevrilmiş her rakam sessizce şaşar), sonuncusu Faz 3'te sunucuya taşınıyor.
 */
export const SYNCED_SETTINGS = [
  'baseCurrency',
  'monthlyExpensesUSD',
  'withdrawalRate',
  'activeFireStage',
  'fireTargetUSD',
  'cashThresholdPct',
  'fireLookbackMonths',
  'autoRefreshEnabled',
  'autoRefreshMinutes',
  'showContributionsLine',
]

export function settingsToDb(settings) {
  const out = {}
  for (const key of SYNCED_SETTINGS) {
    if (settings[key] !== undefined) out[key] = settings[key]
  }
  return out
}

export function settingsFromDb(json) {
  const out = {}
  if (!json || typeof json !== 'object') return out
  for (const key of SYNCED_SETTINGS) {
    if (json[key] !== undefined) out[key] = json[key]
  }
  return out
}
