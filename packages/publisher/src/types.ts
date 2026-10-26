export type Platform = "instagram" | "facebook" | "x" | "threads" | "bluesky" | "tiktok" | "youtube_shorts" | "linkedin" | "pinterest";

export interface PublishItem {
  id: string;
  brand_id: string;
  status: string;
  planned_for: string | null;
  source_image_path: string | null;
}

export interface PublishVariant {
  platform: Platform;
  text: string;
  hashtags: string[];
  alt_text: string | null;
}

export interface BrandSettings {
  publish_mode?: "dry_run" | "live";
  platforms?: Record<string, { via?: "metricool" | "manual" | "api" | "later"; story_to_both?: boolean; phase?: number }>;
}

export interface PublishPayload {
  platform: Platform;
  format: "post" | "story";
  text: string;
  hashtags: string[];
  alt_text: string | null;
  /** Storage path of the cartoon. */
  image_path: string;
  scheduled_for: string;
}

export interface PublishResult {
  status: "scheduled" | "posted" | "failed";
  external_post_id?: string;
  external_url?: string;
  error?: string;
}

export interface PublishAdapter {
  readonly mode: "dry_run" | "live";
  publish(payload: PublishPayload): Promise<PublishResult>;
}
