-- Social OS core schema (Phase 0).
-- Collision check: none of these names exist in the pre-existing qoe-lite tables
-- (orgs, org_members, engagements, documents, accounts, transactions, canonical_categories,
--  financial_facts, txn_classifications, adjustments, adjustment_evidence, gate_acknowledgements,
--  audit_events, deal_structures). Nothing here alters or drops them.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type role_t as enum ('viewer', 'approver', 'owner');

create type content_status as enum (
  'draft', 'checked', 'queued', 'approved', 'rejected', 'scheduled', 'live', 'failed', 'retired'
);

create type platform_t as enum (
  'instagram', 'facebook', 'x', 'threads', 'bluesky', 'tiktok', 'youtube_shorts', 'linkedin', 'pinterest'
);

-- ---------------------------------------------------------------- tenancy
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'owner',
  created_at timestamptz not null default now()
);

create table brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  timezone text not null default 'America/Chicago',
  reply_mode text not null default 'draft_only' check (reply_mode in ('draft_only')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role role_t not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index members_user_idx on members(user_id);

-- Emails allowed to sign up at all. No policies: only service role / security definer reads it.
create table owner_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- access helpers
create function role_rank(r role_t) returns int
language sql immutable as $$
  select case r when 'viewer' then 1 when 'approver' then 2 when 'owner' then 3 end
$$;

create function has_workspace_access(p_workspace_id uuid, p_min role_t default 'viewer')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and role_rank(m.role) >= role_rank(p_min)
  )
$$;

create function has_brand_access(p_brand_id uuid, p_min role_t default 'viewer')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from brands b
    join members m on m.workspace_id = b.workspace_id
    where b.id = p_brand_id
      and m.user_id = auth.uid()
      and role_rank(m.role) >= role_rank(p_min)
  )
$$;

-- ---------------------------------------------------------------- content
create table knowledge_files (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  folder text not null,
  filename text not null,
  content_md text not null default '',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, folder, filename)
);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  title text,
  story_note text,
  gpt_caption text,
  source_image_path text,
  source_hash text,
  status content_status not null default 'draft',
  planned_for timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index content_items_source_hash_uq on content_items(brand_id, source_hash) where source_hash is not null;
create index content_items_status_idx on content_items(brand_id, status);

create table platform_variants (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  platform platform_t not null,
  text text not null default '',
  hashtags text[] not null default '{}',
  alt_text text,
  edited_by_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (content_item_id, platform)
);

create table checks (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  voice_score int check (voice_score between 0 and 3),
  flags jsonb not null default '[]'::jsonb,
  verdict text not null check (verdict in ('passed', 'fixed', 'failed')),
  fixed_text jsonb,
  model text,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index checks_item_idx on checks(content_item_id, created_at);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved', 'edited_approved', 'changes_requested', 'rejected')),
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index approvals_item_idx on approvals(content_item_id, decided_at);

create table publications (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  platform platform_t not null,
  scheduled_for timestamptz,
  external_post_id text,
  external_url text,
  status text not null default 'pending' check (status in ('pending', 'scheduled', 'posted', 'failed')),
  error text,
  mode text not null default 'dry_run' check (mode in ('dry_run', 'live', 'manual')),
  created_at timestamptz not null default now()
);
create index publications_item_idx on publications(content_item_id);

-- ---------------------------------------------------------------- jobs & agents
create table jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  content_item_id uuid references content_items(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  locked_at timestamptz,
  run_after timestamptz not null default now(),
  idempotency_key text,
  error text,
  result jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index jobs_idempotency_uq on jobs(brand_id, idempotency_key) where idempotency_key is not null;
create index jobs_claim_idx on jobs(status, run_after, created_at);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  agent_key text not null,
  provider_mode text not null,
  prompt_hash text,
  input_ref text,
  output_ref text,
  raw_output text,
  duration_ms int,
  tokens_in int,
  tokens_out int,
  error text,
  created_at timestamptz not null default now()
);
create index agent_runs_created_idx on agent_runs(brand_id, created_at desc);

create table reply_drafts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  platform platform_t not null,
  target_url text,
  target_text text,
  draft_text text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted', 'discarded')),
  created_at timestamptz not null default now()
);

create table hashtag_sets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  platform platform_t not null,
  tags text[] not null default '{}',
  label text,
  tested_from date,
  tested_to date,
  created_at timestamptz not null default now()
);

create table post_history (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  platform platform_t not null,
  external_id text,
  text text not null default '',
  posted_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  source text not null default 'import',
  created_at timestamptz not null default now()
);
create unique index post_history_ext_uq on post_history(brand_id, platform, external_id) where external_id is not null;

create table metrics_daily (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  platform platform_t not null,
  date date not null,
  views int, likes int, saves int, shares int, comments int, follows int,
  created_at timestamptz not null default now(),
  unique (content_item_id, platform, date)
);

-- Connection status only. Token values are never stored in the database.
create table connections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  provider text not null,
  platform platform_t,
  status text not null default 'disconnected',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- job claiming (PRD §4)
create or replace function claim_jobs(p_limit int default 5)
returns setof jobs language sql security definer set search_path = public as $$
  update jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
  where id in (
    select id from jobs
    where status = 'queued' and run_after <= now()
    order by created_at
    for update skip locked
    limit p_limit)
  returning *;
$$;
revoke all on function claim_jobs(int) from public, anon, authenticated;
grant execute on function claim_jobs(int) to service_role;

-- Stuck 'running' jobs older than 15 minutes go back to the queue (or fail if out of attempts).
create function requeue_stuck_jobs() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         error = 'worker timed out; requeued',
         locked_at = null,
         updated_at = now()
   where status = 'running' and locked_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function requeue_stuck_jobs() from public, anon, authenticated;
grant execute on function requeue_stuck_jobs() to service_role;

-- ---------------------------------------------------------------- approval gate (PRD §5)
create function approvals_immutable() returns trigger language plpgsql as $$
begin raise exception 'approvals are immutable'; end $$;
create trigger approvals_no_update before update or delete on approvals
  for each row execute function approvals_immutable();

-- Only a signed-in human approver/owner of the brand may record an approval for themselves.
create function approvals_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'approvals require a signed-in user (agents and service role cannot approve)';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'approval user_id must equal auth.uid()';
  end if;
  if not has_brand_access(new.brand_id, 'approver') then
    raise exception 'only approvers and owners can approve';
  end if;
  if not exists (select 1 from content_items ci where ci.id = new.content_item_id and ci.brand_id = new.brand_id) then
    raise exception 'content item does not belong to brand';
  end if;
  return new;
end $$;
create trigger approvals_guard_ins before insert on approvals
  for each row execute function approvals_guard();

-- Defence in depth: the service role has no insert right on approvals at all.
revoke insert, update, delete on approvals from service_role;

-- A content item can only become approved/scheduled/live with an approval newer than any 'fixed' check.
create function enforce_approval_gate() returns trigger language plpgsql as $$
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
    ) then raise exception 'no valid approval for %', new.id; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger content_items_gate before insert or update on content_items
  for each row execute function enforce_approval_gate();

-- A publication row can only exist for an item that already passed the approval gate.
create function publications_require_approved() returns trigger language plpgsql as $$
declare v_status content_status;
begin
  select status into v_status from content_items where id = new.content_item_id;
  if v_status is null or v_status not in ('approved', 'scheduled', 'live') then
    raise exception 'cannot publish item % in status %', new.content_item_id, coalesce(v_status::text, 'missing');
  end if;
  if not exists (
    select 1 from approvals a
    where a.content_item_id = new.content_item_id and a.decision in ('approved', 'edited_approved')
  ) then raise exception 'no approval for item %', new.content_item_id; end if;
  return new;
end $$;
create trigger publications_gate before insert on publications
  for each row execute function publications_require_approved();

-- Must always return 0 rows.
create view unapproved_publications with (security_invoker = true) as
select p.*
from publications p
where not exists (
    select 1 from approvals a
    where a.content_item_id = p.content_item_id and a.decision in ('approved', 'edited_approved')
  );

-- ---------------------------------------------------------------- generic updated_at
create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger jobs_touch before update on jobs for each row execute function touch_updated_at();
create trigger knowledge_touch before update on knowledge_files for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- sign-up allowlist + owner bootstrap
create function enforce_signup_allowlist() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from owner_allowlist where lower(email) = lower(new.email)) then
    raise exception 'sign-ups are restricted';
  end if;
  return new;
end $$;
create trigger auth_users_allowlist before insert on auth.users
  for each row execute function enforce_signup_allowlist();

-- Called by the app after login. First allowlisted user becomes owner of the seeded workspace.
create function claim_owner() returns role_t
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_ws uuid;
  v_role role_t;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select role into v_role from members where user_id = auth.uid() limit 1;
  if v_role is not null then return v_role; end if;
  if not exists (select 1 from owner_allowlist where lower(email) = v_email) then
    raise exception 'not allowlisted';
  end if;
  select w.id into v_ws from workspaces w
   where not exists (select 1 from members m where m.workspace_id = w.id and m.role = 'owner')
   order by w.created_at limit 1;
  if v_ws is null then raise exception 'no unclaimed workspace'; end if;
  insert into members (workspace_id, user_id, role) values (v_ws, auth.uid(), 'owner');
  return 'owner';
end $$;
revoke all on function claim_owner() from public, anon;
grant execute on function claim_owner() to authenticated;

-- ---------------------------------------------------------------- RLS
alter table workspaces enable row level security;
alter table brands enable row level security;
alter table members enable row level security;
alter table owner_allowlist enable row level security;
alter table knowledge_files enable row level security;
alter table content_items enable row level security;
alter table platform_variants enable row level security;
alter table checks enable row level security;
alter table approvals enable row level security;
alter table publications enable row level security;
alter table jobs enable row level security;
alter table agent_runs enable row level security;
alter table reply_drafts enable row level security;
alter table hashtag_sets enable row level security;
alter table post_history enable row level security;
alter table metrics_daily enable row level security;
alter table connections enable row level security;

create policy ws_select on workspaces for select to authenticated using (has_workspace_access(id, 'viewer'));
create policy ws_update on workspaces for update to authenticated using (has_workspace_access(id, 'owner')) with check (has_workspace_access(id, 'owner'));

create policy brands_select on brands for select to authenticated using (has_workspace_access(workspace_id, 'viewer'));
create policy brands_update on brands for update to authenticated
  using (has_workspace_access(workspace_id, 'owner')) with check (has_workspace_access(workspace_id, 'owner'));

create policy members_select on members for select to authenticated using (has_workspace_access(workspace_id, 'viewer'));
create policy members_write on members for all to authenticated
  using (has_workspace_access(workspace_id, 'owner')) with check (has_workspace_access(workspace_id, 'owner'));

-- Owner-managed content
create policy knowledge_select on knowledge_files for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy knowledge_write on knowledge_files for all to authenticated
  using (has_brand_access(brand_id, 'owner')) with check (has_brand_access(brand_id, 'owner'));

create policy ci_select on content_items for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy ci_insert on content_items for insert to authenticated with check (has_brand_access(brand_id, 'approver'));
create policy ci_update on content_items for update to authenticated
  using (has_brand_access(brand_id, 'approver')) with check (has_brand_access(brand_id, 'approver'));

create policy pv_select on platform_variants for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy pv_write on platform_variants for all to authenticated
  using (has_brand_access(brand_id, 'approver')) with check (has_brand_access(brand_id, 'approver'));

-- Agent/publisher-written tables: users read, only service role writes (it bypasses RLS).
create policy checks_select on checks for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy pub_select on publications for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy runs_select on agent_runs for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy metrics_select on metrics_daily for select to authenticated using (has_brand_access(brand_id, 'viewer'));

create policy approvals_select on approvals for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy approvals_insert on approvals for insert to authenticated
  with check (has_brand_access(brand_id, 'approver') and user_id = auth.uid());

create policy jobs_select on jobs for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy jobs_insert on jobs for insert to authenticated
  with check (has_brand_access(brand_id, 'approver') and status = 'queued' and created_by = auth.uid());

create policy replies_select on reply_drafts for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy replies_write on reply_drafts for all to authenticated
  using (has_brand_access(brand_id, 'approver')) with check (has_brand_access(brand_id, 'approver'));

create policy hashtags_select on hashtag_sets for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy hashtags_write on hashtag_sets for all to authenticated
  using (has_brand_access(brand_id, 'approver')) with check (has_brand_access(brand_id, 'approver'));

create policy history_select on post_history for select to authenticated using (has_brand_access(brand_id, 'viewer'));
create policy history_write on post_history for all to authenticated
  using (has_brand_access(brand_id, 'owner')) with check (has_brand_access(brand_id, 'owner'));

create policy conn_select on connections for select to authenticated using (has_brand_access(brand_id, 'owner'));

-- Realtime for the live job/queue UI (no-op where the publication does not exist).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table jobs, content_items;
  end if;
end $$;
