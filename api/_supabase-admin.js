// Sunucunun Supabase'e service_role ile bağlandığı yer.
//
// SERVICE_ROLE NE DEMEK — VE NEDEN BU DOSYA TARAYICIYA HİÇ GİTMEZ
//
// service_role anahtarı RLS'i de tablo yetkilerini de tamamen baypas eder. Yani
// her kullanıcının her satırını okuyup yazabilir. Bütün Faz 1 boyunca kurduğumuz
// koruma bu anahtarın önünde yok hükmünde.
//
// Bu yüzden:
//   - Değişkenin adında `VITE_` ÖNEKİ YOK. Vite yalnızca o önekli değişkenleri
//     istemci paketine gömer; öneksiz olan derlemeye hiç girmez.
//   - Bu dosya api/ altında ve alt çizgiyle başlıyor, yani ne bir uç nokta ne de
//     istemciden import edilebilir bir modül.
//   - Vercel'de `Sensitive` işaretli olmalı.
//
// Buradaki her sorgu, bir kullanıcının kendi verisi için değil, TÜM kullanıcılar
// adına yapılan bir iş için. Fiyatlar kişiye değil sembole ait; bu tabloları
// dolduran şey de kişi değil, zamanlayıcı.

import { fetchWithTimeout } from './_http.js'

// Ortam değişkenleri ÇAĞRI ANINDA okunuyor, modül yüklenirken değil.
//
// Modül seviyesinde sabitlemek serverless'ta çalışır — değişkenler süreç
// başlarken hazırdır — ama iki şeyi kaybettirir: değişkeni sonradan ekleyip
// yeniden deploy ettiğinde sıcak bir örnek eski değeri taşımaya devam eder, ve
// testte "anahtar yokken ne oluyor" sorusu sorulamaz hâle gelir. İkincisi bunu
// yazarken fark edildi: yapılandırma testi, modül bir kez yüklendiği için
// hiçbir zaman kırmızıya dönmüyordu.
const url = () => process.env.SUPABASE_URL || ''
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export function isAdminConfigured() {
  return Boolean(url() && serviceKey())
}

/**
 * PostgREST'e service_role ile istek.
 *
 * supabase-js yerine düz fetch: sunucu tarafında ihtiyacımız olan tek şey iki
 * select ve iki upsert. Koca bir istemci kütüphanesini serverless fonksiyonun
 * soğuk başlangıç süresine eklemek, kullanmadığımız realtime ve auth
 * katmanlarının bedelini her çağrıda ödemek olurdu.
 */
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const key = serviceKey()
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer

  const res = await fetchWithTimeout(
    `${url()}/rest/v1/${path}`,
    { method, headers, body: body ? JSON.stringify(body) : undefined },
    8000,
  )

  const text = await res.text()
  if (!res.ok) throw new Error(`SUPABASE_${res.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

/**
 * Fiyatlanması gereken semboller — TÜM kullanıcıların elindekiler.
 *
 * Elde tutulmayan sembol dışarıda kalıyor: bir yıl önce tamamen satılmış bir
 * hisse için her beş dakikada bir kaynağa gitmek, kotayı kimsenin bakmadığı bir
 * sayı için harcamak olurdu.
 *
 * Miktar hesabı JS'te yapılıyor. SQL'de bir görünüm de yazılabilirdi, ama o
 * görünüm alım-satım mantığını calculations.js'ten ikinci bir yere kopyalamak
 * demek — ve o iki kopyanın bir gün ayrışmayacağının garantisi yok.
 */
export async function heldSymbols() {
  const rows = await rest(
    'transactions?select=symbol,asset_type,type,quantity&deleted_at=is.null&asset_type=neq.cash',
  )

  const held = new Map()
  for (const r of rows) {
    const key = `${r.asset_type}:${r.symbol}`
    const entry = held.get(key) || { symbol: r.symbol, assetType: r.asset_type, qty: 0 }
    const qty = Number(r.quantity) || 0
    if (r.type === 'buy') entry.qty += qty
    else if (r.type === 'sell') entry.qty -= qty
    held.set(key, entry)
  }

  // 0.0001: kayan nokta artıkları. 100 hisseyi üç parça hâlinde satmak bakiyeyi
  // tam sıfır yerine 1e-13 bırakabiliyor ve o sembol sonsuza kadar çekilmeye
  // devam ederdi.
  return [...held.values()].filter((h) => h.qty > 0.0001)
}

/** Fiyatları yaz. Sembol başına tek satır, üzerine yazılır. */
export async function writePrices(quotes) {
  if (!quotes.length) return 0
  await rest('prices_latest?on_conflict=symbol', {
    method: 'POST',
    body: quotes,
    prefer: 'resolution=merge-duplicates,return=minimal',
  })
  return quotes.length
}

/** Sembol kataloğu: hangi sembol hangi tür ve hangi para biriminde. */
export async function writeInstruments(instruments) {
  if (!instruments.length) return 0
  await rest('instruments?on_conflict=symbol', {
    method: 'POST',
    body: instruments,
    prefer: 'resolution=merge-duplicates,return=minimal',
  })
  return instruments.length
}

/**
 * Bir kullanıcı erişim belirtecinin gerçekten geçerli olup olmadığını Supabase'e
 * sorar.
 *
 * JWT'yi burada elle çözmüyoruz. İmzayı doğrulamadan içeriğine bakmak, herkesin
 * kendi başına yazabileceği bir metne güvenmek demek; imzayı doğru doğrulamak
 * ise anahtar döngüsü ve algoritma tuzaklarıyla dolu bir iş. Supabase'e tek bir
 * çağrı sormak, tartışmayı bitiriyor.
 */
export async function verifyUserToken(accessToken) {
  if (!accessToken) return null
  try {
    const res = await fetchWithTimeout(
      `${url()}/auth/v1/user`,
      { headers: { apikey: serviceKey(), Authorization: `Bearer ${accessToken}` } },
      6000,
    )
    if (!res.ok) return null
    const user = await res.json()
    return user?.id ? { userId: user.id, email: user.email } : null
  } catch {
    return null
  }
}
