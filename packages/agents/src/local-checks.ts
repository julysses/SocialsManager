import { LIMITS, PLATFORMS, fullText } from "./platforms.js";
import type { Flag, Variants } from "./schemas.js";

/** Parse a banned-words markdown file: one term per line, optional bullets, `#` lines are headings/comments. */
export function parseBannedWords(md: string): string[] {
  return md
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.toLowerCase());
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Deterministic checks the model can't be trusted with: platform length limits and banned words. */
export function localChecks(variants: Variants, bannedWords: readonly string[]): Flag[] {
  const flags: Flag[] = [];
  for (const p of PLATFORMS) {
    const v = variants[p];
    const body = fullText(v.text, v.hashtags);
    if (body.length > LIMITS[p]) {
      flags.push({ type: "too_long", platform: p, detail: `${body.length} characters; the limit is ${LIMITS[p]}` });
    }
    const lower = body.toLowerCase();
    for (const w of bannedWords) {
      if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, "iu").test(lower)) {
        flags.push({ type: "banned_word", platform: p, detail: `contains banned word "${w}"` });
      }
    }
  }
  return flags;
}
