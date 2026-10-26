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
| 1 Upload → drafts | upload, caption_packager, brand_checker, queue, history import, voice_builder | not started |
| 2 Approve → schedule | approve/schedule, dry-run publisher, Metricool probe, live IG/FB | not started |
| 3 Replies + cross-post | reply_drafter, hashtag experiments, Threads, Bluesky | not started |
| 4 Metrics + Reels | analytics pull, Insights, weekly brief | not started |

## Data model
`supabase/migrations/0001_core.sql` (tables, RLS, gate), `0002_daily_heckler_seed.sql`, `0003_storage.sql`.
Pre-existing qoe-lite tables are untouched; no Social OS name collides with them.

## Approval gate
Enforced by triggers (`approvals_immutable`, `approvals_guard`, `enforce_approval_gate`, `publications_require_approved`).
Beyond the PRD text: `approved` also requires an approval row; publications cannot be inserted for unapproved items;
signups are restricted to `owner_allowlist` via a trigger on `auth.users`. Tested in `supabase/tests/01_gate_rls.test.sql`.

## Auth
Magic link. Sign-up is blocked at the database for any email not in `owner_allowlist`. After login the app calls
`claim_owner()`, which makes the first allowlisted user owner of the seeded workspace. Roles: `owner`, `approver`, `viewer`.

## Model abstraction
`packages/agents`: `ModelProvider` → `ClaudeCliProvider` (`claude -p`, `ANTHROPIC_API_KEY` stripped from the child env),
`ApiProvider` (inert stub), `MockProvider` (tests). All agent output is validated with zod; one retry, then the job fails
with raw output saved in `agent_runs.raw_output`.
