import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Badge, Card, EmptyState } from "../components/ui/card";
import { STATUS_LABEL, STATUS_TONE, useLiveReload, useSignedUrl, type Item } from "../lib/data";
import { supabase } from "../lib/supabase";

interface Check { content_item_id: string; verdict: "passed" | "fixed" | "failed"; voice_score: number | null; created_at: string }

export function ItemCard({ item, check }: { item: Item; check?: Check }) {
  const url = useSignedUrl(item.source_image_path);
  return (
    <Link to={`/queue/${item.id}`} className="group block">
      <Card className="flex gap-3 p-3 transition-colors group-hover:bg-muted sm:p-3">
        {url ? <img src={url} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" loading="lazy" /> : <div className="h-20 w-20 shrink-0 rounded-md bg-muted" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{item.title || "Untitled"}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            {check && <Badge tone={check.verdict === "failed" ? "danger" : check.verdict === "fixed" ? "warning" : "success"}>check: {check.verdict}</Badge>}
            {check?.voice_score != null && <Badge>voice {check.voice_score}/3</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{new Date(item.planned_for ?? item.created_at).toLocaleString()}</p>
        </div>
      </Card>
    </Link>
  );
}

export function QueuePage() {
  const { brand } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!brand) return;
    const r = await supabase.from("content_items").select("*").eq("brand_id", brand.id).in("status", ["draft", "checked", "queued", "approved", "scheduled"]).order("created_at", { ascending: false }).limit(100);
    if (r.error) return setErr(r.error.message);
    setErr(null);
    setItems(r.data as Item[]);
    const ids = (r.data ?? []).map((i) => i.id);
    if (ids.length) {
      const c = await supabase.from("checks").select("content_item_id,verdict,voice_score,created_at").in("content_item_id", ids).order("created_at", { ascending: false });
      const latest: Record<string, Check> = {};
      for (const row of (c.data ?? []) as Check[]) if (!latest[row.content_item_id]) latest[row.content_item_id] = row;
      setChecks(latest);
    }
  }, [brand]);
  useLiveReload(["content_items", "checks"], brand?.id, load);

  const group = (statuses: string[]) => (items ?? []).filter((i) => statuses.includes(i.status));
  const sections: [string, Item[]][] = [
    ["Needs your review", group(["checked", "queued"])],
    ["Writing captions", group(["draft"])],
    ["Approved and scheduled", group(["approved", "scheduled"])],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Queue</h1>
        <Link to="/upload" className="text-sm text-primary underline">Upload a cartoon</Link>
      </div>
      {err && <p role="alert" className="text-sm text-danger">Could not load: {err}</p>}
      {!items && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
      {items && items.length === 0 && <EmptyState title="Nothing in the queue">Upload a cartoon with the text from ChatGPT to get started.</EmptyState>}
      {sections.map(([title, list]) => list.length > 0 && (
        <section key={title} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{title} ({list.length})</h2>
          {list.map((i) => <ItemCard key={i.id} item={i} check={checks[i.id]} />)}
        </section>
      ))}
    </div>
  );
}
