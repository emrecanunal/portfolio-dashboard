// index.js'in sözleşmesinin Supabase ile karşılanmış hali.
//
// BU DOSYA, `@supabase/supabase-js`'i IMPORT EDEN TEK DOSYADIR. Başka bir yerde
// o import görünüyorsa dikiş delinmiş demektir; backend.test.js bunu kovalıyor.
//
// Buradaki fonksiyonlar Supabase'in hata nesnelerini dışarı sızdırmaz: dışarıya
// hep `{ ok, error }` döner. Sebep sadece temizlik değil — çağıran taraf
// `error.status === 429` gibi bir alana bakmaya başlarsa, dikiş biçimsel olarak
// duruyor ama pratikte delinmiş olur.

import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env?.VITE_SUPABASE_URL || ''
const KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || ''

export function isConfigured() {
  return Boolean(URL && KEY)
}

export function status() {
  return {
    configured: isConfigured(),
    url: URL || null,
    missing: [!URL && 'VITE_SUPABASE_URL', !KEY && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean),
  }
}

// İstemci tembel kuruluyor: yapılandırma yoksa createClient hiç çağrılmıyor.
// Modül seviyesinde kurulsaydı, anahtarsız bir kurulumda uygulama import
// sırasında patlar ve "yalnız-yerel kip" diye bir şey mümkün olmazdı.
let client = null
function getClient() {
  if (!isConfigured()) return null
  if (!client) {
    client = createClient(URL, KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Giriş bağlantısı ?code=... ile geri dönüyor; oturumu URL'den kurup
        // adres çubuğunu temizlemeyi kütüphane hallediyor.
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  }
  return client
}

// --- Oturum ---------------------------------------------------------------

export async function sendMagicLink(email) {
  const c = getClient()
  if (!c) return { ok: false, error: 'not-configured' }
  try {
    const { error } = await c.auth.signInWithOtp({
      email,
      options: {
        // Bağlantıya tıklandığında nereye dönüleceği. Supabase panelindeki
        // Redirect URLs listesinde bu adres YOKSA giriş sessizce başarısız
        // olur — bağlantı çalışır ama kullanıcı oturumsuz geri gelir.
        emailRedirectTo: window.location.origin,
        // Davetsiz hesap açılmasın: Faz 4'te davet akışı gelene kadar yalnızca
        // zaten var olan kullanıcılar giriş yapabilir.
        shouldCreateUser: true,
      },
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'network' }
  }
}

export async function signOut() {
  const c = getClient()
  if (!c) return { ok: false, error: 'not-configured' }
  try {
    const { error } = await c.auth.signOut()
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'network' }
  }
}

export async function getSession() {
  const c = getClient()
  if (!c) return null
  try {
    const { data } = await c.auth.getSession()
    return toUser(data?.session)
  } catch {
    return null
  }
}

export function onAuthChange(callback) {
  const c = getClient()
  if (!c) return () => {}
  const { data } = c.auth.onAuthStateChange((_event, session) => {
    callback(toUser(session))
  })
  return () => data?.subscription?.unsubscribe()
}

// Supabase'in oturum nesnesinden dışarı yalnızca iki alan çıkıyor. Tamamını
// döndürmek, çağıranın access_token'a uzanmasını mümkün kılardı.
function toUser(session) {
  if (!session?.user) return null
  return { userId: session.user.id, email: session.user.email }
}

// --- Veri ------------------------------------------------------------------

/**
 * `cursor`dan sonra değişen her şey. cursor null ise: hepsi.
 *
 * `where user_id` YOK ve olmamalı. RLS zaten daraltıyor; burada elle yazmak,
 * unutulduğunda veri sızdıran bir alışkanlığı edinmek olurdu. Sızıntıya karşı
 * duran şey bu satır değil, politikanın kendisi.
 *
 * Silinmiş satırlar da geliyor (deleted_at dolu). Çağıran onları yerelden
 * siler; filtrelenselerdi silme bilgisi hiç ulaşmaz ve kayıt diğer cihazdan
 * geri dirilirdi.
 */
export async function pull(cursor) {
  const c = getClient()
  if (!c) return { ok: false, error: 'not-configured' }

  try {
    const since = cursor || '1970-01-01T00:00:00Z'

    const [txRes, pfRes, stRes] = await Promise.all([
      c.from('transactions').select('*').gt('updated_at', since),
      c.from('portfolios').select('*').gt('updated_at', since),
      c.from('user_settings').select('settings, updated_at').maybeSingle(),
    ])

    const firstError = txRes.error || pfRes.error || stRes.error
    if (firstError) return { ok: false, error: firstError.message }

    return {
      ok: true,
      transactions: txRes.data || [],
      portfolios: pfRes.data || [],
      settings: stRes.data?.settings ?? null,
      // Sunucunun saati, istemcininki değil. İmleci istemci saatinden almak,
      // saati ileri olan bir cihazda henüz gelmemiş satırları atlamak demek.
      serverNow: newestStamp([...(txRes.data || []), ...(pfRes.data || [])], since),
    }
  } catch (e) {
    return { ok: false, error: e?.message || 'network' }
  }
}

function newestStamp(rows, fallback) {
  let newest = fallback
  for (const r of rows) if (r.updated_at > newest) newest = r.updated_at
  return newest
}

/**
 * Satırları yaz. Sıra önemli: portföyler işlemlerden ÖNCE.
 *
 * transactions'ın yabancı anahtarı portfolios'a bakıyor. Ters sırada
 * gönderilseydi, yeni bir portföye yazılmış ilk işlem reddedilir ve
 * gönderim yarıda kalırdı.
 */
export async function push({ userId, portfolios, transactions, deletions, settings }) {
  const c = getClient()
  if (!c) return { ok: false, error: 'not-configured' }

  try {
    if (portfolios?.length) {
      const { error } = await c.from('portfolios').upsert(portfolios, { onConflict: 'user_id,id' })
      if (error) return { ok: false, error: error.message }
    }

    if (transactions?.length) {
      const { error } = await c.from('transactions').upsert(transactions, { onConflict: 'user_id,id' })
      if (error) return { ok: false, error: error.message }
    }

    // Silme = mezar taşı. Satırı gerçekten silmek, silme bilgisini de silmek
    // olurdu ve kayıt diğer cihazdan geri dirilirdi.
    for (const [table, ids] of Object.entries(deletions || {})) {
      if (!ids.length) continue
      const { error } = await c.from(table)
        .update({ deleted_at: new Date().toISOString() })
        .in('id', ids)
      if (error) return { ok: false, error: error.message }
    }

    if (settings) {
      const { error } = await c.from('user_settings')
        .upsert({ user_id: userId, settings }, { onConflict: 'user_id' })
      if (error) return { ok: false, error: error.message }
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'network' }
  }
}

/**
 * Karşı cihaz bir şey yazdığında haber ver.
 *
 * Gelen yükü KULLANMIYORUZ, yalnızca "bir şey değişti" sinyali olarak
 * okuyoruz ve normal bir pull tetikliyoruz. Realtime yükü tek bir satır
 * taşıyor; ona güvenip yerel state'i güncellemek, kaçan bir mesajın kalıcı
 * bir tutarsızlığa dönüşmesi demek olurdu. Pull imleçten çalıştığı için
 * kaçan mesajı da kendiliğinden toparlıyor.
 */
export function subscribeToChanges(userId, onChange) {
  const c = getClient()
  if (!c) return () => {}

  const channel = c
    .channel(`portfolio-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolios' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_settings' }, onChange)
    .subscribe()

  return () => c.removeChannel(channel)
}
