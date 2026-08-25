// Giriş yapılmadan uygulamaya girilmesin — ama yalnızca sunucu varsa.
//
// ÜÇ HAL, VE ÜÇÜNCÜSÜ NEDEN VAR
//
//   1. Sunucu yapılandırılmamış  → uygulamayı olduğu gibi göster.
//   2. Yapılandırılmış, oturum yok → giriş ekranı.
//   3. Yapılandırılmış, oturum var → uygulama.
//
// Birinci hal, bu bileşenin var olmasının mevcut kurulumu bozamaması demek.
// Anahtarsız bir `npm run dev`, bir arkadaşın klonladığı depo, ya da senkron
// katmanı henüz bağlanmamış bir dal — hepsi bugünkü davranışı görür: veri
// localStorage'da, giriş ekranı yok. Kapıyı koşulsuz koysaydık, anahtarları
// olmayan herkes için uygulama bir giriş ekranının arkasında kilitli kalırdı.
//
// BEKLEME EKRANI NEDEN BOŞ
//
// getSession() diskten okuyor, yani bir kare sürüyor. O kareye "Giriş yap"
// bassaydık, zaten girişli olan kullanıcı her açılışta giriş ekranının bir an
// parlayıp kaybolduğunu görürdü. Bilinmiyorken hiçbir şey iddia etmemek, yanlış
// şeyi iddia edip düzeltmekten iyi.

import { useEffect, useState } from 'react'
import { isBackendConfigured, getSession, onAuthChange } from '../lib/backend/index.js'
import { SignIn } from '../pages/SignIn.jsx'

export function AuthGate({ children }) {
  const configured = isBackendConfigured()

  // undefined = henüz bilmiyoruz, null = giriş yok, nesne = giriş var
  const [user, setUser] = useState(configured ? undefined : null)

  useEffect(() => {
    if (!configured) return
    let alive = true

    getSession().then((u) => {
      if (alive) setUser(u)
    })

    // Giriş bağlantısıyla dönüldüğünde, çıkış yapıldığında ve belirteç
    // yenilendiğinde tetiklenir. Aboneliği bırakmak şart: React 18'in
    // StrictMode'u geliştirme sırasında effect'leri iki kez koşturuyor ve
    // bırakılmayan abonelikler ikizleniyor.
    const unsubscribe = onAuthChange((u) => {
      if (alive) setUser(u)
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [configured])

  if (!configured) return children
  if (user === undefined) return null
  if (!user) return <SignIn />
  return children
}
