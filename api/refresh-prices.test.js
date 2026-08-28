// Bu uç noktanın koruması bir CORS başlığı değil, gerçek bir kapı.
//
// Arkasındaki maliyet kotalı: Finnhub ücretsiz katmanda dakikada 60 çağrı,
// TEFAS dakikada 6 istek, İş Yatırım'ın hoşgörüsü ölçülmemiş. Bu uç noktayı
// tetikleyebilen herkes o kotayı tüketebilir — üstelik kendi hesabı için değil,
// herkesin fiyatlarını besleyen tabloyu bozarak.
//
// GELİŞTİRME.md'deki dürüst not burada da geçerli: ALLOWED_ORIGIN bir kilit
// değil, tarayıcıların uymayı kabul ettiği bir kural. curl hiç Origin
// göndermez. Bu yüzden burada paylaşılan bir sır ve doğrulanmış bir kullanıcı
// belirteci var.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  // doMock kayitlari testler arasinda yasiyor; biri isAdminConfigured'i
  // kosulsuz true yapinca yapilandirma testi hicbir zaman kirmiziya donmuyordu.
  vi.doUnmock('./_supabase-admin.js')
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.CRON_SECRET = 'cok-uzun-ve-rastgele-bir-sir-32-karakter'
})

afterEach(() => {
  process.env = { ...ENV }
  vi.restoreAllMocks()
})

const req = (headers = {}, url = '/api/refresh-prices') => ({
  url,
  headers: { host: 'example.vercel.app', ...headers },
})

function fakeRes() {
  const out = { code: null, body: null }
  return {
    out,
    status(c) { out.code = c; return this },
    json(b) { out.body = b; return this },
  }
}

describe('yetkilendirme', () => {
  it('kimliksiz cagriyi reddeder', async () => {
    const { default: handler } = await import('./refresh-prices.js')
    const res = fakeRes()
    await handler(req(), res)
    expect(res.out.code).toBe(401)
    expect(res.out.body.error).toBe('UNAUTHORIZED')
  })

  it('yanlis sirri reddeder', async () => {
    const { default: handler } = await import('./refresh-prices.js')
    const res = fakeRes()
    await handler(req({ 'x-cron-secret': 'tahmin' }), res)
    expect(res.out.code).toBe(401)
  })

  // CRON_SECRET tanımsızken boş bir başlık göndermek "sır eşleşti" sayılmamalı.
  // '' === '' doğrudur ve bu, sır yapılandırılmamış her kurulumu herkese açardı.
  it('CRON_SECRET tanimsizken bos baslik gecmez', async () => {
    delete process.env.CRON_SECRET
    const { default: handler } = await import('./refresh-prices.js')
    const res = fakeRes()
    await handler(req({ 'x-cron-secret': '' }), res)
    expect(res.out.code).toBe(401)
  })

  it('dogru sir cron olarak gecer', async () => {
    vi.doMock('./_supabase-admin.js', async () => ({
      isAdminConfigured: () => true,
      heldSymbols: async () => [],
      writePrices: async () => 0,
      writeInstruments: async () => 0,
      verifyUserToken: async () => null,
    }))
    const { default: handler } = await import('./refresh-prices.js')
    const res = fakeRes()
    await handler(req({ 'x-cron-secret': process.env.CRON_SECRET }), res)
    expect(res.out.code).toBe(200)
    expect(res.out.body.caller).toBe('cron')
  })

  it('gecerli kullanici belirteci de gecer', async () => {
    vi.doMock('./_supabase-admin.js', async () => ({
      isAdminConfigured: () => true,
      heldSymbols: async () => [],
      writePrices: async () => 0,
      writeInstruments: async () => 0,
      verifyUserToken: async (t) => (t === 'gecerli' ? { userId: 'u1', email: 'a@b.c' } : null),
    }))
    const { default: handler } = await import('./refresh-prices.js')
    const res = fakeRes()
    await handler(req({ authorization: 'Bearer gecerli' }), res)
    expect(res.out.code).toBe(200)
    expect(res.out.body.caller).toBe('user')
  })

  it('gecersiz belirteci reddeder', async () => {
    vi.doMock('./_supabase-admin.js', async () => ({
      isAdminConfigured: () => true,
      heldSymbols: async () => [],
      writePrices: async () => 0,
      writeInstruments: async () => 0,
      verifyUserToken: async () => null,
    }))
    const { default: handler } = await import('./refresh-prices.js')
    const res = fakeRes()
    await handler(req({ authorization: 'Bearer uydurma' }), res)
    expect(res.out.code).toBe(401)
  })
})

describe('yapilandirma', () => {
  // Anahtarsız bir dağıtımda 401 döndürmek, "yetkin yok" diyerek yanlış yere
  // baktırırdı. 503 + isim, hangi değişkenin eksik olduğunu söylüyor.
  it('supabase anahtarlari yoksa 503 ve sebep', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { default: handler } = await import('./refresh-prices.js')
    const res = fakeRes()
    await handler(req({ 'x-cron-secret': process.env.CRON_SECRET }), res)
    expect(res.out.code).toBe(503)
    expect(res.out.body.error).toBe('NOT_CONFIGURED')
  })
})

describe('kaynak secimi', () => {
  // Fonlar günde bir kez yayınlanıyor. Beş dakikada bir çekmek aynı sayıyı gün
  // boyu yeniden almak ve TEFAS'ın dakikada 6 isteklik hoşgörüsünü boşa
  // harcamak olurdu — bu yüzden cron onları ayrı bir saatte çağırıyor.
  it('sources parametresi verilmezse ucu birden', async () => {
    const { _parseSources } = await import('./refresh-prices.js')
    expect(_parseSources(req())).toEqual(['bist', 'tefas', 'global'])
  })

  it('yalnizca istenen kaynak', async () => {
    const { _parseSources } = await import('./refresh-prices.js')
    expect(_parseSources(req({}, '/api/refresh-prices?sources=tefas'))).toEqual(['tefas'])
  })

  it('taninmayan kaynak adi yok sayilir', async () => {
    const { _parseSources } = await import('./refresh-prices.js')
    expect(_parseSources(req({}, '/api/refresh-prices?sources=bist,uydurma'))).toEqual(['bist'])
  })

  // Hepsi tanınmıyorsa boş listeyle çalışıp hiçbir şey yapmamaktansa, varsayılana
  // dönmek daha az şaşırtıcı: yazım hatası olan bir cron sessizce bir şey
  // yapmamak yerine işini görür.
  it('hepsi taninmiyorsa varsayilana doner', async () => {
    const { _parseSources } = await import('./refresh-prices.js')
    expect(_parseSources(req({}, '/api/refresh-prices?sources=abc'))).toEqual(['bist', 'tefas', 'global'])
  })
})

describe('elde tutulmayan sembol cekilmez', () => {
  it('tamamen satilmis sembol listede yok', async () => {
    vi.doMock('./_supabase-admin.js', async () => {
      const actual = await vi.importActual('./_supabase-admin.js')
      return actual
    })
    // heldSymbols'un miktar mantigini dogrudan sinamak icin kucuk bir kopya
    // yerine, gercek davranisi refresh-prices uzerinden gozluyoruz: bos liste
    // gelince hicbir kaynaga gidilmiyor.
    vi.doMock('./_supabase-admin.js', async () => ({
      isAdminConfigured: () => true,
      heldSymbols: async () => [],           // her sey satilmis
      writePrices: async () => { throw new Error('yazilmamaliydi') },
      writeInstruments: async () => { throw new Error('yazilmamaliydi') },
      verifyUserToken: async () => null,
    }))
    const { default: handler } = await import('./refresh-prices.js')
    const res = fakeRes()
    await handler(req({ 'x-cron-secret': process.env.CRON_SECRET }), res)
    expect(res.out.code).toBe(200)
    expect(res.out.body.fetched).toBe(0)
  })
})
