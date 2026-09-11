-- LOCK THE HOUSEHOLD LEDGER TO TWO PEOPLE (run once, in the Supabase SQL Editor).
--
-- Every other app on this hub treats its published URL plus sign-in as the
-- gate, which is fine for a gear list and not fine for what two people spend.
-- This is the one app where the Postgres boundary has to be real.
--
-- Both members are filled in below; there is nothing to edit before running.
-- Safe to run more than once. Re-run it after adding or changing a member.
--
-- What it does NOT do: nothing here weakens any other app. The one policy that
-- touches the shared table is RESTRICTIVE and scoped to app = 'household', so
-- every other app's access is exactly what it was.

-- ---------------------------------------------------------------------------
-- 1. Who is in the household. Membership is data, not policy text, because the
--    list is referenced from several policies and an email list copied into
--    several policies is an email list that goes out of sync.
-- ---------------------------------------------------------------------------

create table if not exists public.household_members (
  email      text primary key,
  added_at   timestamptz not null default now()
);

-- RLS on and deliberately NO policies: the table is unreachable from any
-- browser, with or without a session. It is edited here, in the SQL Editor.
--
-- The REVOKE is not redundant. RLS with no policies returns zero rows, which
-- is already safe, but only once a role has been granted SELECT at all --
-- and Supabase applies default privileges to new tables in `public`, so
-- whether these roles hold a grant here depends on project settings rather
-- than on anything visible in this file. Revoking makes the answer the same
-- either way: not "an empty list", but no access to ask.
alter table public.household_members enable row level security;
revoke all on public.household_members from anon, authenticated;

insert into public.household_members (email) values
  ('adebord@quantaaviation.com'),
  ('jndarnell@me.com')
on conflict (email) do nothing;

-- Adding or removing someone later is one statement here plus a re-run; the
-- policies read this table, so nothing else has to change. Note that removing
-- a row does not end that person's existing session -- revoke it under
-- Authentication in the Supabase dashboard if that matters.

-- ---------------------------------------------------------------------------
-- 2. The membership test.
--
--    SECURITY DEFINER matters here and is easy to get wrong. A policy's USING
--    expression runs as the requesting user, so a plain subquery against
--    household_members would be subject to that table's own RLS -- which
--    denies everything -- and the policy would then deny everyone, including
--    the two of us. Running the check as its owner is what makes it work.
--
--    A missing or malformed email claim yields false, never null, so a request
--    with no session cannot slip through on a null comparison.
--
--    It demands a real session (auth.uid()) as well as a listed email, so
--    membership can never be satisfied by an email claim alone. Supabase
--    derives the Postgres role from the JWT, so the two travel together in
--    practice -- this just means the check does not depend on that being so.
-- ---------------------------------------------------------------------------

create or replace function public.is_household_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.household_members m
     where lower(m.email) = lower(coalesce(nullif(auth.jwt() ->> 'email', ''), '~none~'))
  );
$$;

revoke all on function public.is_household_member() from public;
grant execute on function public.is_household_member() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The ledger rows.
--
--    RESTRICTIVE is the whole point. A permissive policy adds access; this
--    subtracts it, ANDing with every other policy on the table. So it holds
--    regardless of what else grants access now or later -- including the
--    table-wide `anon all app_data` grant that schema-anon-restore.sql
--    re-creates for the seating board, which today lets anyone holding the
--    publishable key read every row on the hub. That key is committed and
--    ships inside every bundle, so it is not a secret and was never the
--    boundary. After this, household rows need a session whose email is in
--    the table, and nothing else will do.
-- ---------------------------------------------------------------------------

drop policy if exists "household is private to its members" on public.app_data;
create policy "household is private to its members" on public.app_data
  as restrictive for all to anon, authenticated
  using      (app <> 'household' or public.is_household_member())
  with check (app <> 'household' or public.is_household_member());

-- ---------------------------------------------------------------------------
-- 4. The receipts.
--
--    The hub's `hub-files` bucket is PUBLIC: its URLs carry no session, never
--    expire, and work for anyone they are forwarded to. A locked ledger whose
--    receipts sit in a public bucket is not a locked ledger, so household
--    attachments get their own private bucket and the app asks for signed,
--    expiring links instead.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('household-files', 'household-files', false)
on conflict (id) do update set public = false;

-- Permissive: members get full use of that bucket.
drop policy if exists "household members use household-files" on storage.objects;
create policy "household members use household-files" on storage.objects
  for all to authenticated
  using      (bucket_id = 'household-files' and public.is_household_member())
  with check (bucket_id = 'household-files' and public.is_household_member());

-- Restrictive: and nobody else does, whatever else may grant object access.
drop policy if exists "household-files is private to its members" on storage.objects;
create policy "household-files is private to its members" on storage.objects
  as restrictive for all to anon, authenticated
  using      (bucket_id <> 'household-files' or public.is_household_member())
  with check (bucket_id <> 'household-files' or public.is_household_member());

-- ---------------------------------------------------------------------------
-- 5. Verify. Run these after the above and read the answers.
-- ---------------------------------------------------------------------------

-- (a) Who is a member. Expect exactly the two of you, no placeholder.
select email from public.household_members order by email;

-- (b) The policies exist, and the two that matter are RESTRICTIVE.
--     Expect 3 rows: permissive=f on the two named "private to its members".
select schemaname, tablename, policyname, permissive, roles
  from pg_policies
 where policyname in ('household is private to its members',
                      'household-files is private to its members',
                      'household members use household-files')
 order by tablename, policyname;

-- (c) The bucket is private. Expect public = false.
select id, public from storage.buckets where id = 'household-files';

-- (d) The real test: does an anonymous reader see the ledger? This runs the
--     request the same way a browser holding the publishable key does.
--
--     The transaction block is load-bearing, not tidiness. SET LOCAL outside
--     one is ignored with only a WARNING, and the query then runs as you --
--     the owner, who bypasses RLS -- so it reports every household row as
--     visible to anon and reads as a failed lockdown when nothing is wrong.
--     A verification step that cries wolf is worse than none.
--
--     Expect 0. Read it together with (e): 0 here means nothing more than
--     "this policy denies somebody", and only (e) shows it still admits you.
begin;
  set local role anon;
  select count(*) as anon_can_see_household from public.app_data where app = 'household';
rollback;

-- (e) And that a member still sees the ledger: the other half, and the half
--     that catches a policy which locked out everyone including you.
--     Expect the number of entries you have logged (3 collections' worth of
--     rows, so a couple more than the entry count). The claims are stubbed
--     because the SQL Editor carries no session of its own.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"email":"adebord@quantaaviation.com"}';
  select count(*) as member_can_see_household from public.app_data where app = 'household';
rollback;

-- (f) And that a stranger with a session does not. Expect 0.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"email":"nobody@example.com"}';
  select count(*) as stranger_can_see_household from public.app_data where app = 'household';
rollback;
