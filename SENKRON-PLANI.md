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

**Kaynak: [`supabase/schema.sql`](supabase/schema.sql).** Çalışan sürüm orada;
burada yalnızca *neden öyle* yazıldığı var. Şema değişirse o dosya değişir, bu
bölüm değil.

Kurulum: Supabase → SQL Editor → New query → dosyanın tamamını yapıştır → Run.
Dosya yeniden çalıştırılabilir, ikinci kez koşturmak veriyi bozmaz.

### Şemayı belirleyen dört karar

**Birincil anahtar `(user_id, id)`, tek başına `id` değil.** Bunu gerçek veriyi
okuyunca değiştirdim: 364 işlemin **349'unun id'si UUID değil** — Investing.com
içe aktarması `inv-233`, fon dönüştürücü `fund-1` yazmış. Deterministik olmaları
iyi bir şey (aynı dosyayı iki kez aktarmak kayıtları ikizlemiyor) ama global
benzersizlik garantisi yok: ikinci kullanıcı da kendi dosyasını aktardığında onun
da bir `inv-233`'ü olur. Bileşik anahtar herkese kendi ad alanını veriyor.

**`trade_date` `date` tipinde, `timestamptz` değil.** `test:tz`'nin kovaladığı
hata tam buradan çıkmıştı: işlem tarihi saat ve saat dilimi taşımıyor, taşırsa
Türkiye'de üç saatlik kayma ve ayın son günündeki işlemlerin grafikten düşmesi
geri gelir.

**`deleted_at` mezar taşı.** Satır fiziksel silinirse silme bilgisi
senkronlanamaz ve kayıt diğer cihazdan geri dirilir. 90 günden eskiler
`purge_tombstones()` ile temizlenir.

**`updated_at`'i trigger ile sunucu yazar**, istemci değil. Senkron imleci bu
kolona bakıyor; saati beş dakika geri olan bir telefonun yazdığı satır imlecin
gerisinde kalır ve diğer cihaz onu hiç görmez.

### Uygulama ↔ veritabanı alan eşlemesi

SQL tarafı snake_case ve tip adlarıyla çakışmayan isimler kullanıyor. Çeviri tek
yerde, `src/lib/backend/` dikişinde:

| Uygulama | Veritabanı |
|---|---|
| `assetType` | `asset_type` |
| `portfolioId` | `portfolio_id` |
| `date` | `trade_date` |

### RLS politikaları

`using` ne okuyabileceğimi, `with check` ne yazabileceğimi söyler ve **ikisi de
gerekir**. Yalnızca `using` yazmak — en sık yapılan RLS hatası — okumayı kapatıp
yazmayı açık bırakır: kullanıcı başkasının `user_id`'siyle satır ekleyebilir,
sonra da onu göremediği için ne yaptığını fark etmez.

Paylaşılan fiyat tablolarında tersi kurgu: `select` politikası var, yazma
politikası **hiç tanımlanmıyor**. RLS açıkken politikası olmayan işlem yasaktır;
cron `service_role` ile bağlandığı için RLS'i baypas edip yazar.

**Bu politikalar test edildi.** RLS yanlış yazıldığında hata vermez, sessizce boş
sonuç döner — yani ancak iki sahte kullanıcıyla birbirinin satırlarını okumayı
*ve yazmayı* deneyen bir test paketi bunu yakalar. `supabase/test/rls_test.sql`
sekiz şeyi sınıyor: yeni kullanıcıya portföy açılması, kendi satırını yazabilme,
başkasınınkini görememe, **aynı `inv-233` id'sinin iki kullanıcıda çakışmaması**,
başkasının `user_id`'siyle yazmanın reddedilmesi, fiyat tablolarının okunabilip
yazılamaması ve `updated_at`'in istemci değerini ezmesi.

Supabase projesi açmadan koşar (`supabase/test/prelude.sql` eksik parçaları
taklit eder):

```bash
createdb rlstest
psql -d rlstest -v ON_ERROR_STOP=1 -f supabase/test/prelude.sql
psql -d rlstest -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql -d rlstest -v ON_ERROR_STOP=1 -f supabase/test/rls_test.sql
```

---

## 3. Senkron algoritması

Model: **local-first**. `localStorage` gerçeğin kaynağı olmaktan çıkıp önbelleğe
dönüşür; uygulama uçakta da açılır, internet gelince kendini toparlar.

**Çekme (pull).** `select * from transactions where updated_at > :cursor`.
RLS zaten kullanıcıya daraltıyor, `where user_id` yazmaya gerek yok — ve
yazmamak, unutulduğunda açık bırakan bir alışkanlığı hiç edinmemek demek.

**İmleç ham `max(updated_at)` OLAMAZ, birkaç saniye geriden sorulmalı.** Bunu
şemayı lokal Postgres'te sınarken fark ettim ve sessizce veri kaybettirecek
cinsten:

> A işlemi T1'de başlar. B işlemi T2'de (T2 > T1) başlar, işini bitirir ve önce
> commit eder. İstemci o sırada çeker, imleci T2'ye taşır. **Sonra** A commit
> eder — ama satırları T1 damgalı, yani imlecin gerisinde. O satırlar bir daha
> hiçbir çekmeye yakalanmaz.

Damga *yazma* anında konuyor, satır ise *commit* anında görünür oluyor; ikisinin
sırası aynı olmak zorunda değil. Çözüm ucuz: imleci `max(updated_at) - 30 sn`
olarak sakla ve aynı satırları tekrar çek. Birleştirme `id` üzerinden idempotent
olduğu için tekrar gelen satır zarar vermiyor, sadece birkaç satır fazla trafik.

(Kusursuz çözüm imleci zaman yerine commit sırasına bağlamak olurdu — Postgres
tarafında `xmin` ya da mantıksal çoğaltma. Bu ürünün ölçeğinde ödediği bedele
değmez; 30 saniyelik pencere yeterli.)

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

### Faz 1 — Backend iskeleti ✅ (tamamlandı, 25 Ağustos 2026)

| Kim | Ne |
|---|---|
| **Sen** | supabase.com'da proje aç, bölge **eu-central-1 (Frankfurt)** |
| **Sen** | `supabase/schema.sql`'i SQL Editor'e yapıştır → Run |
| **Sen** | Proje URL'i + **anon key**'i bana ver (bunlar gizli değil, istemciye gömülür) |
| **Sen** | **service_role key'i bana verme** — doğrudan Vercel env'e koy |
| Ben | ✅ Şema SQL'i + RLS politikaları (`supabase/schema.sql`) |
| Ben | ✅ RLS test paketi (`supabase/test/`) — 8 test, lokal Postgres'te geçiyor |
| Ben | `src/lib/backend/` dikişi, `AuthGate`, magic link giriş ekranı |
| Ben | `portfolio-private-import.json` → Supabase migration script'i (364 işlem) |

> **Faz 1'de öğrenilenler.**
>
> **Supabase, `public` şemasındaki her tabloya `anon` için de yetki veriyor.**
> Şema "anon hiçbir şey almıyor" diye yazıyordu; yanlıştı. Anonim bir yazma
> denemesinin `permission denied` yerine `row-level security` ile reddedilmesi
> ele verdi — ikisi de isteği durduruyor ama biri yetki katmanında, diğeri tek
> başına politikada. Şema artık dokuz tablonun hepsinde `revoke ... from anon`
> yapıyor. **Yeni tablo eklerken o listeye de eklemeyi unutma.**
>
> **Bir testin geçmesi, ölçtüğünü sandığın şeyi ölçtüğü anlamına gelmiyor.**
> `prices_latest` için "anonim okuma kapalı" testi boş dizi dönünce geçiyordu —
> ama tablo zaten boş, herkese açık bir boş tablo da aynı cevabı verir. Kontrol
> script'i artık reddin *derecesini* ayırt ediyor; boş sonuç `ZAYIF` sayılıyor.
>
> **Node 22 zorunlu oldu.** `supabase-js` `engines: node >=22` diyor ve Vercel
> Node 20 çalışma zamanını 1 Ekim 2026'da kaldırıyor.

### Faz 2 — Senkron katmanı ✅ (tamamlandı, 25 Ağustos 2026)

`src/lib/sync.js`, outbox, Realtime aboneliği, senkron durumu göstergesi
("son senkron 2 dk önce" / "çevrimdışı, 3 değişiklik bekliyor").

> **Faz 2'de öğrenilenler.**
>
> **Kimliğin benzersizliği varsayılamaz, doğrulanmalı.** 364 işlemin 39'u başka
> bir işlemle aynı id'yi taşıyordu: `import-investing.mjs`'in `idPrefix`
> varsayılanı `'inv'` olduğu için iki ayrı Investing.com dosyası da `inv-1`'den
> numaralanmıştı. `inv-39` hem `sub-t3`'te bir CRDFA alımı hem `sub-global`'de
> bir TEM satışıydı. Tek tarayıcıda hiçbir belirtisi yok — id'ye bakan tek şey
> senkron. Artık hem içe aktarmada önek zorunlu (hedef portföyden türüyor) hem
> `parseJsonBackup` çift id'leri kapıda onarıyor.
>
> **Senkron, kendisine söyleneni yapar.** Sunucuya bir ara Mayıs yedeği
> yüklendi ve senkron onu sadakatle yukarı taşıdı: 256 işlem, 4 portföy.
> Hata değildi, ama şunu gösterdi — geri yükleme artık iki cihazı birden
> etkileyen bir işlem. Onay ekranının bunu söylemesi gerekiyor (Faz 4).
>
> **Toptan değiştirmeler fark almalı.** Yalnızca yeni satırları "gönder"
> işaretlemek, kaybolanları sunucuda bırakır ve bir sonraki çekmede geri
> getirir. `outboxForReplacement` gidenlere mezar taşı koyuyor.

### Faz 3 — Fiyat katmanı sunucuya

`prices_latest` doldurulur, Finnhub ve Alpha Vantage anahtarları env'e taşınır,
`src/lib/priceApi.js` dış kaynağa değil kendi veritabanımıza bakar. Tarayıcıda
API anahtarı diye bir şey kalmaz.

**Zamanlayıcı Vercel Cron DEĞİL.** Bu planın ilk halinde öyle yazıyordu, sonra
doğruladım: **Vercel'in ücretsiz (Hobby) planında cron günde yalnızca bir kez
çalışabilir** ve daha sık bir ifade deploy sırasında hata verir; üstelik tetikleme
zamanı da ±59 dakika şaşabilir. "Piyasa açıkken 5 dakikada bir" oradan çıkmıyor.

Yerine **Supabase Cron (`pg_cron`)** — zamanlama doğrudan Postgres'in içinde,
dakikalık çözünürlükte, `pg_net` ile HTTP çağrısı yapabiliyor. Belgelerde plana
bağlı bir kısıt geçmiyor; Faz 3'e geldiğimizde ücretsiz katmanda bizzat
doğrulanacak. Çıkmazsa yedek seçenek GitHub Actions (`schedule:`, 5 dakikalık
asgari aralık, özel depoda ayda 2000 dakika ücretsiz).

Bunun ikinci bir faydası var: `pg_cron` her gün veritabanına yazdığı için
Supabase'in "ücretsiz projeler 1 hafta hareketsizlikte duraklatılır" kuralı
kendiliğinden konu dışı kalıyor.

> **Mac mini M4 notu.** Bir ara bu işi ev sunucusuna vermeyi konuştuk; alım şimdilik
> yok. İleride alınırsa doğru kullanım "sunucu" değil **işçi** olurdu: dışarı hiç
> port açmadan fiyatları çeker, TEFAS'ı kazır, sonuçları Supabase'e yazar.
> İstemciler yine Supabase'den okuduğu için mini kapalıyken de uygulama çalışır,
> yalnızca fiyatlar bayatlar. Bu kararın şemaya etkisi yok — sadece
> `prices_latest`'e kimin yazdığı değişir.

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
