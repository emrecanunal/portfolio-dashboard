// Senkronu ne zaman çalıştıracağımıza karar veren yer.
//
// BEŞ TETİKLEYİCİ, HER BİRİ AYRI BİR SORUYA CEVAP
//
//   açılış           → "bu cihaz yokken ne oldu?"
//   store değişimi   → "az önce girdiğim şey karşıya geçsin"  (2 sn beklemeli)
//   sekme odağı      → "telefonu bırakıp masaüstüne döndüm"
//   realtime         → "karşı cihaz bir şey yazdı"
//   online           → "ağ geri geldi, biriken varsa gitsin"
//
// Realtime tek başına yeterli görünebilir ama değil: mesaj kaçabilir, soket
// kopabilir, uygulama uykudayken hiçbir şey gelmez. Diğer dördü o boşlukları
// kapatıyor ve hepsi aynı imleçten çalıştığı için tekrarları zararsız.
//
// DEBOUNCE NEDEN 2 SANİYE
//
// Bir işlem eklemek store'a tek yazma gibi görünmüyor: modal alan alan
// güncelliyor. Debounce olmasaydı her tuş vuruşu bir gönderim tetiklerdi.
// İki saniye, yazmayı bitirip düğmeye basacak kadar uzun, "kaydettim ama
// telefonda yok" dedirtmeyecek kadar kısa.

import { useEffect, useRef } from 'react'
import { usePortfolioStore } from '../lib/store.js'
import { syncNow } from '../lib/sync.js'
import { isBackendConfigured, subscribeToChanges } from '../lib/backend/index.js'

const DEBOUNCE_MS = 2000

export function SyncProvider({ userId }) {
  const timer = useRef(null)

  useEffect(() => {
    if (!isBackendConfigured() || !userId) return

    let alive = true
    const run = () => { if (alive) syncNow(userId) }

    run()

    // Store'un YALNIZCA outbox'ını dinliyoruz. Tüm store'a abone olsaydık,
    // her fiyat yenilemesi (dakikada bir, 147 sembol) bir senkron turu
    // tetiklerdi — oysa fiyatlar senkronlanmıyor bile.
    const unsubscribeStore = usePortfolioStore.subscribe(
      (s) => s.outbox,
      () => {
        clearTimeout(timer.current)
        timer.current = setTimeout(run, DEBOUNCE_MS)
      },
    )

    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', run)

    const unsubscribeRealtime = subscribeToChanges(userId, run)

    return () => {
      alive = false
      clearTimeout(timer.current)
      unsubscribeStore()
      unsubscribeRealtime()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', run)
    }
  }, [userId])

  return null
}
