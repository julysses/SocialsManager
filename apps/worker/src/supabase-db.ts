import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunRow, BrandRow, CheckRow, HistoryRow, ImageRow, ItemRow, Job, PublicationRow, VariantRow, WorkerDb } from "./types.js";

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export class SupabaseDb implements WorkerDb {
  private readonly sb: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.sb = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async requeueStuck(): Promise<number> {
    return Number(must(await this.sb.rpc("requeue_stuck_jobs"), "requeue_stuck_jobs") ?? 0);
  }

  async claim(limit: number): Promise<Job[]> {
    return (must(await this.sb.rpc("claim_jobs", { p_limit: limit }), "claim_jobs") ?? []) as Job[];
  }

  async succeed(jobId: string, result: unknown): Promise<void> {
    must(await this.sb.from("jobs").update({ status: "succeeded", result, error: null, locked_at: null }).eq("id", jobId), "job succeed");
  }

  async fail(jobId: string, error: string, retryAt: Date | null, refundAttempt = false): Promise<void> {
    let attempts: number | undefined;
    if (refundAttempt) {
      const cur = must(await this.sb.from("jobs").select("attempts").eq("id", jobId).single(), "read attempts");
      attempts = Math.max(0, (cur as { attempts: number }).attempts - 1);
    }
    const patch: Record<string, unknown> = retryAt
      ? { status: "queued", run_after: retryAt.toISOString(), error, locked_at: null }
      : { status: "failed", error, locked_at: null };
    if (attempts !== undefined) patch.attempts = attempts;
    must(await this.sb.from("jobs").update(patch).eq("id", jobId), "job fail");
  }

  async insertAgentRun(row: AgentRunRow): Promise<void> {
    must(await this.sb.from("agent_runs").insert(row), "agent_runs insert");
  }

  async getItem(id: string): Promise<ItemRow | null> {
    const r = await this.sb.from("content_items").select("id,brand_id,title,story_note,gpt_caption,source_image_path,status,planned_for").eq("id", id).maybeSingle();
    return must(r, "get item") as ItemRow | null;
  }

  async getBrand(id: string): Promise<BrandRow | null> {
    return must(await this.sb.from("brands").select("id,name,timezone,settings").eq("id", id).maybeSingle(), "get brand") as BrandRow | null;
  }

  async getKnowledge(brandId: string): Promise<Record<string, string>> {
    const rows = must(await this.sb.from("knowledge_files").select("folder,filename,content_md").eq("brand_id", brandId), "get knowledge") as { folder: string; filename: string; content_md: string }[];
    return Object.fromEntries(rows.map((r) => [`${r.folder}/${r.filename}`, r.content_md]));
  }

  async downloadImage(path: string): Promise<string> {
    const { data, error } = await this.sb.storage.from("cartoons").download(path);
    if (error || !data) throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
    const dir = await mkdtemp(join(tmpdir(), "socialos-"));
    const file = join(dir, basename(path).replace(/[^A-Za-z0-9._-]/g, "_"));
    await writeFile(file, Buffer.from(await data.arrayBuffer()));
    return file;
  }

  async getVariants(itemId: string): Promise<VariantRow[]> {
    return (must(await this.sb.from("platform_variants").select("platform,text,hashtags,alt_text").eq("content_item_id", itemId), "get variants") ?? []) as VariantRow[];
  }

  async upsertVariants(brandId: string, itemId: string, rows: VariantRow[]): Promise<void> {
    const payload = rows.map((r) => ({ brand_id: brandId, content_item_id: itemId, platform: r.platform, text: r.text, hashtags: r.hashtags, alt_text: r.alt_text, edited_by_owner: false }));
    must(await this.sb.from("platform_variants").upsert(payload, { onConflict: "content_item_id,platform" }), "upsert variants");
  }

  async insertCheck(row: CheckRow): Promise<void> {
    must(await this.sb.from("checks").insert(row), "insert check");
  }

  async getImages(itemId: string): Promise<ImageRow[]> {
    const r = await this.sb.from("content_images").select("storage_path,position,role,label,alt_text").eq("content_item_id", itemId).order("position").order("created_at");
    return (must(r, "get images") ?? []) as ImageRow[];
  }

  async setImages(brandId: string, itemId: string, rows: ImageRow[]): Promise<void> {
    const payload = rows.map((r) => ({ brand_id: brandId, content_item_id: itemId, storage_path: r.storage_path, position: r.position, role: r.role, label: r.label, alt_text: r.alt_text }));
    must(await this.sb.from("content_images").upsert(payload, { onConflict: "content_item_id,storage_path" }), "set images");
  }

  async updateItem(id: string, patch: { status?: string; source_image_path?: string | null; change_note?: string | null }): Promise<void> {
    must(await this.sb.from("content_items").update(patch).eq("id", id), "update item");
  }

  async getPostHistory(brandId: string, limit: number): Promise<HistoryRow[]> {
    return (must(await this.sb.from("post_history").select("platform,text,posted_at,metrics").eq("brand_id", brandId).order("posted_at", { ascending: false, nullsFirst: false }).limit(limit), "get history") ?? []) as HistoryRow[];
  }

  async hasApproval(itemId: string): Promise<boolean> {
    const rows = must(await this.sb.from("approvals").select("id").eq("content_item_id", itemId).in("decision", ["approved", "edited_approved"]).limit(1), "has approval") as unknown[];
    return rows.length > 0;
  }

  async getPublications(itemId: string) {
    return (must(await this.sb.from("publications").select("platform,format,mode,status").eq("content_item_id", itemId), "get publications") ?? []) as Pick<PublicationRow, "platform" | "format" | "mode" | "status">[];
  }

  async insertPublication(row: PublicationRow): Promise<void> {
    must(await this.sb.from("publications").insert(row), "insert publication");
  }
}
