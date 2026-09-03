-- ============================================================================
-- Portfolio Dashboard · Supabase şeması
--
-- Supabase → SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
-- Baştan sona yeniden çalıştırılabilir: her ifade "if not exists" ya da
-- "or replace". Bir kez daha koşturmak veriyi bozmaz.
--
-- Alan adları uygulamadaki karşılıklarıyla birebir DEĞİL; SQL tarafı snake_case
-- ve `date` gibi tip adlarıyla çakışan isimlerden kaçınıyor. Çeviri tek yerde,
-- src/lib/backend/ dikişinde yapılır:
--
--   assetType   → asset_type
--   portfolioId → portfolio_id
--   date        → trade_date      ('date' Postgres'te tip adı; kolon adı olarak
--                                   çalışır ama her sorguda tırnak isteyen bir
--                                   belirsizlik yaratır)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. updated_at'i her zaman SUNUCU yazar
--
-- Senkron imleci bu kolona bakıyor: "şu andan sonra değişenleri ver". İstemci
-- saatine bırakılsaydı, saati beş dakika geri olan bir telefonun yazdığı satır
-- imlecin gerisinde kalır ve diğer cihaz onu hiç görmezdi.
--
-- now() DEĞİL clock_timestamp(): now() işlemin BAŞLANGIÇ anını döndürür ve o
-- işlem boyunca sabit kalır. Tek bir işlemde 50 satır yazan bir senkron
-- gönderiminde hepsi aynı damgayı alırdı — ki tek başına sorun değil, ama
-- imlecin gerçek yazma anından uzaklaşması hiç istenmeyen bir sapma.
--
-- DİKKAT — bu trigger tek başına yetmez. İki işlem üst üste binebilir: A işlemi
-- T1'de başlar, B işlemi T2'de (T2 > T1) başlayıp önce commit eder, istemci
-- imleci T2'ye çeker, sonra A commit eder ve T1 damgalı satırları imlecin
-- gerisinde kalır — bir daha hiç çekilmez. Bu yüzden istemci imleci ham
-- kullanmaz, birkaç saniye geriden sorar; ayrıntısı SENKRON-PLANI.md §3'te.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Kullanıcıya ait tablolar
--
-- BİRİNCİL ANAHTAR NEDEN (user_id, id) — TEK BAŞINA id DEĞİL
--
-- id'yi istemci üretiyor ve mevcut verinin 364 satırının 349'unda o id bir UUID
-- bile değil: Investing.com içe aktarması 'inv-233', fon dönüştürücü 'fund-1'
-- yazmış. Bunlar deterministik ve bu iyi bir şey — aynı dosyayı ikinci kez içe
-- aktarmak kayıtları ikizlemiyor. Ama global olarak benzersiz olduklarının hiçbir
-- garantisi yok: ikinci bir kullanıcı da kendi dosyasını aktarsa onun da 'inv-233'ü
-- olur.
--
-- Anahtar (user_id, id) olunca bu çakışma diye bir şey kalmıyor; herkesin kendi
-- ad alanı var. Tek başına id olsaydı, ikinci kullanıcının içe aktarması
-- birincininkine çarpar ve sonuç ya hata ya da — upsert'te — birinin verisinin
-- üstüne yazılması olurdu.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

create table if not exists public.portfolios (
  user_id    uuid        not null references auth.users on delete cascade,
  id         text        not null,
  name       text        not null,
  color      text        not null default '#10b981',
  sort_order integer     not null default 0,

  -- Kasa: paranın girip çıktığı yer. Sıradan bir portföy gibi durur ama işi
  -- yatırım yapmak değil, henüz yatırılmamış parayı tutmak — o yüzden getiri
  -- karşılaştırmalarında "%0 getirili portföy" olarak listeyi kirletmemesi
  -- gerekiyor. Bayrak tam olarak bunun için: arayüz farklı davranabilsin diye.
  is_cash_account boolean not null default false,
  updated_at timestamptz not null default now(),
  -- Mezar taşı. Satır fiziksel silinirse silme bilgisi senkronlanamaz ve
  -- kayıt diğer cihazdan geri dirilir.
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.transactions (
  user_id      uuid        not null references auth.users on delete cascade,
  id           text        not null,
  portfolio_id text        not null,
  -- 'exchange' bu listede, çünkü dataExport.js'in TXN_TYPES'ı onu geçerli
  -- sayıyor. Şemanın kabul ettiği tipler ile uygulamanın ürettiği tipler
  -- ayrışırsa, ayrışma sessiz kalmaz ama geç kalır: kullanıcı işlemi girer,
  -- uygulamada görür, ve o satır senkronda check ihlaliyle sonsuza kadar
  -- takılı kalır. Yeni bir işlem tipi eklerken burası da güncellenmeli.
  --   transfer : iki alt portföy arasında nakit. İKİ bacağı olan tek satır —
  --              kaynak portfolio_id, hedef to_portfolio_id. Toplam varlığı
  --              değiştirmez, yalnızca nerede durduğunu.
  --   opening  : başlangıç bakiyesi. Nakit açısından para yatırma gibi davranır
  --              ama TASARRUF SAYILMAZ (calculations.js · contributedUpTo).
  --              İşlem geçmişi 2023'e, fonlama geçmişi 2025'e dayandığı için
  --              var: aradaki on dokuz ayı uydurmak yerine bir başlangıç
  --              noktası ilan ediyor.
  type         text        not null check (type in ('buy', 'sell', 'deposit', 'withdraw', 'exchange', 'transfer', 'opening')),
  asset_type   text        not null check (asset_type in ('bist', 'tefas', 'global', 'cash')),
  symbol       text        not null,
  quantity     numeric     not null,
  price        numeric     not null,
  fee          numeric     not null default 0,
  currency     text        not null,

  -- date, timestamptz DEĞİL. İşlem tarihi saat ve saat dilimi taşımıyor;
  -- taşırsa Türkiye'de üç saatlik kayma ve ayın son günündeki işlemlerin
  -- performans grafiğinden düşmesi geri gelir. npm run test:tz tam bunu
  -- kovalıyor — tip burada değişirse o testler anlamını yitirir.
  trade_date   date        not null,

  notes        text        not null default '',

  -- Yalnızca transfer'de dolu. Yabancı anahtar YOK ve bu kasıtlı: portföy silme
  -- akışı işlemleri de siliyor, hedefe konan bir kısıt o akışı kilitlerdi.
  -- Bütünlüğü istemci tarafındaki doğrulama koruyor (dataExport.js).
  to_portfolio_id text,

  -- Yalnızca exchange'de dolu: takasın KARŞI bacağı. Kaynak taraf quantity +
  -- currency, hedef taraf bunlar. İkisi olmadan satır yarım: uygulama çıkışı
  -- görür, girişi göremez ve parayı yok sayar.
  to_amount    numeric,
  to_currency  text,

  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  primary key (user_id, id),
  foreign key (user_id, portfolio_id)
    references public.portfolios (user_id, id)
    on delete restrict
);

-- Senkronun tek sıcak sorgusu: "bu kullanıcının şu imleçten yeni satırları".
create index if not exists transactions_sync_idx
  on public.transactions (user_id, updated_at);

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users on delete cascade,
  -- İzin listesi olarak tutulur, ham settings nesnesi değil. fxRates, priceMeta
  -- ve finnhubApiKey buraya ASLA girmez: ilki anı kaydeder (Mayıs'taki 34,5'lik
  -- kur bugünün 47,9'unun üzerine yazılırsa çevrilmiş her rakam sessizce şaşar),
  -- sonuncusu ise Faz 3'te sunucuya taşınıp tarayıcıdan tamamen çıkıyor.
  -- Kaynak liste: src/lib/dataExport.js · RESTORABLE_SETTINGS
  settings   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists portfolios_updated_at on public.portfolios;
create trigger portfolios_updated_at before update on public.portfolios
  for each row execute function public.set_updated_at();

drop trigger if exists transactions_updated_at on public.transactions;
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 3. Kullanıcıdan bağımsız tablolar (Faz 3)
--
-- Fiyat sembole aittir, kişiye değil. Bugün priceCache kullanıcı state'inin
-- içinde duruyor; üç kullanıcı THYAO tutuyorsa aynı fiyat üç kez çekiliyor ve
-- üç kez saklanıyor. Kaynaklar sözleşmesiz ve kotalı — İş Yatırım seni engeller,
-- Alpha Vantage günde 25 çağrı verir. Bu tablolar o çarpanı 1'e indiriyor.
-- ---------------------------------------------------------------------------

create table if not exists public.instruments (
  symbol       text primary key,
  asset_type   text not null,
  currency     text not null,
  display_name text,
  source       text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.prices_latest (
  symbol     text primary key,
  price      numeric     not null,
  currency   text        not null,
  source     text,
  fetched_at timestamptz not null default now()
);

create table if not exists public.prices_monthly (
  symbol text    not null,
  month  text    not null,               -- 'YYYY-MM'
  close  numeric not null,
  primary key (symbol, month)
);

create table if not exists public.fx_latest (
  base       text        not null,
  quote      text        not null,
  rate       numeric     not null,
  fetched_at timestamptz not null default now(),
  primary key (base, quote)
);

create table if not exists public.fx_monthly (
  base  text    not null,
  quote text    not null,
  month text    not null,                -- 'YYYY-MM'
  rate  numeric not null,
  primary key (base, quote, month)
);


-- ---------------------------------------------------------------------------
-- 3.5 Mevcut kurulumlara eklenenler
--
-- `create table if not exists` VAR OLAN bir tabloya yeni kolon EKLEMEZ — sessizce
-- atlar. Yani yukarıdaki tanımlar yalnızca sıfırdan kurulumda geçerli; şema
-- zaten kuruluysa buradaki ifadeler olmadan yeni alanlar hiç oluşmaz ve
-- uygulama, veritabanının tanımadığı bir kolona yazmaya çalışır.
--
-- Bunlar da yeniden çalıştırılabilir: `if not exists` / `drop ... if exists`.
-- ---------------------------------------------------------------------------

alter table public.transactions add column if not exists to_portfolio_id text;
alter table public.transactions add column if not exists to_amount numeric;
alter table public.transactions add column if not exists to_currency text;
alter table public.portfolios   add column if not exists is_cash_account boolean not null default false;

-- Kısıt YENİDEN kuruluyor, çünkü eskisi 'transfer' ve 'opening'i tanımıyor ve
-- bir check kısıtı yerinde güncellenemiyor. Sıra önemli: önce düşür, sonra ekle.
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('buy', 'sell', 'deposit', 'withdraw', 'exchange', 'transfer', 'opening'));


-- ---------------------------------------------------------------------------
-- 4. Satır seviyesi güvenlik
--
-- `using` NE OKUYABİLECEĞİMİ, `with check` NE YAZABİLECEĞİMİ söyler ve İKİSİ DE
-- gerekir. Yalnızca `using` yazmak — en sık yapılan RLS hatası — okuma tarafını
-- kapatıp yazma tarafını açık bırakır: kullanıcı başkasının user_id'siyle satır
-- ekleyebilir, sonra da onu göremediği için ne yaptığını fark etmez.
--
-- Bu politikalar test edilecek (Faz 1). RLS yanlış yazıldığında hata vermez,
-- sessizce boş sonuç döner; yani ancak iki sahte kullanıcıyla birbirinin
-- satırlarını okumayı ve yazmayı deneyen bir test paketi bunu yakalar.
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.portfolios    enable row level security;
alter table public.transactions  enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists own_rows on public.profiles;
create policy own_rows on public.profiles for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_rows on public.portfolios;
create policy own_rows on public.portfolios for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_rows on public.transactions;
create policy own_rows on public.transactions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_rows on public.user_settings;
create policy own_rows on public.user_settings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Paylaşılan tablolar: giriş yapmış herkes okur, kimse yazamaz.
-- Yazma politikası HİÇ tanımlanmıyor; RLS açıkken politikası olmayan işlem
-- yasaktır. Cron service_role ile bağlandığı için RLS'i baypas eder ve yazar.
alter table public.instruments    enable row level security;
alter table public.prices_latest  enable row level security;
alter table public.prices_monthly enable row level security;
alter table public.fx_latest      enable row level security;
alter table public.fx_monthly     enable row level security;

drop policy if exists read_all on public.instruments;
create policy read_all on public.instruments    for select to authenticated using (true);
drop policy if exists read_all on public.prices_latest;
create policy read_all on public.prices_latest  for select to authenticated using (true);
drop policy if exists read_all on public.prices_monthly;
create policy read_all on public.prices_monthly for select to authenticated using (true);
drop policy if exists read_all on public.fx_latest;
create policy read_all on public.fx_latest      for select to authenticated using (true);
drop policy if exists read_all on public.fx_monthly;
create policy read_all on public.fx_monthly     for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- 5. Tablo yetkileri
--
-- Supabase bunları yeni tablolara varsayılan olarak zaten veriyor, ama burada
-- açıkça yazılı olmaları iki işe yarıyor: dosya kendi başına eksiksiz olur
-- (başka bir Postgres'e taşındığında da çalışır) ve hangi rolün neye
-- erişebildiği okunur bir yerde durur.
--
-- RLS ile yetkiler AYRI iki katman ve ikisi de gerekir: yetki "bu tabloya
-- dokunabilir misin"i, RLS "hangi satırlarına"yı söyler. Yetki olmadan RLS'in
-- ne yazdığının önemi yok — sorgu daha politikaya varmadan reddedilir.
--
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.profiles, public.portfolios, public.transactions, public.user_settings
  to authenticated;

-- Fiyat tabloları herkese açık ama salt okunur. Yazma yetkisi hiçbir role
-- verilmiyor; cron service_role ile bağlanır ve o rol yetki denetimini de
-- RLS'i de baypas eder.
grant select on
  public.instruments, public.prices_latest, public.prices_monthly,
  public.fx_latest, public.fx_monthly
  to authenticated;

-- anon'dan HER ŞEYİ GERİ AL — ve bu satırlar dekoratif değil.
--
-- İlk yazışımda buraya "anon zaten hiçbir şey almıyor" diye bir yorum koymuştum.
-- Yanlıştı. Supabase, public şemasında oluşturulan her tabloya anon, authenticated
-- ve service_role için varsayılan yetkiler veriyor; yani anon, biz ona hiçbir şey
-- vermesek de tabloların hepsinde SELECT/INSERT/UPDATE/DELETE ile doğuyor.
--
-- Bunu canlıda scripts/check-backend.mjs ortaya çıkardı: anonim bir INSERT
-- denemesi "permission denied for table transactions" değil, "new row violates
-- row-level security policy" ile döndü. İkisi de isteği reddediyor, ama ilki
-- yetki katmanında, ikincisi tek başına RLS'te — yani sandığımız iki katmanlı
-- savunma aslında tek katmanmış ve tamamı bir politika ifadesinin doğruluğuna
-- bağlıymış.
--
-- Giriş yapılmamış bir istemcinin bu tablolarda hiçbir işi yok: uygulama
-- sunucuya yalnızca oturum açıldıktan sonra gidiyor, magic link ise tabloları
-- değil auth uç noktasını kullanıyor. Dolayısıyla geri almanın hiçbir maliyeti
-- yok.
revoke all on public.profiles, public.portfolios, public.transactions,
              public.user_settings, public.instruments, public.prices_latest,
              public.prices_monthly, public.fx_latest, public.fx_monthly
  from anon;

-- Bundan SONRA eklenen tablolar yine varsayılanlarla doğar. Yeni bir tablo
-- eklerken bu listeye de eklemeyi unutma; check-backend.mjs'in listesi de
-- güncellenmeli, yoksa yeni tablo sınanmadan kalır.
alter default privileges in schema public revoke all on tables from anon;


-- ---------------------------------------------------------------------------
-- 6. Yeni kullanıcı → boş profil ve boş ayarlar
--
-- PORTFÖY BURADA AÇILMIYOR — VE BİR ÖNCEKİ SÜRÜMDE AÇILIYORDU
--
-- Gerekçe "yeni bir hesabın ilk işlemi var olmayan bir portföye referans
-- vermesin" idi. Doğru bir kaygı, yanlış çözüm: istemci zaten STARTER_PORTFOLIO
-- ile açılıyor (store.js) ve ilk senkronda onu kendisi gönderiyor, üstelik
-- işlemlerden önce. Yani yabancı anahtar zaten karşılanıyordu.
--
-- Karşılığında ödenen bedel şuydu: sunucu, istemcinin hiç bilmediği bir satır
-- üretiyordu. Zaten portföyleri olan biri (T3, Mixed, Amerika) ilk kez
-- senkronladığında bu satırı çeker ve arayüzünde dördüncü, boş bir portföy
-- belirir — kendi açmadığı, ne olduğunu bilmediği bir şey. Tek kullanıcıda
-- can sıkıcı, birden fazla cihazda kafa karıştırıcı.
--
-- Sunucu, istemcinin göndermediği veriyi uydurmasın. Kural bu.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
    on conflict (user_id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 7. Mezar taşı temizliği
--
-- Silinmiş satır sonsuza kadar durmak zorunda değil; senkronun onu görmesi
-- yeterli. 90 gün, "aylardır açmadığım telefonu açtım" senaryosunu rahatça
-- kapsıyor. Zamanlaması Faz 3'te pg_cron ile bağlanır.
-- ---------------------------------------------------------------------------
create or replace function public.purge_tombstones()
returns void
language sql
as $$
  delete from public.transactions where deleted_at < now() - interval '90 days';
  delete from public.portfolios   where deleted_at < now() - interval '90 days';
$$;
