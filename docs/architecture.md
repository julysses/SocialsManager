# Architecture

```
Owner (browser, Cloudflare Pages)        GitHub Actions                         Supabase (qwnmeltdckwgsrjxvons)
  React app ── insert job (RLS) ───────────────────────────────────────────────►  jobs
  React app ── invoke `enqueue` ──► Edge Function ── repository_dispatch ──►  worker.yml
                                                                                   │ claim_jobs() (SKIP LOCKED)
                                                                                   │ `claude -p` (subscription token)
                                                                                   │ zod-validate → write rows (service role)
  realtime/poll ◄──────────────────────────────────────────────────────────────  jobs, agent_runs
```

## Phases
| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 Foundation | schema, RLS, approval gate, auth, shell, worker, enqueue, CI, deploy workflow | built, awaiting owner gate |
| 1 Upload → drafts | upload, caption_packager, brand_checker, queue, history import, voice_builder | built; needs real cartoons to verify |
| 2 Approve → schedule | approve/schedule, dry-run publisher, Metricool probe, live IG/FB | approve/schedule + dry-run built; live IG/FB blocked on Metricool probe and owner go-ahead |
| 3 Replies + cross-post | reply_drafter, hashtag experiments, Threads, Bluesky | not started |
| 4 Metrics + Reels | analytics pull, Insights, weekly brief | not started |

## Data model
`supabase/migrations/0001_core.sql` (tables, RLS, gate), `0002_daily_heckler_seed.sql`, `0003_storage.sql`.
Pre-existing qoe-lite tables are untouched; no Social OS name collides with them.

## Approval gate
Enforced by triggers (`approvals_immutable`, `approvals_guard`, `enforce_approval_gate`, `publications_require_approved`).
Beyond the PRD text: `approved` also requires an approval row; publications cannot be inserted for unapproved items;
`claim_owner()` only promotes emails in `owner_allowlist` (no trigger on `auth.users`, because the project also hosts another app). Tested in `supabase/tests/01_gate_rls.test.sql`.

## Auth
Magic link. A stranger can create an auth user but gets no membership and sees no data. After login the app calls
`claim_owner()`, which makes the first allowlisted user owner of the seeded workspace. Roles: `owner`, `approver`, `viewer`.

## Model abstraction
`packages/agents`: `ModelProvider` → `ClaudeCliProvider` (`claude -p`, `ANTHROPIC_API_KEY` stripped from the child env),
`ApiProvider` (inert stub), `MockProvider` (tests). All agent output is validated with zod; one retry, then the job fails
with raw output saved in `agent_runs.raw_output`.

## Phase 1/2 flow (as built)
1. Upload: image to private bucket `cartoons/{brand_id}/...`, `content_items` row (unique `source_hash`), job `caption_package`.
2. Worker `caption_package`: `caption_packager` (reads the image) → `brand_checker` (separate call) + code checks for platform length and banned words. A `fixed` rewrite is re-checked once. Pass/fixed → `queued`; fail → `checked` (owner decides).
3. Owner edits, then **Approve** (immutable `approvals` row) and, separately, **Schedule** / **Post now** (status `scheduled`, job `publish`).
4. Worker `publish` (no LLM): `packages/publisher` builds payloads from DB rows; refuses unless `scheduled` + approved. Dry-run mode records `publications` (mode `dry_run`) for Instagram and Facebook posts and a Story to both. X is manual (copy, open composer, paste URL → RPC `mark_posted_manual`).
5. DB locks approved text (`variants_guard`); an approval is void if the text changed afterwards.

Live Metricool publishing is not implemented: `LiveAdapter` refuses until the Phase 2 gate.
