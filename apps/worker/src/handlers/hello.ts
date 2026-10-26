import { helloAgent, runAgent } from "@socialos/agents";
import type { Handler } from "./index.js";

/** Phase 0 health check: proves Actions -> claude -p -> zod -> DB works end to end. */
export const hello: Handler = async ({ job, provider }) => {
  const r = await runAgent(provider, helloAgent, `Health check for job ${job.id}. Reply now.`);
  return { agentKey: helloAgent.key, result: r.data, run: r };
};
