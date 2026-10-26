# Social OS — project rules for Claude Code

Multi-tenant "AI social media team" app. Tenant #1 is Daily Heckler (@thedailyheckler). Everything runs in the cloud: GitHub Actions (workers), Supabase (DB, auth, storage, edge functions), Cloudflare Pages (web). Nothing runs on the owner's computer.

## How to work
- Work in phases (see docs/architecture.md). At the end of each phase: run tests, commit, push, report what passed, what is mocked, and the next 5 tasks. Stop at each gate and wait for the owner.
- Never post, schedule or send anything to a social platform while building or testing. Use the dry-run publisher until the owner explicitly says to go live.
- Never print, log or commit secrets. Secrets come from env vars, GitHub Actions secrets or Supabase secrets. Never ask for secret values in chat.
- If a requirement conflicts with the repo or the database, stop and ask. Do not guess.
- Supabase project `qwnmeltdckwgsrjxvons` also holds 14 unrelated tables (orgs, org_members, engagements, documents, accounts, transactions, canonical_categories, financial_facts, txn_classifications, adjustments, adjustment_evidence, gate_acknowledgements, audit_events, deal_structures). Never alter or drop them. Check for name collisions before every migration.

## Daily Heckler hard rules
1. The owner chooses every story and creates every image and its draft text in ChatGPT. Agents never choose topics and never generate artwork.
2. Nothing is posted or scheduled without the owner's explicit action in the app: Approve, then (separately) Schedule or Post now.
3. The "AI-generated" label is a per-brand setting, default off (`brands.settings.ai_label = false`).
4. Editorial angle: both parties are fair game. Track balance, do not force it.
5. Replies are drafts only (`reply_mode = 'draft_only'`).
6. Each edition's Story goes to both Facebook and Instagram.
7. Growth order: X reply strategy, then hashtag/caption overhaul, then Reels.

## Approval gate (enforced in Postgres, supabase/migrations/0001_core.sql)
- `approvals` is append-only. Only `approver`/`owner` users insert, and `user_id = auth.uid()`. Agents (service role) can never write approvals.
- `content_items` can only become approved/scheduled/live with a valid approval newer than any `fixed` check.
- View `unapproved_publications` must always return 0 rows (tested).

## Publishing
- Publisher is plain code with no LLM; payload built only from DB rows; refuses unless the item is `scheduled` with an approval.
- Dry run first (`publications.mode = 'dry_run'`). Live requires `brands.settings.publish_mode = 'live'`, set only by the owner.
- Only `packages/publisher` may call a platform write endpoint (`npm run check:no-platform-writes`).
- X is manual (copy + open composer + paste URL). Never scrape or automate logins.

## Conventions
- Every row has `workspace`/`brand_id`; RLS everywhere via `has_brand_access(brand_id, min_role)`.
- All model calls go through `ModelProvider` (`ClaudeCliProvider` now; `ApiProvider` is an unwired stub). Claude only in v1.
- Agent output is JSON validated with zod; invalid output is retried once, then the job fails with raw output saved in `agent_runs`.
- Migrations are numbered in `supabase/migrations`; SQL tests in `supabase/tests` (`npm run test:sql`).
