import { PublishRefused, buildPayloads, selectAdapter, type PublishVariant } from "@socialos/publisher";
import type { Handler } from "./index.js";

/**
 * Plain code, no LLM. Builds payloads from database rows only and hands them to the adapter for the brand's
 * publish_mode (dry_run by default). Refuses unless the item is `scheduled` with an approval.
 */
export const publish: Handler = async ({ job, db, log }) => {
  const itemId = String(job.payload.content_item_id ?? job.content_item_id ?? "");
  const item = itemId ? await db.getItem(itemId) : null;
  if (!item) throw new Error(`content item ${itemId || "(missing)"} not found`);
  const brand = await db.getBrand(item.brand_id);
  if (!brand) throw new Error("brand not found");

  const variants = (await db.getVariants(item.id)) as PublishVariant[];
  const hasApproval = await db.hasApproval(item.id);
  let built;
  try {
    const images = (await db.getImages(item.id)).map((i) => i.storage_path);
    built = buildPayloads({ item: { ...item, image_paths: images }, variants, settings: brand.settings, hasApproval });
  } catch (e) {
    if (e instanceof PublishRefused) throw new Error(`publish refused: ${e.message}`);
    throw e;
  }

  const adapter = selectAdapter(brand.settings);
  const existing = await db.getPublications(item.id);
  const done: string[] = [];
  for (const payload of built.auto) {
    const dupe = existing.some((p) => p.platform === payload.platform && p.format === payload.format && p.mode === adapter.mode && p.status !== "failed");
    if (dupe) continue;
    const res = await adapter.publish(payload);
    await db.insertPublication({
      brand_id: item.brand_id,
      content_item_id: item.id,
      platform: payload.platform,
      format: payload.format,
      mode: adapter.mode,
      status: res.status,
      scheduled_for: payload.scheduled_for,
      payload,
      error: res.error ?? null,
      external_post_id: res.external_post_id ?? null,
      external_url: res.external_url ?? null,
    });
    done.push(`${payload.platform}:${payload.format}`);
  }
  log(`item ${item.id}: ${adapter.mode} publish recorded ${done.join(", ") || "nothing new"}`);
  return { result: { mode: adapter.mode, recorded: done, manual: built.manual.map((p) => p.platform) }, runs: [] };
};
