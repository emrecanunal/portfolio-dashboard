// Supabase bağlantısını ve RLS'in dışarıya kapalı olduğunu doğrular.
//
//   node scripts/check-backend.mjs
//
// NEDEN AYRI BİR SCRIPT
//
// supabase/test/rls_test.sql politikaların MANTIĞINI sınıyor ama bunu lokal bir
// Postgres'te, auth.uid()'yi taklit ederek yapıyor. Canlı projede araya bir
// katman daha giriyor: PostgREST, gelen isteğin anahtarına bakıp onu bir role
// büründürüyor. O eşleme yanlışsa politikalar kusursuz olsa bile veri açıkta
// olur — ve bunu ancak gerçek uç noktaya, gerçek anahtarla sorarak görebilirsin.
//
// Burada kasten GİRİŞ YAPILMIYOR. Sorulan soru "ben verimi görebiliyor muyum"
// değil, "tanımadığım biri görebiliyor mu". İkincisinin cevabı hayır olmalı.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// .env.local'i elle okuyoruz: bu bir Vite süreci değil, import.meta.env yok.
let env = {}
try {
  env = Object.fromEntries(
    readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
} catch {
  console.error('.env.local okunamadi. Proje kokunde mi calistiriyorsun?')
  process.exit(1)
}

const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!URL_ || !KEY) {
  console.error('.env.local icinde VITE_SUPABASE_URL ve VITE_SUPABASE_PUBLISHABLE_KEY yok.')
  process.exit(1)
}

const c = createClient(URL_, KEY, { auth: { persistSession: false } })
let failed = 0

function report(name, ok, detail) {
  console.log(`  ${ok ? 'OK  ' : 'HATA'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}

console.log(`\n${URL_}\n`)

// 1. Proje ayakta mı. Ağ katmanına gerçekten dokunan bir çağrı gerekiyor;
//    auth.getSession() diskten okuduğu için ayakta olmayan bir projede bile
//    hatasız döner ve yanlış bir güven verir.
{
  const { error } = await c.from('prices_latest').select('symbol').limit(1)
  const reachable = !error || !/fetch failed|ENOTFOUND|network/i.test(error.message)
  report('proje erisilebilir', reachable, reachable ? null : error.message)
  if (!reachable) process.exit(1)
}

// REDDEDİLMENİN ÜÇ DERECESİ — ve neden ayırt etmek gerekiyor
//
// "İstek reddedildi" tek bir sonuç değil. Üç ayrı şey olabilir:
//
//   permission denied   → yetki katmanı durdurdu. En güçlüsü: istek daha
//                         politikaya varmadan bitiyor.
//   RLS reddi           → yetki VAR, tek engel politika. Çalışıyor, ama
//                         savunmanın tamamı bir ifadenin doğruluğuna bağlı.
//   boş dizi            → hiçbir şey dönmedi. Ama tablo zaten boşsa bu hiçbir
//                         şey KANITLAMAZ; herkese açık bir tablo da boş döner.
//
// Bu ayrımı ilk sürümde yapmıyordum ve iki sorunu birden gizledi: anon'un
// tablolarda hâlâ INSERT yetkisi olduğunu (Supabase varsayılanı, şemadan
// geri alınmamış) ve prices_latest testinin tablo boş olduğu için içi boş
// olduğunu. İkisi de OK yazıyordu.
function classify(error, data) {
  if (error && /permission denied/i.test(error.message)) return { level: 'grant', ok: true }
  if (error && /row-level security/i.test(error.message)) return { level: 'rls', ok: true }
  if (error) return { level: 'error', ok: true }
  if (Array.isArray(data) && data.length === 0) return { level: 'empty', ok: true }
  return { level: 'leak', ok: false }
}

const NOTE = {
  grant: 'yetki katmaninda reddedildi',
  rls: 'ZAYIF: yalnizca RLS durduruyor, anon yetkisi hala var',
  empty: 'ZAYIF: bos dondu — tablo zaten bossa bu bir sey kanitlamaz',
}

const USER_TABLES = ['transactions', 'portfolios', 'profiles', 'user_settings']
const SHARED_TABLES = ['prices_latest', 'prices_monthly', 'instruments', 'fx_latest', 'fx_monthly']

// Giriş yapılmadan hiçbir tablo okunamamalı.
for (const table of [...USER_TABLES, ...SHARED_TABLES]) {
  const { data, error } = await c.from(table).select('*').limit(1)
  const v = classify(error, data)
  report(
    `${table}: anonim okuma kapali`,
    v.ok,
    v.level === 'leak' ? `SIZINTI: ${data.length} satir dondu` : NOTE[v.level],
  )
}

// Yazma ayrı bir politika dalı: `with check` eksikse okuma kapalıyken yazma
// açık kalabilir ve dışarıdan hiçbir belirtisi olmaz.
{
  const { error } = await c.from('transactions').insert({
    user_id: '00000000-0000-0000-0000-000000000000',
    id: `sizinti-testi-${Date.now()}`,
    portfolio_id: 'sub-default',
    type: 'buy', asset_type: 'bist', symbol: 'TEST',
    quantity: 1, price: 1, currency: 'TRY', trade_date: '2026-01-01',
  })
  const v = classify(error, null)
  report('transactions: anonim yazma kapali', Boolean(error), NOTE[v.level])
}

console.log(failed === 0 ? '\nHepsi gecti.\n' : `\n${failed} kontrol basarisiz.\n`)
process.exit(failed === 0 ? 0 : 1)
