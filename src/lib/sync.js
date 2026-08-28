// Senkron motoru: gönder, çek, birleştir.
//
// MODEL: LOCAL-FIRST
//
// localStorage gerçeğin kaynağı olmaktan çıkıp önbelleğe dönüştü, ama arayüz
// hâlâ yalnızca ondan okuyor. Yani uygulama uçakta da açılıyor, ağ gelince
// kendini topluyor, ve hiçbir ekran "yükleniyor" diye beklemiyor.
//
// SIRALAMA: ÖNCE GÖNDER, SONRA ÇEK
//
// Tersi de çalışırdı ama bir yarış açardı: çekilen satırlar birleşirken henüz
// gönderilmemiş yerel değişikliklerin üstüne yazabilirdi. Önce göndermek, çekme
// başladığında sunucunun bizim son hâlimizi zaten bilmesini garantiliyor.
// Ayrıca `mergeRows` kirli satırlara hiç dokunmuyor — aynı şeyin ikinci kez
// güvenceye alınması, çünkü gönderim yarıda kalabilir.

import { usePortfolioStore } from './store.js'
import {
  pull as backendPull,
  push as backendPush,
  txToDb, txFromDb,
  portfolioToDb, portfolioFromDb,
  settingsToDb, settingsFromDb,
} from './backend/index.js'

// İmleç ne kadar geriden sorulacak.
//
// Damga satır YAZILIRKEN konuyor, satır ise COMMIT edilince görünür oluyor ve
// ikisinin sırası aynı olmak zorunda değil: T1'de başlayan bir işlem, T2'de
// başlayıp önce commit eden bir işlemden sonra commit edebilir. İmleci ham
// max(updated_at) olarak saklasaydık, T1 damgalı o satırlar imlecin gerisinde
// kalır ve bir daha HİÇ çekilmezdi.
//
// 30 saniye, bu uygulamanın işlem sürelerinin çok üstünde. Bedeli her turda
// birkaç satırın tekrar gelmesi; birleştirme id üzerinden idempotent olduğu
// için zararsız.
const CURSOR_LAG_MS = 30_000

let inFlight = null

/**
 * Bir tur senkron. Aynı anda ikinci bir tur başlatılamaz.
 *
 * Eşzamanlı çağrı gerçekten oluyor: açılışta bir kez, realtime sinyaliyle bir
 * kez, sekme odağıyla bir kez — üçü aynı saniyeye düşebiliyor. Kilit olmasaydı
 * aynı satırlar iki kez gönderilir ve outbox'ın muhasebesi karışırdı.
 */
export function syncNow(userId) {
  if (inFlight) return inFlight
  inFlight = runSync(userId).finally(() => { inFlight = null })
  return inFlight
}

async function runSync(userId) {
  const store = usePortfolioStore.getState()
  store.setSyncStatus('syncing')

  try {
    // Bu tarayıcı hiç senkronlanmadıysa elindeki her şey "yeni"dir. Buradaki
    // koşul imlecin null olması — outbox'ın boş olması DEĞİL, çünkü boş bir
    // outbox "gönderilecek bir şey yok" anlamına da gelir ve ikisi karıştırılırsa
    // 364 işlem sunucuya hiç çıkmaz.
    // ...ama YALNIZCA bir kez. `adopted` bunu ayırıyor: imleç sıfır olabilir
    // çünkü tarayıcı yeni (benimse) ya da çünkü kullanıcı "tümünü yeniden çek"
    // dedi (benimseME — o düğme sunucunun doğru olduğunu söylüyor). İkisini
    // yalnızca imlece bakarak ayırt etmek, ikinci durumda yereldeki artıkları
    // sunucuya geri diriltmek demekti.
    if (store.syncMeta.cursor === null && !store.syncMeta.adopted) {
      store.markEverythingDirty()
    }

    // Çift id kontrolü gönderimden ÖNCE, her turda. Sunucudaki anahtar
    // (user_id, id) olduğu için çakışan iki satırdan biri diğerinin üstüne
    // yazılır ve bir sonraki çekişte yereldeki de silinir — sessizce. Burası o
    // veriyi kaybetmeden önceki son nokta. Ucuz: id kümesi zaten bellekte.
    const renamed = usePortfolioStore.getState().dedupeIds()
    if (renamed) {
      console.warn(`[sync] ${renamed} çakışan id yeniden adlandırıldı; gönderim öncesi düzeltildi.`)
    }

    const pushed = await pushOutbox(userId)
    if (!pushed.ok) return fail(pushed.error)

    const pulled = await pullSince()
    if (!pulled.ok) return fail(pulled.error)

    usePortfolioStore.getState().setSyncStatus('idle')
    return { ok: true }
  } catch (e) {
    return fail(e?.message || 'unknown')
  }
}

function fail(error) {
  usePortfolioStore.getState().setSyncStatus('error', error)
  return { ok: false, error }
}

// --- Gönderme --------------------------------------------------------------

async function pushOutbox(userId) {
  // Kimliksiz gönderim yapma. Bunu sunucuya sormak, satırın user_id'si boş
  // gittiği için "new row violates row-level security policy" ile geri
  // dönüyordu — doğru bir ret ama okuyana hiçbir şey anlatmayan bir cümle,
  // ve çağıranın oturum nesnesinden yanlış alanı okuduğunu (user.id, oysa
  // getSession() { userId, email } döndürüyor) hiç söylemiyor.
  if (!userId) return { ok: false, error: 'no-user-id' }

  const s = usePortfolioStore.getState()
  const { outbox } = s

  const txIds = Object.keys(outbox.transactions)
  const pfIds = Object.keys(outbox.portfolios)
  if (!txIds.length && !pfIds.length && !outbox.settings) return { ok: true }

  const byId = {
    transactions: new Map(s.transactions.map((r) => [r.id, r])),
    portfolios: new Map(s.subPortfolios.map((r) => [r.id, r])),
  }

  const upserts = { transactions: [], portfolios: [] }
  const deletions = { transactions: [], portfolios: [] }

  for (const [kind, ids] of [['transactions', txIds], ['portfolios', pfIds]]) {
    for (const id of ids) {
      const row = byId[kind].get(id)
      // 'upsert' işaretli ama artık yerelde olmayan satır: aradaki bir
      // toptan değiştirme onu götürmüş. Silme sayılır — göndermeye çalışmak
      // undefined'ı serialize etmeye çalışmak olurdu.
      if (outbox[kind][id] === 'delete' || !row) {
        deletions[kind].push(id)
      } else {
        upserts[kind].push(
          kind === 'transactions'
            ? txToDb(row, userId)
            : portfolioToDb(row, userId, s.subPortfolios.indexOf(row)),
        )
      }
    }
  }

  const result = await backendPush({
    userId,
    portfolios: upserts.portfolios,
    transactions: upserts.transactions,
    deletions,
    settings: outbox.settings ? settingsToDb(s.settings) : null,
  })

  if (!result.ok) return result

  // Gönderilen tam olarak neydi — kutudan yalnızca o düşecek. Gönderim
  // SIRASINDA girilen bir işlem kutuda kalmalı, yoksa sessizce kaybolur.
  usePortfolioStore.getState().clearOutbox({
    transactions: Object.fromEntries([...txIds].map((id) => [id, outbox.transactions[id]])),
    portfolios: Object.fromEntries([...pfIds].map((id) => [id, outbox.portfolios[id]])),
    settings: outbox.settings,
  })

  return { ok: true }
}

// --- Çekme -----------------------------------------------------------------

async function pullSince() {
  const s = usePortfolioStore.getState()
  const result = await backendPull(s.syncMeta.cursor)
  if (!result.ok) return result

  usePortfolioStore.getState().applyPulled({
    transactions: result.transactions.map(toLocalTx),
    portfolios: result.portfolios.map(toLocalPortfolio),
    settings: result.settings ? settingsFromDb(result.settings) : null,
    cursor: laggedCursor(result.serverNow),
  })

  return { ok: true }
}

// Mezar taşı, uygulama şeklindeki satırın üstünde tek fazladan alan olarak
// taşınıyor. mergeRows onu okuyup atıyor; veri modeline girmiyor.
function toLocalTx(row) {
  return { ...txFromDb(row), deleted_at: row.deleted_at }
}

function toLocalPortfolio(row) {
  return { ...portfolioFromDb(row), deleted_at: row.deleted_at }
}

export function laggedCursor(serverNow) {
  const t = new Date(serverNow).getTime()
  if (!isFinite(t)) return null
  return new Date(t - CURSOR_LAG_MS).toISOString()
}
