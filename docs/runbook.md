# Runbook

## One-time setup (owner)
1. **Apply migrations** to the Supabase project (SQL editor or `supabase db push` after `supabase link --project-ref qwnmeltdckwgsrjxvons`). Run `0001`, `0002`, `0003` in order. They only create new objects.
2. **Auth URL config** (Supabase → Authentication → URL Configuration): set Site URL and redirect URL to the Cloudflare Pages URL.
3. **GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions):
   - `CLAUDE_CODE_OAUTH_TOKEN` — run `claude setup-token` once on any machine, save the output as this secret. Never paste it in chat.
   - `SUPABASE_URL` — `https://qwnmeltdckwgsrjxvons.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project settings → API.
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Pages: Edit).
   - Variables: `VITE_SUPABASE_ANON_KEY` (publishable key), optional `CF_PAGES_PROJECT` (default `social-os`).
4. **Edge Function**: `supabase functions deploy enqueue`, then `supabase secrets set GITHUB_DISPATCH_TOKEN=...` (fine-grained PAT, this repo only, Actions: write → needs "Contents: write" for repository_dispatch).
5. **Merge to `main`**: `repository_dispatch`, `schedule` and `deploy-web` only run from the default branch.
6. Create the Cloudflare Pages project `social-os` (direct upload) once.

## Gate check
Sign in → Settings → **Run test job**. Within ~1 minute Worker health shows the job and an `agent_runs` row (`hello`, `claude-cli`).
If the job stays queued: check the `worker` workflow run in Actions, then the `enqueue` function logs.

## Failure modes
- "Claude limit reached, retrying at HH:MM UTC": subscription limit; job is re-queued without using an attempt.
- Stuck `running` jobs older than 15 min are re-queued at the start of every worker run.
- Worker never touches platform APIs. `npm run check:no-platform-writes` enforces it in CI.

## Local checks
`npm ci && npm run typecheck && npm test && npm run test:sql`
