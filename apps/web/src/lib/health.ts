export interface JobRow {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface Health {
  queueDepth: number;
  running: number;
  lastJobAt: string | null;
  lastError: string | null;
  state: "idle" | "busy" | "attention";
}

/** Summarises the most recent jobs for the Settings > Worker health card. */
export function summarizeHealth(jobs: JobRow[]): Health {
  const sorted = [...jobs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const queueDepth = jobs.filter((j) => j.status === "queued").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const lastDone = sorted.find((j) => j.status === "succeeded" || j.status === "failed");
  const lastFailed = sorted.find((j) => j.status === "failed" || (j.status === "queued" && j.error));
  const state = lastFailed && lastDone?.status === "failed" ? "attention" : running + queueDepth > 0 ? "busy" : "idle";
  return { queueDepth, running, lastJobAt: lastDone?.updated_at ?? null, lastError: lastFailed?.error ?? null, state };
}
