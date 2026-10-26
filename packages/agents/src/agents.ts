import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AgentDefinition } from "./run-agent.js";

const prompt = (name: string) => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");

export const helloOutput = z.object({ status: z.literal("ok"), message: z.string().min(1).max(300) });

/** Phase 0 health check. Phase 1 adds caption_packager, brand_checker and voice_builder. */
export const helloAgent: AgentDefinition<typeof helloOutput> = {
  key: "hello",
  system: prompt("hello"),
  reads: [],
  writes: ["agent_runs", "jobs"],
  output: helloOutput,
};
