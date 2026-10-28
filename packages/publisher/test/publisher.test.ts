import { describe, expect, it } from "vitest";
import { DryRunAdapter, LiveAdapter, PublishRefused, buildPayloads, selectAdapter, type PublishItem, type PublishVariant } from "../src/index.js";

const settings = {
  publish_mode: "dry_run" as const,
  platforms: {
    instagram: { via: "metricool" as const, story_to_both: true },
    facebook: { via: "metricool" as const },
    x: { via: "manual" as const },
    threads: { via: "api" as const, phase: 3 },
    bluesky: { via: "api" as const, phase: 3 },
  },
};
const item = (over: Partial<PublishItem> = {}): PublishItem => ({ id: "i1", brand_id: "b1", status: "scheduled", planned_for: "2026-11-01T14:00:00Z", source_image_path: "b1/a.png", ...over });
const six = ["b1/1.png", "b1/2.png", "b1/3.png", "b1/4.png", "b1/5.png", "b1/6.png"];
const v = (platform: PublishVariant["platform"]): PublishVariant => ({ platform, text: `text ${platform}`, hashtags: ["a"], alt_text: "alt" });
const all = (["instagram", "facebook", "x", "threads", "bluesky"] as const).map(v);

describe("buildPayloads", () => {
  it("refuses unless scheduled", () => {
    for (const status of ["draft", "queued", "approved", "live"]) {
      expect(() => buildPayloads({ item: item({ status }), variants: all, settings, hasApproval: true })).toThrow(PublishRefused);
    }
  });
  it("refuses without an approval", () => {
    expect(() => buildPayloads({ item: item(), variants: all, settings, hasApproval: false })).toThrow(/no approval/);
  });
  it("refuses an item without an image", () => {
    expect(() => buildPayloads({ item: item({ source_image_path: null }), variants: all, settings, hasApproval: true })).toThrow(/no image/);
  });
  it("builds IG + FB posts, Story to both, X as manual, skips phase-3 platforms", () => {
    const { auto, manual } = buildPayloads({ item: item(), variants: all, settings, hasApproval: true });
    expect(auto.map((p) => `${p.platform}:${p.format}`).sort()).toEqual(["facebook:post", "facebook:story", "instagram:post", "instagram:story"]);
    expect(manual.map((p) => p.platform)).toEqual(["x"]);
    expect(auto.every((p) => p.scheduled_for === "2026-11-01T14:00:00.000Z")).toBe(true);
    expect(auto.find((p) => p.format === "story")!.text).toBe("");
  });
  it("only uses the text from the database rows", () => {
    const { auto } = buildPayloads({ item: item(), variants: all, settings, hasApproval: true });
    expect(auto.find((p) => p.platform === "instagram" && p.format === "post")!.text).toBe("text instagram");
  });
});

describe("hand-off (free Metricool plan: Instagram and Facebook posted by hand)", () => {
  const handoff = { ...settings, platforms: { ...settings.platforms, instagram: { via: "manual" as const, story_to_both: true }, facebook: { via: "manual" as const } } };
  it("sends nothing automatically and lists every post and Story for the owner", () => {
    const { auto, manual } = buildPayloads({ item: item(), variants: all, settings: handoff, hasApproval: true });
    expect(auto).toEqual([]);
    expect(manual.map((p) => `${p.platform}:${p.format}`).sort()).toEqual(["facebook:post", "facebook:story", "instagram:post", "instagram:story", "x:post"]);
  });
});

describe("carousels", () => {
  it("sends all slides in order to Instagram/Facebook, caps X at 4, and Stories carry only the cover", () => {
    const handoff = { ...settings, platforms: { ...settings.platforms, instagram: { via: "manual" as const, story_to_both: true }, facebook: { via: "manual" as const } } };
    const { manual } = buildPayloads({ item: item({ image_paths: six, source_image_path: six[0]! }), variants: all, settings: handoff, hasApproval: true });
    const by = (platform: string, format: string) => manual.find((p) => p.platform === platform && p.format === format)!;
    expect(by("instagram", "post").image_paths).toEqual(six);
    expect(by("facebook", "post").image_paths).toEqual(six);
    expect(by("x", "post").image_paths).toEqual(six.slice(0, 4));
    expect(by("instagram", "story").image_paths).toEqual([six[0]]);
    expect(by("instagram", "post").image_path).toBe("b1/1.png");
  });
  it("still works for single-image items", () => {
    const { auto } = buildPayloads({ item: item(), variants: all, settings, hasApproval: true });
    expect(auto[0]!.image_paths).toEqual(["b1/a.png"]);
  });
});

describe("adapters", () => {
  it("defaults to dry run and never goes live unless the owner set live", async () => {
    expect(selectAdapter({}).mode).toBe("dry_run");
    expect(selectAdapter({ publish_mode: "dry_run" })).toBeInstanceOf(DryRunAdapter);
    expect(selectAdapter({ publish_mode: "live" })).toBeInstanceOf(LiveAdapter);
  });
  it("dry run only reports a scheduled status", async () => {
    expect(await new DryRunAdapter().publish({} as never)).toEqual({ status: "scheduled" });
  });
  it("live adapter refuses until enabled", async () => {
    await expect(new LiveAdapter().publish({} as never)).rejects.toThrow(/not enabled/);
  });
});
