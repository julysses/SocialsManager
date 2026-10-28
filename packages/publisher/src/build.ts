import type { BrandSettings, Platform, PublishItem, PublishPayload, PublishVariant } from "./types.js";

/** Platform image limits. X and Bluesky take 4; Instagram and Facebook up to 10. */
const MAX_IMAGES: Partial<Record<string, number>> = { x: 4, bluesky: 4, threads: 20, instagram: 10, facebook: 10 };

export class PublishRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishRefused";
  }
}

export interface BuildInput {
  item: PublishItem;
  variants: PublishVariant[];
  settings: BrandSettings;
  /** True when an approving row exists (approved / edited_approved) for this item. */
  hasApproval: boolean;
  now?: Date;
}

export interface BuildOutput {
  /** Platforms the publisher posts or schedules itself. */
  auto: PublishPayload[];
  /** Platforms the owner posts by hand (X). Never sent anywhere by code. */
  manual: PublishPayload[];
}

/**
 * Builds publish payloads from database rows only. Refuses unless the item is `scheduled` AND has an approval.
 * Platforms with a `phase` marker in brand settings (not yet enabled) are skipped.
 */
export function buildPayloads({ item, variants, settings, hasApproval, now = new Date() }: BuildInput): BuildOutput {
  if (item.status !== "scheduled") throw new PublishRefused(`item is "${item.status}", not "scheduled"`);
  if (!hasApproval) throw new PublishRefused("no approval on record for this item");
  const all = item.image_paths?.length ? item.image_paths : item.source_image_path ? [item.source_image_path] : [];
  if (all.length === 0) throw new PublishRefused("item has no image");

  const when = new Date(item.planned_for ?? now).toISOString();
  const auto: PublishPayload[] = [];
  const manual: PublishPayload[] = [];
  const platforms = settings.platforms ?? {};

  for (const v of variants) {
    const cfg = platforms[v.platform as Platform];
    if (!cfg || cfg.phase !== undefined || cfg.via === "later" || cfg.via === "api") continue;
    const post: PublishPayload = {
      platform: v.platform,
      format: "post",
      text: v.text,
      hashtags: v.hashtags,
      alt_text: v.alt_text,
      image_path: all[0]!,
      image_paths: all.slice(0, MAX_IMAGES[v.platform] ?? 10),
      scheduled_for: when,
    };
    (cfg.via === "manual" ? manual : auto).push(post);
  }

  // Each edition's Story goes to both Facebook and Instagram (automatic or by hand, per that platform's setting).
  if (platforms.instagram?.story_to_both) {
    for (const platform of ["instagram", "facebook"] as const) {
      const cfg = platforms[platform];
      if (!cfg || cfg.via === "later" || cfg.via === "api" || !variants.some((v) => v.platform === platform)) continue;
      const story: PublishPayload = {
        platform, format: "story", text: "", hashtags: [],
        alt_text: variants.find((v) => v.platform === platform)?.alt_text ?? null,
        image_path: all[0]!, image_paths: [all[0]!], scheduled_for: when,
      };
      (cfg.via === "manual" ? manual : auto).push(story);
    }
  }
  return { auto, manual };
}
