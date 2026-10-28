import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Badge } from "./ui/card";
import { useSignedUrl } from "../lib/data";

export interface Slide { id: string; storage_path: string; position: number; role: "cover" | "detail" | "other"; label: string | null; alt_text: string | null }

function Thumb({ path, alt }: { path: string; alt: string }) {
  const url = useSignedUrl(path);
  return url ? <img src={url} alt={alt} className="aspect-square w-full rounded-md border border-border object-cover" /> : <div className="aspect-square w-full rounded-md bg-muted" />;
}

/** The carousel in order. While the item is still editable the owner can move slides; slide 1 is the cover. */
export function SlideStrip({ itemId, slides, editable, onChanged, onError }: {
  itemId: string; slides: Slide[]; editable: boolean; onChanged: () => void; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= slides.length || busy) return;
    setBusy(true);
    const order = slides.map((s) => s.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (let k = 0; k < order.length; k++) {
      const s = slides.find((x) => x.id === order[k])!;
      const wantRole = k === 0 ? "cover" : s.role === "cover" ? "detail" : s.role;
      if (s.position === k + 1 && s.role === wantRole) continue;
      const r = await supabase.from("content_images").update({ position: k + 1, role: wantRole }).eq("id", s.id);
      if (r.error) { setBusy(false); return onError(r.error.message); }
    }
    const cover = slides.find((x) => x.id === order[0])!;
    const r = await supabase.from("content_items").update({ source_image_path: cover.storage_path }).eq("id", itemId);
    setBusy(false);
    if (r.error) return onError(r.error.message);
    onChanged();
  }

  if (slides.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{slides.length === 1 ? "1 image" : `Carousel: ${slides.length} slides, in posting order`}{editable && slides.length > 1 ? ". Use the arrows to reorder." : ""}</p>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {slides.map((s, i) => (
          <li key={s.id} className="space-y-1">
            <div className="relative">
              <Thumb path={s.storage_path} alt={s.alt_text ?? s.label ?? `Slide ${i + 1}`} />
              <span className="absolute left-1 top-1 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">{i + 1}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {i === 0 ? <Badge tone="success">cover</Badge> : <Badge>detail</Badge>}
              {editable && slides.length > 1 && (
                <>
                  <button disabled={busy || i === 0} onClick={() => void move(i, -1)} aria-label={`Move slide ${i + 1} earlier`} className="rounded border border-border px-2 text-xs disabled:opacity-30">←</button>
                  <button disabled={busy || i === slides.length - 1} onClick={() => void move(i, 1)} aria-label={`Move slide ${i + 1} later`} className="rounded border border-border px-2 text-xs disabled:opacity-30">→</button>
                </>
              )}
            </div>
            {s.label && <p className="text-xs text-muted-foreground">{s.label}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
