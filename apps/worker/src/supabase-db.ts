import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunRow, Job, WorkerDb } from "./types.js";

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export class SupabaseDb implements WorkerDb {
  private readonly sb: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.sb = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async requeueStuck(): Promise<number> {
    return Number(must(await this.sb.rpc("requeue_stuck_jobs"), "requeue_stuck_jobs") ?? 0);
  }

  async claim(limit: number): Promise<Job[]> {
    return (must(await this.sb.rpc("claim_jobs", { p_limit: limit }), "claim_jobs") ?? []) as Job[];
  }

  async succeed(jobId: string, result: unknown): Promise<void> {
    must(await this.sb.from("jobs").update({ status: "succeeded", result, error: null, locked_at: null }).eq("id", jobId), "job succeed");
  }

  async fail(jobId: string, error: string, retryAt: Date | null, refundAttempt = false): Promise<void> {
    let attempts: number | undefined;
    if (refundAttempt) {
      const cur = must(await this.sb.from("jobs").select("attempts").eq("id", jobId).single(), "read attempts");
      attempts = Math.max(0, (cur as { attempts: number }).attempts - 1);
    }
    const patch: Record<string, unknown> = retryAt
      ? { status: "queued", run_after: retryAt.toISOString(), error, locked_at: null }
      : { status: "failed", error, locked_at: null };
    if (attempts !== undefined) patch.attempts = attempts;
    must(await this.sb.from("jobs").update(patch).eq("id", jobId), "job fail");
  }

  async insertAgentRun(row: AgentRunRow): Promise<void> {
    must(await this.sb.from("agent_runs").insert(row), "agent_runs insert");
  }
}
