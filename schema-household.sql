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
-- 5. Verify -- one report, because the SQL Editor shows only the last result.
--
--    Everything above is the change; this is how you know it worked. It asks
--    the real questions the real way: it becomes `anon`, then each member,
--    then a stranger, and counts what each can actually see through the
--    policies. Nothing here is a guess about what should happen.
--
--    Two traps it is built to avoid:
--
--    - SET LOCAL outside a transaction is ignored with only a WARNING, and
--      the query then runs as you -- the owner, who bypasses RLS -- so it
--      reports every private row as world-readable when nothing is wrong. A
--      verification step that cries wolf is worse than none. Here the role
--      switches happen inside a function, where they are transaction-local
--      and cannot silently no-op.
--
--    - "0 rows" is not a pass on its own: a policy that locks out BOTH of you
--      also returns 0. So each member is measured against the true row count
--      taken as the owner, and an empty ledger is reported as INCONCLUSIVE
--      rather than green.
--
--    A failure to impersonate a role reports CANNOT TEST, never PASS.
-- ---------------------------------------------------------------------------

create or replace function public.household_access_report()
returns table (check_name text, observed text, expected text, verdict text)
language plpgsql
as $$
declare
  truth   bigint;   -- rows really there, counted as the owner (RLS bypassed)
  n       bigint;
  m       text;
  members text[];
begin
  select count(*) into truth from public.app_data where app = 'household';
  select array_agg(lower(email) order by lower(email)) into members
    from public.household_members;

  return query select 'ledger rows that exist (counted as owner)'::text,
    truth::text, 'your entries'::text,
    case when truth = 0 then 'EMPTY -- log an entry and re-run for a real test'
         else 'baseline' end;

  return query select 'household_members list'::text,
    coalesce(array_to_string(members, ', '), '(none)'), 'the two of you'::text,
    case when members is null then 'FAIL -- nobody is a member; everyone is locked out'
         when array_length(members, 1) = 2 then 'PASS'
         else 'CHECK -- expected 2, found ' || array_length(members, 1) end;

  -- anon: a browser holding the publishable key, which is public by design.
  begin
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{}', true);
    select count(*) into n from public.app_data where app = 'household';
    perform set_config('role', 'none', true);
    return query select 'anon (publishable key) can read the ledger'::text,
      n::text, '0'::text,
      case when n = 0 then 'PASS' else 'FAIL -- still readable without signing in' end;
  exception when others then
    perform set_config('role', 'none', true);
    return query select 'anon (publishable key) can read the ledger'::text,
      sqlerrm, '0'::text, 'CANNOT TEST'::text;
  end;

  -- each member, with a real session.
  foreach m in array coalesce(members, array[]::text[]) loop
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        json_build_object('email', m, 'sub', '00000000-0000-0000-0000-0000000000aa')::text, true);
      select count(*) into n from public.app_data where app = 'household';
      perform set_config('role', 'none', true);
      return query select 'member ' || m || ' can read the ledger',
        n::text, truth::text,
        case when truth = 0 then 'INCONCLUSIVE -- ledger is empty'
             when n = truth then 'PASS'
             when n = 0 then 'FAIL -- this member is locked out of their own ledger'
             else 'FAIL -- sees ' || n || ' of ' || truth end;
    exception when others then
      perform set_config('role', 'none', true);
      return query select 'member ' || m || ' can read the ledger',
        sqlerrm, truth::text, 'CANNOT TEST'::text;
    end;
  end loop;

  -- a signed-in stranger.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      '{"email":"nobody@example.invalid","sub":"00000000-0000-0000-0000-0000000000bb"}', true);
    select count(*) into n from public.app_data where app = 'household';
    perform set_config('role', 'none', true);
    return query select 'a signed-in stranger can read the ledger'::text,
      n::text, '0'::text,
      case when n = 0 then 'PASS' else 'FAIL -- any signed-in user can read it' end;
  exception when others then
    perform set_config('role', 'none', true);
    return query select 'a signed-in stranger can read the ledger'::text,
      sqlerrm, '0'::text, 'CANNOT TEST'::text;
  end;

  -- a member's email with no session behind it.
  begin
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims',
      json_build_object('email', coalesce(members[1], 'x@y.z'))::text, true);
    select count(*) into n from public.app_data where app = 'household';
    perform set_config('role', 'none', true);
    return query select 'a member email with NO session can read the ledger'::text,
      n::text, '0'::text,
      case when n = 0 then 'PASS' else 'FAIL -- an email claim alone is enough' end;
  exception when others then
    perform set_config('role', 'none', true);
    return query select 'a member email with NO session can read the ledger'::text,
      sqlerrm, '0'::text, 'CANNOT TEST'::text;
  end;

  -- the receipts bucket.
  return query select 'receipts bucket household-files is private'::text,
    coalesce((select case when public then 'public' else 'private' end
                from storage.buckets where id = 'household-files'), 'missing'),
    'private'::text,
    case when (select public from storage.buckets where id = 'household-files') is false
         then 'PASS'
         when (select 1 from storage.buckets where id = 'household-files') is null
         then 'FAIL -- bucket does not exist'
         else 'FAIL -- receipts are world-readable by link' end;

  -- the policies themselves, and that the two that matter are RESTRICTIVE.
  return query
    select 'policy: ' || policyname,
           case when permissive = 'RESTRICTIVE' then 'restrictive' else 'permissive' end,
           case when policyname like '%private to its members%' then 'restrictive' else 'permissive' end,
           case when (policyname like '%private to its members%') = (permissive = 'RESTRICTIVE')
                then 'PASS' else 'FAIL -- wrong kind of policy' end
      from pg_policies
     where policyname in ('household is private to its members',
                          'household-files is private to its members',
                          'household members use household-files')
     order by 1;

  -- And that every other app on the hub still works. This is the worst thing
  -- that can go wrong here: a restrictive policy missing its
  -- `app <> 'household' or ...` escape applies to the whole table and takes
  -- every app down, the seating board first. Measured against the owner's own
  -- count, so "anon sees none" can never be excused as "there are none" --
  -- those are two different numbers and the difference is the damage.
  begin
    select count(*) into truth from public.app_data where app <> 'household';
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{}', true);
    select count(*) into n from public.app_data where app <> 'household';
    perform set_config('role', 'none', true);
    return query select 'other apps still readable as anon (no collateral damage)'::text,
      n::text, truth::text,
      case when truth = 0 then 'N/A -- no other apps have data yet'
           when n = truth then 'PASS'
           when n = 0 then 'FAIL -- every other app on the hub is now broken'
           else 'FAIL -- other apps lost ' || (truth - n) || ' of ' || truth || ' rows' end;
  exception when others then
    perform set_config('role', 'none', true);
    return query select 'other apps still readable as anon (no collateral damage)'::text,
      sqlerrm, 'unchanged'::text, 'CANNOT TEST'::text;
  end;
end $$;

revoke all on function public.household_access_report() from public, anon, authenticated;

-- Read every row. Anything not PASS or baseline wants attention; INCONCLUSIVE
-- on the member rows just means the ledger is empty, so log one entry and run
-- `select * from public.household_access_report();` again.
select * from public.household_access_report();
