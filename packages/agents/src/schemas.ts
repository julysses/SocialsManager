import { z } from "zod";
import { PLATFORMS } from "./platforms.js";

const tag = z.string().min(1).max(60).transform((t) => t.replace(/^#/, "").replace(/\s+/g, ""));
const tags = z.array(tag).max(12).default([]);

export const variantSchema = z.object({ text: z.string().min(1), hashtags: tags });
export type Variant = z.infer<typeof variantSchema>;

export const variantsSchema = z.object({
  instagram: variantSchema,
  facebook: variantSchema,
  x: variantSchema,
  threads: variantSchema,
  bluesky: variantSchema,
});
export type Variants = z.infer<typeof variantsSchema>;

export const needsInfo = z.object({ status: z.literal("needs_info"), missing: z.array(z.string()).min(1) });

export const captionPackageOutput = z.union([
  z.object({
    status: z.literal("ok"),
    variants: variantsSchema,
    alt_text: z.string().min(1).max(1000),
    change_note: z.string().min(1).max(400),
  }),
  needsInfo,
]);
export type CaptionPackageOutput = z.infer<typeof captionPackageOutput>;

export const flagSchema = z.object({
  type: z.enum(["unsupported_claim", "defamation_risk", "too_long", "banned_word", "voice", "other"]),
  platform: z.enum(PLATFORMS).optional(),
  detail: z.string().min(1).max(400),
});
export type Flag = z.infer<typeof flagSchema>;

/** Flag types that stop an item from passing. "voice" and "other" are advisory. */
export const BLOCKING_FLAGS: ReadonlySet<Flag["type"]> = new Set(["unsupported_claim", "defamation_risk", "too_long", "banned_word"]);

export const brandCheckerOutput = z.union([
  z.object({
    status: z.literal("ok"),
    voice_score: z.number().int().min(0).max(3).nullable(),
    flags: z.array(flagSchema).max(30).default([]),
    verdict: z.enum(["passed", "fixed", "failed"]),
    rewrite: variantsSchema.optional(),
  }),
  needsInfo,
]);
export type BrandCheckerOutput = z.infer<typeof brandCheckerOutput>;

export const voiceBuilderOutput = z.union([
  z.object({
    status: z.literal("ok"),
    voice_guide_md: z.string().min(20),
    banned_words_md: z.string().min(1),
    hook_library_md: z.string().min(1),
  }),
  needsInfo,
]);
export type VoiceBuilderOutput = z.infer<typeof voiceBuilderOutput>;

