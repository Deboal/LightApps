-- ONE-TIME shared backend for the whole App Hub. Run this once, ever.
-- Every app namespaces itself by the `app` column, so new apps need no new SQL.

create table if not exists public.app_data (
  app        text not null,
  collection text not null,
  doc_id     text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (app, collection, doc_id)
);
create index if not exists app_data_app_idx on public.app_data (app, collection);

-- RLS on; anon role full CRUD. Access model: the app's published URL is the gate.
-- Fine for low-stakes internal tools. Note: all apps share this key, so any app's
-- key could read any app's data. Give a sensitive app its own project instead.
alter table public.app_data enable row level security;
create policy "anon all app_data" on public.app_data
  for all to anon using (true) with check (true);

-- One shared public bucket for attachments, namespaced by app in the path.
insert into storage.buckets (id, name, public)
values ('hub-files', 'hub-files', true)
on conflict (id) do nothing;

create policy "anon read hub-files"   on storage.objects for select to anon using (bucket_id = 'hub-files');
create policy "anon write hub-files"  on storage.objects for insert to anon with check (bucket_id = 'hub-files');
create policy "anon update hub-files" on storage.objects for update to anon using (bucket_id = 'hub-files');
create policy "anon delete hub-files" on storage.objects for delete to anon using (bucket_id = 'hub-files');

-- Realtime so apps can sync live.
alter publication supabase_realtime add table public.app_data;
