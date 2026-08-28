-- Sunucunun gerçekte ne taşıdığını söyler. SADECE OKUR, hiçbir şey değiştirmez.
--
-- NEDEN VAR
--
-- 28 Ağustos'tan sonra iki cihaz iki farklı portföy sayısı gösterdi. Yerelde
-- görünen şey soruyu cevaplamıyor: mezar taşı yazılmamış da olabilir, yazılmış
-- ama updated_at'i tetikleyen trigger kurulu olmadığı için imleçle çeken cihaza
-- hiç duyurulmamış da olabilir. İkisi tamamen farklı hatalar ve ekrandan
-- ayırt edilemiyorlar.
--
-- KULLANIM
--   Supabase Dashboard → SQL Editor → yapıştır → Run.
--
-- Sonuç iki kolon: kontrol / sonuc. "?" ile başlayan her satır bir sorundur.

with kontroller as (

  -- 1. Kolonlar yerinde mi (şemanın son hâli çalıştırılmış mı)
  select 1 as sira, 'kolon: portfolios.is_cash_account' as kontrol,
         coalesce((select 'VAR' from information_schema.columns
                   where table_schema='public' and table_name='portfolios'
                     and column_name='is_cash_account'), '? YOK') as sonuc
  union all
  select 2, 'kolon: portfolios.deleted_at',
         coalesce((select 'VAR' from information_schema.columns
                   where table_schema='public' and table_name='portfolios'
                     and column_name='deleted_at'), '? YOK')
  union all
  select 3, 'kolon: transactions.to_portfolio_id',
         coalesce((select 'VAR' from information_schema.columns
                   where table_schema='public' and table_name='transactions'
                     and column_name='to_portfolio_id'), '? YOK')
  union all
  select 4, 'kolon: transactions.deleted_at',
         coalesce((select 'VAR' from information_schema.columns
                   where table_schema='public' and table_name='transactions'
                     and column_name='deleted_at'), '? YOK')

  -- 2. İşlem tipleri. 'transfer' ve 'opening' check kısıtında yoksa Kasa akışı
  --    sunucuda reddedilir ve o satırlar senkronda sonsuza kadar takılı kalır.
  union all
  select 5, 'tip kisiti: transfer kabul ediliyor mu',
         case when exists (
           select 1 from pg_constraint
           where conrelid='public.transactions'::regclass
             and pg_get_constraintdef(oid) like '%transfer%'
         ) then 'EVET' else '? HAYIR' end
  union all
  select 6, 'tip kisiti: opening kabul ediliyor mu',
         case when exists (
           select 1 from pg_constraint
           where conrelid='public.transactions'::regclass
             and pg_get_constraintdef(oid) like '%opening%'
         ) then 'EVET' else '? HAYIR' end

  -- 3. updated_at trigger'ları. BU KRİTİK: mezar taşı bir UPDATE'tir. Trigger
  --    yoksa deleted_at yazılır ama updated_at olduğu yerde kalır — imleçten
  --    çeken diğer cihaz silmeyi HİÇ görmez. Satır sunucuda ölüdür, telefonda
  --    yaşamaya devam eder. Aradığımız hata tam olarak bu olabilir.
  union all
  select 7, 'trigger: portfolios_updated_at',
         coalesce((select 'VAR' from pg_trigger
                   where tgrelid='public.portfolios'::regclass
                     and tgname='portfolios_updated_at' and not tgisinternal), '? YOK')
  union all
  select 8, 'trigger: transactions_updated_at',
         coalesce((select 'VAR' from pg_trigger
                   where tgrelid='public.transactions'::regclass
                     and tgname='transactions_updated_at' and not tgisinternal), '? YOK')

  -- 4. Kayıp portföy. Hangi hâlde duruyor?
  union all
  select 9, 'sub-default portfoy satiri',
         coalesce((select case when deleted_at is null
                               then '? YASIYOR (mezar tasi yok) — ad: ' || name
                               else 'mezar tasli: ' || deleted_at::text end
                   from public.portfolios where id='sub-default'),
                  'sunucuda hic yok')
  union all
  select 10, 'sub-default islemleri (canli / mezar tasli)',
         (select coalesce(count(*) filter (where deleted_at is null),0)::text || ' canli / ' ||
                 coalesce(count(*) filter (where deleted_at is not null),0)::text || ' mezar tasli'
          from public.transactions where portfolio_id='sub-default')

  -- 5. Genel sayım. Beklenen: 4 canli portfoy, 368 canli islem.
  union all
  select 11, 'canli portfoy sayisi (beklenen 4)',
         (select count(*)::text from public.portfolios where deleted_at is null)
  union all
  select 12, 'canli islem sayisi (beklenen 368)',
         (select count(*)::text from public.transactions where deleted_at is null)
  union all
  select 13, 'cakisan islem id (beklenen 0)',
         (select coalesce(count(*),0)::text from (
            select id from public.transactions where deleted_at is null
            group by user_id, id having count(*) > 1) x)
)
select kontrol, sonuc from kontroller order by sira;
