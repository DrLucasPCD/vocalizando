begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vocalizando-private', 'vocalizando-private', false, 41943040,
        array['audio/*', 'application/json', 'application/octet-stream'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Each account can access only its own folder, including object listings.
drop policy if exists "vocalizando_select_own" on storage.objects;
create policy "vocalizando_select_own" on storage.objects for select to authenticated
using (bucket_id = 'vocalizando-private'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text));

drop policy if exists "vocalizando_insert_own" on storage.objects;
create policy "vocalizando_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'vocalizando-private'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text));

drop policy if exists "vocalizando_update_own" on storage.objects;
create policy "vocalizando_update_own" on storage.objects for update to authenticated
using (bucket_id = 'vocalizando-private'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text))
with check (bucket_id = 'vocalizando-private'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text));

drop policy if exists "vocalizando_delete_own" on storage.objects;
create policy "vocalizando_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'vocalizando-private'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid()::text));

commit;
