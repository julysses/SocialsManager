import { BLOCKING_FLAGS, PLATFORMS, brandCheckerAgent, captionPackagerAgent, localChecks, parseBannedWords, runAgent, type Flag, type Variants } from "@socialos/agents";
import { checkerPrompt, packagerPrompt } from "../prompts.js";
import type { Handler, HandlerRun } from "./index.js";

/**
 * Upload -> drafts. 1) caption_packager writes per-platform variants. 2) brand_checker (separate call, different
 * system prompt) plus deterministic length/banned-word checks review them. A 'fixed' rewrite is re-checked once.
 * Passed/fixed items go to `queued`; failed items go to `checked` for the owner. Nothing here can approve or publish.
 */
export const captionPackage: Handler = async ({ job, provider, db, log }) => {
  const itemId = String(job.payload.content_item_id ?? job.content_item_id ?? "");
  const item = itemId ? await db.getItem(itemId) : null;
  if (!item) throw new Error(`content item ${itemId || "(missing)"} not found`);
  if (!item.source_image_path) throw new Error("content item has no image");
  if (item.status === "approved" || item.status === "scheduled" || item.status === "live") {
    throw new Error(`item is already ${item.status}; refusing to re-package`);
  }

  const kn = await db.getKnowledge(item.brand_id);
  const banned = parseBannedWords(kn["voice/banned-words.md"] ?? "");
  const image = await db.downloadImage(item.source_image_path);
  const runs: HandlerRun[] = [];

  const pack = await runAgent(provider, captionPackagerAgent, packagerPrompt(item, kn, image, String(job.payload.feedback ?? "")), [image]);
  runs.push({ agentKey: captionPackagerAgent.key, run: pack });
  if (pack.data.status === "needs_info") {
    throw new Error(`caption_packager needs more information: ${pack.data.missing.join("; ")}`);
  }
  const packaged = pack.data;

  const review = async (variants: Variants) => {
    const local = localChecks(variants, banned);
    const r = await runAgent(provider, brandCheckerAgent, checkerPrompt(item, variants, kn));
    runs.push({ agentKey: brandCheckerAgent.key, run: r });
    if (r.data.status === "needs_info") throw new Error(`brand_checker needs more information: ${r.data.missing.join("; ")}`);
    return { r: r.data, local, ms: r.durationMs, model: r.model };
  };

  let final: Variants = packaged.variants;
  let first = await review(final);
  let flags: Flag[] = dedupe([...first.local, ...first.r.flags]);
  let score = first.r.voice_score;
  let verdict: "passed" | "fixed" | "failed";
  let fixedText: Variants | null = null;
  let ms = first.ms;
  const blocking = (f: Flag[]) => f.some((x) => BLOCKING_FLAGS.has(x.type));

  if (first.r.verdict === "passed" && !blocking(flags)) {
    verdict = "passed";
  } else if (first.r.rewrite) {
    // One re-check of the rewrite. If it still has blocking problems, hand it back to the owner.
    const second = await review(first.r.rewrite);
    const flags2 = dedupe([...second.local, ...second.r.flags]);
    ms += second.ms;
    if (!blocking(flags2) && second.r.verdict !== "failed") {
      verdict = "fixed";
      fixedText = first.r.rewrite;
      final = first.r.rewrite;
      score = second.r.voice_score;
      flags = dedupe([...flags, ...flags2]);
    } else {
      verdict = "failed";
      flags = dedupe([...flags, ...flags2]);
    }
  } else {
    verdict = "failed";
  }
  if (verdict === "failed" && !blocking(flags) && first.r.verdict === "failed") {
    flags = [...flags, { type: "other", detail: "The checker could not repair this edition without changing your point. Edit it or ask for changes." }];
  }

  await db.upsertVariants(item.brand_id, item.id, PLATFORMS.map((p) => ({ platform: p, text: final[p].text, hashtags: final[p].hashtags, alt_text: packaged.alt_text })));
  await db.insertCheck({ brand_id: item.brand_id, content_item_id: item.id, voice_score: score, flags, verdict, fixed_text: fixedText, model: first.model ?? null, latency_ms: ms });
  await db.updateItem(item.id, { status: verdict === "failed" ? "checked" : "queued", change_note: packaged.change_note });
  log(`item ${item.id}: ${verdict}`);
  return { result: { content_item_id: item.id, verdict, voice_score: score, flags: flags.length }, runs };
};

function dedupe(flags: Flag[]): Flag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.type}|${f.platform ?? ""}|${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
