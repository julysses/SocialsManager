import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";
import { enqueueJob, sha256Hex } from "../lib/data";
import { supabase } from "../lib/supabase";

const MAX_BYTES = 15 * 1024 * 1024;

export function UploadPage() {
  const { brand, session, role } = useAuth();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [gpt, setGpt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function accept(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("That file is not an image. Use PNG, JPG or WebP.");
    if (f.size > MAX_BYTES) return setError("That image is over 15 MB. Export a smaller one.");
    setFile(f);
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files[0]); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!brand || !session || !file) return;
    if (!note.trim() && !gpt.trim()) return setError("Add the story note or paste the text from ChatGPT.");
    setBusy(true);
    setError(null);
    let uploaded: string | null = null;
    try {
      const hash = await sha256Hex(await file.arrayBuffer());
      const dupe = await supabase.from("content_items").select("id").eq("brand_id", brand.id).eq("source_hash", hash).maybeSingle();
      if (dupe.data) {
        setBusy(false);
        return nav(`/queue/${dupe.data.id}`, { state: { notice: "You already uploaded this image. Here it is." } });
      }
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
      const path = `${brand.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("cartoons").upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
      uploaded = path;
      const title = (note.trim() || gpt.trim()).split("\n")[0]!.slice(0, 90);
      const ins = await supabase.from("content_items")
        .insert({ brand_id: brand.id, title, story_note: note.trim() || null, gpt_caption: gpt.trim() || null, source_image_path: path, source_hash: hash, created_by: session.user.id })
        .select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      uploaded = null;
      const job = await enqueueJob({ brandId: brand.id, userId: session.user.id, kind: "caption_package", itemId: ins.data.id });
      nav(`/queue/${ins.data.id}`, { state: { notice: job.wakeError ? `Saved. The worker could not be woken (${job.wakeError}); it will pick this up on its next run.` : null } });
    } catch (err) {
      if (uploaded) void supabase.storage.from("cartoons").remove([uploaded]);
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
        <CardTitle>1. The cartoon</CardTitle>
        <label
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
          className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm ${over ? "border-primary bg-muted" : "border-border"}`}
        >
          {preview ? <img src={preview} alt="Selected cartoon preview" className="max-h-72 rounded-md" /> : <span className="text-muted-foreground">Drag the image here, or click to choose a file</span>}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => accept(e.target.files?.[0])} />
          {file && <span className="text-xs text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB · click to replace</span>}
        </label>
      </Card>
      <Card className="space-y-3">
        <CardTitle>2. Your story and ChatGPT's text</CardTitle>
        <p className="text-xs text-muted-foreground">You choose the story. The captions are adapted from your words; nothing is invented.</p>
        <label className="block text-sm" htmlFor="note">Story note (what this edition is about)</label>
        <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border border-border bg-muted p-3 text-sm" />
        <label className="block text-sm" htmlFor="gpt">Paste the text from ChatGPT (headline / draft caption)</label>
        <textarea id="gpt" rows={5} value={gpt} onChange={(e) => setGpt(e.target.value)} className="w-full rounded-md border border-border bg-muted p-3 text-sm" />
      </Card>
      {error && <p role="alert" className="rounded-md bg-danger/15 p-3 text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={busy || !file} className="w-full sm:w-auto">{busy ? "Uploading…" : "Create caption package"}</Button>
    </form>
  );
}
