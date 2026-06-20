-- AUTH MIGRATION (run once, in the Supabase SQL Editor).
-- Adds per-user ownership and authenticated access. Existing anon policies are
-- intentionally KEPT for now so nothing breaks while you deploy the new code.
-- After sign-in works on the live site, run schema-auth-enforce.sql to lock anon out.

-- Ownership + visibility on the shared table.
alter table public.app_data add column if not exists owner uuid default auth.uid();
alter table public.app_data add column if not exists visibility text not null default 'private';

-- Authenticated access: you see your own rows, plus anything marked shared.
drop policy if exists "auth read app_data" on public.app_data;
create policy "auth read app_data" on public.app_data for select to authenticated
  using (owner = auth.uid() or visibility = 'shared');

drop policy if exists "auth insert app_data" on public.app_data;
create policy "auth insert app_data" on public.app_data for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "auth update app_data" on public.app_data;
create policy "auth update app_data" on public.app_data for update to authenticated
  using (owner = auth.uid() or visibility = 'shared') with check (true);

drop policy if exists "auth delete app_data" on public.app_data;
create policy "auth delete app_data" on public.app_data for delete to authenticated
  using (owner = auth.uid() or visibility = 'shared');

-- Authenticated access to the shared file bucket.
drop policy if exists "auth all hub-files" on storage.objects;
create policy "auth all hub-files" on storage.objects for all to authenticated
  using (bucket_id = 'hub-files') with check (bucket_id = 'hub-files');
