import type { BrandSettings, PublishAdapter, PublishPayload, PublishResult } from "./types.js";

/** Records what WOULD be sent. Calls nothing. */
export class DryRunAdapter implements PublishAdapter {
  readonly mode = "dry_run" as const;
  async publish(_p: PublishPayload): Promise<PublishResult> {
    return { status: "scheduled" };
  }
}

/**
 * Live adapter. Intentionally not implemented until the Phase 2 gate: the Metricool capability probe
 * (docs/metricool-capabilities.md) must be done and the owner must flip `publish_mode` to "live".
 */
export class LiveAdapter implements PublishAdapter {
  readonly mode = "live" as const;
  async publish(_p: PublishPayload): Promise<PublishResult> {
    throw new Error("Live publishing is not enabled yet (Phase 2 gate: Metricool probe + owner go-ahead).");
  }
}

export function selectAdapter(settings: BrandSettings): PublishAdapter {
  return settings.publish_mode === "live" ? new LiveAdapter() : new DryRunAdapter();
}
