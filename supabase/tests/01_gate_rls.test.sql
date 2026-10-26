-- RLS (two fake workspaces), approval gate, job claiming. Raises on any failure.
create schema tt;
grant usage on schema tt to anon, authenticated, service_role;

create function tt.as_user(p_uid uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.email', p_email, true);
  execute 'set local role authenticated';
end $$;
create function tt.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);
  execute 'set local role service_role';
end $$;
create function tt.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end $$;
create function tt.reset() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);
  execute 'reset role';
end $$;
-- true when running the statement raises an error containing p_expect
create function tt.fails(p_sql text, p_expect text default '') returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return position(lower(p_expect) in lower(sqlerrm)) > 0;
end $$;
create function tt.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on all functions in schema tt to anon, authenticated, service_role;

-- ------------------------------------------------------------ fixtures
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';   -- owner of Daily Heckler workspace
  b uuid := '00000000-0000-0000-0000-00000000000b';   -- owner of the other workspace
  c uuid := '00000000-0000-0000-0000-00000000000c';   -- viewer in Daily Heckler workspace
  d uuid := '00000000-0000-0000-0000-00000000000d';   -- approver in Daily Heckler workspace
  ws2 uuid; br2 uuid; ws1 uuid; br1 uuid;
begin
  insert into owner_allowlist(email) values ('b@example.com'), ('c@example.com'), ('d@example.com');
  insert into auth.users(id, email) values (a, 'julyssesd@gmail.com'), (b, 'b@example.com'), (c, 'c@example.com'), (d, 'd@example.com');

  -- owner bootstrap
  perform tt.as_user(a, 'julyssesd@gmail.com');
  perform tt.ok(claim_owner() = 'owner', 'allowlisted user claims the seeded workspace as owner');
  perform tt.ok(claim_owner() = 'owner', 'claim_owner is idempotent');
  perform tt.reset();
  perform tt.as_user(c, 'c@example.com');
  perform tt.ok(tt.fails('select claim_owner()', 'no unclaimed'), 'second allowlisted user cannot claim an owned workspace');
  perform tt.reset();
  insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000ee', 'stranger@example.com');
  perform tt.as_user('00000000-0000-0000-0000-0000000000ee', 'stranger@example.com');
  perform tt.ok(tt.fails('select claim_owner()', 'not allowlisted'), 'non-allowlisted account cannot claim ownership');
  perform tt.ok((select count(*) from brands) = 0, 'non-allowlisted account sees no brands');
  perform tt.reset();

  select id into ws1 from workspaces where name = 'Julio Dominguez';
  select id into br1 from brands where slug = 'daily-heckler';
  insert into members(workspace_id, user_id, role) values (ws1, c, 'viewer'), (ws1, d, 'approver');
  insert into workspaces(name) values ('Other Co') returning id into ws2;
  insert into brands(workspace_id, name, slug) values (ws2, 'Other Brand', 'other') returning id into br2;
  insert into members(workspace_id, user_id, role) values (ws2, b, 'owner');
  insert into knowledge_files(brand_id, folder, filename, content_md) values (br2, 'voice', 'secret.md', 'other tenant data');

  perform set_config('t.br1', br1::text, false);
  perform set_config('t.br2', br2::text, false);
end $$;

-- ------------------------------------------------------------ tenant isolation
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b';
  c uuid := '00000000-0000-0000-0000-00000000000c';
  br1 uuid := current_setting('t.br1')::uuid; br2 uuid := current_setting('t.br2')::uuid;
begin
  perform tt.as_user(a, 'julyssesd@gmail.com');
  perform tt.ok((select count(*) from brands) = 1, 'owner A sees only their own brand');
  perform tt.ok((select count(*) from knowledge_files where brand_id = br2) = 0, 'owner A cannot read other tenant knowledge files');
  perform tt.ok((select count(*) from knowledge_files where brand_id = br1) = 10, 'owner A sees the 10 seeded knowledge files');
  perform tt.ok(tt.fails(format($q$insert into content_items(brand_id, title) values (%L, 'x')$q$, br2), 'row-level security'),
    'owner A cannot insert into other tenant brand');
  insert into content_items(brand_id, title, created_by) values (br1, 'A item', a);
  perform tt.reset();

  perform tt.as_user(b, 'b@example.com');
  perform tt.ok((select count(*) from content_items) = 0, 'owner B cannot see A content items');
  perform tt.ok((select count(*) from brands) = 1, 'owner B sees only their own brand');
  perform tt.reset();

  perform tt.as_user(c, 'c@example.com');
  perform tt.ok((select count(*) from content_items) = 1, 'viewer can read content items');
  perform tt.ok(tt.fails(format($q$insert into content_items(brand_id, title) values (%L, 'v')$q$, br1), 'row-level security'),
    'viewer cannot create content items');
  perform tt.ok(tt.fails(format($q$insert into jobs(brand_id, kind, created_by) values (%L, 'hello', %L)$q$, br1, c), 'row-level security'),
    'viewer cannot create jobs');
  perform tt.reset();

  perform tt.as_anon();
  perform tt.ok(tt.fails('select count(*) from brands', 'permission denied') or (select count(*) from brands) = 0,
    'anon sees nothing');
  perform tt.reset();
end $$;

-- ------------------------------------------------------------ approval gate
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a'; c uuid := '00000000-0000-0000-0000-00000000000c';
  d uuid := '00000000-0000-0000-0000-00000000000d';
  br1 uuid := current_setting('t.br1')::uuid;
  item uuid;
begin
  select id into item from content_items where title = 'A item';

  perform tt.ok(tt.fails(format($q$insert into content_items(brand_id, status) values (%L, 'scheduled')$q$, br1), 'cannot insert as'),
    'cannot insert a content item directly as scheduled');
  perform tt.ok(tt.fails(format($q$insert into content_items(brand_id, status) values (%L, 'live')$q$, br1), 'cannot insert as'),
    'cannot insert a content item directly as live');

  perform tt.as_user(a, 'julyssesd@gmail.com');
  perform tt.ok(tt.fails(format($q$update content_items set status = 'scheduled' where id = %L$q$, item), 'approve first'),
    'draft -> scheduled is blocked');
  perform tt.ok(tt.fails(format($q$update content_items set status = 'approved' where id = %L$q$, item), 'no valid approval'),
    'draft -> approved without an approval row is blocked');
  perform tt.ok(tt.fails(format($q$update content_items set status = 'live' where id = %L$q$, item), 'invalid transition'),
    'draft -> live is blocked');
  perform tt.reset();

  -- who may approve
  perform tt.as_user(c, 'c@example.com');
  perform tt.ok(tt.fails(format($q$insert into approvals(brand_id, content_item_id, user_id, decision) values (%L, %L, %L, 'approved')$q$, br1, item, c), 'only approvers'),
    'viewer cannot approve');
  perform tt.reset();
  perform tt.as_user(d, 'd@example.com');
  perform tt.ok(tt.fails(format($q$insert into approvals(brand_id, content_item_id, user_id, decision) values (%L, %L, %L, 'approved')$q$, br1, item, a), 'must equal'),
    'approver cannot approve on behalf of another user_id');
  perform tt.reset();
  perform tt.as_service();
  perform tt.ok(tt.fails(format($q$insert into approvals(brand_id, content_item_id, user_id, decision) values (%L, %L, %L, 'approved')$q$, br1, item, a), 'permission denied'),
    'service role (agents) can never write an approval');
  perform tt.reset();
  perform tt.ok(tt.fails(format($q$insert into approvals(brand_id, content_item_id, user_id, decision) values (%L, %L, %L, 'approved')$q$, br1, item, a), 'signed-in user'),
    'even a superuser session without a signed-in user cannot write an approval');

  -- happy path
  perform tt.as_user(a, 'julyssesd@gmail.com');
  insert into approvals(brand_id, content_item_id, user_id, decision) values (br1, item, a, 'approved');
  update content_items set status = 'approved' where id = item;
  update content_items set status = 'scheduled' where id = item;
  perform tt.ok((select status from content_items where id = item) = 'scheduled', 'owner approval allows approved -> scheduled');
  update approvals set decision = 'rejected' where content_item_id = item;
  delete from approvals where content_item_id = item;
  perform tt.ok((select count(*) from approvals where content_item_id = item and decision = 'approved') = 1,
    'signed-in users cannot update or delete approvals (no policy)');
  perform tt.reset();

  -- approvals are immutable even for a superuser
  perform tt.ok(tt.fails('delete from approvals', 'immutable'), 'approvals immutable for superuser too');
  perform tt.ok(tt.fails('update approvals set decision = ''rejected''', 'immutable'), 'approvals cannot be updated by superuser either');
end $$;

-- a 'fixed' check created after the approval invalidates it
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  br1 uuid := current_setting('t.br1')::uuid;
  item uuid;
begin
  insert into content_items(brand_id, title, created_by) values (br1, 'B item', a) returning id into item;
  insert into approvals(brand_id, content_item_id, user_id, decision, decided_at) values (br1, item, a, 'approved', now() - interval '10 minutes')
    -- bypass the guard for fixture setup only
    ;
exception when others then
  -- the guard requires a signed-in user; set up with one
  null;
end $$;

do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  br1 uuid := current_setting('t.br1')::uuid;
  item uuid;
begin
  perform tt.as_user(a, 'julyssesd@gmail.com');
  insert into content_items(brand_id, title, created_by) values (br1, 'B item', a) returning id into item;
  insert into approvals(brand_id, content_item_id, user_id, decision, decided_at)
    values (br1, item, a, 'approved', now() - interval '10 minutes');
  perform tt.reset();
  -- checker produced a rewrite AFTER the approval (service role writes checks)
  perform tt.as_service();
  insert into checks(brand_id, content_item_id, verdict, created_at) values (br1, item, 'fixed', now() - interval '5 minutes');
  perform tt.reset();
  perform tt.as_user(a, 'julyssesd@gmail.com');
  perform tt.ok(tt.fails(format($q$update content_items set status = 'approved' where id = %L$q$, item), 'no valid approval'),
    'approval older than a fixed check no longer counts');
  insert into approvals(brand_id, content_item_id, user_id, decision, decided_at)
    values (br1, item, a, 'edited_approved', now());
  update content_items set status = 'approved' where id = item;
  perform tt.ok(true, 're-approval after the fixed check is accepted');
  perform tt.reset();
end $$;

-- ------------------------------------------------------------ publications & unapproved view
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  br1 uuid := current_setting('t.br1')::uuid;
  draft uuid; sched uuid;
begin
  select id into sched from content_items where title = 'A item';
  insert into content_items(brand_id, title, created_by) values (br1, 'C draft', a) returning id into draft;

  perform tt.as_service();
  perform tt.ok(tt.fails(format($q$insert into publications(brand_id, content_item_id, platform) values (%L, %L, 'instagram')$q$, br1, draft), 'cannot publish'),
    'cannot create a publication for an unapproved item');
  insert into publications(brand_id, content_item_id, platform, mode) values (br1, sched, 'instagram', 'dry_run');
  perform tt.reset();
  perform tt.ok((select count(*) from unapproved_publications) = 0, 'unapproved_publications returns 0 rows');

  perform tt.as_user(a, 'julyssesd@gmail.com');
  perform tt.ok(tt.fails(format($q$insert into publications(brand_id, content_item_id, platform) values (%L, %L, 'x')$q$, br1, sched), 'permission denied')
                or tt.fails(format($q$insert into publications(brand_id, content_item_id, platform) values (%L, %L, 'x')$q$, br1, sched), 'row-level security'),
    'signed-in users cannot write publications');
  perform tt.ok(tt.fails(format($q$insert into checks(brand_id, content_item_id, verdict) values (%L, %L, 'passed')$q$, br1, sched), 'row-level security'),
    'signed-in users cannot write checks');
  perform tt.ok(tt.fails(format($q$insert into agent_runs(brand_id, agent_key, provider_mode) values (%L, 'x', 'y')$q$, br1), 'row-level security'),
    'signed-in users cannot write agent_runs');
  perform tt.reset();
end $$;

-- ------------------------------------------------------------ jobs
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  br1 uuid := current_setting('t.br1')::uuid;
  j uuid; n int;
begin
  perform tt.as_user(a, 'julyssesd@gmail.com');
  insert into jobs(brand_id, kind, payload, created_by, idempotency_key) values (br1, 'hello', '{}', a, 'hello:1') returning id into j;
  perform tt.ok(tt.fails(format($q$insert into jobs(brand_id, kind, created_by, idempotency_key) values (%L, 'hello', %L, 'hello:1')$q$, br1, a), 'duplicate'),
    'idempotency key prevents duplicate jobs');
  perform tt.ok(tt.fails('select * from claim_jobs(5)', 'permission denied'), 'signed-in users cannot claim jobs');
  perform tt.reset();
  perform tt.as_anon();
  perform tt.ok(tt.fails('select * from claim_jobs(5)', 'permission denied'), 'anon cannot claim jobs');
  perform tt.reset();

  perform tt.as_service();
  select count(*) into n from claim_jobs(5);
  perform tt.ok(n = 1, 'service role claims the queued job');
  select count(*) into n from claim_jobs(5);
  perform tt.ok(n = 0, 'a claimed job is not claimed twice');
  perform tt.ok((select attempts from jobs where id = j) = 1, 'claim increments attempts');
  update jobs set locked_at = now() - interval '20 minutes' where id = j;
  perform tt.ok(requeue_stuck_jobs() = 1, 'stuck running job is requeued');
  perform tt.ok((select status from jobs where id = j) = 'queued', 'requeued job is queued again');
  perform tt.reset();
end $$;

-- ------------------------------------------------------------ function grants
do $$
declare br1 uuid := current_setting('t.br1')::uuid;
begin
  perform tt.as_anon();
  perform tt.ok(tt.fails(format('select has_brand_access(%L)', br1), 'permission denied'), 'anon cannot call has_brand_access');
  perform tt.ok(tt.fails('select claim_owner()', 'permission denied'), 'anon cannot call claim_owner');
  perform tt.reset();
end $$;
