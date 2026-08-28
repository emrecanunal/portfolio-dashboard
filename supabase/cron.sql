-- ============================================================================
-- Fiyat yenileme zamanlayıcısı (Faz 3)
--
-- Supabase → SQL Editor → yapıştır → değişkenleri doldur → Run.
-- Yeniden çalıştırılabilir: her iş önce siliniyor, sonra kuruluyor.
--
-- ZAMANLAYICI NEDEN VERCEL CRON DEĞİL
--
-- Vercel'in ücretsiz (Hobby) planında cron GÜNDE BİR KEZ çalışabiliyor ve daha
-- sık bir ifade deploy sırasında hata veriyor; üstelik tetikleme zamanı ±59
-- dakika şaşabiliyor. "Piyasa açıkken beş dakikada bir" oradan çıkmıyor.
--
-- pg_cron zamanlamayı Postgres'in kendi içinde yapıyor, dakikalık çözünürlükte
-- ve plan kısıtı olmadan. Yan faydası: her gün veritabanına yazdığı için
-- Supabase'in "ücretsiz projeler 1 hafta hareketsizlikte duraklatılır" kuralı
-- kendiliğinden konu dışı kalıyor.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ---------------------------------------------------------------------------
-- Sırlar Vault'ta, iş tanımında değil.
--
-- pg_cron işinin gövdesi cron.job tablosunda düz metin duruyor ve projeye
-- erişimi olan herkes okuyabiliyor. CRON_SECRET'ı oraya yazmak, uç noktayı
-- koruyan tek şeyi herkesin görebileceği bir yere koymak olurdu.
--
-- ↓ ÖNCE BU İKİSİNİ KENDİ DEĞERLERİNLE ÇALIŞTIR ↓
-- ---------------------------------------------------------------------------
-- select vault.create_secret('https://SENIN-ADRESIN.vercel.app', 'app_base_url');
-- select vault.create_secret('BURAYA-URETTIGIN-SIR',             'cron_secret');


-- ---------------------------------------------------------------------------
-- Uç noktayı çağıran yardımcı.
--
-- pg_net eşzamansız çalışıyor: net.http_post isteği kuyruğa koyup hemen bir id
-- döndürüyor, cevabı beklemiyor. Bu tam da istediğimiz şey — 39 sembollük bir
-- Finnhub turu yarım dakika sürebiliyor ve o süre boyunca bir veritabanı
-- işlemini açık tutmanın hiçbir faydası yok.
--
-- Sonucu görmek için: select * from net._http_response order by created desc;
-- ---------------------------------------------------------------------------
create or replace function public.trigger_price_refresh(sources text)
returns bigint
language plpgsql
security definer set search_path = public, vault, extensions
as $$
declare
  base   text;
  secret text;
begin
  select decrypted_secret into base   from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';

  if base is null or secret is null then
    raise exception 'app_base_url ve cron_secret Vault''ta tanimli degil';
  end if;

  return net.http_post(
    url     := base || '/api/refresh-prices?sources=' || sources,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- İşler
--
-- Saatler UTC. Türkiye UTC+3, yani buradaki 07:00 = TSİ 10:00.
--
-- Üç ayrı iş, çünkü üç kaynak üç farklı saatte yaşıyor. Hepsini tek zamanlamaya
-- bağlamak, günde bir kez yayınlanan TEFAS fiyatını beş dakikada bir yeniden
-- almak ve o kaynağın dakikada 6 isteklik hoşgörüsünü hiçbir şey için harcamak
-- olurdu.
-- ---------------------------------------------------------------------------

-- BIST: 10:00–18:00 TSİ, hafta içi, beş dakikada bir.
-- Seans 18:00'de kapanıyor; kapanış fiyatının oturması için 18:10'a kadar
-- uzatmak yerine, aşağıdaki akşam işi zaten son hâli alıyor.
select cron.unschedule('prices-bist') where exists (select 1 from cron.job where jobname = 'prices-bist');
select cron.schedule('prices-bist', '*/5 4-15 * * 1-5', $$ select public.trigger_price_refresh('bist') $$);

-- Global: 16:30–23:00 TSİ, hafta içi, beş dakikada bir.
-- ABD borsaları TSİ 16:30'da açılıyor (yaz saati; kışın 17:30). Aradaki bir
-- saatlik kayma için ayrı bir iş yazmak yerine pencereyi geniş tutuyoruz —
-- kapalı piyasada çekilen fiyat aynı sayıyı döndürüyor, zararı yok.
select cron.unschedule('prices-global') where exists (select 1 from cron.job where jobname = 'prices-global');
select cron.schedule('prices-global', '*/5 13-20 * * 1-5', $$ select public.trigger_price_refresh('global') $$);

-- TEFAS: günde iki kez. Fonlar akşam TEK bir fiyat yayınlıyor, o yüzden gün
-- içinde çekmenin hiçbir karşılığı yok. 20:00 TSİ yayın sonrası, 09:00 TSİ ise
-- akşam kaçırılmışsa güne doğru fiyatla başlamak için.
select cron.unschedule('prices-tefas') where exists (select 1 from cron.job where jobname = 'prices-tefas');
select cron.schedule('prices-tefas', '0 6,17 * * 1-5', $$ select public.trigger_price_refresh('tefas') $$);

-- Mezar taşı temizliği: haftada bir, pazar gecesi.
select cron.unschedule('purge-tombstones') where exists (select 1 from cron.job where jobname = 'purge-tombstones');
select cron.schedule('purge-tombstones', '0 2 * * 0', $$ select public.purge_tombstones() $$);


-- ---------------------------------------------------------------------------
-- Kontrol
-- ---------------------------------------------------------------------------
-- Kurulan işler:
--   select jobname, schedule, active from cron.job order by jobname;
--
-- Son çalışmalar (başarısızlık burada görünür):
--   select jobname, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 20;
--
-- Uç noktanın gerçekte ne cevap verdiği:
--   select status_code, content, created from net._http_response
--    order by created desc limit 10;
--
-- Fiyatlar geldi mi:
--   select count(*), max(fetched_at) from prices_latest;
--
-- Elle bir tur tetiklemek:
--   select public.trigger_price_refresh('bist,tefas,global');
