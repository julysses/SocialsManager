import type { Variants } from "@socialos/agents";

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

export interface ItemRow {
  id: string;
  brand_id: string;
  title: string | null;
  story_note: string | null;
  gpt_caption: string | null;
  source_image_path: string | null;
  status: string;
  planned_for: string | null;
}

export interface BrandRow {
  id: string;
  name: string;
  timezone: string;
  settings: Record<string, any>;
}

export interface VariantRow {
  platform: string;
  text: string;
  hashtags: string[];
  alt_text: string | null;
}

export interface CheckRow {
  brand_id: string;
  content_item_id: string;
  voice_score: number | null;
  flags: unknown[];
  verdict: "passed" | "fixed" | "failed";
  fixed_text?: Variants | null;
  model?: string | null;
  latency_ms?: number | null;
}

export interface PublicationRow {
  brand_id: string;
  content_item_id: string;
  platform: string;
  format: "post" | "story";
  mode: "dry_run" | "live";
  status: "scheduled" | "posted" | "failed";
  scheduled_for: string;
  payload: unknown;
  error?: string | null;
  external_post_id?: string | null;
  external_url?: string | null;
}

export interface HistoryRow {
  platform: string;
  text: string;
  posted_at: string | null;
  metrics: Record<string, unknown>;
}

/** Everything the worker needs from the database; faked in tests. */
export interface WorkerDb {
  requeueStuck(): Promise<number>;
  claim(limit: number): Promise<Job[]>;
  succeed(jobId: string, result: unknown): Promise<void>;
  /** retryAt = null marks the job permanently failed. */
  fail(jobId: string, error: string, retryAt: Date | null, refundAttempt?: boolean): Promise<void>;
  insertAgentRun(row: AgentRunRow): Promise<void>;

  getItem(id: string): Promise<ItemRow | null>;
  getBrand(id: string): Promise<BrandRow | null>;
  /** Knowledge files keyed "folder/filename". */
  getKnowledge(brandId: string): Promise<Record<string, string>>;
  /** Downloads a Storage object to a local temp file and returns its path. */
  downloadImage(path: string): Promise<string>;
  getVariants(itemId: string): Promise<VariantRow[]>;
  upsertVariants(brandId: string, itemId: string, rows: VariantRow[]): Promise<void>;
  insertCheck(row: CheckRow): Promise<void>;
  updateItem(id: string, patch: Partial<Pick<ItemRow, "status">> & { change_note?: string | null }): Promise<void>;
  getPostHistory(brandId: string, limit: number): Promise<HistoryRow[]>;
  hasApproval(itemId: string): Promise<boolean>;
  getPublications(itemId: string): Promise<Pick<PublicationRow, "platform" | "format" | "mode" | "status">[]>;
  insertPublication(row: PublicationRow): Promise<void>;
}
