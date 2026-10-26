import type { AgentRunResult, ModelProvider } from "@socialos/agents";
import type { Job } from "../types.js";
import { hello } from "./hello.js";

export interface HandlerContext {
  job: Job;
  provider: ModelProvider;
}

export interface HandlerOutput {
  agentKey: string;
  result: unknown;
  run: AgentRunResult<unknown>;
}

export type Handler = (ctx: HandlerContext) => Promise<HandlerOutput>;

/** Phase 1 registers caption_package and voice_build here. */
export const handlers: Record<string, Handler> = { hello };
