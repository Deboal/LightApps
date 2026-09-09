-- RESTORE ANONYMOUS ACCESS (the inverse of schema-auth-enforce.sql).
--
-- Run this in the Supabase SQL Editor if sign-in was ever enforced and an app
-- that has no sign-in stopped working. The seating board is the one that
-- depends on it: with these policies missing it still loads, but it reads
-- nothing, draws the empty default layout, and reports "Offline — not saved".
-- That looks exactly like losing the roster, and signing in does not fix it,
-- because the board never asks anyone to sign in.
--
-- This re-creates what schema.sql granted. It is safe to run more than once.
-- Note it re-opens anonymous access for EVERY app on the hub, not just the
-- board -- the policies are table-wide. Apps that wrap themselves in AuthGate
-- keep asking for sign-in regardless, because that gate is in their own code.

drop policy if exists "anon all app_data" on public.app_data;
create policy "anon all app_data" on public.app_data
  for all to anon using (true) with check (true);

drop policy if exists "anon read hub-files"   on storage.objects;
drop policy if exists "anon write hub-files"  on storage.objects;
drop policy if exists "anon update hub-files" on storage.objects;
drop policy if exists "anon delete hub-files" on storage.objects;
create policy "anon read hub-files"   on storage.objects for select to anon using (bucket_id = 'hub-files');
create policy "anon write hub-files"  on storage.objects for insert to anon with check (bucket_id = 'hub-files');
create policy "anon update hub-files" on storage.objects for update to anon using (bucket_id = 'hub-files');
create policy "anon delete hub-files" on storage.objects for delete to anon using (bucket_id = 'hub-files');

-- Signed-in visitors are the other half of this, and the half that bit us. A
-- request carrying a session arrives as `authenticated`, NOT `anon`, so the
-- policy above does not apply to it at all. If the authenticated policies are
-- missing, such a request matches nothing and reads zero rows -- which is why
-- one person saw the roster and the next, who had signed in to another app on
-- the hub, saw an empty board and signing in again could not fix it.
--
-- The app-side fix is that the board now always talks as anon. These are here
-- so a signed-in visitor is never left matching no policy, on any app.

alter table public.app_data add column if not exists owner uuid default auth.uid();
alter table public.app_data add column if not exists visibility text not null default 'private';

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

drop policy if exists "auth all hub-files" on storage.objects;
create policy "auth all hub-files" on storage.objects for all to authenticated
  using (bucket_id = 'hub-files') with check (bucket_id = 'hub-files');

-- Rows written before `visibility` existed default to 'private', which hides
-- them from every signed-in user (they match neither owner = auth.uid(), since
-- an anonymous write leaves owner null, nor visibility = 'shared'). The board's
-- own rows are the ones that matter here.
update public.app_data
   set visibility = 'shared'
 where app = 'b100-seating'
   and visibility is distinct from 'shared';
