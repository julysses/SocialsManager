import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { enqueueJob, useLiveReload } from "../lib/data";
import { supabase } from "../lib/supabase";
import { Badge, Card, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

interface KFile { id: string; folder: string; filename: string; content_md: string; version: number }
interface VoiceJob { id: string; status: string; error: string | null; result: { posts_used: number; voice_guide_md: string; banned_words_md: string; hook_library_md: string } | null; created_at: string }

type TextKey = "voice_guide_md" | "banned_words_md" | "hook_library_md";
const TARGETS: [TextKey, string, string, string][] = [
  ["voice_guide_md", "voice", "voice-guide.md", "Voice guide"],
  ["banned_words_md", "voice", "banned-words.md", "Banned words"],
  ["hook_library_md", "hooks", "hook-library.md", "Hook library"],
];

export function KnowledgeEditor() {
  const { brand, session, role } = useAuth();
  const [files, setFiles] = useState<KFile[]>([]);
  const [sel, setSel] = useState<string>("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [voice, setVoice] = useState<VoiceJob | null>(null);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const owner = role === "owner";

  const load = useCallback(async () => {
    if (!brand) return;
    const [f, j, h] = await Promise.all([
      supabase.from("knowledge_files").select("id,folder,filename,content_md,version").eq("brand_id", brand.id).order("folder").order("filename"),
      supabase.from("jobs").select("id,status,error,result,created_at").eq("brand_id", brand.id).eq("kind", "voice_build").order("created_at", { ascending: false }).limit(1),
      supabase.from("post_history").select("id", { count: "exact", head: true }).eq("brand_id", brand.id),
    ]);
    if (f.data) setFiles(f.data as KFile[]);
    setVoice(((j.data ?? [])[0] as VoiceJob | undefined) ?? null);
    setHistoryCount(h.count ?? 0);
  }, [brand]);
  useLiveReload(["jobs", "knowledge_files"], brand?.id, load, 10000);

  useEffect(() => {
    if (!sel && files[0]) setSel(files[0].id);
  }, [files, sel]);
  const current = files.find((f) => f.id === sel);
  useEffect(() => { setText(current?.content_md ?? ""); }, [current?.id, current?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(file: KFile, content: string, okText: string) {
    const r = await supabase.from("knowledge_files").update({ content_md: content, version: file.version + 1 }).eq("id", file.id);
    setMsg(r.error ? { tone: "danger", text: r.error.message } : { tone: "success", text: okText });
    await load();
  }

  async function buildVoice() {
    if (!brand || !session) return;
    try {
      const r = await enqueueJob({ brandId: brand.id, userId: session.user.id, kind: "voice_build" });
      setMsg({ tone: "success", text: r.wakeError ? "Queued. The worker will run it shortly." : "Building the voice documents… this takes a minute." });
      await load();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  }

  if (!brand) return null;
  const working = voice && (voice.status === "queued" || voice.status === "running") && !voice.error;
  return (
    <Card className="space-y-3">
      <CardTitle>Voice and knowledge files</CardTitle>
      <p className="text-xs text-muted-foreground">These guide every caption and check. Empty files mean the writer uses a generic satirical voice, so fill at least the voice guide.</p>

      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-sm font-medium">Build the voice from your past posts</p>
        <p className="text-xs text-muted-foreground">{historyCount === null ? "…" : `${historyCount} imported post${historyCount === 1 ? "" : "s"}`}. <Link to="/import" className="text-primary underline">Import post history</Link> first (5 or more).</p>
        {owner && <Button variant="outline" onClick={buildVoice} disabled={!!working || (historyCount ?? 0) < 5}>{working ? "Building…" : "Build voice documents"}</Button>}
        {voice?.error && <p role="alert" className="text-sm text-danger">{voice.error}</p>}
        {voice?.status === "succeeded" && voice.result && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Drafted from {voice.result.posts_used} posts. Nothing is saved until you accept it.</p>
            {TARGETS.map(([key, folder, filename, label]) => {
              const target = files.find((f) => f.folder === folder && f.filename === filename);
              return (
                <details key={key} className="rounded-md bg-muted p-3">
                  <summary className="cursor-pointer text-sm">{label}</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{voice.result![key]}</pre>
                  {owner && target && <Button className="mt-2" onClick={() => void save(target, voice.result![key], `Saved ${label}.`)}>Accept as {label.toLowerCase()}</Button>}
                </details>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <ul className="max-h-72 space-y-0.5 overflow-y-auto text-sm" aria-label="Knowledge files">
          {files.map((f) => (
            <li key={f.id}>
              <button onClick={() => setSel(f.id)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left ${sel === f.id ? "bg-muted" : "hover:bg-muted"}`}>
                <span className="truncate">{f.folder}/{f.filename}</span>
                {!f.content_md.trim() || f.content_md.trim().split("\n").every((l) => l.startsWith("#") || !l.trim()) ? <Badge tone="warning">empty</Badge> : <Badge>v{f.version}</Badge>}
              </button>
            </li>
          ))}
        </ul>
        {current && (
          <div className="space-y-2">
            <label className="sr-only" htmlFor="kf">{current.folder}/{current.filename}</label>
            <textarea id="kf" rows={14} value={text} onChange={(e) => setText(e.target.value)} readOnly={!owner} className="w-full rounded-md border border-border bg-muted p-3 font-mono text-xs" />
            {owner && <Button disabled={text === current.content_md} onClick={() => void save(current, text, `Saved ${current.folder}/${current.filename}.`)}>Save file</Button>}
          </div>
        )}
      </div>
      {msg && <p role="status" className={msg.tone === "danger" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
    </Card>
  );
}
