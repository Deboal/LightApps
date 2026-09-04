-- GBA CLOUD SAVES (run once, in the Supabase SQL Editor).
--
-- The emulator stores two kinds of blob per user: cartridge ROMs and cartridge
-- saves. Neither belongs in the shared `hub-files` bucket, which is public-read
-- and open to every signed-in hub user. This creates a private bucket whose
-- objects are scoped to the uploader by the first path segment:
--
--   <user_id>/roms/<rom_sha256>.gba
--   <user_id>/saves/<game_code>-<rom_sha12>/v<version>.sav
--
-- Metadata (versions, history, device ids) lives in the existing app_data
-- table under app='gba', which is already row-level-secured per owner.

insert into storage.buckets (id, name, public)
values ('gba', 'gba', false)
on conflict (id) do update set public = false;

-- One policy for every operation: a user may only touch objects under their
-- own user id. storage.foldername() splits the object name on '/', so
-- element 1 is that leading directory.
drop policy if exists "gba own files" on storage.objects;
create policy "gba own files" on storage.objects for all to authenticated
  using (
    bucket_id = 'gba'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'gba'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Saves are versioned with a monotonic counter and written with a
-- compare-and-swap, never last-write-wins on a timestamp: two devices whose
-- clocks disagree would otherwise silently eat a playthrough. The check below
-- makes that a database invariant rather than a convention the client is
-- trusted to follow.
create or replace function public.gba_save_version_advances()
returns trigger language plpgsql as $$
begin
  if new.app = 'gba' and new.collection = 'saves' then
    if (new.data->>'version')::bigint <= (old.data->>'version')::bigint then
      raise exception 'gba save version must advance (% -> %)',
        old.data->>'version', new.data->>'version';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists gba_save_version_advances on public.app_data;
create trigger gba_save_version_advances
  before update on public.app_data
  for each row execute function public.gba_save_version_advances();
