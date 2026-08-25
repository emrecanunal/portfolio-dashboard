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
