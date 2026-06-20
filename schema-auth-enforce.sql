-- ENFORCE SIGN-IN (run only AFTER you've confirmed magic-link sign-in works on the
-- live site). This removes anonymous access, so every app now requires sign-in.

drop policy if exists "anon all app_data"     on public.app_data;
drop policy if exists "anon read hub-files"   on storage.objects;
drop policy if exists "anon write hub-files"  on storage.objects;
drop policy if exists "anon update hub-files" on storage.objects;
drop policy if exists "anon delete hub-files" on storage.objects;
