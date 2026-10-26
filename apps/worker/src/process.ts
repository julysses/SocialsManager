import { AgentOutputError, UsageLimitError, type ModelProvider } from "@socialos/agents";
import { handlers } from "./handlers/index.js";
import type { Job, WorkerDb } from "./types.js";

export interface ProcessDeps {
  db: WorkerDb;
  provider: ModelProvider;
  now?: () => Date;
  log?: (msg: string) => void;
}

export const backoffMs = (attempts: number) => Math.min(60, 2 ** attempts) * 60_000;
const hhmm = (d: Date) => d.toISOString().slice(11, 16) + " UTC";

export type Outcome = "succeeded" | "retry" | "failed" | "limit";

export async function processJob(job: Job, deps: ProcessDeps): Promise<Outcome> {
  const { db, provider } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const started = Date.now();
  const handler = handlers[job.kind];
  const base = { brand_id: job.brand_id, job_id: job.id, provider_mode: provider.mode };

  try {
    if (!handler) throw new Error(`no handler for job kind "${job.kind}"`);
    const out = await handler({ job, provider });
    await db.insertAgentRun({
      ...base,
      agent_key: out.agentKey,
      prompt_hash: out.run.promptHash,
      raw_output: out.run.raw,
      output_ref: `jobs/${job.id}/result`,
      duration_ms: Date.now() - started,
      tokens_in: out.run.tokensIn,
      tokens_out: out.run.tokensOut,
    });
    await db.succeed(job.id, out.result);
    log(`job ${job.id} (${job.kind}) succeeded`);
    return "succeeded";
  } catch (e) {
    const err = e as Error;
    if (e instanceof UsageLimitError) {
      const msg = `Claude limit reached, retrying at ${hhmm(e.retryAt)}`;
      await db.fail(job.id, msg, e.retryAt, true);
      log(`job ${job.id}: ${msg}`);
      return "limit";
    }
    await db.insertAgentRun({
      ...base,
      agent_key: job.kind,
      raw_output: e instanceof AgentOutputError ? e.raw : undefined,
      duration_ms: Date.now() - started,
      error: err.message.slice(0, 500),
    });
    if (job.attempts >= job.max_attempts) {
      await db.fail(job.id, err.message.slice(0, 500), null);
      log(`job ${job.id} failed permanently: ${err.message}`);
      return "failed";
    }
    await db.fail(job.id, err.message.slice(0, 500), new Date(now().getTime() + backoffMs(job.attempts)));
    log(`job ${job.id} failed (attempt ${job.attempts}/${job.max_attempts}), will retry: ${err.message}`);
    return "retry";
  }
}

export interface RunOptions extends ProcessDeps {
  batchSize?: number;
  /** Stop claiming new jobs after this long, to keep Actions minutes bounded. */
  budgetMs?: number;
}

export async function runWorker(opts: RunOptions): Promise<{ processed: number; minutes: number }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 8 * 60_000;
  const log = opts.log ?? (() => {});
  const requeued = await opts.db.requeueStuck();
  if (requeued) log(`requeued ${requeued} stuck job(s)`);
  let processed = 0;
  while (Date.now() - started < budget) {
    const jobs = await opts.db.claim(opts.batchSize ?? 5);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      await processJob(job, opts);
      processed++;
    }
  }
  const minutes = (Date.now() - started) / 60_000;
  log(`processed ${processed} job(s) in ${minutes.toFixed(2)} min of runner time`);
  return { processed, minutes };
}
