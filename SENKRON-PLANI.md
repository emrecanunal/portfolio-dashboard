# Senkronizasyon Planı

Bu dosya, uygulamayı tek tarayıcıya bağlı bir defterden çok cihazlı bir ürüne
taşıyan işin planı. `GELISTIRME.md` "bugün nasıl çalışıyor"u anlatır; bu dosya
"nereye gidiyoruz ve neden o yoldan"ı anlatır.

Ağustos 2026 kod incelemesinin 13 maddelik listesinde 1–12 kapandı. Bu, 13.
madde.

---

## 0. Karar ve gerekçe

**Backend: Supabase (Postgres + Auth + RLS + Realtime), satıcı-nötr bir dikişle.**

Alternatif kendi backend'imizdi: Vercel + Neon + Auth.js. Aynı sonuca varır ama
kimlik doğrulamayı ve yetkilendirmeyi elle yazmayı gerektirir. Belirleyici fark
tek bir yerde:

Supabase'de yetkilendirme **veritabanının içinde** durur. `auth.uid() = user_id`
politikası bir kez yazılır ve o tablodan geçen her sorgu — hangi endpoint'ten,
hangi istemciden gelirse gelsin — ona uymak zorundadır. Kendi backend'imizde
koruma her sorgudaki `where user_id = ?` cümlesidir; birini yazmayı unuttuğun
gün A kullanıcısı B'nin portföyünü görür. Kendi verin için bu bir hata, başkasının
finansal verisi için bir olay.

**Kilitlenme endişesi küçük:** altı standart Postgres. `pg_dump` ile alıp Neon'a
taşınır. Bağımlı olduğumuz şey veritabanı değil, Auth ve Realtime katmanları —
ve onları da `src/lib/backend/` dikişinin arkasına koyuyoruz (bkz. §4).

**Faz sırası: baştan çok kullanıcılı.** Tek kullanıcılı kurup sonra genişletmeye
göre yaklaşık bir günlük fazla iş; karşılığında yakın çevrene açmak sadece davet
göndermek oluyor, şema migration'ı değil.

---

## 1. Neyi senkronlarız, neyi cihazda bırakırız

Senkronun zor mu kolay mı olacağını belirleyen asıl karar bu. Her şeyi
senkronlamak hem gereksiz hem zararlı.

| Veri | Karar | Neden |
|---|---|---|
| `transactions` | **Senkron, satır bazlı** | Yeri doldurulamaz. UUID + `updated_at` + mezar taşı |
| `subPortfolios` | **Senkron, satır bazlı** | Aynı gerekçe, çok daha az satır |
| `settings` (FIRE hedefleri, para birimi) | **Senkron, alan bazlı LWW** | Nadiren değişir, pratikte çakışmaz |
| `priceHistory`, `fxHistory` | **Senkron, paylaşılan tablo** | Alpha Vantage günde 25 çağrı. İki kez backfill etmek israf |
| `priceCache`, `fxRates` | Paylaşılan tabloya taşınır (Faz 3) | Türetilmiş veri; kullanıcıya değil sembole ait |
| `theme`, `language` | **Cihaz yerel** | Telefonda karanlık, masaüstünde açık isteyebilirsin |
| `finnhubApiKey` | **Yok olur** (Faz 3) | Sunucuya taşınıyor; tarayıcıda hiç durmayacak |

Fiyatların kullanıcı state'inden çıkması, listedeki en az göze çarpan ama en
önemli maddesi. Bugün her tarayıcı doğrudan İş Yatırım'a gidiyor. Üç kullanıcı ×
5 dakikada bir = kaynak seni engeller. Faz 3 bunu tersine çeviriyor: cron çeker,
istemci kendi veritabanından okur.

---

## 2. Şema

```sql
-- auth.users → Supabase yönetir

create table profiles (
  user_id     uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at  timestamptz not null default now()
);

create table portfolios (
  id          uuid primary key,              -- istemci üretir
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  color       text not null,
  sort_order  int  not null default 0,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table transactions (
  id            uuid primary key,            -- istemci üretir (crypto.randomUUID)
  user_id       uuid not null references auth.users on delete cascade,
  portfolio_id  uuid not null,
  type          text not null,               -- buy | sell | deposit | withdraw | fx
  symbol        text,
  asset_class   text,                        -- bist | tefas | global | cash
  quantity      numeric,
  price         numeric,
  currency      text not null,
  commission    numeric not null default 0,
  trade_date    date not null,               -- 'YYYY-MM-DD', saat/dilim YOK
  notes         text,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index on transactions (user_id, updated_at);

create table user_settings (
  user_id     uuid primary key references auth.users on delete cascade,
  settings    jsonb not null default '{}',   -- izin listesi, bkz. RESTORABLE_SETTINGS
  updated_at  timestamptz not null default now()
);

-- Kullanıcıdan bağımsız, herkesin okuduğu, sadece cron'un yazdığı:
create table instruments   (symbol text primary key, asset_class text, currency text, source text);
create table prices_latest (symbol text primary key, price numeric, currency text, fetched_at timestamptz);
create table prices_monthly(symbol text, month text, close numeric, primary key (symbol, month));
create table fx_latest     (base text, quote text, rate numeric, fetched_at timestamptz, primary key (base, quote));
create table fx_monthly    (base text, quote text, month text, rate numeric, primary key (base, quote, month));
```

**`trade_date` `date` tipinde, `timestamptz` değil.** `test:tz`'nin yakaladığı hata
tam buradan çıkmıştı: işlem tarihi saat ve saat dilimi taşımıyor, taşırsa Türkiye'de
üç saatlik kayma ve ayın son günündeki işlemlerin grafikten düşmesi geri gelir.

**`deleted_at` mezar taşı şart.** Satır fiziksel olarak silinirse, silme bilgisi
senkronlanamaz ve silinen işlem diğer cihazdan geri dirilir. 90 günden eski
mezar taşları periyodik temizlenir.

**`updated_at` trigger ile sunucuda yazılır**, istemci saatiyle değil. İki
cihazın saati birbirini tutmayabilir ve senkron imleci buna bağlı.

### RLS politikaları

```sql
alter table transactions enable row level security;

create policy "own rows" on transactions
  for all
  using      (auth.uid() = user_id)      -- ne okuyabilirim
  with check (auth.uid() = user_id);     -- ne yazabilirim
```

**`with check` olmadan yazma tarafı açık kalır** — kullanıcı başkasının
`user_id`'siyle satır ekleyebilir. Klasik RLS hatası; her tabloda ikisi birden
olmalı. Aynı politika `portfolios`, `profiles`, `user_settings` için tekrarlanır.

Paylaşılan tablolar tersi: `for select using (true)`, yazma yalnızca
`service_role` (yani cron) tarafından.

**Bu politikalar test edilecek.** İki sahte kullanıcı yaratıp A'nın oturumuyla
B'nin satırlarını okumayı ve yazmayı deneyen bir test paketi — RLS'in kendisi
sessizce boş sonuç döndürdüğü için, yanlış yazılmış bir politika ancak böyle
fark edilir.

---

## 3. Senkron algoritması

Model: **local-first**. `localStorage` gerçeğin kaynağı olmaktan çıkıp önbelleğe
dönüşür; uygulama uçakta da açılır, internet gelince kendini toparlar.

**Çekme (pull).** `select * from transactions where updated_at > :cursor`.
RLS zaten kullanıcıya daraltıyor, `where user_id` yazmaya gerek yok — ve
yazmamak, unutulduğunda açık bırakan bir alışkanlığı hiç edinmemek demek.
İmleç, görülen en büyük `updated_at`.

**Gönderme (push).** Yerelde kirli işaretlenmiş satırlar `upsert` edilir.
`id` istemcide üretildiği için işlem idempotent: aynı satırı iki kez göndermek
iki kayıt yaratmaz.

**Çakışma kuralı: satır bazlı, kirli olan kazanır.** Bir satır yerelde
değiştirilmişse bu turda o gönderilir; değiştirilmemişse sunucudan geleni kabul
eder. Farklı cihazlarda farklı işlemler eklemek tamamen güvenli — ikisi de yaşar.

**Dürüst olduğumuz yer:** *aynı* işlemi iki cihazda çevrimdışıyken düzenlersen,
sonra senkronlanan kazanır ve diğerinin düzenlemesi sessizce kaybolur. Tek
kullanıcı iki cihaz için bu senaryo pratikte olmuyor; olmasını engellemek CRDT
gerektirir ve bu ürün için ağır top. Kabul ediyoruz ve buraya yazıyoruz.

**Ne zaman tetiklenir:**

| Olay | Yön |
|---|---|
| Uygulama açılışı | pull |
| Store değişimi (2 sn debounce) | push |
| Sekme odağı / `visibilitychange` | pull |
| Realtime `postgres_changes` | pull (delta) |
| `online` olayı | outbox'ı boşalt |

**Outbox:** çevrimdışıyken yapılan yazımlar kuyrukta bekler ve zustand persist
ile diske yazılır — yani uygulamayı kapatıp açmak kuyruğu kaybetmez.

---

## 4. Satıcı-nötr dikiş

```
src/lib/backend/
├── index.js      ← uygulamanın gördüğü tek arayüz
└── supabase.js   ← o arayüzün Supabase uygulaması
```

`index.js`'in sözleşmesi: `signIn`, `signOut`, `getSession`, `pull(cursor)`,
`push(rows)`, `subscribe(onChange)`.

**Uygulamanın geri kalanı `@supabase/supabase-js`'i hiç import etmez.** Taşımak
gerekirse değişen dosya sayısı: bir. Bu kural bozulmasın diye Faz 1'de basit bir
lint kontrolü de eklenecek.

---

## 5. Fazlar

### Faz 0 — Temizlik ✅ (tamamlandı)

- Demo veri varsayılan state'ten çıktı; ilk açılış boş, demo `loadDemoData()`
  ile Settings'ten geliyor
- `src/lib/store.test.js` bu davranışı kilitliyor

> **Bu neden senkronun önkoşuluydu:** telefon uygulamayı ilk açtığında demo
> işlemlerle boot edip onları gerçekmiş gibi sunucuya iterdi ve hiçbir birleştirme
> mantığı bunları laptopta girilen gerçek işlemlerden ayıramazdı.

### Faz 1 — Backend iskeleti

| Kim | Ne |
|---|---|
| **Sen** | supabase.com'da proje aç, bölge **eu-central-1 (Frankfurt)** |
| **Sen** | Proje URL'i + **anon key**'i bana ver (bunlar gizli değil, istemciye gömülür) |
| **Sen** | **service_role key'i bana verme** — doğrudan Vercel env'e koy |
| Ben | Şema SQL'i + RLS politikaları + RLS testleri |
| Ben | `src/lib/backend/` dikişi, `AuthGate`, magic link giriş ekranı |
| Ben | `portfolio-private-import.json` → Supabase migration script'i (364 işlem) |

### Faz 2 — Senkron katmanı

`src/lib/sync.js`, outbox, Realtime aboneliği, senkron durumu göstergesi
("son senkron 2 dk önce" / "çevrimdışı, 3 değişiklik bekliyor").

### Faz 3 — Fiyat katmanı sunucuya

`prices_latest` + Vercel Cron (piyasa açıkken 5 dk, TEFAS akşam bir kez).
Finnhub ve Alpha Vantage anahtarları env'e; tarayıcıdan tamamen çıkar.
`src/lib/priceApi.js` artık dış kaynağa değil kendi veritabanımıza bakar.

### Faz 4 — Çok kullanıcı hazırlığı (yakın çevreye açarken)

Davet akışı, kullanıcı başına kota, Sentry, "yatırım tavsiyesi değildir" ibaresi,
KVKK aydınlatma metni ve hesap/veri silme akışı.

---

## 6. Üç ufuk

| | H1 · Sadece sen | H2 · 2-3 kişi | H3 · Ürün |
|---|---|---|---|
| Şema | Aynı | **Aynı** | Aynı + abonelik tabloları |
| Auth | Magic link | Aynı + davet | Aynı + onboarding |
| Fiyat çekme | Cron, tek kullanıcı | Cron, aynı | Cron + kota yönetimi |
| Maliyet | ₺0 | ₺0 | ~$45/ay (Supabase Pro + Vercel Pro) |
| Yeni iş | — | Davet + kota + izleme | Ödeme, destek, yasal |

H1'den H2'ye geçiş şema değişikliği içermiyor. Bu, "baştan çok kullanıcılı"
kararının tek cümlelik gerekçesi.

**Supabase ücretsiz katman:** 500 MB veritabanı, 5 GB egress, 50k aylık aktif
kullanıcı. Tek uyarı: ücretsiz projeler **1 hafta hareketsizlikten sonra
duraklatılıyor**. Günlük açtığın bir uygulamada oluşmaz; yine de Faz 3'teki cron
zaten haftanın her günü veritabanına yazacağı için bu risk kendiliğinden kapanıyor.

---

## 7. Şimdi yapmayacaklarımız

Ödeme altyapısı, ekip/paylaşılan portföy, native uygulama (PWA yetiyor),
mikroservis ayrıştırması, CRDT tabanlı çevrimdışı birleştirme.

Hiçbiri bugün alınan kararları kısıtlamıyor — hepsi bu şemanın üstüne, geldiği
gün eklenir. Erken eklenirse sadece bakım yükü olur.
