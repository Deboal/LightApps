-- DIAGNOSTIC. Read-only: selects and catalog lookups only, no writes, no DDL.
-- Paste the whole thing into the Supabase SQL Editor and run it. Each block
-- prints a labelled result set; send them back and they say exactly which
-- migrations have run and whether anything is misfiled.

-- 1. Which migrations have been applied -------------------------------------
-- app_data.owner + visibility  => schema-auth.sql has run
-- integration_secrets exists   => schema-integrations.sql has run
select
  'tables' as check,
  to_regclass('public.app_data')            is not null as app_data,
  to_regclass('public.integration_secrets') is not null as integration_secrets,
  exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='app_data' and column_name='owner')      as has_owner_col,
  exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='app_data' and column_name='visibility') as has_visibility_col;

-- 2. RLS state ---------------------------------------------------------------
-- Both must be true. integration_secrets should have RLS on and ZERO policies,
-- which denies anon and authenticated everything and leaves service_role as the
-- only access path.
select 'rls' as check, relname as table, relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
        where p.schemaname='public' and p.tablename=c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname in ('app_data','integration_secrets');

-- 3. Policies on app_data ----------------------------------------------------
-- An "anon all app_data" row here means schema-auth-enforce.sql has NOT run yet,
-- so the whole hub is still readable without signing in. That is the intended
-- state only until magic-link sign-in is confirmed working.
select 'policies' as check, policyname, roles::text, cmd
from pg_policies
where schemaname='public' and tablename='app_data'
order by policyname;

-- 4. Does the coach's auth user exist ---------------------------------------
-- The ingestion job resolves owner from this email. If it is missing, sign in to
-- /cocodona-coach/ once via magic link, then re-run.
select 'auth user' as check, id as owner_uuid, email,
       last_sign_in_at, (email_confirmed_at is not null) as confirmed
from auth.users
where lower(email) = lower('adebord@quantaaviation.com');

-- 5. What data is actually stored -------------------------------------------
select 'data' as check, app, collection, count(*) as rows,
       min(updated_at)::date as oldest, max(updated_at)::date as newest
from public.app_data
group by app, collection
order by app, collection;

-- 6. THE INVISIBLE-ROW TRAP --------------------------------------------------
-- app_data.owner defaults to auth.uid(), which is NULL under the service_role
-- key, while the app reads under `owner = auth.uid()`. A row written without an
-- owner therefore saves successfully and is invisible to the app forever — it
-- never errors. Any count above zero here for cocodona-coach is a real problem.
select 'ownerless rows' as check, app, collection, count(*) as orphaned
from public.app_data
where owner is null
group by app, collection
order by orphaned desc;

-- 7. Ingestion credentials stored yet ----------------------------------------
-- Empty until the job has run once and rotated its tokens. The secret values are
-- deliberately not selected.
select 'integration secrets' as check, provider, updated_at
from public.integration_secrets
order by provider;

-- 8. Storage bucket + realtime ----------------------------------------------
select 'bucket' as check, id, public from storage.buckets where id = 'hub-files';

select 'realtime' as check,
       exists (select 1 from pg_publication_tables
               where pubname='supabase_realtime' and schemaname='public' and tablename='app_data')
       as app_data_in_realtime;
