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

-- Rows written before `visibility` existed default to 'private', which hides
-- them from every signed-in user (they match neither owner = auth.uid(), since
-- an anonymous write leaves owner null, nor visibility = 'shared'). The board's
-- own rows are the ones that matter here.
update public.app_data
   set visibility = 'shared'
 where app = 'b100-seating'
   and visibility is distinct from 'shared';
