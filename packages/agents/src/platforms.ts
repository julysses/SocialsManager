export const PLATFORMS = ["instagram", "facebook", "x", "threads", "bluesky"] as const;
export type CaptionPlatform = (typeof PLATFORMS)[number];

/** Character limits enforced in code (the model is also told them). X and Bluesky are hard limits from the PRD. */
export const LIMITS: Record<CaptionPlatform, number> = {
  instagram: 2200,
  facebook: 5000,
  x: 280,
  threads: 500,
  bluesky: 300,
};

export const PLATFORM_LABEL: Record<CaptionPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  threads: "Threads",
  bluesky: "Bluesky",
};

/** Text exactly as it will be posted: body plus hashtags (hashtags on their own line). */
export function fullText(text: string, hashtags: readonly string[]): string {
  const tags = hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return tags ? `${text.trimEnd()}\n\n${tags}` : text;
}
