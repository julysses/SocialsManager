import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Card, CardTitle } from "../components/ui/card";
import { useLiveReload } from "../lib/data";
import { supabase } from "../lib/supabase";

export function TodayPage() {
  const { brand } = useAuth();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const load = useCallback(async () => {
    if (!brand) return;
    const r = await supabase.from("content_items").select("status").eq("brand_id", brand.id).in("status", ["draft", "checked", "queued", "approved", "scheduled"]);
    const c: Record<string, number> = {};
    for (const row of r.data ?? []) c[row.status] = (c[row.status] ?? 0) + 1;
    setCounts(c);
  }, [brand]);
  useLiveReload(["content_items"], brand?.id, load);

  const review = (counts?.queued ?? 0) + (counts?.checked ?? 0);
  const tiles: [string, number, string][] = [
    ["Need your review", review, "/queue"],
    ["Writing captions", counts?.draft ?? 0, "/queue"],
    ["Approved, not scheduled", counts?.approved ?? 0, "/queue"],
    ["Scheduled", counts?.scheduled ?? 0, "/queue"],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Today</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, n, to]) => (
          <Link key={label} to={to}><Card className="p-4 sm:p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{counts ? n : "–"}</p></Card></Link>
        ))}
      </div>
      <Card className="space-y-2">
        <CardTitle>Daily flow</CardTitle>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li><Link to="/upload" className="text-primary underline">Upload</Link> the cartoon and paste ChatGPT's text.</li>
          <li>Open it in the <Link to="/queue" className="text-primary underline">Queue</Link>, check each platform tab, edit if needed.</li>
          <li>Click <b>Approve</b>. Then, as a separate click, <b>Schedule</b> or <b>Post now</b>.</li>
        </ol>
        {brand?.settings.publish_mode !== "live" && <p className="text-xs text-warning">Dry-run mode: scheduling records what would be sent. Nothing is posted to Instagram or Facebook yet.</p>}
      </Card>
    </div>
  );
}
