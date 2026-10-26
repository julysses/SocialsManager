import { runAgent, voiceBuilderAgent } from "@socialos/agents";
import { voicePrompt } from "../prompts.js";
import type { Handler } from "./index.js";

/** Drafts voice documents from imported post history. The result lives on the job; the owner accepts it in the app. */
export const voiceBuild: Handler = async ({ job, provider, db }) => {
  const history = await db.getPostHistory(job.brand_id, 60);
  if (history.length < 5) throw new Error(`need at least 5 imported posts, have ${history.length}. Use Import history first.`);
  const r = await runAgent(provider, voiceBuilderAgent, voicePrompt(history));
  if (r.data.status === "needs_info") throw new Error(`voice_builder needs: ${r.data.missing.join("; ")}`);
  return { result: { posts_used: history.length, voice_guide_md: r.data.voice_guide_md, banned_words_md: r.data.banned_words_md, hook_library_md: r.data.hook_library_md }, runs: [{ agentKey: voiceBuilderAgent.key, run: r }] };
};
