export interface CompleteRequest {
  system: string;
  prompt: string;
  /** Absolute paths of local files (e.g. a cartoon image) the model may read. */
  attachments?: string[];
  timeoutMs?: number;
}

export interface CompleteResult {
  text: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs: number;
}

export interface ModelProvider {
  /** Recorded in agent_runs.provider_mode. */
  readonly mode: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

/** Thrown when the subscription usage limit is hit; the worker re-queues instead of failing. */
export class UsageLimitError extends Error {
  constructor(message: string, readonly retryAt: Date) {
    super(message);
    this.name = "UsageLimitError";
  }
}
