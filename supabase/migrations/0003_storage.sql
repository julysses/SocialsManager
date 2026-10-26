-- Private bucket for cartoons. Object path convention: {brand_id}/{filename}.
insert into storage.buckets (id, name, public) values ('cartoons', 'cartoons', false)
on conflict (id) do nothing;

create policy cartoons_select on storage.objects for select to authenticated
  using (bucket_id = 'cartoons' and has_brand_access(((storage.foldername(name))[1])::uuid, 'viewer'));
create policy cartoons_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cartoons' and has_brand_access(((storage.foldername(name))[1])::uuid, 'approver'));
create policy cartoons_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cartoons' and has_brand_access(((storage.foldername(name))[1])::uuid, 'owner'));
