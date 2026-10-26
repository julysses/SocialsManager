import type { AgentRunResult, ModelProvider } from "@socialos/agents";
import type { Job, WorkerDb } from "../types.js";
import { captionPackage } from "./caption-package.js";
import { hello } from "./hello.js";
import { publish } from "./publish.js";
import { voiceBuild } from "./voice-build.js";

export interface HandlerContext {
  job: Job;
  provider: ModelProvider;
  db: WorkerDb;
  log: (msg: string) => void;
}

export interface HandlerRun {
  agentKey: string;
  run: AgentRunResult<unknown>;
}

export interface HandlerOutput {
  result: unknown;
  /** One entry per model call, each written to agent_runs. Empty for plain-code jobs (publish). */
  runs: HandlerRun[];
}

export type Handler = (ctx: HandlerContext) => Promise<HandlerOutput>;

export const handlers: Record<string, Handler> = {
  hello,
  caption_package: captionPackage,
  voice_build: voiceBuild,
  publish,
};
