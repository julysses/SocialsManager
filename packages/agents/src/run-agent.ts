import { createHash } from "node:crypto";
import type { z } from "zod";
import type { ModelProvider } from "./provider.js";

export interface AgentDefinition<S extends z.ZodTypeAny> {
  key: string;
  system: string;
  /** Knowledge files this agent may read. */
  reads: readonly string[];
  /** Tables this agent's handler may write. */
  writes: readonly string[];
  output: S;
}

export class AgentOutputError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = "AgentOutputError";
  }
}

export interface AgentRunResult<T> {
  data: T;
  raw: string;
  promptHash: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs: number;
}

/** Pull a JSON object out of model text (tolerates code fences and surrounding prose). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* try harder */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1]!);
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("no JSON object found");
}

/** Calls the provider, validates with zod; on invalid output retries exactly once, then throws AgentOutputError. */
export async function runAgent<S extends z.ZodTypeAny>(
  provider: ModelProvider,
  agent: AgentDefinition<S>,
  prompt: string,
  attachments?: string[],
): Promise<AgentRunResult<z.infer<S>>> {
  const promptHash = createHash("sha256").update(agent.system).update("\0").update(prompt).digest("hex").slice(0, 16);
  let lastRaw = "";
  let lastErr = "";
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was invalid (${lastErr}). Reply with valid JSON only.`;
    const res = await provider.complete({ system: agent.system, prompt: p, attachments });
    durationMs += res.durationMs;
    lastRaw = res.text;
    try {
      const data = agent.output.parse(extractJson(res.text));
      return { data, raw: res.text, promptHash, model: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, durationMs };
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 300);
    }
  }
  throw new AgentOutputError(`invalid agent output after retry: ${lastErr}`, lastRaw);
}
