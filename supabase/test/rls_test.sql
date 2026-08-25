-- ============================================================================
-- RLS test paketi
--
-- NEDEN AYRI BİR DOSYA VE NEDEN ASSERT
--
-- Yanlış yazılmış bir RLS politikası HATA VERMEZ. Sessizce boş sonuç döner ya da
-- sessizce fazla satır döndürür. Yani gözle bakarak doğrulanamaz; ancak iki ayrı
-- kullanıcı yaratıp birbirinin satırlarını okumayı VE yazmayı deneyen bir test
-- yakalar. Aşağıdaki her assert, yanlış giderse sessiz kalacak bir şeyi
-- gürültülü hale getiriyor.
--
-- NASIL KOŞULUR (lokal Postgres 16, Supabase gerekmez):
--
--   createdb rlstest
--   psql -d rlstest -v ON_ERROR_STOP=1 -f supabase/test/prelude.sql
--   psql -d rlstest -v ON_ERROR_STOP=1 -f supabase/schema.sql
--   psql -d rlstest -v ON_ERROR_STOP=1 -f supabase/test/rls_test.sql
--
-- Çıktının son satırı "TUM RLS TESTLERI GECTI" değilse bir şey bozulmuştur.
-- Supabase üzerinde de aynen koşar; orada prelude'a gerek yoktur.
-- ============================================================================

begin;

-- Testin kendi kullanıcıları. auth.users'a doğrudan yazmak Supabase'de normalde
-- yapılmaz ama test bağlamında handle_new_user tetikleyicisini de sınıyor.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test');

-- Fiyat tablosu paylaşılan; test okumayı sınayacak.
insert into public.prices_latest (symbol, price, currency) values ('THYAO', 312.5, 'TRY');


-- ---------------------------------------------------------------------------
-- 1. Yeni kullanıcıya profil ve ayar satırı açılıyor, PORTFÖY AÇILMIYOR
--
-- Portföyün açılmaması kasıtlı. Bir önceki sürüm açıyordu ve sonucu şuydu:
-- zaten portföyleri olan biri ilk kez senkronladığında, kendi açmadığı boş bir
-- dördüncü portföy arayüzünde beliriyordu. Sunucu, istemcinin göndermediği
-- veriyi uydurmamalı — istemci zaten kendi başlangıç portföyüyle açılıyor.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.profiles
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 1, format('handle_new_user profil acmadi (bulunan: %s)', n);

  select count(*) into n from public.user_settings
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 1, format('handle_new_user ayar satiri acmadi (bulunan: %s)', n);

  select count(*) into n from public.portfolios
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 0, format('handle_new_user portfoy UYDURDU (bulunan: %s)', n);
end $$;


set role authenticated;

-- Portföyler istemciden gelir; işlemlerin yabancı anahtarı onlara bakıyor.
-- Senkron da aynı sırayı izliyor: önce portföyler, sonra işlemler.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.portfolios (user_id, id, name, color)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'sub-default', 'Portfolio', '#10b981');

set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.portfolios (user_id, id, name, color)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'sub-default', 'Portfolio', '#10b981');


-- ---------------------------------------------------------------------------
-- 2. Kullanıcı kendi satırını yazabiliyor mu
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.transactions
  (user_id, id, portfolio_id, type, asset_type, symbol, quantity, price, currency, trade_date)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'inv-233', 'sub-default',
   'buy', 'bist', 'THYAO', 10, 312.5, 'TRY', '2026-03-03');

do $$
declare n int;
begin
  select count(*) into n from public.transactions;
  assert n = 1, format('A kendi islemini goremiyor (goren: %s)', n);
end $$;


-- ---------------------------------------------------------------------------
-- 3. Başkasının satırı görünmüyor — RLS'in bütün varlık sebebi
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

do $$
declare n int;
begin
  select count(*) into n from public.transactions;
  assert n = 0, format('SIZINTI: B, A nin %s islemini goruyor', n);
end $$;


-- ---------------------------------------------------------------------------
-- 4. Aynı id, farklı kullanıcı → çakışma YOK
--
-- Bileşik birincil anahtarın (user_id, id) var oluş sebebi bu. İşlem id'lerinin
-- 349/364'ü içe aktarmadan geliyor ve deterministik ('inv-233', 'fund-1'), yani
-- ikinci kullanıcı kendi dosyasını aktardığında aynı id'leri üretecek. Anahtar
-- tek başına id olsaydı bu satır ya hata verir ya da A'nın verisinin üstüne
-- yazardı.
-- ---------------------------------------------------------------------------
insert into public.transactions
  (user_id, id, portfolio_id, type, asset_type, symbol, quantity, price, currency, trade_date)
values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'inv-233', 'sub-default',
   'buy', 'bist', 'ASELS', 5, 78.4, 'TRY', '2026-03-04');

do $$
declare n int;
begin
  select count(*) into n from public.transactions;
  assert n = 1, format('B kendi inv-233 unu goremiyor (goren: %s)', n);
end $$;


-- ---------------------------------------------------------------------------
-- 5. Başkasının user_id'siyle yazmak reddediliyor mu — `with check` testi
--
-- Politikada yalnızca `using` yazılsaydı bu insert BAŞARILI olurdu ve kimse fark
-- etmezdi: B, A'nın hesabına satır ekler, sonra `using` yüzünden onu göremediği
-- için ne yaptığını da görmezdi.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.transactions
      (user_id, id, portfolio_id, type, asset_type, symbol, quantity, price, currency, trade_date)
    values
      ('aaaaaaaa-0000-0000-0000-000000000001', 'kotu-1', 'sub-default',
       'buy', 'bist', 'XXX', 1, 1, 'TRY', '2026-03-05');
    raise exception 'ACIK: B, A nin user_id si ile satir yazabildi. Politikada `with check` eksik.';
  exception
    when insufficient_privilege then null;   -- beklenen: RLS reddetti
  end;
end $$;


-- ---------------------------------------------------------------------------
-- 6. Paylaşılan fiyat tabloları: herkes OKUR
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.prices_latest where symbol = 'THYAO';
  assert n = 1, 'Giris yapmis kullanici fiyat tablosunu okuyamiyor';
end $$;


-- ---------------------------------------------------------------------------
-- 7. Paylaşılan fiyat tabloları: kimse YAZAMAZ
--
-- Buraya yalnızca cron (service_role) yazar. Bir kullanıcının fiyat yazabilmesi,
-- herkesin portföy değerini istediği gibi oynatabilmesi demek olurdu.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.prices_latest (symbol, price, currency) values ('HACK', 1, 'TRY');
    raise exception 'ACIK: sıradan kullanici fiyat yazabildi.';
  exception
    when insufficient_privilege then null;   -- beklenen: yetki yok
  end;
end $$;


-- ---------------------------------------------------------------------------
-- 8. updated_at'i sunucu yazıyor mu
--
-- Senkron imleci buna bağlı. İstemcinin gönderdiği değer kabul edilirse, saati
-- geri kalan bir cihazın yazdığı satır imlecin gerisinde kalır ve diğer cihaz
-- onu hiç görmez.
-- ---------------------------------------------------------------------------
-- Test edilen şey "damga ilerledi mi" DEĞİL, "istemcinin yalanı ezildi mi".
-- Aradaki fark bu testi ilk yazışımda gözden kaçtı: bütün dosya tek bir işlem
-- içinde koştuğu için now() sabit kalıyordu ve "ilerledi mi" assert'i, trigger
-- kusursuz çalışırken bile kırmızı yanıyordu. Testin kendisi yanlıştı; trigger
-- değil. (Trigger o sırada clock_timestamp()'a çevrildi, ama bu testin doğru
-- sorusu yine de aşağıdaki.)
do $$
declare after_ts timestamptz;
begin
  update public.transactions
     set quantity = 6, updated_at = '2000-01-01'::timestamptz   -- kasten yalan
   where id = 'inv-233';
  select updated_at into after_ts from public.transactions where id = 'inv-233';
  assert after_ts > '2020-01-01'::timestamptz,
    format('updated_at trigger istemci degerini ezmedi (kalan deger: %s)', after_ts);
end $$;


reset role;
rollback;   -- test hiçbir iz bırakmaz

\echo ''
\echo '  TUM RLS TESTLERI GECTI'
\echo ''
