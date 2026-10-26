-- Approved text must not change under an approval. (1) Variants are locked once the item is approved/scheduled/live
-- (withdraw the approval first). (2) An approval only counts if it is newer than the last text edit and any 'fixed' check.
alter table platform_variants add column updated_at timestamptz not null default now();

create function variants_guard() returns trigger language plpgsql set search_path = public as $$
declare v_status content_status;
begin
  select status into v_status from content_items where id = new.content_item_id;
  if v_status in ('approved', 'scheduled', 'live') then
    if tg_op = 'INSERT'
       or new.text is distinct from old.text or new.hashtags is distinct from old.hashtags or new.alt_text is distinct from old.alt_text then
      raise exception 'item is %; withdraw the approval before editing its text', v_status;
    end if;
  end if;
  if tg_op = 'INSERT' or new.text is distinct from old.text or new.hashtags is distinct from old.hashtags or new.alt_text is distinct from old.alt_text then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger platform_variants_guard before insert or update on platform_variants
  for each row execute function variants_guard();

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
    ) then raise exception 'no valid approval for %', new.id; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
