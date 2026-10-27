-- Hand-off publishing: on Metricool's free plan there is no API, so Instagram and Facebook (like X) are posted by hand
-- from the app's "Post by hand" panel. The owner records each post (URL) or Story; when everything required is
-- recorded the item becomes 'live'. Approval gate unchanged: only approved/scheduled items can be recorded.
update brands
   set settings = jsonb_set(jsonb_set(settings, '{platforms,instagram,via}', '"manual"'), '{platforms,facebook,via}', '"manual"')
 where slug = 'daily-heckler';

drop function mark_posted_manual(uuid, platform_t, text);

create function mark_posted_manual(p_item uuid, p_platform platform_t, p_url text, p_format text default 'post') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_brand uuid;
  v_status content_status;
  v_settings jsonb;
  v_id uuid;
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_missing int;
begin
  if p_format not in ('post', 'story') then raise exception 'unknown format %', p_format; end if;
  select ci.brand_id, ci.status into v_brand, v_status from content_items ci where ci.id = p_item;
  if v_brand is null then raise exception 'unknown content item'; end if;
  if not has_brand_access(v_brand, 'approver') then raise exception 'only approvers can record a post'; end if;
  select b.settings into v_settings from brands b where b.id = v_brand;
  if (v_settings -> 'platforms' -> p_platform::text ->> 'via') is distinct from 'manual' then
    raise exception 'platform % is not posted by hand for this brand', p_platform;
  end if;
  if v_status not in ('approved', 'scheduled', 'live') then raise exception 'item must be approved first'; end if;
  if p_format = 'story' then
    if p_platform not in ('instagram', 'facebook') or coalesce((v_settings -> 'platforms' -> 'instagram' ->> 'story_to_both')::boolean, false) is not true then
      raise exception 'Stories are only recorded for Instagram and Facebook when story_to_both is on';
    end if;
    if v_url is not null and v_url !~* '^https?://' then raise exception 'a post URL must start with http(s)://'; end if;
  elsif v_url is null or v_url !~* '^https?://' then
    raise exception 'a post URL is required';
  end if;
  if exists (select 1 from publications where content_item_id = p_item and platform = p_platform and format = p_format and mode = 'manual') then
    raise exception 'already recorded';
  end if;

  insert into publications (brand_id, content_item_id, platform, status, mode, external_url, format)
  values (v_brand, p_item, p_platform, 'posted', 'manual', v_url, p_format)
  returning id into v_id;

  -- everything this brand posts by hand, recorded?
  with plat as (select key as platform, value as cfg from jsonb_each(v_settings -> 'platforms')),
  need as (
    select platform, 'post'::text as fmt from plat where cfg ->> 'via' = 'manual' and cfg ->> 'phase' is null
    union all
    select platform, 'story' from plat
     where platform in ('instagram', 'facebook') and cfg ->> 'via' = 'manual'
       and coalesce((v_settings -> 'platforms' -> 'instagram' ->> 'story_to_both')::boolean, false)
  )
  select count(*) into v_missing from need n
   where not exists (select 1 from publications p where p.content_item_id = p_item and p.platform::text = n.platform and p.format = n.fmt and p.mode = 'manual');
  if v_missing = 0 and v_status in ('approved', 'scheduled') then
    update content_items set status = 'live' where id = p_item;
  end if;
  return v_id;
end $$;
revoke all on function mark_posted_manual(uuid, platform_t, text, text) from public, anon;
grant execute on function mark_posted_manual(uuid, platform_t, text, text) to authenticated;
