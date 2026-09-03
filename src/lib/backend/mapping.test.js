// Çevirinin iki yönü birbirinin tersi mi.
//
// Bu dosyanın var olma sebebi tek bir hata sınıfı: bir yöne alan eklenip
// diğerine eklenmemesi. Alan sunucuya gider, geri gelirken düşer, hiçbir hata
// oluşmaz — kullanıcı notunun kaybolduğunu aylar sonra fark eder.

import { describe, it, expect } from 'vitest'
import {
  txToDb, txFromDb,
  portfolioToDb, portfolioFromDb,
  settingsToDb, settingsFromDb,
  SYNCED_SETTINGS,
} from './mapping.js'

const TX = {
  id: 'inv-233',
  portfolioId: 'sub-t3',
  type: 'sell',
  assetType: 'bist',
  symbol: 'GWIND',
  quantity: 199,
  price: 25.6,
  fee: 1.5,
  currency: 'TRY',
  date: '2025-07-22',
  notes: 'Galata Wind Enerji',
}

describe('islem cevirisi', () => {
  it('gidip gelince ayni nesne', () => {
    expect(txFromDb(txToDb(TX, 'user-1'))).toEqual(TX)
  })

  // Takasin KARSI bacagi. 3 Eylul 2026'ya kadar bu iki alan ceviride yoktu:
  // satir sunucudan toAmount'suz donuyor, cashDeltaTRY cikisi sayip girisi
  // sifir kabul ediyor ve takas, portfoyun nakdini cevrilen tutar kadar
  // yiyordu. Tek cihazda hic gorunmuyor, ikinci cihaz acilinca para gidiyordu.
  it('takasin karsi bacagini tasir', () => {
    const EX = {
      id: 'x1', portfolioId: 'kasa', type: 'exchange', assetType: 'cash',
      symbol: 'TRY→USD', quantity: 226058, price: 1, fee: 0, currency: 'TRY',
      toAmount: 5651.45, toCurrency: 'USD', date: '2026-09-03', notes: '',
    }
    expect(txFromDb(txToDb(EX, 'user-1'))).toEqual(EX)
  })

  it('toAmount metin gelse bile sayiya cevrilir', () => {
    const local = txFromDb({
      id: 'x', portfolio_id: 'kasa', type: 'exchange', asset_type: 'cash', symbol: 'TRY→USD',
      quantity: '226058', price: '1', fee: '0', currency: 'TRY',
      to_amount: '5651.45', to_currency: 'USD', trade_date: '2026-09-03', notes: null,
    })
    expect(local.toAmount).toBe(5651.45)
  })

  it('takas olmayan satira bos karsi bacak eklemez', () => {
    const local = txFromDb(txToDb(TX, 'user-1'))
    expect(local).not.toHaveProperty('toAmount')
    expect(local).not.toHaveProperty('toCurrency')
  })

  it('user_id ekler ama uygulama nesnesine sizdirmaz', () => {
    const db = txToDb(TX, 'user-1')
    expect(db.user_id).toBe('user-1')
    expect(txFromDb(db)).not.toHaveProperty('user_id')
  })

  it('alan adlari veritabani tarafinda snake_case', () => {
    const db = txToDb(TX, 'u')
    expect(db.portfolio_id).toBe('sub-t3')
    expect(db.asset_type).toBe('bist')
    // 'date' degil: Postgres'te tip adiyla cakisiyor.
    expect(db.trade_date).toBe('2025-07-22')
    expect(db).not.toHaveProperty('date')
  })

  // Postgres numeric'i JSON'a METİN olarak gelir. Number'a çevrilmezse
  // calculations.js'in her toplaması sessizce string birleştirmesine döner:
  // "10" + "5" = "105" ve portföy değeri saçmalar. Hiçbir yerde hata çıkmaz.
  it('numeric alanlari metin olarak gelse bile sayiya cevirir', () => {
    const local = txFromDb({
      id: 't', portfolio_id: 'p', type: 'buy', asset_type: 'bist', symbol: 'X',
      quantity: '199', price: '25.6', fee: '1.5', currency: 'TRY',
      trade_date: '2025-07-22', notes: null,
    })
    expect(local.quantity).toBe(199)
    expect(local.price).toBe(25.6)
    expect(local.fee).toBe(1.5)
    expect(local.quantity + local.price).toBe(224.6)   // 19925.6 degil
  })

  it('bos notu ve eksik ucreti tolere eder', () => {
    const local = txFromDb({
      id: 't', portfolio_id: 'p', type: 'buy', asset_type: 'bist', symbol: 'X',
      quantity: 1, price: 1, currency: 'TRY', trade_date: '2026-01-01',
    })
    expect(local.fee).toBe(0)
    expect(local.notes).toBe('')
  })
})

describe('portfoy cevirisi', () => {
  it('gidip gelince ayni nesne', () => {
    const p = { id: 'sub-t3', name: 'T3', color: '#3b82f6' }
    expect(portfolioFromDb(portfolioToDb(p, 'u', 0))).toEqual(p)
  })
})

describe('ayar cevirisi', () => {
  it('yalnizca izin listesindekiler gecer', () => {
    const db = settingsToDb({
      baseCurrency: 'USD',
      fireTargetUSD: 300000,
      // Asagidakiler ANI tanimliyor, kisiyi degil. Gecmemeliler.
      fxRates: { USD: 34.5 },
      finnhubApiKey: 'gizli',
      priceMeta: { fetchedAt: 1 },
      lastBackupAt: '2026-01-01',
    })
    expect(db).toEqual({ baseCurrency: 'USD', fireTargetUSD: 300000 })
  })

  // Mayıs'taki 34,5'lik USD kuru bugünün 48,1'inin üzerine yazılırsa,
  // uygulamadaki çevrilmiş her rakam %28 şaşar — hata vermeden, hiçbir etiket
  // değişmeden. Bu üçü izin listesine ASLA girmemeli.
  it('kur, fiyat damgasi ve api anahtari izin listesinde degil', () => {
    for (const key of ['fxRates', 'fxMeta', 'priceMeta', 'finnhubApiKey', 'lastBackupAt']) {
      expect(SYNCED_SETTINGS).not.toContain(key)
    }
  })

  // Tema ve dil RESTORABLE_SETTINGS'te var ama burada yok: yedek dosyası
  // kişinin tercihini taşır, senkron ise iki cihaz arasında geçer. Telefonda
  // karanlık, masaüstünde açık isteyebilmek bilinçli bir fark.
  it('tema ve dil senkronlanmaz — cihaza ait', () => {
    expect(SYNCED_SETTINGS).not.toContain('theme')
    expect(SYNCED_SETTINGS).not.toContain('language')
  })

  it('sunucudan gelen fazlaliklari da eler', () => {
    expect(settingsFromDb({ baseCurrency: 'EUR', birSey: 1 })).toEqual({ baseCurrency: 'EUR' })
  })

  it('bos ya da bozuk gelirse patlamaz', () => {
    expect(settingsFromDb(null)).toEqual({})
    expect(settingsFromDb('metin')).toEqual({})
  })
})

// Transferin hedefi cevirinin iki yaninda da hayatta kalmali. Dusmesi hicbir
// hata uretmez: para kaynaktan cikar, hicbir yere varmaz, ve toplam varlik
// sessizce azalir.
describe('transfer cevirisi', () => {
  const TR = {
    id: 'tr-1', portfolioId: 'kasa', toPortfolioId: 'sub-t3',
    type: 'transfer', assetType: 'cash', symbol: 'CASH',
    quantity: 1, price: 50000, fee: 0, currency: 'TRY',
    date: '2026-03-01', notes: '',
  }

  it('gidip gelince ayni nesne', () => {
    expect(txFromDb(txToDb(TR, 'u'))).toEqual(TR)
  })

  it('hedef snake_case olarak gider', () => {
    expect(txToDb(TR, 'u').to_portfolio_id).toBe('sub-t3')
  })

  // PostgREST toplu eklemede her satirin ayni anahtar kumesini istiyor
  // (PGRST102). Transferi olmayan satirlarda alani undefined birakmak, o
  // satirlari farkli sekle sokup TUM yazmayi reddettirirdi.
  it('transfer olmayan satirda alan yine var, degeri null', () => {
    const db = txToDb({ ...TR, type: 'buy', toPortfolioId: undefined }, 'u')
    expect('to_portfolio_id' in db).toBe(true)
    expect(db.to_portfolio_id).toBeNull()
  })

  it('null hedef uygulama nesnesine sizmaz', () => {
    expect(txFromDb(txToDb({ ...TR, toPortfolioId: undefined }, 'u')))
      .not.toHaveProperty('toPortfolioId')
  })
})
