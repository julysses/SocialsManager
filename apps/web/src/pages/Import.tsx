import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";
import { csvToPosts, type ImportedPost } from "../lib/csv";
import { sha256Hex } from "../lib/data";
import { supabase } from "../lib/supabase";

const PLATFORMS: ImportedPost["platform"][] = ["instagram", "facebook", "x", "threads", "bluesky", "tiktok"];

export function ImportPage() {
  const { brand, role } = useAuth();
  const [platform, setPlatform] = useState<ImportedPost["platform"]>("instagram");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function save(posts: ImportedPost[], note = "") {
    if (!brand) return;
    if (posts.length === 0) return setMsg({ tone: "danger", text: "Nothing to import." });
    setBusy(true);
    try {
      const rows = await Promise.all(posts.map(async (p) => ({
        brand_id: brand.id, platform: p.platform, text: p.text, posted_at: p.posted_at, metrics: p.metrics, source: "import",
        external_id: p.external_id ?? `text:${(await sha256Hex(new TextEncoder().encode(`${p.platform}|${p.text.trim()}`))).slice(0, 32)}`,
      })));
      // De-duplicate within the batch, then upsert so re-importing the same posts is harmless.
      const unique = [...new Map(rows.map((r) => [`${r.platform}|${r.external_id}`, r])).values()];
      for (let i = 0; i < unique.length; i += 200) {
        const { error } = await supabase.from("post_history").upsert(unique.slice(i, i + 200), { onConflict: "brand_id,platform,external_id", ignoreDuplicates: false });
        if (error) throw new Error(error.message);
      }
      setMsg({ tone: "success", text: `Imported ${unique.length} post${unique.length === 1 ? "" : "s"}.${note}` });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
    setBusy(false);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    const { posts, skipped, error } = csvToPosts(await f.text(), platform);
    if (error) return setMsg({ tone: "danger", text: error });
    await save(posts, skipped ? ` Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no caption.` : "");
  }

  if (role !== "owner") return <p className="text-sm text-muted-foreground">Only the owner can import history.</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Import post history</h1>
      <p className="text-sm text-muted-foreground">Past posts teach the voice builder how Daily Heckler sounds. Add at least 5 (10 or more is better), then build the voice in <Link to="/settings" className="text-primary underline">Settings</Link>.</p>
      <Card className="space-y-3">
        <CardTitle>Platform for pasted captions</CardTitle>
        <select value={platform} onChange={(e) => setPlatform(e.target.value as ImportedPost["platform"])} aria-label="Platform" className="h-10 rounded-md border border-border bg-muted px-2 text-sm">
          {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>
      </Card>
      <Card className="space-y-3">
        <CardTitle>Option A: Metricool export (CSV)</CardTitle>
        <p className="text-xs text-muted-foreground">Needs a caption column. Date, network, post id and likes/comments/shares/saves/views columns are picked up when present.</p>
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} className="text-sm" aria-label="CSV file" />
      </Card>
      <Card className="space-y-3">
        <CardTitle>Option B: paste captions</CardTitle>
        <p className="text-xs text-muted-foreground">Separate posts with a line containing only <code>---</code>.</p>
        <textarea rows={10} value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Pasted captions" className="w-full rounded-md border border-border bg-muted p-3 text-sm" />
        <Button disabled={busy || !pasted.trim()} onClick={() => save(pasted.split(/^\s*---\s*$/m).map((t) => t.trim()).filter(Boolean).map((text) => ({ platform, text, posted_at: null, external_id: null, metrics: {} })))}>
          {busy ? "Importing…" : "Import pasted captions"}
        </Button>
      </Card>
      {msg && <p role="status" className={msg.tone === "danger" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
    </div>
  );
}
