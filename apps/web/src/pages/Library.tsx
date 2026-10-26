import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Badge, Card, EmptyState } from "../components/ui/card";
import { STATUS_LABEL, STATUS_TONE, PLATFORM_ORDER, useLiveReload, useSignedUrl, type Item, type Status } from "../lib/data";
import { supabase } from "../lib/supabase";

interface Pub { content_item_id: string; platform: string; format: string; mode: string; status: string; external_url: string | null }

function Row({ item, pubs }: { item: Item; pubs: Pub[] }) {
  const url = useSignedUrl(item.source_image_path);
  return (
    <Card className="flex gap-3 p-3 sm:p-3">
      {url ? <img src={url} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" loading="lazy" /> : <div className="h-16 w-16 shrink-0 rounded-md bg-muted" />}
      <div className="min-w-0 flex-1 space-y-1">
        <Link to={`/queue/${item.id}`} className="block truncate text-sm font-medium underline-offset-2 hover:underline">{item.title || "Untitled"}</Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
          {pubs.map((p, i) => p.external_url
            ? <a key={i} href={p.external_url} target="_blank" rel="noreferrer" className="text-primary underline">{p.platform} ↗</a>
            : <Badge key={i}>{p.platform}{p.format === "story" ? " story" : ""} · {p.mode === "dry_run" ? "dry run" : p.status}</Badge>)}
        </div>
      </div>
    </Card>
  );
}

export function LibraryPage() {
  const { brand } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [pubs, setPubs] = useState<Pub[]>([]);
  const [status, setStatus] = useState<string>("all");
  const [platform, setPlatform] = useState<string>("all");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!brand) return;
    const [i, p] = await Promise.all([
      supabase.from("content_items").select("*").eq("brand_id", brand.id).order("created_at", { ascending: false }).limit(200),
      supabase.from("publications").select("content_item_id,platform,format,mode,status,external_url").eq("brand_id", brand.id),
    ]);
    if (i.error || p.error) return setErr((i.error ?? p.error)!.message);
    setErr(null);
    setItems(i.data as Item[]);
    setPubs(p.data as Pub[]);
  }, [brand]);
  useLiveReload(["content_items", "publications"], brand?.id, load, 15000);

  const shown = (items ?? []).filter((i) => (status === "all" || i.status === status) && (platform === "all" || pubs.some((p) => p.content_item_id === i.id && p.platform === platform)));
  const sel = "h-9 rounded-md border border-border bg-muted px-2 text-sm";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Library</h1>
        <Link to="/import" className="text-sm text-primary underline">Import post history</Link>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="text-sm"><span className="sr-only">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></label>
        <label className="text-sm"><span className="sr-only">Platform</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={sel}>
            <option value="all">All platforms</option>
            {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
      </div>
      {err && <p role="alert" className="text-sm text-danger">Could not load: {err}</p>}
      {!items && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
      {items && shown.length === 0 && <EmptyState title="Nothing here yet">{items.length ? "No items match these filters." : "Every item you upload will be listed here."}</EmptyState>}
      <div className="space-y-2">{shown.map((i) => <Row key={i.id} item={i} pubs={pubs.filter((p) => p.content_item_id === i.id)} />)}</div>
    </div>
  );
}
