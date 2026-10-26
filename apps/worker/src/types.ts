export interface Job {
  id: string;
  brand_id: string;
  content_item_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface AgentRunRow {
  brand_id: string;
  job_id: string;
  agent_key: string;
  provider_mode: string;
  prompt_hash?: string;
  input_ref?: string;
  output_ref?: string;
  raw_output?: string;
  duration_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
}

/** Everything the worker needs from the database; faked in tests. */
export interface WorkerDb {
  requeueStuck(): Promise<number>;
  claim(limit: number): Promise<Job[]>;
  succeed(jobId: string, result: unknown): Promise<void>;
  /** retryAt = null marks the job permanently failed. */
  fail(jobId: string, error: string, retryAt: Date | null, refundAttempt?: boolean): Promise<void>;
  insertAgentRun(row: AgentRunRow): Promise<void>;
}
