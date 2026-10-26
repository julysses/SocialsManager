// Edge Function: enqueue
// The web app creates a `jobs` row (RLS-checked), then calls this with { job_id }.
// We verify the caller can see that job, then wake the GitHub Actions worker via repository_dispatch.
// Secrets: GITHUB_DISPATCH_TOKEN (fine-grained PAT, this repo only). Optional GITHUB_REPO (default below).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "missing authorization" }, 401);

  let jobId: unknown;
  try {
    ({ job_id: jobId } = await req.json());
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (typeof jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "job_id required" }, 400);

  // Run the lookup as the caller so RLS decides whether they may enqueue this job.
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: job, error } = await sb.from("jobs").select("id, kind, status").eq("id", jobId).maybeSingle();
  if (error || !job) return json({ error: "job not found" }, 404);
  if (job.status !== "queued") return json({ ok: true, skipped: `job is ${job.status}` });

  const token = Deno.env.get("GITHUB_DISPATCH_TOKEN");
  if (!token) return json({ error: "GITHUB_DISPATCH_TOKEN not configured" }, 503);
  const repo = Deno.env.get("GITHUB_REPO") ?? "julysses/SocialsManager";

  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "social-os-enqueue",
    },
    body: JSON.stringify({ event_type: "job-queued", client_payload: { job_id: job.id, kind: job.kind } }),
  });
  if (res.status !== 204) return json({ error: `github dispatch failed (${res.status})` }, 502);
  return json({ ok: true });
});
