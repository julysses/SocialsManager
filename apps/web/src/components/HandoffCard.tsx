import { useEffect, useState } from "react";
import { PLATFORM_LABEL, fullText } from "@socialos/agents/src/platforms";
import { Button } from "./ui/button";
import { Badge, Card, CardTitle } from "./ui/card";
import { supabase } from "../lib/supabase";
import type { Platform } from "../lib/data";

export interface HandoffVariant { platform: Platform; text: string; hashtags: string[] }
export interface HandoffPub { id: string; platform: string; format: string; mode: string; external_url: string | null }
interface Row { key: string; platform: Platform; format: "post" | "story"; title: string }

const OPEN: Partial<Record<Platform, (text: string) => { href: string; label: string }>> = {
  instagram: () => ({ href: "https://app.metricool.com/", label: "Open Metricool" }),
  facebook: () => ({ href: "https://app.metricool.com/", label: "Open Metricool" }),
  x: (t) => ({ href: `https://x.com/intent/post?text=${encodeURIComponent(t)}`, label: "Open X composer" }),
};

/** "Post by hand" panel: the owner copies the approved text, posts it, and records it. Approval is enforced in Postgres. */
export function HandoffCard({ itemId, imagePaths, variants, pubs, platformsCfg, canAct, onChanged, onMessage }: {
  itemId: string;
  /** Slides in posting order, cover first. */
  imagePaths: string[];
  variants: HandoffVariant[];
  pubs: HandoffPub[];
  platformsCfg: Record<string, { via?: string; story_to_both?: boolean; phase?: number }>;
  canAct: boolean;
  onChanged: () => void;
  onMessage: (m: { tone: "success" | "danger"; text: string }) => void;
}) {
  const [downloads, setDownloads] = useState<string[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const pathKey = imagePaths.join("|");
  useEffect(() => {
    let live = true;
    Promise.all(imagePaths.map((p, i) => supabase.storage.from("cartoons").createSignedUrl(p, 3600, { download: `${String(i + 1).padStart(2, "0")}-${p.split("/").pop()}` })))
      .then((r) => live && setDownloads(r.map((x) => x.data?.signedUrl ?? "")));
    return () => { live = false; };
  }, [pathKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const manual = (p: Platform) => platformsCfg[p]?.via === "manual" && platformsCfg[p]?.phase === undefined;
  const rows: Row[] = [];
  for (const p of ["instagram", "facebook", "x"] as Platform[]) if (manual(p) && variants.some((v) => v.platform === p)) rows.push({ key: `${p}:post`, platform: p, format: "post", title: `${PLATFORM_LABEL[p]} post` });
  if (platformsCfg.instagram?.story_to_both) for (const p of ["instagram", "facebook"] as Platform[]) if (manual(p)) rows.push({ key: `${p}:story`, platform: p, format: "story", title: `${PLATFORM_LABEL[p]} Story` });
  if (rows.length === 0) return null;

  const done = (r: Row) => pubs.find((x) => x.mode === "manual" && x.platform === r.platform && x.format === r.format);
  const left = rows.filter((r) => !done(r)).length;

  async function record(r: Row) {
    setBusy(r.key);
    const { error } = await supabase.rpc("mark_posted_handoff", { p_item: itemId, p_platform: r.platform, p_url: urls[r.key] ?? "", p_format: r.format });
    setBusy(null);
    if (error) return onMessage({ tone: "danger", text: error.message });
    setUrls((u) => ({ ...u, [r.key]: "" }));
    onMessage({ tone: "success", text: `${r.title} recorded.` });
    onChanged();
  }
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => onMessage({ tone: "success", text: `Copied the ${what}.` }), () => onMessage({ tone: "danger", text: "Your browser blocked copying. Select the text and copy it by hand." }));

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>Post by hand</CardTitle>
        <Badge tone={left === 0 ? "success" : "warning"}>{left === 0 ? "all recorded" : `${left} to go`}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">Approved text only. Copy it, post it in Metricool (or the app), then record it here. When every row is recorded the item turns Live.</p>
      {downloads.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{downloads.length === 1 ? "Image" : `Images in posting order (${downloads.length}). Upload them to the carousel in this order; files are numbered.`}</p>
          <div className="flex flex-wrap gap-2">
            {downloads.map((u, i) => u && <a key={i} href={u} download className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">{downloads.length === 1 ? "Download image" : `Download ${i + 1}${i === 0 ? " (cover)" : ""}`}</a>)}
          </div>
        </div>
      )}
      <ul className="space-y-3">
        {rows.map((r) => {
          const v = variants.find((x) => x.platform === r.platform)!;
          const text = r.format === "story" ? "" : fullText(v.text, v.hashtags);
          const d = done(r);
          const open = r.format === "post" ? OPEN[r.platform]?.(text) : OPEN[r.platform]?.("");
          return (
            <li key={r.key} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{r.title}</span>
                {d ? <Badge tone="success">recorded</Badge> : <Badge tone="warning">to post</Badge>}
                {d?.external_url && <a href={d.external_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">open ↗</a>}
              </div>
              {!d && (
                <>
                  {r.format === "post" && r.platform === "x" && downloads.length > 4 && <p className="text-xs text-warning">X takes 4 images: attach downloads 1 to 4.</p>}
                  {r.format === "post" ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{text}</pre> : <p className="text-xs text-muted-foreground">Stories carry one image: the cover{downloads.length > 1 ? " (download 1)" : ""}.</p>}
                  <div className="flex flex-wrap gap-2">
                    {r.format === "post" && <Button variant="outline" onClick={() => void copy(text, `${r.title} text`)}>Copy text</Button>}
                    {open && <a className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-muted" href={open.href} target="_blank" rel="noreferrer">{open.label} ↗</a>}
                  </div>
                  {canAct && (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <label className="block text-xs" htmlFor={`u-${r.key}`}>{r.format === "post" ? "Paste the post's URL after posting" : "Post URL (optional for Stories)"}</label>
                        <input id={`u-${r.key}`} value={urls[r.key] ?? ""} onChange={(e) => setUrls({ ...urls, [r.key]: e.target.value })} placeholder="https://…" className="h-10 w-full rounded-md border border-border bg-muted px-3 text-sm" />
                      </div>
                      <Button disabled={busy !== null || (r.format === "post" && !(urls[r.key] ?? "").trim())} onClick={() => void record(r)}>{busy === r.key ? "Saving…" : "Mark posted"}</Button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
