import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export type Status = "draft" | "checked" | "queued" | "approved" | "rejected" | "scheduled" | "live" | "failed" | "retired";
export type Platform = "instagram" | "facebook" | "x" | "threads" | "bluesky";
export const PLATFORM_ORDER: Platform[] = ["instagram", "facebook", "x", "threads", "bluesky"];

export interface Item {
  id: string;
  brand_id: string;
  title: string | null;
  story_note: string | null;
  gpt_caption: string | null;
  source_image_path: string | null;
  status: Status;
  planned_for: string | null;
  change_note: string | null;
  created_at: string;
}

export const STATUS_LABEL: Record<Status, string> = {
  draft: "Writing captions", checked: "Needs your attention", queued: "Ready for review", approved: "Approved", rejected: "Rejected",
  scheduled: "Scheduled", live: "Live", failed: "Failed", retired: "Retired",
};
export const STATUS_TONE: Record<Status, "neutral" | "success" | "warning" | "danger"> = {
  draft: "neutral", checked: "warning", queued: "warning", approved: "success", rejected: "danger", scheduled: "success", live: "success", failed: "danger", retired: "neutral",
};

const urlCache = new Map<string, string>();
/** Short-lived signed URL for a private cartoon. */
export function useSignedUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(path ? (urlCache.get(path) ?? null) : null);
  useEffect(() => {
    if (!path) return setUrl(null);
    const cached = urlCache.get(path);
    if (cached) return setUrl(cached);
    let live = true;
    supabase.storage.from("cartoons").createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) urlCache.set(path, data.signedUrl);
      if (live) setUrl(data?.signedUrl ?? null);
    });
    return () => { live = false; };
  }, [path]);
  return url;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Creates a job (RLS-checked) and wakes the worker. The job is queued either way; waking can fail without losing it. */
export async function enqueueJob(args: { brandId: string; userId: string; kind: string; itemId?: string; payload?: Record<string, unknown> }): Promise<{ jobId: string; wakeError: string | null }> {
  const ins = await supabase
    .from("jobs")
    .insert({
      brand_id: args.brandId, kind: args.kind, content_item_id: args.itemId ?? null, payload: { ...(args.payload ?? {}), ...(args.itemId ? { content_item_id: args.itemId } : {}) },
      created_by: args.userId, idempotency_key: `${args.kind}:${args.itemId ?? "brand"}:${crypto.randomUUID()}`,
    })
    .select("id")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  const fn = await supabase.functions.invoke("enqueue", { body: { job_id: ins.data.id } });
  return { jobId: ins.data.id, wakeError: fn.error ? fn.error.message : null };
}

/** Re-runs `load` on realtime changes to the given tables for a brand, plus a slow poll as a safety net. */
export function useLiveReload(tables: string[], brandId: string | undefined, load: () => void, pollMs = 8000) {
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => {
    if (!brandId) return;
    ref.current();
    const channel = supabase.channel(`live-${tables.join("-")}-${brandId}-${Math.random().toString(36).slice(2, 7)}`);
    for (const table of tables) channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `brand_id=eq.${brandId}` }, () => ref.current());
    channel.subscribe();
    const poll = setInterval(() => ref.current(), pollMs);
    return () => { clearInterval(poll); void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, tables.join(",")]);
}
