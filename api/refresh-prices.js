// Fiyatları kaynaklardan çekip paylaşılan tabloya yazan tek yer.
//
// BU UÇ NOKTA NEDEN VAR
//
// Faz 3'e kadar fiyatları her tarayıcı kendisi çekiyordu. Tek kullanıcıda
// çalışıyordu; üç kullanıcıda çalışmaz, çünkü:
//
//   - İş Yatırım ve TEFAS sözleşmesiz kaynaklar. N cihaz × beş dakikada bir =
//     engellenme. TEFAS zaten dakikada 6 istek kabul ediyor.
//   - Finnhub anahtarı kullanıcı başına giriliyordu; arkadaşlarından kendi
//     hesaplarını açmalarını isteyemezsin.
//   - Aynı sembol için N ayrı istek atmak, tek bir sayıyı N kez satın almak.
//
// Şimdi çarpan 1: zamanlayıcı çeker, herkes okur.
//
// KİM ÇAĞIRABİLİR
//
//   - pg_cron (CRON_SECRET ile). Asıl çağıran bu; piyasa saatlerinde düzenli.
//   - Giriş yapmış bir kullanıcı (Supabase erişim belirteci ile). "Şimdi
//     güncelle" düğmesi için — bir kaynak düzeldiğinde beklemek zorunda kalma.
//
// Kimliksiz çağrı reddediliyor. Bu bir CORS meselesi değil: buradaki maliyet
// kotalı bir dış kaynağa yapılan istek, ve onu tetikleyebilen herkes kotayı
// tüketebilir.

import { bistHandle } from './bist.js'
import { tefasHandle } from './tefas.js'
import { fetchGlobalQuotes } from './_finnhub.js'
import {
  isAdminConfigured,
  heldSymbols,
  writePrices,
  writeInstruments,
  verifyUserToken,
} from './_supabase-admin.js'

const ALL_SOURCES = ['bist', 'tefas', 'global']

export default async function handler(req, res) {
  if (!isAdminConfigured()) {
    return res.status(503).json({
      error: 'NOT_CONFIGURED',
      hint: 'SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanimli degil.',
    })
  }

  const caller = await authorize(req)
  if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

  // Kaynaklar ayrı saatlerde çalışıyor: hisseler gün içinde tikliyor, fonlar
  // günde bir kez yayınlanıyor. Fonları beş dakikada bir çekmek aynı sayıyı
  // gün boyu yeniden almak ve TEFAS'ın hoşgörüsünü boşa harcamak olurdu.
  const requested = parseSources(req)

  try {
    const held = await heldSymbols()
    const wanted = held.filter((h) => requested.includes(h.assetType))

    if (wanted.length === 0) {
      return res.status(200).json({ ok: true, caller: caller.kind, fetched: 0, sources: {}, errors: [] })
    }

    const { quotes, errors, sources } = await fetchFromSources(wanted, requested)

    const written = await writePrices(
      Object.entries(quotes).map(([symbol, q]) => ({
        symbol,
        price: q.price,
        currency: q.currency,
        source: q.source,
        fetched_at: new Date().toISOString(),
      })),
    )

    await writeInstruments(
      wanted
        .filter((h) => quotes[h.symbol])
        .map((h) => ({
          symbol: h.symbol,
          asset_type: h.assetType,
          currency: quotes[h.symbol].currency,
          source: quotes[h.symbol].source,
          updated_at: new Date().toISOString(),
        })),
    )

    return res.status(200).json({
      ok: true,
      caller: caller.kind,
      fetched: written,
      requested: wanted.length,
      sources,
      // İstemci tarafı bunu doğrudan priceCache'e işleyebilsin diye alıntılar
      // da dönüyor: "şimdi güncelle" düğmesine basan kullanıcı, yazdıklarımızı
      // okumak için ikinci bir gidiş dönüş beklemesin.
      quotes,
      errors,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' })
  }
}

/**
 * İki kabul edilen kimlik. Sırayla denenir çünkü cron çok daha sık çağırıyor ve
 * onun yolu ağa hiç çıkmıyor.
 */
async function authorize(req) {
  const secret = process.env.CRON_SECRET
  const given = req.headers['x-cron-secret']
  // Sabit uzunlukta karşılaştırma burada gereksiz: sır 32+ karakter rastgele ve
  // saldırgan zamanlama farkını ölçmek için milyonlarca istek atmak zorunda
  // kalır ki bu zaten çok daha gürültülü bir saldırı.
  if (secret && given && given === secret) return { kind: 'cron' }

  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const user = await verifyUserToken(token)
  return user ? { kind: 'user', ...user } : null
}

function parseSources(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const raw = url.searchParams.get('sources')
    if (!raw) return ALL_SOURCES
    const picked = raw.split(',').map((s) => s.trim()).filter((s) => ALL_SOURCES.includes(s))
    return picked.length ? picked : ALL_SOURCES
  } catch {
    return ALL_SOURCES
  }
}

async function fetchFromSources(held, requested) {
  const quotes = {}
  const errors = []
  const sources = {}

  const byType = { bist: [], tefas: [], global: [] }
  for (const h of held) byType[h.assetType]?.push(h.symbol)

  // Üç kaynak birbirinden bağımsız; biri çökerse diğerleri yine de yazsın.
  // Sıralı değil paralel: TEFAS tek tek ve aralıklı çekiyor, onu beklerken
  // BIST'i boşta tutmanın anlamı yok.
  const jobs = []

  if (requested.includes('bist') && byType.bist.length) {
    jobs.push(
      bistHandle(byType.bist.join(','))
        .then((r) => ({ source: 'bist', ...r }))
        .catch((e) => ({ source: 'bist', results: {}, errors: [{ symbol: '', error: e.message }] })),
    )
  }
  if (requested.includes('tefas') && byType.tefas.length) {
    jobs.push(
      tefasHandle(byType.tefas.join(','))
        .then((r) => ({ source: 'tefas', ...r }))
        .catch((e) => ({ source: 'tefas', results: {}, errors: [{ symbol: '', error: e.message }] })),
    )
  }
  if (requested.includes('global') && byType.global.length) {
    jobs.push(
      fetchGlobalQuotes(byType.global, process.env.FINNHUB_KEY)
        .then((r) => ({ source: 'global', ...r }))
        .catch((e) => ({ source: 'global', results: {}, errors: [{ symbol: '', error: e.message }] })),
    )
  }

  for (const outcome of await Promise.all(jobs)) {
    Object.assign(quotes, outcome.results)
    errors.push(...outcome.errors.map((e) => ({ ...e, source: outcome.source })))
    sources[outcome.source] = {
      ok: Object.keys(outcome.results).length,
      failed: outcome.errors.length,
      // Hiç sonuç dönmeyen bir kaynak, "sekiz sembol başarısız" değil "kaynak
      // düştü" demektir. İkisini ayırmak, kullanıcıyı ASELS'te ne var diye
      // aramaktan kurtarıyor.
      down: Object.keys(outcome.results).length === 0 && outcome.errors.length > 0,
    }
  }

  return { quotes, errors, sources }
}

export { authorize as _authorize, parseSources as _parseSources }
