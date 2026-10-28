import type { AgentRunRow, BrandRow, CheckRow, HistoryRow, ImageRow, ItemRow, Job, PublicationRow, VariantRow, WorkerDb } from "../src/types.js";

/** In-memory WorkerDb. Mirrors the real gate: the item must already be approved/scheduled for publications. */
export class FakeDb implements WorkerDb {
  queue: Job[] = [];
  calls: { fn: string; args: unknown[] }[] = [];
  runs: AgentRunRow[] = [];
  items = new Map<string, ItemRow>();
  brand: BrandRow = {
    id: "b1", name: "Daily Heckler", timezone: "America/Chicago",
    settings: { publish_mode: "dry_run", platforms: { instagram: { via: "metricool", story_to_both: true }, facebook: { via: "metricool" }, x: { via: "manual" }, threads: { via: "api", phase: 3 }, bluesky: { via: "api", phase: 3 } } },
  };
  knowledge: Record<string, string> = {};
  variants = new Map<string, VariantRow[]>();
  checks: CheckRow[] = [];
  history: HistoryRow[] = [];
  approved = new Set<string>();
  publications: PublicationRow[] = [];
  downloads: string[] = [];
  images = new Map<string, ImageRow[]>();

  async requeueStuck() { return 0; }
  async claim() { return this.queue.splice(0, 5); }
  async succeed(...args: [string, unknown]) { this.calls.push({ fn: "succeed", args }); }
  async fail(...args: [string, string, Date | null, boolean?]) { this.calls.push({ fn: "fail", args }); }
  async insertAgentRun(r: AgentRunRow) { this.runs.push(r); }
  async getItem(id: string) { return this.items.get(id) ?? null; }
  async getBrand() { return this.brand; }
  async getKnowledge() { return this.knowledge; }
  async downloadImage(path: string) { this.downloads.push(path); return `/tmp/fake/${path.split("/").pop()}`; }
  async getVariants(id: string) { return this.variants.get(id) ?? []; }
  async upsertVariants(_b: string, id: string, rows: VariantRow[]) { this.variants.set(id, rows); }
  async insertCheck(r: CheckRow) { this.checks.push(r); }
  async getImages(id: string) { return [...(this.images.get(id) ?? [])].sort((a, b) => a.position - b.position); }
  async setImages(_b: string, id: string, rows: ImageRow[]) { this.images.set(id, rows); }
  async updateItem(id: string, patch: { status?: string; source_image_path?: string | null; change_note?: string | null }) {
    const it = this.items.get(id)!;
    if (patch.status) it.status = patch.status;
    if (patch.source_image_path) it.source_image_path = patch.source_image_path;
    this.calls.push({ fn: "updateItem", args: [id, patch] });
  }
  async getPostHistory() { return this.history; }
  async hasApproval(id: string) { return this.approved.has(id); }
  async getPublications() { return this.publications; }
  async insertPublication(r: PublicationRow) {
    const it = this.items.get(r.content_item_id);
    if (!it || !["approved", "scheduled", "live"].includes(it.status)) throw new Error("cannot publish unapproved item");
    this.publications.push(r);
  }
}

export const item = (over: Partial<ItemRow> = {}): ItemRow => ({
  id: "i1", brand_id: "b1", title: "Test", story_note: "Senate fights over the budget again", gpt_caption: "They said it was a hole. It's a canyon.",
  source_image_path: "b1/cartoon.png", status: "draft", planned_for: null, ...over,
});

export const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", brand_id: "b1", content_item_id: "i1", kind: "hello", payload: {}, attempts: 1, max_attempts: 3, ...over,
});

const v = (text: string, hashtags: string[] = []) => ({ text, hashtags });
export const goodVariants = () => ({
  instagram: v("They said it was a hole. It's a canyon.", ["senate", "budget", "politicalcartoon"]),
  facebook: v("They said it was a hole. It's a canyon.", ["budget"]),
  x: v("They said it was a hole. It's a canyon."),
  threads: v("They said it was a hole. It's a canyon."),
  bluesky: v("They said it was a hole. It's a canyon."),
});
export const slide = (image: string, role: "cover" | "detail" = "detail", label = "a panel") => ({ image, role, label, alt_text: `Alt text for ${image}.` });
export const packagerReply = (variants = goodVariants(), slides = [slide("img1", "cover", "the full cartoon")]) =>
  JSON.stringify({ status: "ok", slides, variants, change_note: "Added hashtags to Instagram." });
export const checkerReply = (o: Record<string, unknown> = {}) => JSON.stringify({ status: "ok", voice_score: 3, flags: [], verdict: "passed", ...o });
