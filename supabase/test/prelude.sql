-- ============================================================================
-- Supabase'in sağladığı, sıradan bir Postgres'te olmayan parçaların taklidi.
--
-- YALNIZCA TEST İÇİN. Supabase'e bunu asla yükleme — orada bu nesnelerin
-- gerçekleri zaten var ve üstlerine yazmak kimlik doğrulamayı bozar.
--
-- Amaç, supabase/schema.sql'i ve RLS testlerini bir Supabase projesi açmadan,
-- internete çıkmadan, lokalde koşturabilmek. Şemaya dokunan her değişiklik
-- böylece canlıya gitmeden önce sınanabiliyor.
-- ============================================================================

-- Supabase'in üç rolü. PostgREST gelen isteği kimliğine göre bunlardan birine
-- büründürür: anon = giriş yapmamış, authenticated = giriş yapmış,
-- service_role = sunucu tarafı (RLS'i baypas eder).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
    then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
    then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')
    then create role service_role; end if;
end $$;

create schema if not exists auth;

-- Gerçeğinde çok daha fazla kolon var; şemanın referans verdiği tek şey id.
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- Bütün RLS politikalarının dayandığı fonksiyon. Supabase'de bu, isteğin JWT'sinden
-- gelen kullanıcı kimliğini döndürür. Lokalde aynı yeri bir oturum değişkeni
-- tutuyor, böylece testler `set request.jwt.claim.sub = '...'` diyerek kullanıcı
-- değiştirebiliyor.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
