-- Carousels: an item has 1-10 images. The worker proposes the order (cover first, then details); the owner can reorder
-- until approval. Images are locked once approved, and an approval is void if images changed afterwards.
create table content_images (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  storage_path text not null,
  position int not null check (position between 1 and 10),
  role text not null default 'other' check (role in ('cover', 'detail', 'other')),
  label text,
  alt_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, storage_path)
);
create index content_images_item_idx on content_images(content_item_id, position);
alter table content_images enable row level security;

create policy images_select on content_images for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy images_write on content_images for all to authenticated
  using (has_brand_access(brand_id, 'approver')) with check (has_brand_access(brand_id, 'approver'));

create function content_images_guard() returns trigger language plpgsql set search_path = public as $$
declare v_status content_status; v_item uuid := coalesce(new.content_item_id, old.content_item_id);
begin
  select status into v_status from content_items where id = v_item;
  if v_status in ('approved', 'scheduled', 'live') then
    raise exception 'item is %; withdraw the approval before changing its images', v_status;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger content_images_guard_trg before insert or update or delete on content_images
  for each row execute function content_images_guard();

-- Existing single-image items become one-image carousels.
insert into content_images (brand_id, content_item_id, storage_path, position, role)
select brand_id, id, source_image_path, 1, 'cover' from content_items where source_image_path is not null
on conflict do nothing;

create or replace function enforce_approval_gate() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('approved', 'scheduled', 'live')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if tg_op = 'INSERT' then raise exception 'cannot insert as %', new.status; end if;
    if new.status = 'scheduled' and old.status <> 'approved' then raise exception 'approve first'; end if;
    if new.status = 'live' and old.status not in ('scheduled', 'approved') then raise exception 'invalid transition'; end if;
    if not exists (
      select 1 from approvals a
      where a.content_item_id = new.id and a.decision in ('approved', 'edited_approved')
        and a.decided_at >= coalesce((select max(c.created_at) from checks c
              where c.content_item_id = new.id and c.verdict = 'fixed'), '-infinity')
        and a.decided_at >= coalesce((select max(pv.updated_at) from platform_variants pv
              where pv.content_item_id = new.id), '-infinity')
        and a.decided_at >= coalesce((select max(ci.updated_at) from content_images ci
              where ci.content_item_id = new.id), '-infinity')
    ) then raise exception 'no valid approval for %', new.id; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table content_images;
  end if;
end $$;
