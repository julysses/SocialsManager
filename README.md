# Social OS (SocialsManager)

Multi-tenant "AI social media team" app. Tenant #1: Daily Heckler. Everything runs in the cloud
(Supabase, GitHub Actions, Cloudflare Pages). See `CLAUDE.md` for project rules, `docs/architecture.md`
for the design and `docs/runbook.md` for setup.

```
apps/web       React + Vite + Tailwind app
apps/worker    Actions worker: claim -> agent -> validate -> write
packages/agents    ModelProvider, zod schemas, prompts
packages/publisher Phase 2 (only module allowed to call platform write endpoints)
supabase       migrations, edge functions, SQL tests
```

Status: Phase 0 (foundation) built; nothing publishes anywhere.
