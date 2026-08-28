// Uygulamanın sunucuyla konuştuğu TEK kapı.
//
// NEDEN BÖYLE BİR DİKİŞ VAR
//
// Supabase'i seçerken verdiğimiz söz şuydu: altı standart Postgres olduğu için
// ileride başka bir sağlayıcıya taşımak pahalı olmasın. Ama bu söz kendiliğinden
// tutulmuyor. `supabase.auth.signInWithOtp(...)` çağrısı uygulamanın otuz ayrı
// yerine dağılırsa, taşıma "bir dosyayı değiştir" olmaktan çıkıp "otuz dosyayı
// tara" haline gelir — ve o noktada kimse taşımaz.
//
// Bu yüzden kural sert: **`@supabase/supabase-js`'i yalnızca supabase.js import
// eder.** Uygulamanın geri kalanı bu dosyanın sözleşmesini görür. Kuralın
// bozulmadığını backend.test.js kontrol ediyor, çünkü bu tür kurallar yorum
// olarak yazıldığında altı ay dayanır, test olarak yazıldığında kalıcıdır.
//
// YAPILANDIRILMAMIŞ HALDE DE ÇALIŞIR
//
// Ortam değişkenleri yoksa uygulama çökmüyor, "yalnız-yerel kip"te açılıyor:
// bugünkü davranışın aynısı, veri localStorage'da, giriş ekranı yok. Bu, bu
// dosyanın var olmasının uygulamayı bozamaması demek — ve senkron katmanı
// gelene kadar da öyle kalması gerekiyor.

import * as supabase from './supabase.js'

/**
 * Sunucu tarafı yapılandırılmış mı?
 *
 * false ise çağıran taraf sunucuya hiç gitmemeli; uygulama yalnız-yerel
 * çalışır. UI bunu "giriş ekranını göster mi" kararında kullanıyor.
 */
export function isBackendConfigured() {
  return supabase.isConfigured()
}

/** Yapılandırma nereden okundu, ne eksik — Ayarlar ekranında gösterilir. */
export function backendStatus() {
  return supabase.status()
}

// --- Oturum ---------------------------------------------------------------

/**
 * E-postaya tek kullanımlık giriş bağlantısı yollar (magic link).
 *
 * Parola yok: tek kullanıcılık bir üründe parola, kullanıcının hatırlaması
 * gereken bir sır ve bizim saklamamız gereken bir sorumluluk ekler; ikisi de
 * karşılığında bir şey vermiyor. Telefonda parola yazmak zaten en sevilmeyen
 * ekran.
 *
 * @returns {Promise<{ok: boolean, error?: string}>} — asla throw etmez.
 */
export function sendMagicLink(email) {
  return supabase.sendMagicLink(email)
}

/**
 * E-posta + parola ile giriş. Hiçbir e-posta gönderilmez.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export function signInWithPassword(email, password) {
  return supabase.signInWithPassword(email, password)
}

/** Açık oturuma parola atar/değiştirir. Eski parola gerekmez. */
export function setPassword(password) {
  return supabase.setPassword(password)
}

/** Oturumu kapatır ve yerel oturum belirtecini siler. */
export function signOut() {
  return supabase.signOut()
}

/**
 * Şu anki oturum, ya da giriş yapılmamışsa null.
 * @returns {Promise<{userId: string, email: string} | null>}
 */
export function getSession() {
  return supabase.getSession()
}

/**
 * Oturum değişikliklerini dinler (giriş, çıkış, belirtecin yenilenmesi).
 * @returns {() => void} aboneliği bırakan fonksiyon
 */
export function onAuthChange(callback) {
  return supabase.onAuthChange(callback)
}

// --- Veri -----------------------------------------------------------------

/**
 * `cursor`dan sonra değişen satırlar. Silinmiş olanlar da gelir.
 * @returns {Promise<{ok, transactions?, portfolios?, settings?, serverNow?, error?}>}
 */
export function pull(cursor) {
  return supabase.pull(cursor)
}

/**
 * Satırları yazar. Portföyler işlemlerden önce gider (yabancı anahtar).
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export function push(payload) {
  return supabase.push(payload)
}

/**
 * Karşı cihaz yazdığında haber verir. Yükü taşımaz, yalnızca sinyaldir —
 * çağıran normal bir pull yapar.
 * @returns {() => void} aboneliği bırakan fonksiyon
 */
export function subscribeToChanges(userId, onChange) {
  return supabase.subscribeToChanges(userId, onChange)
}

/**
 * Paylaşılan fiyat tablosunu okur. Dış kaynağa gitmez.
 * @returns {Promise<{ok, quotes?, error?}>}
 */
export function readPrices() {
  return supabase.readPrices()
}

/** Oturum belirteciyle imzalanmış istek — kendi /api/* uçlarımız için. */
export function authorizedFetch(path, options) {
  return supabase.authorizedFetch(path, options)
}

export { SYNCED_SETTINGS, txToDb, txFromDb, portfolioToDb, portfolioFromDb, settingsToDb, settingsFromDb } from './mapping.js'
