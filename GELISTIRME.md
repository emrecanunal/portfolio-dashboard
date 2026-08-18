# Geliştirme Kılavuzu

Bu dosya uygulamanın **özelliklerini** değil, projeyi **nasıl geliştireceğini** anlatır:
dosyalar nerede, değişikliği nasıl yaparsın, GitHub'a nasıl gönderirsin, veri nerede durur.

Uzun bir aradan sonra döndüysen doğrudan [Aradan sonra geri dönüş](#aradan-sonra-geri-dönüş)
bölümüne git.

---

## 1. Proje nerede duruyor

```
Master Portfolio/                      ← senin klasörün (iCloud/Masaüstü)
├── portfolio-dashboard/               ← asıl proje, git deposu burası
├── portfolio-private.json             ← gerçek portföy yedeğin (git'e GİRMEZ)
└── portfolio-dashboard-*.zip          ← eski sürüm arşivleri, gerek yok
```

GitHub deposu: `https://github.com/emrecanunal/portfolio-dashboard` · dal: `main`

### portfolio-dashboard içinde ne nerede

| Yol | Ne işe yarar | Ne zaman dokunursun |
|---|---|---|
| `src/pages/` | Sayfalar (Dashboard, Transactions, FIRE, Settings…) | Bir sayfanın düzenini değiştirirken |
| `src/components/` | Tekrar kullanılan parçalar; `charts/` grafikler, `ui/` düğme-modal gibi temel öğeler, `modals/` işlem ekleme penceresi | Görsel bileşen eklerken |
| `src/lib/calculations.js` | **Tüm para matematiği** — bakiye, dağılım, kâr/zarar | Hesap mantığı değişince. En kritik dosya. |
| `src/lib/store.js` | Uygulama state'i + localStorage'a otomatik kayıt | Yeni bir veri alanı eklerken |
| `src/lib/priceApi.js` | Tarayıcıdan `/api/*` uçlarını çağıran katman | Fiyat kaynağı davranışı değişince |
| `src/lib/fxApi.js` | Döviz kuru (Frankfurter/ECB) | Kur kaynağı değişince |
| `src/lib/dataExport.js` | JSON yedek + CSV dışa aktarma | Kayıtlara yeni alan eklediğinde **buraya da ekle** |
| `src/i18n/translations.js` | İngilizce + Türkçe tüm metinler | Arayüzde yeni yazı çıkardığında |
| `api/bist.js` · `api/tefas.js` · `api/global.js` | Fiyat çeken sunucu kodu (İş Yatırım / FonBul / Stooq) | Bir kaynak bozulunca |
| `dev-proxy.js` | Lokalde `api/*` dosyalarını çalıştıran mini sunucu | Neredeyse hiç |
| `vite.config.js` · `vercel.json` · `tailwind.config.js` | Yapılandırma | Nadiren |

**Altın kural:** yeni bir işlem alanı eklersen üç yeri birden güncelle —
`calculations.js` (hesaba katsın), `translations.js` (etiketi olsun),
`dataExport.js` (yedeğe/CSV'ye girsin). Bu üçlüyü unutmak en sık yapılan hata.

---

## 2. Günlük çalışma döngüsü

```bash
cd "$HOME/Desktop/Desktop Folder/Bireysel Projeler/Hisse Projesi/Master Portfolio/portfolio-dashboard"

npm install        # sadece ilk kurulumda ve package.json/lock değişince
npm run dev:full   # geliştirme sunucusu
```

`dev:full` iki şeyi aynı anda başlatır:

- **Vite → http://localhost:5173** — uygulamanın kendisi, dosyayı kaydettiğinde anında yenilenir
- **Express → http://localhost:3001** — `api/*.js` dosyalarını lokalde çalıştırır

Vite, `/api/...` isteklerini 3001'e yönlendirir; yani tarayıcıdaki kod hem lokalde
hem Vercel'de birebir aynı `fetch('/api/bist?...')` çağrısını yapar. İkisini de
durdurmak için terminalde `Ctrl+C`.

Sadece arayüzle uğraşıyorsan `npm run dev` yeter (fiyat çekme çalışmaz).

Fiyat uçlarını tek başına test etmek istersen, proxy çalışırken:

```bash
curl "http://localhost:3001/api/health"
curl "http://localhost:3001/api/bist?symbols=THYAO,ASELS"
curl "http://localhost:3001/api/global?symbols=AAPL,VOO"
curl "http://localhost:3001/api/tefas?symbols=AFA,TI2"
```

Göndermeden önce mutlaka:

```bash
npm run build      # hata verirse gönderme — Vercel'de de patlar
```

---

## 3. Değişikliği GitHub'a gönderme

Sıra her zaman aynı: **bak → seç → kaydet → gönder**.

```bash
git status                    # neler değişmiş
git diff                      # tam olarak ne değişmiş (q ile çık)

git add -A                    # hepsini seç
# ya da tek tek:  git add src/lib/calculations.js

git commit -m "Kısa açıklama"
git push
```

`git push` sonrası GitHub güncellenir. Vercel bağlıysa deploy da kendiliğinden başlar
(bkz. [bölüm 5](#5-vercel-ve-yayına-alma)).

### İyi commit mesajı

İlk satır kısa ve emir kipinde, ne yaptığını söylesin. Uzun açıklama gerekiyorsa
bir boş satır bırakıp altına yaz:

```bash
git commit -m "Add currency exchange transaction type

Adds toAmount/toCurrency to the transaction model and splits cash
per currency in the allocation donut."
```

Terminalde çok satırlı yazmak zorsa `git commit` (mesajsız) yaz, açılan editörde
mesajı yaz, `:wq` ile kaydet-çık.

### Küçük ama faydalı komutlar

```bash
git log --oneline -10               # son 10 commit
git log --oneline -5 --stat         # hangi dosyalar değişmiş
git show HEAD                       # son commit'in tam içeriği
git diff HEAD~1 src/lib/store.js    # bir dosyanın son değişimi
```

### Geri alma

| Durum | Komut |
|---|---|
| Bir dosyadaki kaydedilmemiş değişikliği çöpe at | `git restore src/pages/FirePage.jsx` |
| Tüm kaydedilmemiş değişiklikleri çöpe at | `git restore .` |
| `git add` yaptım, geri alayım (dosya kalsın) | `git restore --staged .` |
| Son commit'i geri al, değişiklikler dursun | `git reset --soft HEAD~1` |
| Son commit'in mesajını düzelt (henüz push etmediysen) | `git commit --amend -m "Yeni mesaj"` |
| Push ettiğim bir commit'i güvenle geri al | `git revert <commit-hash>` |

> Push edilmiş bir şeyi `reset` ile silmeye çalışma — `revert` kullan. `revert`
> geçmişi bozmadan "bunu geri alan" yeni bir commit üretir.

### Riskli bir şey denerken: dal aç

Büyük bir değişikliğe girişiyorsan `main`'i bozma:

```bash
git checkout -b deneme-yeni-grafik    # yeni dal aç ve geç
# ...çalış, commit'le...
git checkout main                     # ana dala dön
git merge deneme-yeni-grafik          # beğendiysen birleştir
git branch -d deneme-yeni-grafik      # dalı sil
```

Beğenmediysen birleştirme, sadece dalı sil (`git branch -D deneme-yeni-grafik`) —
`main` hiç etkilenmemiş olur.

---

## 4. Git'e ASLA girmemesi gerekenler

`.gitignore` şunları zaten engelliyor:

```
node_modules        dist            .DS_Store       .env / .env.local
portfolio-backup-*.json             portfolio-private*.json
*-private.json                      t3-portfolio*.json
```

Yani gerçek portföy verin GitHub'a çıkmaz. **Yedek dosyalarını her zaman bu
kalıplardan biriyle adlandır** (`portfolio-private-2026-08.json` gibi). Başka bir
isim verirsen `.gitignore` yakalamaz ve holdinglerin herkese açık depoya düşebilir.

Yanlışlıkla eklediysen, push etmeden önce:

```bash
git rm --cached portfolio-private.json    # takipten çıkar, dosya diskte kalır
```

Push ettikten sonra fark ettiysen: dosya geçmişte kalır. O durumda GitHub'da depoyu
private yap veya geçmişi temizle — bana sor, birlikte hallederiz.

---

## 5. Vercel ve yayına alma

`vercel.json` hazır, `api/*.js` dosyaları Vercel'de otomatik olarak serverless
fonksiyona dönüşür. Ekstra bir ayar gerekmiyor.

**Bağlıysa akış şu:** `git push` → Vercel değişikliği görür → derler → canlıya alır
(~1 dakika). Yani ayrı bir "deploy" komutu yok, push yeterli.

**Bağlı mı, nasıl anlarsın:** [vercel.com/dashboard](https://vercel.com/dashboard)
→ `portfolio-dashboard` projesi görünüyorsa bağlıdır, son deploy'ların listesi de
oradadır. Bir deploy kırmızıysa üstüne tıkla, build log'u hatayı söyler — genelde
lokalde `npm run build` çalıştırınca aynı hatayı görürsün.

Bağlı değilse: Vercel'de **Add New → Project** → GitHub'dan `portfolio-dashboard`
deposunu seç → ayarlara dokunmadan **Deploy**. Vite'ı ve `api/` klasörünü kendi
tanır.

---

## 6. Verilerin nerede — en önemli bölüm

**Portföy verin git'te değil, tarayıcının `localStorage`'ında duruyor**
(anahtar: `portfolio-dashboard-v1`).

Bunun pratik sonuçları:

- Kod göndermek verini yedeklemez. Bunlar tamamen ayrı iki şey.
- Her tarayıcı/cihaz kendi verisini tutar. Mac'teki Chrome ile telefonundaki
  uygulama **aynı veriyi görmez**.
- Tarayıcı verisini temizlersen (veya "site verilerini sil" dersen) portföyün gider.
- localhost:5173 ile Vercel adresin **farklı** iki depo — lokalde girdiğin işlem
  canlıda görünmez.

### Yedek al (düzenli yap)

Uygulamada **Ayarlar → Dışa aktar & yedekle → Yedek indir (JSON)**. Dosya
`portfolio-backup-TARIH.json` adıyla iner; bu isim `.gitignore` kalıbına uyar,
yani güvenli.

Geri yüklemek: aynı bölümde **Yedekten geri yükle** → dosyayı seç. (Uyarı da diyor:
bu işlem mevcut verinin **tamamını** değiştirir.)

İşlem geçmişini Excel'de incelemek istersen **İşlemleri dışa aktar (CSV)**.

Cihaz değiştirirken, tarayıcı temizlerken veya veri yapısını değiştiren bir kod
yazmadan önce **mutlaka önce yedek al.** Elindeki `portfolio-private.json` da böyle
bir yedek — ama Mayıs 2026'dan kalma, güncel değil.

> Yedek dosyası Finnhub API anahtarını içermez, bilerek çıkarılır. Geri yükledikten
> sonra anahtarı Settings'ten tekrar girmen gerekir.

---

## 7. Aradan sonra geri dönüş

Aylar sonra döndüysen sırayla:

```bash
cd "$HOME/Desktop/Desktop Folder/Bireysel Projeler/Hisse Projesi/Master Portfolio/portfolio-dashboard"

git status                 # yarım kalmış değişiklik var mı?
git log --oneline -5       # en son ne yapmışım?
npm install                # bağımlılıkları tazele
npm run dev:full           # aç ve fiyatları yenile
```

Sonra uygulamada **Ayarlar → Varlık fiyatları → Tüm fiyatları güncelle** de. Üç
kaynağın (BIST, TEFAS, global) da döndüğünü gör — bunlar herkese açık, sözleşmesiz
kaynaklar ve zamanla sessizce bozulabilirler. "Bazı semboller başarısız" uyarısı
çıkarsa ilgili `api/*.js` dosyasına bakılması gerekir. Kurlar için ayrıca
**Döviz kurları → Şimdi güncelle** var.

`git status` çıktısında `M` işaretli dosyalar varsa, o senin yarım bıraktığın iştir.
`git diff` ile ne yaptığını hatırlarsın.

---

## 8. Sık karşılaşılan sorunlar

**"Resource deadlock avoided" / dosyalar boş görünüyor**
iCloud dosyaları buluta taşımış, diskte sadece yer tutucu var. Finder'da
`Master Portfolio` klasörüne sağ tık → **Şimdi İndir**. Kalıcı çözüm: Sistem
Ayarları → Apple Hesabı → iCloud → **"Mac Depolamayı Optimize Et"**i kapat.
Bu klasörü iCloud dışında bir yerde (ör. `~/Projects/`) tutmak daha da iyi.

**`npm run dev` "port 5173 kullanımda" diyor**
Arka planda eski bir sunucu kalmış:
```bash
lsof -ti:5173 | xargs kill    # aynısı 3001 için de
```

**`Cannot find module @rollup/rollup-...` veya tuhaf derleme hataları**
`node_modules` bozulmuş. Sıfırla:
```bash
rm -rf node_modules && npm install
```

**`npm audit` uyarı veriyor**
```bash
npm audit fix          # güvenli, kırıcı olmayan yamalar — çekinmeden çalıştır
npm audit fix --force  # ÇALIŞTIRMA — major sürüm atlatır, uygulamayı bozabilir
```
`--force` isteyen uyarılar kalırsa bunlar ayrı bir iş olarak planlanmalı, aceleye
getirilmemeli.

**Vercel deploy kırmızı**
Önce lokalde `npm run build` çalıştır; hata büyük ihtimalle orada da çıkar ve
mesajı daha okunaklıdır.

**Fiyatlar gelmiyor**
`npm run dev:full` yerine sadece `npm run dev` çalıştırmış olabilirsin — 3001'deki
proxy ayakta değildir. Ayaktaysa `curl http://localhost:3001/api/health` ile teyit et.

---

## 9. Çok kullanılan komutlar

```bash
npm run dev:full   # geliştirme (Vite 5173 + api proxy 3001)
npm run build      # production derleme — göndermeden önce çalıştır
npm run preview    # derlenmiş sürümü lokalde dene

git status         # ne değişti
git diff           # ayrıntılı fark
git add -A         # hepsini seç
git commit -m "…"  # kaydet
git push           # GitHub'a gönder (+ Vercel deploy)
git log --oneline -10
git restore .      # kaydedilmemiş her şeyi çöpe at (dikkat)
```
