import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";
import { enqueueJob, sha256Hex } from "../lib/data";
import { supabase } from "../lib/supabase";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES = 10; // Instagram's carousel limit

interface Picked { file: File; url: string; hash: string }

/** One image hashes to itself; several hash to the sorted list of hashes, so the same set always dedupes. */
export async function setHash(hashes: string[]): Promise<string> {
  if (hashes.length === 1) return hashes[0]!;
  return sha256Hex(new TextEncoder().encode([...hashes].sort().join("|")).buffer as ArrayBuffer);
}

export function UploadPage() {
  const { brand, session, role } = useAuth();
  const nav = useNavigate();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [note, setNote] = useState("");
  const [gpt, setGpt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => () => picked.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function accept(files: FileList | File[] | null | undefined) {
    setError(null);
    const list = [...(files ?? [])];
    if (list.length === 0) return;
    const next = [...picked];
    const problems: string[] = [];
    for (const f of list) {
      if (!f.type.startsWith("image/")) { problems.push(`${f.name} is not an image.`); continue; }
      if (f.size > MAX_BYTES) { problems.push(`${f.name} is over 15 MB.`); continue; }
      if (next.length >= MAX_IMAGES) { problems.push(`Only ${MAX_IMAGES} images fit in a carousel; skipped ${f.name}.`); continue; }
      const hash = await sha256Hex(await f.arrayBuffer());
      if (next.some((p) => p.hash === hash)) { problems.push(`${f.name} is a duplicate of an image already added.`); continue; }
      next.push({ file: f, url: URL.createObjectURL(f), hash });
    }
    setPicked(next);
    if (problems.length) setError(problems.join(" "));
  }
  const remove = (i: number) => { URL.revokeObjectURL(picked[i]!.url); setPicked(picked.filter((_, k) => k !== i)); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void accept(e.dataTransfer.files); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!brand || !session || picked.length === 0) return;
    if (!note.trim() && !gpt.trim()) return setError("Add the story note or paste the text from ChatGPT.");
    setBusy(true);
    setError(null);
    const uploaded: string[] = [];
    try {
      const hash = await setHash(picked.map((p) => p.hash));
      const dupe = await supabase.from("content_items").select("id").eq("brand_id", brand.id).eq("source_hash", hash).maybeSingle();
      if (dupe.data) {
        setBusy(false);
        return nav(`/queue/${dupe.data.id}`, { state: { notice: "You already uploaded these images. Here it is." } });
      }
      for (const p of picked) {
        const ext = (p.file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
        const path = `${brand.id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("cartoons").upload(path, p.file, { contentType: p.file.type, upsert: false });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
        uploaded.push(path);
      }
      const title = (note.trim() || gpt.trim()).split("\n")[0]!.slice(0, 90);
      const ins = await supabase.from("content_items")
        .insert({ brand_id: brand.id, title, story_note: note.trim() || null, gpt_caption: gpt.trim() || null, source_image_path: uploaded[0], source_hash: hash, created_by: session.user.id })
        .select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      const imgs = await supabase.from("content_images").insert(uploaded.map((path, i) => ({ brand_id: brand.id, content_item_id: ins.data.id, storage_path: path, position: i + 1, role: i === 0 ? "cover" : "other" })));
      if (imgs.error) {
        await supabase.from("content_items").delete().eq("id", ins.data.id);
        throw new Error(imgs.error.message);
      }
      uploaded.length = 0;
      const job = await enqueueJob({ brandId: brand.id, userId: session.user.id, kind: "caption_package", itemId: ins.data.id });
      nav(`/queue/${ins.data.id}`, { state: { notice: job.wakeError ? `Saved. The worker could not be woken (${job.wakeError}); it will pick this up on its next run.` : null } });
    } catch (err) {
      if (uploaded.length) void supabase.storage.from("cartoons").remove(uploaded);
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!brand) return null;
  if (role === "viewer") return <p className="text-sm text-muted-foreground">Your role can view but not upload.</p>;

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Upload</h1>
      <Card className="space-y-4">
        <CardTitle>1. The images (1 to {MAX_IMAGES})</CardTitle>
        <p className="text-xs text-muted-foreground">Add the full cartoon and any detail panels in any order. The app looks at them, puts the best cover first and orders the rest to match the caption. You can reorder before approving.</p>
        <label
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
          className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm ${over ? "border-primary bg-muted" : "border-border"}`}
        >
          <span className="text-muted-foreground">Drag images here, or click to choose files</span>
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void accept(e.target.files); e.target.value = ""; }} />
        </label>
        {picked.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Selected images">
            {picked.map((p, i) => (
              <li key={p.hash} className="relative">
                <img src={p.url} alt={`Selected image ${i + 1}`} className="aspect-square w-full rounded-md border border-border object-cover" />
                <button type="button" onClick={() => remove(i)} aria-label={`Remove image ${i + 1}`} className="absolute right-1 top-1 rounded-full bg-background/90 px-2 py-0.5 text-xs">✕</button>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{p.file.name}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{picked.length} of {MAX_IMAGES} images</p>
      </Card>
      <Card className="space-y-3">
        <CardTitle>2. Your story and ChatGPT's text</CardTitle>
        <p className="text-xs text-muted-foreground">You choose the story. Include the source (outlet, date, URL) and any "Swipe for…" idea. The captions are adapted from your words; nothing is invented.</p>
        <label className="block text-sm" htmlFor="note">Story note (what this edition is about)</label>
        <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border border-border bg-muted p-3 text-sm" />
        <label className="block text-sm" htmlFor="gpt">Paste the text from ChatGPT (headline / draft caption)</label>
        <textarea id="gpt" rows={5} value={gpt} onChange={(e) => setGpt(e.target.value)} className="w-full rounded-md border border-border bg-muted p-3 text-sm" />
      </Card>
      {error && <p role="alert" className="rounded-md bg-danger/15 p-3 text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={busy || picked.length === 0} className="w-full sm:w-auto">{busy ? "Uploading…" : `Create caption package${picked.length > 1 ? ` (${picked.length} images)` : ""}`}</Button>
    </form>
  );
}
