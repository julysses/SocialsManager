import { describe, expect, it } from "vitest";
import { MockProvider } from "@socialos/agents";
import { processJob } from "../src/process.js";
import { FakeDb, checkerReply, goodVariants, item, job, packagerReply, slide } from "./fake-db.js";

const scripted = (...replies: string[]) => new MockProvider((_r, n) => replies[Math.min(n - 1, replies.length - 1)]!);

function setup(over: Partial<ReturnType<typeof item>> = {}) {
  const db = new FakeDb();
  db.items.set("i1", item(over));
  return db;
}

describe("caption_package", () => {
  it("packages, checks (passed) and queues the item", async () => {
    const db = setup();
    const p = scripted(packagerReply(), checkerReply());
    const out = await processJob(job({ kind: "caption_package", payload: { content_item_id: "i1" } }), { db, provider: p });
    expect(out).toBe("succeeded");
    expect(db.items.get("i1")!.status).toBe("queued");
    expect(db.variants.get("i1")).toHaveLength(5);
    expect(db.checks[0]).toMatchObject({ verdict: "passed", voice_score: 3 });
    expect(db.downloads).toEqual(["b1/cartoon.png"]);
    expect((await db.getImages("i1")).map((s) => s.role)).toEqual(["cover"]);
    expect(db.runs.map((r) => r.agent_key)).toEqual(["caption_packager", "brand_checker"]);
    // the checker is a separate call with a different system prompt
    expect(p.calls[0]!.system).not.toBe(p.calls[1]!.system);
    expect(p.calls[0]!.attachments).toEqual(["/tmp/fake/cartoon.png"]);
  });

  it("passes the owner's feedback into the packager prompt", async () => {
    const db = setup();
    const p = scripted(packagerReply(), checkerReply());
    await processJob(job({ kind: "caption_package", payload: { content_item_id: "i1", feedback: "make X punchier" } }), { db, provider: p });
    expect(p.calls[0]!.prompt).toContain("make X punchier");
  });

  it("applies a fixed rewrite after one re-check and records the 'fixed' verdict", async () => {
    const db = setup();
    const rewrite = goodVariants();
    rewrite.x.text = "Fixed shorter line.";
    const p = scripted(
      packagerReply(),
      checkerReply({ verdict: "fixed", flags: [{ type: "unsupported_claim", platform: "x", detail: "adds a claim" }], rewrite }),
      checkerReply(),
    );
    await processJob(job({ kind: "caption_package", payload: { content_item_id: "i1" } }), { db, provider: p });
    expect(p.calls).toHaveLength(3);
    expect(db.checks[0]).toMatchObject({ verdict: "fixed" });
    expect(db.checks[0]!.fixed_text).toMatchObject({ x: { text: "Fixed shorter line." } });
    expect(db.variants.get("i1")!.find((v) => v.platform === "x")!.text).toBe("Fixed shorter line.");
    expect(db.items.get("i1")!.status).toBe("queued");
  });

  it("fails the check (item goes back to the owner) when the rewrite still has blocking flags", async () => {
    const db = setup();
    const bad = { type: "defamation_risk", detail: "states an allegation as fact" };
    const p = scripted(packagerReply(), checkerReply({ verdict: "fixed", flags: [bad], rewrite: goodVariants() }), checkerReply({ verdict: "failed", flags: [bad] }));
    await processJob(job({ kind: "caption_package", payload: { content_item_id: "i1" } }), { db, provider: p });
    expect(db.checks[0]).toMatchObject({ verdict: "failed" });
    expect(db.items.get("i1")!.status).toBe("checked");
  });

  it("enforces platform limits and banned words in code even if the model says passed", async () => {
    const db = setup();
    db.knowledge["voice/banned-words.md"] = "# Banned words\n- canyon\n";
    const long = goodVariants();
    long.x.text = "x".repeat(300);
    const p = scripted(packagerReply(long), checkerReply());
    await processJob(job({ kind: "caption_package", payload: { content_item_id: "i1" } }), { db, provider: p });
    expect(db.checks[0]!.verdict).toBe("failed");
    const flags = db.checks[0]!.flags as { type: string }[];
    expect(flags.map((f) => f.type)).toEqual(expect.arrayContaining(["too_long", "banned_word"]));
    expect(db.items.get("i1")!.status).toBe("checked");
  });

  it("refuses to re-package an item that is already approved or scheduled", async () => {
    const db = setup({ status: "scheduled" });
    const p = scripted(packagerReply());
    await processJob(job({ kind: "caption_package", payload: { content_item_id: "i1" }, attempts: 3 }), { db, provider: p });
    expect(p.calls).toHaveLength(0);
    expect(db.runs[0]!.error).toMatch(/already scheduled/);
  });

  it("fails cleanly when the packager needs more information", async () => {
    const db = setup();
    const p = scripted(JSON.stringify({ status: "needs_info", missing: ["who is the senator"] }));
    await processJob(job({ kind: "caption_package", payload: { content_item_id: "i1" }, attempts: 3 }), { db, provider: p });
    expect(db.runs.at(-1)!.error).toMatch(/needs more information: who is the senator/);
    expect(db.items.get("i1")!.status).toBe("draft");
  });
});

describe("caption_package with a carousel", () => {
  const three = () => {
    const db = new FakeDb();
    db.items.set("i1", item({ source_image_path: "b1/a.png" }));
    db.images.set("i1", ["a", "b", "c"].map((n, i) => ({ storage_path: `b1/${n}.png`, position: i + 1, role: "other" as const, label: null, alt_text: null })));
    return db;
  };
  const jobOf = () => job({ kind: "caption_package", payload: { content_item_id: "i1" } });

  it("shows the model every image and stores the order, roles, labels and the new cover", async () => {
    const db = three();
    const reply = packagerReply(goodVariants(), [slide("img3", "cover", "the full cartoon"), slide("img1", "detail", "the empty purse"), slide("img2", "detail", "the knife")]);
    const p = new MockProvider((_r, n) => (n === 1 ? reply : checkerReply()));
    expect(await processJob(jobOf(), { db, provider: p })).toBe("succeeded");
    expect(db.downloads).toEqual(["b1/a.png", "b1/b.png", "b1/c.png"]);
    expect(p.calls[0]!.attachments).toHaveLength(3);
    expect(p.calls[0]!.prompt).toContain("img3:");
    const stored = await db.getImages("i1");
    expect(stored.map((s) => `${s.position}:${s.storage_path}:${s.role}:${s.label}`)).toEqual([
      "1:b1/c.png:cover:the full cartoon", "2:b1/a.png:detail:the empty purse", "3:b1/b.png:detail:the knife",
    ]);
    expect(db.items.get("i1")!.source_image_path).toBe("b1/c.png");
    expect(db.variants.get("i1")![0]!.alt_text).toBe("Alt text for img3.");
    expect(p.calls[1]!.prompt).toContain("2. detail: the empty purse");
  });

  it("rejects an order that drops or repeats an image", async () => {
    for (const slides of [[slide("img1", "cover"), slide("img2")], [slide("img1", "cover"), slide("img1"), slide("img2"), slide("img3")], [slide("img1", "cover"), slide("img2"), slide("img9")]]) {
      const db = three();
      await processJob({ ...jobOf(), attempts: 3 }, { db, provider: new MockProvider(() => packagerReply(goodVariants(), slides)) });
      expect(db.runs.at(-1)!.error).toMatch(/left out|twice|unknown image/);
      expect(db.items.get("i1")!.status).toBe("draft");
      expect((await db.getImages("i1")).map((s) => s.role)).toEqual(["other", "other", "other"]);
    }
  });
});

describe("voice_build", () => {
  const reply = JSON.stringify({ status: "ok", voice_guide_md: "# Voice guide\n\n## Persona\nDry and sharp.", banned_words_md: "# Banned words\n- x", hook_library_md: "# Hook library\n1. ..." });
  it("needs at least 5 imported posts", async () => {
    const db = setup();
    db.history = [{ platform: "x", text: "one", posted_at: null, metrics: {} }];
    await processJob(job({ kind: "voice_build", attempts: 3 }), { db, provider: scripted(reply) });
    expect(db.runs[0]!.error).toMatch(/at least 5/);
  });
  it("returns the drafted documents on the job result and never writes knowledge files", async () => {
    const db = setup();
    db.history = Array.from({ length: 6 }, (_, i) => ({ platform: "x", text: `post ${i}`, posted_at: "2026-01-01T00:00:00Z", metrics: { likes: i } }));
    await processJob(job({ kind: "voice_build" }), { db, provider: scripted(reply) });
    const done = db.calls.find((c) => c.fn === "succeed")!;
    expect(done.args[1]).toMatchObject({ posts_used: 6, voice_guide_md: expect.stringContaining("Voice guide") });
    expect(db.knowledge).toEqual({});
  });
});

describe("publish (dry run)", () => {
  const publishJob = job({ kind: "publish", payload: { content_item_id: "i1" } });
  const ready = () => {
    const db = setup({ status: "scheduled", planned_for: "2026-11-01T14:00:00Z" });
    db.variants.set("i1", (["instagram", "facebook", "x", "threads", "bluesky"] as const).map((platform) => ({ platform, text: `t ${platform}`, hashtags: ["a"], alt_text: "alt" })));
    db.images.set("i1", [{ storage_path: "b1/cartoon.png", position: 1, role: "cover", label: null, alt_text: null }]);
    db.approved.add("i1");
    return db;
  };

  it("refuses when the item has no approval", async () => {
    const db = ready();
    db.approved.clear();
    await processJob({ ...publishJob, attempts: 3 }, { db, provider: new MockProvider() });
    expect(db.publications).toHaveLength(0);
    expect(db.runs[0]!.error).toMatch(/publish refused: no approval/);
  });

  it("refuses when the item is not scheduled", async () => {
    const db = ready();
    db.items.get("i1")!.status = "approved";
    await processJob({ ...publishJob, attempts: 3 }, { db, provider: new MockProvider() });
    expect(db.publications).toHaveLength(0);
    expect(db.runs[0]!.error).toMatch(/not "scheduled"/);
  });

  it("records dry-run publications for IG + FB posts and Stories, leaves X manual, and never calls the model", async () => {
    const db = ready();
    const p = new MockProvider();
    expect(await processJob(publishJob, { db, provider: p })).toBe("succeeded");
    expect(p.calls).toHaveLength(0);
    expect(db.publications.map((x) => `${x.platform}:${x.format}:${x.mode}:${x.status}`).sort()).toEqual([
      "facebook:post:dry_run:scheduled", "facebook:story:dry_run:scheduled", "instagram:post:dry_run:scheduled", "instagram:story:dry_run:scheduled",
    ]);
  });

  it("is idempotent: running twice does not duplicate publications", async () => {
    const db = ready();
    await processJob(publishJob, { db, provider: new MockProvider() });
    await processJob(publishJob, { db, provider: new MockProvider() });
    expect(db.publications).toHaveLength(4);
  });

  it("fails safely in live mode until live publishing is enabled", async () => {
    const db = ready();
    db.brand.settings.publish_mode = "live";
    await processJob({ ...publishJob, attempts: 3 }, { db, provider: new MockProvider() });
    expect(db.publications).toHaveLength(0);
    expect(db.runs[0]!.error).toMatch(/not enabled/);
  });
});

describe("end to end (mock model): upload -> drafts -> approve -> schedule -> dry-run publish", () => {
  it("walks the golden path without touching any platform", async () => {
    const db = setup();
    const p = scripted(packagerReply(), checkerReply());
    await processJob(job({ id: "j1", kind: "caption_package", payload: { content_item_id: "i1" } }), { db, provider: p });
    expect(db.items.get("i1")!.status).toBe("queued");
    // the owner approves and schedules in the app (database gate enforces this in Postgres)
    db.approved.add("i1");
    db.items.get("i1")!.status = "scheduled";
    await processJob(job({ id: "j2", kind: "publish", payload: { content_item_id: "i1" } }), { db, provider: p });
    expect(db.publications.length).toBeGreaterThan(0);
    expect(db.publications.every((x) => x.mode === "dry_run")).toBe(true);
  });
});
