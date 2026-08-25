// Senkronun muhasebesi.
//
// Buradaki her test, kaybolan bir satırın senaryosu. Senkron hatalarının ortak
// özelliği sessiz olmaları: hiçbir şey kırmızı yanmıyor, uygulama açılıyor,
// sayılar makul görünüyor — yalnızca bir işlem eksik. O yüzden bu dosya
// "çalışıyor mu"yu değil, "ne kaybolabilir"i sınıyor.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

let usePortfolioStore
let laggedCursor

beforeAll(async () => {
  const mem = new Map()
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  }
  ;({ usePortfolioStore } = await import('./store.js'))
  ;({ laggedCursor } = await import('./sync.js'))
})

const TX = (id, over = {}) => ({
  id, portfolioId: 'p1', type: 'buy', assetType: 'bist', symbol: 'THYAO',
  quantity: 1, price: 10, fee: 0, currency: 'TRY', date: '2026-01-01', notes: '',
  ...over,
})

function seed({ transactions = [], subPortfolios = [{ id: 'p1', name: 'P', color: '#000' }] } = {}) {
  usePortfolioStore.setState({
    transactions,
    subPortfolios,
    outbox: { transactions: {}, portfolios: {}, settings: false },
    syncMeta: { cursor: null, lastSyncAt: null, lastError: null, status: 'idle' },
  })
}

beforeEach(() => seed())

describe('outbox: yerel degisiklikler isaretleniyor', () => {
  it('ekleme upsert olarak girer', () => {
    usePortfolioStore.getState().addTransaction(TX('ignored'))
    const { transactions, outbox } = usePortfolioStore.getState()
    expect(outbox.transactions[transactions[0].id]).toBe('upsert')
  })

  it('silme delete olarak girer — satir gitse bile', () => {
    seed({ transactions: [TX('t1')] })
    usePortfolioStore.getState().deleteTransaction('t1')
    const { transactions, outbox } = usePortfolioStore.getState()
    expect(transactions).toHaveLength(0)
    // Satır yerelden gitti ama kutuda kaydı DURUYOR. Durmasaydı sunucu onu
    // hiç öğrenmez ve bir sonraki cekmede geri gelirdi.
    expect(outbox.transactions.t1).toBe('delete')
  })

  it('tema ve dil kutuya girmez — cihaza ait, kisiye degil', () => {
    usePortfolioStore.getState().setTheme('light')
    usePortfolioStore.getState().setLanguage('tr')
    expect(usePortfolioStore.getState().outbox.settings).toBe(false)
  })

  it('ayar degisikligi kutuya girer', () => {
    usePortfolioStore.getState().updateSettings({ fireTargetUSD: 500000 })
    expect(usePortfolioStore.getState().outbox.settings).toBe(true)
  })
})

describe('toptan degistirme: kaybolan satirlar mezar tasi alir', () => {
  // Bu, senkronun en sinsi hatası. 364 işlemi 256'lık bir yedekle
  // değiştirdiğinde aradaki 108 satır YALNIZCA yerelden gider; sunucuda öylece
  // durur ve bir sonraki çekmede geri gelir. Kullanıcı geri yükleme yapar,
  // birkaç dakika sonra sildiklerinin geri geldiğini görür.
  it('yedekten geri yukleme, gitmis satirlari silinmis isaretler', () => {
    seed({ transactions: [TX('eski-1'), TX('eski-2'), TX('kalan')] })

    usePortfolioStore.getState().restoreFromBackup({
      transactions: [TX('kalan'), TX('yeni')],
      subPortfolios: [{ id: 'p1', name: 'P', color: '#000' }],
    })

    const { outbox } = usePortfolioStore.getState()
    expect(outbox.transactions['eski-1']).toBe('delete')
    expect(outbox.transactions['eski-2']).toBe('delete')
    expect(outbox.transactions['kalan']).toBe('upsert')
    expect(outbox.transactions['yeni']).toBe('upsert')
  })

  it('hepsini temizle, her isleme mezar tasi koyar', () => {
    seed({ transactions: [TX('t1'), TX('t2')] })
    usePortfolioStore.getState().clearAllTransactions()
    const { outbox } = usePortfolioStore.getState()
    expect(outbox.transactions).toEqual({ t1: 'delete', t2: 'delete' })
  })
})

describe('applyPulled: sunucudan gelenleri birlestirme', () => {
  it('kirli satira DOKUNMAZ', () => {
    seed({ transactions: [TX('t1', { price: 10 })] })
    usePortfolioStore.getState().updateTransaction('t1', { price: 999 })

    // Sunucu hâlâ eski fiyatı biliyor; bizimki henüz gitmedi.
    usePortfolioStore.getState().applyPulled({
      transactions: [{ ...TX('t1', { price: 10 }), deleted_at: null }],
      portfolios: [],
      cursor: '2026-01-01T00:00:00.000Z',
    })

    expect(usePortfolioStore.getState().transactions[0].price).toBe(999)
  })

  it('kirli olmayan satirda sunucu kazanir', () => {
    seed({ transactions: [TX('t1', { price: 10 })] })
    usePortfolioStore.getState().applyPulled({
      transactions: [{ ...TX('t1', { price: 42 }), deleted_at: null }],
      portfolios: [],
      cursor: 'c',
    })
    expect(usePortfolioStore.getState().transactions[0].price).toBe(42)
  })

  it('mezar tasi satiri yerelden dusurur ve veri modeline sizmaz', () => {
    seed({ transactions: [TX('t1'), TX('t2')] })
    usePortfolioStore.getState().applyPulled({
      transactions: [
        { ...TX('t1'), deleted_at: '2026-01-02T00:00:00Z' },
        { ...TX('t2'), deleted_at: null },
      ],
      portfolios: [],
      cursor: 'c',
    })
    const { transactions } = usePortfolioStore.getState()
    expect(transactions.map((t) => t.id)).toEqual(['t2'])
    expect(transactions[0]).not.toHaveProperty('deleted_at')
  })

  it('siralamayi bozmaz, yenileri sona ekler', () => {
    seed({ transactions: [TX('a'), TX('b')] })
    usePortfolioStore.getState().applyPulled({
      transactions: [{ ...TX('c'), deleted_at: null }, { ...TX('a', { price: 5 }), deleted_at: null }],
      portfolios: [],
      cursor: 'c',
    })
    expect(usePortfolioStore.getState().transactions.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('bekleyen ayar degisikligi varken sunucunun ayarlarini almaz', () => {
    usePortfolioStore.getState().updateSettings({ fireTargetUSD: 500000 })
    usePortfolioStore.getState().applyPulled({
      settings: { fireTargetUSD: 111 },
      cursor: 'c',
    })
    expect(usePortfolioStore.getState().settings.fireTargetUSD).toBe(500000)
  })
})

describe('clearOutbox: gonderim sirasinda gireni yutmaz', () => {
  it('gonderim devam ederken eklenen islem kutuda kalir', () => {
    seed({ transactions: [TX('t1')] })
    usePortfolioStore.getState().updateTransaction('t1', { price: 1 })

    // Gönderim başladı: t1 yola çıktı.
    const sent = { transactions: { t1: 'upsert' }, portfolios: {}, settings: false }

    // Gönderim SÜRERKEN kullanıcı yeni bir işlem girdi.
    usePortfolioStore.getState().addTransaction(TX('ignored'))
    const yeniId = usePortfolioStore.getState().transactions.at(-1).id

    // Gönderim başarıyla döndü ve kutu temizlendi.
    usePortfolioStore.getState().clearOutbox(sent)

    const { outbox } = usePortfolioStore.getState()
    expect(outbox.transactions.t1).toBeUndefined()      // gitti
    expect(outbox.transactions[yeniId]).toBe('upsert')  // duruyor
  })

  it('ayni satir gonderim sirasinda tekrar degistiyse kutuda kalir', () => {
    seed({ transactions: [TX('t1')] })
    usePortfolioStore.getState().deleteTransaction('t1')          // delete
    const sent = { transactions: { t1: 'upsert' }, portfolios: {}, settings: false }
    usePortfolioStore.getState().clearOutbox(sent)
    // Gönderilen 'upsert'tü, kutudaki 'delete'. Aynı şey değil, düşmemeli.
    expect(usePortfolioStore.getState().outbox.transactions.t1).toBe('delete')
  })
})

describe('markEverythingDirty: ilk senkron', () => {
  it('her satiri ve ayarlari kirli isaretler', () => {
    seed({ transactions: [TX('t1'), TX('t2')], subPortfolios: [{ id: 'p1', name: 'P', color: '#000' }] })
    usePortfolioStore.getState().markEverythingDirty()
    const { outbox } = usePortfolioStore.getState()
    expect(outbox.transactions).toEqual({ t1: 'upsert', t2: 'upsert' })
    expect(outbox.portfolios).toEqual({ p1: 'upsert' })
    expect(outbox.settings).toBe(true)
  })
})

describe('laggedCursor', () => {
  // Damga satır YAZILIRKEN konuyor, satır COMMIT edilince görünüyor ve ikisinin
  // sırası aynı olmak zorunda değil. İmleci ham max(updated_at) olarak
  // saklamak, geç commit eden bir işlemin satırlarını sonsuza kadar imlecin
  // gerisinde bırakırdı.
  it('imleci 30 saniye geri alir', () => {
    const c = laggedCursor('2026-08-25T12:00:30.000Z')
    expect(c).toBe('2026-08-25T12:00:00.000Z')
  })

  it('gecersiz damgada null doner — bozuk imlec saklamaktansa bastan cekmek', () => {
    expect(laggedCursor('bir sey degil')).toBeNull()
  })
})
