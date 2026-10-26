export * from "./provider.js";
export * from "./claude-cli.js";
export * from "./api-provider.js";
export * from "./mock-provider.js";
export * from "./run-agent.js";
export * from "./agents.js";

import { ClaudeCliProvider } from "./claude-cli.js";
import { MockProvider } from "./mock-provider.js";
import type { ModelProvider } from "./provider.js";

/** Only Claude (subscription CLI) is available in v1; "mock" exists for tests. */
export function createProvider(mode = "claude-cli"): ModelProvider {
  if (mode === "claude-cli") return new ClaudeCliProvider({ model: process.env.CLAUDE_MODEL || undefined });
  if (mode === "mock") return new MockProvider();
  throw new Error(`unsupported MODEL_PROVIDER "${mode}" (v1 supports claude-cli)`);
}
