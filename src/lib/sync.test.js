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

// Kasa: paranın girip çıktığı portföy.
describe('setCashAccount', () => {
  const P = (id, over = {}) => ({ id, name: id, color: '#000', ...over })

  it('birini isaretler', () => {
    seed({ subPortfolios: [P('kasa'), P('t3')] })
    usePortfolioStore.getState().setCashAccount('kasa')
    const byId = Object.fromEntries(usePortfolioStore.getState().subPortfolios.map((p) => [p.id, p]))
    expect(byId.kasa.isCashAccount).toBe(true)
    // toBe(false) DEGIL: setCashAccount zaten eslesen portfoylere hic
    // dokunmuyor, cunku dokunmak onlari bosuna senkron kuyruguna sokardi. Yani
    // isaretsiz bir portfoyde alan hic yazilmamis kalabiliyor. Bayragin
    // YOKLUGU zaten "kasa degil" demek; okuyan her yer Boolean()'dan geciriyor.
    expect(byId.t3.isCashAccount).toBeFalsy()
  })

  // "Paranin girdigi yer" birden fazla olamaz — olursa soru tekrar cevapsiz
  // kalir. Kullanicidan once eskisini kapatmasini istemek, unutuldugunda iki
  // kasali ve sessizce anlamsiz bir duruma yol acardi.
  it('yenisini isaretlemek eskisinin isaretini kaldirir', () => {
    seed({ subPortfolios: [P('kasa', { isCashAccount: true }), P('t3')] })
    usePortfolioStore.getState().setCashAccount('t3')
    const byId = Object.fromEntries(usePortfolioStore.getState().subPortfolios.map((p) => [p.id, p]))
    expect(byId.kasa.isCashAccount).toBe(false)
    expect(byId.t3.isCashAccount).toBe(true)
  })

  it('null hepsini temizler', () => {
    seed({ subPortfolios: [P('kasa', { isCashAccount: true })] })
    usePortfolioStore.getState().setCashAccount(null)
    expect(usePortfolioStore.getState().subPortfolios[0].isCashAccount).toBe(false)
  })

  // Degisen portfoy senkrona girmeli, degismeyen girmemeli: gereksiz gonderim
  // her turda tekrarlanir ve outbox hic bosalmamis gibi gorunur.
  it('yalnizca degisen portfoyler kutuya girer', () => {
    seed({ subPortfolios: [P('kasa'), P('t3'), P('mixed')] })
    usePortfolioStore.getState().setCashAccount('kasa')
    expect(Object.keys(usePortfolioStore.getState().outbox.portfolios)).toEqual(['kasa'])
  })
})

describe('setOpeningBalance', () => {
  const P = (id) => ({ id, name: id, color: '#000' })
  const openings = () => usePortfolioStore.getState().transactions.filter((t) => t.type === 'opening')

  it('yoksa olusturur', () => {
    seed({ subPortfolios: [P('t3')] })
    usePortfolioStore.getState().setOpeningBalance('t3', { amount: 50000, date: '2023-01-01' })
    expect(openings()).toHaveLength(1)
    expect(openings()[0].price).toBe(50000)
    expect(openings()[0].assetType).toBe('cash')
  })

  // Ikinci bir kayit bir duzeltme degil, sessizce ikiye katlanmis bir bakiye
  // olurdu — ve hicbir ekran "burada iki baslangic var" demezdi.
  it('varsa gunceller, ikinciyi olusturmaz', () => {
    seed({ subPortfolios: [P('t3')] })
    const set = usePortfolioStore.getState().setOpeningBalance
    set('t3', { amount: 50000, date: '2023-01-01' })
    set('t3', { amount: 75000, date: '2023-01-01' })
    expect(openings()).toHaveLength(1)
    expect(openings()[0].price).toBe(75000)
  })

  it('sifir ya da bos verilince kaydi siler', () => {
    seed({ subPortfolios: [P('t3')] })
    const set = usePortfolioStore.getState().setOpeningBalance
    set('t3', { amount: 50000, date: '2023-01-01' })
    const id = openings()[0].id
    set('t3', { amount: '' })
    expect(openings()).toHaveLength(0)
    // Silme sunucuya da gitmeli, yoksa bir sonraki cekmede geri gelir.
    expect(usePortfolioStore.getState().outbox.transactions[id]).toBe('delete')
  })

  it('her portfoy kendi baslangicini tutar', () => {
    seed({ subPortfolios: [P('t3'), P('mixed')] })
    const set = usePortfolioStore.getState().setOpeningBalance
    set('t3', { amount: 1000, date: '2023-01-01' })
    set('mixed', { amount: 2000, date: '2023-01-01' })
    expect(openings()).toHaveLength(2)
  })
})

// ÇİFT ID — 28 AĞUSTOS 2026'DA KAYBEDİLEN 39 İŞLEM
//
// Sunucudaki birincil anahtar (user_id, id). Aynı id'yi taşıyan iki satır
// gönderildiğinde ikincisi birincinin üstüne yazılıyor ve bir sonraki çekişte o
// tek satır yereldeki diğerinin de üstüne iniyor. Kaybın görünür hiçbir belirtisi
// yok: senkron "başarılı" diyor, uygulama açılıyor, yalnızca 39 işlem yok.
//
// Gerçekte olan buydu: içe aktarım betiği iki Investing.com dosyasına da 'inv'
// önekini verdi, T3'ün CRDFA alışı ile Amerika'nın TEM satışı aynı `inv-39`
// id'sini paylaştı, ve T3'ün 28 pozisyonunun tamamı yok oldu.
describe('cift id korumasi', () => {
  const dedupe = () => usePortfolioStore.getState().dedupeIds()

  it('cakisan ikinci satira yeni id verir', () => {
    seed({ transactions: [TX('inv-39'), TX('inv-39', { symbol: 'TEM', portfolioId: 'p2' })] })
    expect(dedupe()).toBe(1)
    const rows = usePortfolioStore.getState().transactions
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
    // Id'yi ILK satir tutuyor: sunucuda o id zaten varsa, hangi icerigi
    // tasidigina bakmaksizin ikisi de gonderilecek.
    expect(rows[0].id).toBe('inv-39')
    expect(rows[1].id).not.toBe('inv-39')
  })

  it('hicbir satir kaybolmaz — sayi korunur', () => {
    const many = Array.from({ length: 39 }, (_, i) => TX(`inv-${i}`))
    const clash = Array.from({ length: 39 }, (_, i) => TX(`inv-${i}`, { symbol: 'X', portfolioId: 'p2' }))
    seed({ transactions: [...many, ...clash] })
    expect(dedupe()).toBe(39)
    const rows = usePortfolioStore.getState().transactions
    expect(rows).toHaveLength(78)
    expect(new Set(rows.map((r) => r.id)).size).toBe(78)
  })

  // Yalnizca yeni id'yi gondermek yetmezdi: sunucudaki mevcut satir hangisinin
  // icerigini tasiyor bilmiyoruz. Ikisini de kirli isaretlemek bunu kesinlestiriyor.
  it('cakisan satirlarin IKISI de outbox a girer', () => {
    seed({ transactions: [TX('dup'), TX('dup', { symbol: 'TEM' })] })
    dedupe()
    const { transactions: rows, outbox } = usePortfolioStore.getState()
    expect(outbox.transactions[rows[0].id]).toBe('upsert')
    expect(outbox.transactions[rows[1].id]).toBe('upsert')
  })

  it('portfoylerde de calisir', () => {
    seed({
      transactions: [],
      subPortfolios: [{ id: 'p1', name: 'A' }, { id: 'p1', name: 'B' }],
    })
    expect(dedupe()).toBe(1)
    const ps = usePortfolioStore.getState().subPortfolios
    expect(new Set(ps.map((p) => p.id)).size).toBe(2)
    expect(ps.map((p) => p.name)).toEqual(['A', 'B'])
  })

  // Temiz veride hicbir sey yapmamali: her turda cagriliyor ve her turda
  // state'i yeniden yazsaydi, outbox'i gereksiz yere sisirir ve abone olan her
  // bilesen bosuna render alirdi.
  it('temiz veride state e dokunmaz', () => {
    seed({ transactions: [TX('a'), TX('b')] })
    const before = usePortfolioStore.getState().transactions
    expect(dedupe()).toBe(0)
    expect(usePortfolioStore.getState().transactions).toBe(before)
    expect(usePortfolioStore.getState().outbox.transactions).toEqual({})
  })
})
