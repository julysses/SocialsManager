-- Phase 1/2: what the queue UI and the (dry-run) publisher need.
alter table content_items add column change_note text;

alter table publications add column payload jsonb;
alter table publications add column format text not null default 'post' check (format in ('post', 'story'));

-- Manual platforms (X): the owner posts by hand, then records the URL. Only approvers, only for approved items.
create function mark_posted_manual(p_item uuid, p_platform platform_t, p_url text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_brand uuid;
  v_status content_status;
  v_via text;
  v_id uuid;
begin
  select ci.brand_id, ci.status into v_brand, v_status from content_items ci where ci.id = p_item;
  if v_brand is null then raise exception 'unknown content item'; end if;
  if not has_brand_access(v_brand, 'approver') then raise exception 'only approvers can record a post'; end if;
  select b.settings -> 'platforms' -> p_platform::text ->> 'via' into v_via from brands b where b.id = v_brand;
  if v_via is distinct from 'manual' then raise exception 'platform % is not manual for this brand', p_platform; end if;
  if v_status not in ('approved', 'scheduled', 'live') then raise exception 'item must be approved first'; end if;
  if coalesce(trim(p_url), '') = '' or p_url !~* '^https?://' then raise exception 'a post URL is required'; end if;
  insert into publications (brand_id, content_item_id, platform, status, mode, external_url, format)
  values (v_brand, p_item, p_platform, 'posted', 'manual', trim(p_url), 'post')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function mark_posted_manual(uuid, platform_t, text) from public, anon;
grant execute on function mark_posted_manual(uuid, platform_t, text) to authenticated;
