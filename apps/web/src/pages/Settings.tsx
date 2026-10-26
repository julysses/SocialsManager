import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth";
import { Badge, Card, CardTitle, EmptyState } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { summarizeHealth, type JobRow } from "../lib/health";
import { supabase } from "../lib/supabase";

interface RunRow {
  id: string;
  agent_key: string;
  provider_mode: string;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export function SettingsPage() {
  const { brand, role, session } = useAuth();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testState, setTestState] = useState<{ busy: boolean; msg: string | null; tone: "success" | "danger" }>({ busy: false, msg: null, tone: "success" });

  const load = useCallback(async () => {
    if (!brand) return;
    const [j, r] = await Promise.all([
      supabase.from("jobs").select("id,kind,status,error,attempts,created_at,updated_at").eq("brand_id", brand.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("agent_runs").select("id,agent_key,provider_mode,duration_ms,error,created_at").eq("brand_id", brand.id).order("created_at", { ascending: false }).limit(20),
    ]);
    if (j.error || r.error) return setLoadError((j.error ?? r.error)!.message);
    setLoadError(null);
    setJobs(j.data as JobRow[]);
    setRuns(r.data as RunRow[]);
  }, [brand]);

  useEffect(() => {
    void load();
    if (!brand) return;
    const ch = supabase
      .channel(`jobs-${brand.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `brand_id=eq.${brand.id}` }, () => void load())
      .subscribe();
    const poll = setInterval(() => void load(), 15000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, [brand, load]);

  async function runTestJob() {
    if (!brand || !session) return;
    setTestState({ busy: true, msg: null, tone: "success" });
    const ins = await supabase
      .from("jobs")
      .insert({ brand_id: brand.id, kind: "hello", payload: {}, created_by: session.user.id, idempotency_key: `hello:${crypto.randomUUID()}` })
      .select("id")
      .single();
    if (ins.error) return setTestState({ busy: false, msg: ins.error.message, tone: "danger" });
    const fn = await supabase.functions.invoke("enqueue", { body: { job_id: ins.data.id } });
    setTestState(
      fn.error
        ? { busy: false, msg: `Job queued, but waking the worker failed (${fn.error.message}). The daily batch will still pick it up.`, tone: "danger" }
        : { busy: false, msg: "Test job queued. Watch it below.", tone: "success" },
    );
    void load();
  }

  const [pw, setPw] = useState("");
  const [pwState, setPwState] = useState<{ msg: string; tone: "success" | "danger" } | null>(null);
  async function savePassword() {
    if (pw.length < 10) return setPwState({ msg: "Use at least 10 characters.", tone: "danger" });
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setPwState({ msg: error.message, tone: "danger" });
    setPw("");
    setPwState({ msg: "Password saved. You can now sign in with your email and password.", tone: "success" });
  }

  if (!brand) return null;
  const health = jobs ? summarizeHealth(jobs) : null;
  const s = brand.settings;
  const tone = health?.state === "attention" ? "danger" : health?.state === "busy" ? "warning" : "success";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card className="space-y-3">
        <CardTitle>Brand settings — {brand.name}</CardTitle>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Publish mode</dt><dd><Badge tone={s.publish_mode === "live" ? "danger" : "success"}>{s.publish_mode ?? "dry_run"}</Badge></dd></div>
          <div><dt className="text-muted-foreground">Autopublish</dt><dd>{String(s.autopublish ?? false)}</dd></div>
          <div><dt className="text-muted-foreground">Reply mode</dt><dd>{s.reply_mode ?? "draft_only"}</dd></div>
          <div><dt className="text-muted-foreground">AI label</dt><dd>{String(s.ai_label ?? false)}</dd></div>
          <div><dt className="text-muted-foreground">Timezone</dt><dd>{brand.timezone}</dd></div>
          <div><dt className="text-muted-foreground">Your role</dt><dd>{role}</dd></div>
        </dl>
        <p className="text-xs text-muted-foreground">
          The AI-label setting is yours to decide; platform rules on labeling realistic synthetic media can override it. Satire involving real named people should
          not present invented facts as real. This is not legal advice. Editing settings arrives in Phase 1; live publishing is locked until the Phase 2 gate.
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Worker health</CardTitle>
          {health && <Badge tone={tone}>{health.state}</Badge>}
        </div>
        {loadError && <p role="alert" className="text-sm text-danger">Could not load: {loadError}</p>}
        {!jobs && !loadError && <p className="text-sm text-muted-foreground">Loading…</p>}
        {health && (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Queue depth</dt><dd className="text-lg font-semibold">{health.queueDepth}</dd></div>
            <div><dt className="text-muted-foreground">Running</dt><dd className="text-lg font-semibold">{health.running}</dd></div>
            <div className="col-span-2"><dt className="text-muted-foreground">Last job finished</dt><dd>{fmt(health.lastJobAt)}</dd></div>
            {health.lastError && <div className="col-span-full"><dt className="text-muted-foreground">Last error</dt><dd className="text-danger">{health.lastError}</dd></div>}
          </dl>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runTestJob} disabled={testState.busy || role === "viewer"}>{testState.busy ? "Queuing…" : "Run test job"}</Button>
          {testState.msg && <span role="status" className={testState.tone === "danger" ? "text-sm text-danger" : "text-sm text-success"}>{testState.msg}</span>}
        </div>
      </Card>

      <Card className="space-y-3">
        <CardTitle>Last 20 agent runs</CardTitle>
        {runs.length === 0 ? (
          <EmptyState title="No agent runs yet">Run the test job to see the first one.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="py-1 pr-3">When</th><th className="pr-3">Agent</th><th className="pr-3">Mode</th><th className="pr-3">ms</th><th>Result</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1 pr-3 whitespace-nowrap">{fmt(r.created_at)}</td>
                    <td className="pr-3">{r.agent_key}</td>
                    <td className="pr-3">{r.provider_mode}</td>
                    <td className="pr-3">{r.duration_ms ?? "–"}</td>
                    <td>{r.error ? <span className="text-danger">{r.error}</span> : <Badge tone="success">ok</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <CardTitle>Account</CardTitle>
        <p className="text-sm text-muted-foreground">Signed in as {session?.user.email}. Set a password so you never need an emailed link again. You stay signed in on this device.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className="block text-sm" htmlFor="newpw">New password</label>
            <input
              id="newpw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-muted px-3 text-sm"
            />
          </div>
          <Button onClick={savePassword} disabled={!pw}>Save password</Button>
        </div>
        {pwState && <p role="status" className={pwState.tone === "danger" ? "text-sm text-danger" : "text-sm text-success"}>{pwState.msg}</p>}
      </Card>

      <Card className="space-y-2">
        <CardTitle>Connections</CardTitle>
        <EmptyState title="No connections yet">Metricool is probed in Phase 2. Tokens are never stored in the database.</EmptyState>
      </Card>
    </div>
  );
}
