import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AgentDefinition } from "./run-agent.js";
import { brandCheckerOutput, captionPackageOutput, voiceBuilderOutput } from "./schemas.js";

const prompt = (name: string) => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");

export const helloOutput = z.object({ status: z.literal("ok"), message: z.string().min(1).max(300) });

/** Phase 0 health check. */
export const helloAgent: AgentDefinition<typeof helloOutput> = {
  key: "hello",
  system: prompt("hello"),
  reads: [],
  writes: ["agent_runs", "jobs"],
  output: helloOutput,
};

export const captionPackagerAgent: AgentDefinition<typeof captionPackageOutput> = {
  key: "caption_packager",
  system: prompt("caption_packager"),
  reads: ["voice/voice-guide.md", "voice/banned-words.md", "content/editorial-rules.md", "platforms/*", "hooks/hook-library.md"],
  writes: ["platform_variants", "content_items"],
  output: captionPackageOutput,
};

export const brandCheckerAgent: AgentDefinition<typeof brandCheckerOutput> = {
  key: "brand_checker",
  system: prompt("brand_checker"),
  reads: ["voice/voice-guide.md", "voice/banned-words.md", "content/editorial-rules.md"],
  writes: ["checks", "platform_variants", "content_items"],
  output: brandCheckerOutput,
};

export const voiceBuilderAgent: AgentDefinition<typeof voiceBuilderOutput> = {
  key: "voice_builder",
  system: prompt("voice_builder"),
  reads: [],
  writes: ["jobs"],
  output: voiceBuilderOutput,
};
