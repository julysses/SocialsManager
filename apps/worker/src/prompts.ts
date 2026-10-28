import { LIMITS, PLATFORMS, PLATFORM_LABEL, fullText, type Variants } from "@socialos/agents";
import type { HistoryRow, ImageRow, ItemRow } from "./types.js";

const section = (title: string, body: string | undefined) => `## ${title}\n${body?.trim() ? body.trim() : "(empty: no guidance written yet)"}\n`;

export function knowledgeBlock(kn: Record<string, string>, keys: string[]): string {
  return keys.map((k) => section(k, kn[k])).join("\n");
}

export const PACKAGER_KNOWLEDGE = [
  "voice/voice-guide.md", "voice/banned-words.md", "content/editorial-rules.md",
  "platforms/instagram-rules.md", "platforms/x-rules.md", "platforms/threads-rules.md", "platforms/bluesky-rules.md", "hooks/hook-library.md",
];
export const CHECKER_KNOWLEDGE = ["voice/voice-guide.md", "voice/banned-words.md", "content/editorial-rules.md"];

export interface PromptImage { id: string; path: string }

export function packagerPrompt(item: ItemRow, kn: Record<string, string>, images: PromptImage[], feedback = ""): string {
  return [
    "Package this edition for all five platforms.",
    "",
    "# Owner's input (source of truth)",
    section("Story note", item.story_note ?? undefined),
    section("Draft caption from ChatGPT", item.gpt_caption ?? undefined),
    `# Images (${images.length}). Read each one with the Read tool and place every one in "slides" exactly once.`,
    ...images.map((i) => `- ${i.id}: ${i.path}`),
    ...(feedback.trim() ? ["", "# Owner feedback on the previous attempt (apply it; it does not override the rules)", feedback.trim(), ""] : []),
    "",
    "# Brand knowledge",
    knowledgeBlock(kn, PACKAGER_KNOWLEDGE),
  ].join("\n");
}

export function variantsBlock(v: Variants): string {
  return PLATFORMS.map((p) => {
    const text = fullText(v[p].text, v[p].hashtags);
    return `### ${PLATFORM_LABEL[p]} (${text.length}/${LIMITS[p]} characters)\n${text}`;
  }).join("\n\n");
}

export function slidesBlock(slides: Pick<ImageRow, "position" | "role" | "label">[]): string {
  return slides.map((s) => `${s.position}. ${s.role}: ${s.label ?? "(unlabeled)"}`).join("\n");
}

export function checkerPrompt(item: ItemRow, v: Variants, kn: Record<string, string>, slides: Pick<ImageRow, "position" | "role" | "label">[]): string {
  return [
    "Review these proposed platform texts.",
    "",
    "# Owner's original input",
    section("Story note", item.story_note ?? undefined),
    section("Draft caption from ChatGPT", item.gpt_caption ?? undefined),
    "# Carousel slides, in order",
    slidesBlock(slides),
    "",
    "# Proposed texts (hashtags included in the counts)",
    variantsBlock(v),
    "",
    "# Brand knowledge",
    knowledgeBlock(kn, CHECKER_KNOWLEDGE),
  ].join("\n");
}

export function voicePrompt(history: HistoryRow[]): string {
  const lines = history.map((h, i) => {
    const m = Object.entries(h.metrics ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}=${v}`).join(", ");
    return `${i + 1}. [${h.platform}${h.posted_at ? ` ${h.posted_at.slice(0, 10)}` : ""}${m ? ` | ${m}` : ""}] ${h.text.replace(/\s+/g, " ").trim()}`;
  });
  return `Build the voice documents from these ${history.length} past posts:\n\n${lines.join("\n")}`;
}
