import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { LIMITS, PLATFORM_LABEL, fullText } from "@socialos/agents/src/platforms";
import { useAuth } from "../auth";
import { Button } from "../components/ui/button";
import { HandoffCard } from "../components/HandoffCard";
import { Badge, Card, CardTitle } from "../components/ui/card";
import { PLATFORM_ORDER, STATUS_LABEL, STATUS_TONE, enqueueJob, useLiveReload, useSignedUrl, type Item, type Platform } from "../lib/data";
import { formatInTz, utcToZonedInput, zonedToUtc } from "../lib/time";
import { supabase } from "../lib/supabase";

interface Variant { platform: Platform; text: string; hashtags: string[]; alt_text: string | null; edited_by_owner: boolean }
interface Flag { type: string; platform?: Platform; detail: string }
interface Check { verdict: "passed" | "fixed" | "failed"; voice_score: number | null; flags: Flag[]; created_at: string }
interface Pub { id: string; platform: string; format: string; mode: string; status: string; external_url: string | null; scheduled_for: string | null; error: string | null }
interface JobRow { id: string; kind: string; status: string; error: string | null; created_at: string }

const parseTags = (s: string) => s.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
const tagsToText = (t: string[]) => t.map((x) => `#${x}`).join(" ");

export function ItemDetailPage() {
  const { id } = useParams();
  const { brand, session, role } = useAuth();
  const location = useLocation();
  const [item, setItem] = useState<Item | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [check, setCheck] = useState<Check | null>(null);
  const [pubs, setPubs] = useState<Pub[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Platform>("instagram");
  const [drafts, setDrafts] = useState<Record<string, { text: string; tags: string }>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(
    (location.state as { notice?: string } | null)?.notice ? { tone: "success", text: (location.state as { notice: string }).notice } : null,
  );
  const [feedback, setFeedback] = useState("");
  const [when, setWhen] = useState("");
  const tz = brand?.timezone ?? "America/Chicago";
  const image = useSignedUrl(item?.source_image_path);

  const load = useCallback(async () => {
    if (!id) return;
    const [i, v, c, p, j] = await Promise.all([
      supabase.from("content_items").select("*").eq("id", id).maybeSingle(),
      supabase.from("platform_variants").select("platform,text,hashtags,alt_text,edited_by_owner").eq("content_item_id", id),
      supabase.from("checks").select("verdict,voice_score,flags,created_at").eq("content_item_id", id).order("created_at", { ascending: false }).limit(1),
      supabase.from("publications").select("id,platform,format,mode,status,external_url,scheduled_for,error").eq("content_item_id", id).order("created_at"),
      supabase.from("jobs").select("id,kind,status,error,created_at").eq("content_item_id", id).order("created_at", { ascending: false }).limit(6),
    ]);
    if (!i.data) return setMissing(true);
    setItem(i.data as Item);
    setVariants((v.data ?? []) as Variant[]);
    setCheck(((c.data ?? [])[0] as Check | undefined) ?? null);
    setPubs((p.data ?? []) as Pub[]);
    setJobs((j.data ?? []) as JobRow[]);
  }, [id]);
  useLiveReload(["content_items", "jobs", "publications", "checks"], brand?.id, load, 4000);

  // Fill the editors from the database unless the owner has unsaved edits.
  useEffect(() => {
    if (dirty) return;
    const next: Record<string, { text: string; tags: string }> = {};
    for (const v of variants) next[v.platform] = { text: v.text, tags: tagsToText(v.hashtags) };
    setDrafts(next);
  }, [variants, dirty]);

  useEffect(() => {
    if (!when) setWhen(utcToZonedInput(new Date(Math.ceil((Date.now() + 3600_000) / 900_000) * 900_000), tz));
  }, [tz, when]);

  const byPlatform = useMemo(() => Object.fromEntries(variants.map((v) => [v.platform, v])), [variants]);
  const editable = !!item && role !== "viewer" && (item.status === "queued" || item.status === "checked");
  const canAct = role !== "viewer";

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setMsg(null);
    try {
      const out = await fn();
      return out;
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const must = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

  async function saveEdits() {
    if (!item) return;
    for (const v of variants) {
      const d = drafts[v.platform];
      if (!d) continue;
      const tags = parseTags(d.tags);
      if (d.text === v.text && tagsToText(tags) === tagsToText(v.hashtags)) continue;
      must(await supabase.from("platform_variants").update({ text: d.text, hashtags: tags, edited_by_owner: true }).eq("content_item_id", item.id).eq("platform", v.platform));
    }
    setDirty(false);
    await load();
  }

  const record = async (decision: "approved" | "edited_approved" | "changes_requested" | "rejected") => {
    must(await supabase.from("approvals").insert({ brand_id: item!.brand_id, content_item_id: item!.id, user_id: session!.user.id, decision }));
  };
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    must(await supabase.from("content_items").update({ status, ...extra }).eq("id", item!.id));
  };

  const approve = () => run("approve", async () => {
    if (check?.verdict === "failed" && !window.confirm("The checker flagged blocking problems. Approve anyway?")) return;
    if (dirty) await saveEdits();
    const edited = dirty || variants.some((v) => v.edited_by_owner);
    await record(edited ? "edited_approved" : "approved");
    await setStatus("approved");
    setMsg({ tone: "success", text: "Approved. It is not scheduled yet: choose a time or Post now below." });
    await load();
  });

  const requestChanges = () => run("changes", async () => {
    if (!feedback.trim()) throw new Error("Tell the writer what should change first.");
    await record("changes_requested");
    await setStatus("draft");
    const job = await enqueueJob({ brandId: item!.brand_id, userId: session!.user.id, kind: "caption_package", itemId: item!.id, payload: { feedback: feedback.trim() } });
    setFeedback("");
    setDirty(false);
    setMsg({ tone: "success", text: job.wakeError ? "Sent back. The worker will pick it up on its next run." : "Sent back for a rewrite." });
    await load();
  });

  const reject = () => run("reject", async () => {
    if (!window.confirm("Reject this edition? It will leave the queue.")) return;
    await record("rejected");
    await setStatus("rejected");
    await load();
  });

  const withdraw = () => run("withdraw", async () => {
    await setStatus("queued");
    setMsg({ tone: "success", text: "Approval withdrawn. You can edit again and re-approve." });
    await load();
  });

  const schedule = (now: boolean) => run(now ? "now" : "schedule", async () => {
    const at = now ? new Date() : zonedToUtc(when, tz);
    if (!now && at.getTime() < Date.now() - 60_000) throw new Error("That time is in the past.");
    await setStatus("scheduled", { planned_for: at.toISOString() });
    const job = await enqueueJob({ brandId: item!.brand_id, userId: session!.user.id, kind: "publish", itemId: item!.id });
    setMsg({ tone: "success", text: `${now ? "Posting now" : "Scheduled for " + formatInTz(at.toISOString(), tz)}. Nothing is sent automatically: post it by hand from the panel below.${job.wakeError ? " (The worker will pick it up shortly.)" : ""}` });
    await load();
  });

  const retryPackage = () => run("retry", async () => {
    await enqueueJob({ brandId: item!.brand_id, userId: session!.user.id, kind: "caption_package", itemId: item!.id });
    setMsg({ tone: "success", text: "Retrying." });
    await load();
  });

  if (missing) return <p className="text-sm text-muted-foreground">That item was not found. <Link to="/queue" className="text-primary underline">Back to the queue</Link></p>;
  if (!item) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const captionJob = jobs.find((j) => j.kind === "caption_package");
  const publishJob = jobs.find((j) => j.kind === "publish");
  const showSchedule = item.status === "approved" && canAct;
  const post = drafts[tab];
  const postLen = post ? fullText(post.text, parseTags(post.tags)).length : 0;
  const limit = LIMITS[tab];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/queue" className="text-sm text-muted-foreground underline">← Queue</Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{item.title || "Untitled"}</h1>
        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
      </div>
      {msg && <p role={msg.tone === "danger" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${msg.tone === "danger" ? "bg-danger/15 text-danger" : "bg-success/15 text-success"}`}>{msg.text}</p>}
      {brand?.settings.publish_mode !== "live" && <p className="rounded-md bg-warning/10 p-2 text-xs text-warning">Hand-off mode: nothing is sent to Instagram, Facebook or X automatically. After approving, you copy the text and post it yourself.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-3">
          {image ? <img src={image} alt={byPlatform.instagram?.alt_text ?? item.title ?? "Cartoon"} className="w-full rounded-lg border border-border" /> : <div className="aspect-square w-full rounded-lg bg-muted" />}
          {item.change_note && <Card className="p-3 sm:p-3"><p className="text-xs text-muted-foreground">What changed from your ChatGPT draft</p><p className="text-sm">{item.change_note}</p></Card>}
          <details className="rounded-lg border border-border p-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Your original input</summary>
            <p className="mt-2 whitespace-pre-wrap"><b>Story note:</b> {item.story_note || "–"}</p>
            <p className="mt-2 whitespace-pre-wrap"><b>ChatGPT text:</b> {item.gpt_caption || "–"}</p>
          </details>
          {byPlatform.instagram?.alt_text && <p className="text-xs text-muted-foreground"><b>Alt text:</b> {byPlatform.instagram.alt_text}</p>}
        </div>

        <div className="space-y-3">
          {item.status === "draft" && (
            <Card className="space-y-2">
              <CardTitle>{captionJob?.status === "failed" || captionJob?.error ? "Caption writing hit a problem" : "Writing captions…"}</CardTitle>
              {captionJob?.status === "failed" || (captionJob?.status === "queued" && captionJob.error) ? (
                <>
                  <p role="alert" className="text-sm text-danger">{captionJob.error}</p>
                  {canAct && <Button onClick={retryPackage} disabled={!!busy}>Try again</Button>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground" role="status">{captionJob?.status === "running" ? "Claude is writing and checking the captions. This usually takes a minute." : "Queued. The worker starts within a minute; this page updates by itself."}</p>
              )}
            </Card>
          )}

          {variants.length > 0 && item.status !== "draft" && (
            <Card className="space-y-3">
              <div role="tablist" aria-label="Platform" className="flex flex-wrap gap-1">
                {PLATFORM_ORDER.map((p) => {
                  const over = drafts[p] ? fullText(drafts[p]!.text, parseTags(drafts[p]!.tags)).length > LIMITS[p] : false;
                  return (
                    <button key={p} role="tab" aria-selected={tab === p} onClick={() => setTab(p)}
                      className={`rounded-md px-3 py-1.5 text-sm ${tab === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"} ${over ? "ring-1 ring-danger" : ""}`}>
                      {PLATFORM_LABEL[p]}
                    </button>
                  );
                })}
              </div>
              {post && (
                <div role="tabpanel" className="space-y-2">
                  <label className="block text-sm" htmlFor="body">{PLATFORM_LABEL[tab]} text</label>
                  <textarea id="body" rows={tab === "x" || tab === "bluesky" ? 5 : 9} value={post.text} readOnly={!editable}
                    onChange={(e) => { setDrafts({ ...drafts, [tab]: { ...post, text: e.target.value } }); setDirty(true); }}
                    className="w-full rounded-md border border-border bg-muted p-3 text-sm read-only:opacity-80" />
                  <label className="block text-sm" htmlFor="tags">Hashtags</label>
                  <input id="tags" value={post.tags} readOnly={!editable}
                    onChange={(e) => { setDrafts({ ...drafts, [tab]: { ...post, tags: e.target.value } }); setDirty(true); }}
                    className="h-10 w-full rounded-md border border-border bg-muted px-3 text-sm read-only:opacity-80" />
                  <p className={`text-xs ${postLen > limit ? "font-semibold text-danger" : "text-muted-foreground"}`} aria-live="polite">{postLen} / {limit} characters (text + hashtags){postLen > limit ? " — too long" : ""}</p>
                </div>
              )}
              {!editable && item.status !== "queued" && item.status !== "checked" && <p className="text-xs text-muted-foreground">Text is locked while the item is {STATUS_LABEL[item.status].toLowerCase()}. Withdraw the approval to edit.</p>}
            </Card>
          )}

          {check && item.status !== "draft" && (
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Check</CardTitle>
                <Badge tone={check.verdict === "failed" ? "danger" : check.verdict === "fixed" ? "warning" : "success"}>{check.verdict}</Badge>
                {check.voice_score != null ? <Badge>voice {check.voice_score}/3</Badge> : <Badge>voice not scored (no voice guide yet)</Badge>}
              </div>
              {check.verdict === "fixed" && <p className="text-xs text-muted-foreground">The checker rewrote some text to resolve the flags below. The text shown is the rewrite.</p>}
              {check.flags.length === 0 ? <p className="text-sm text-muted-foreground">No flags.</p> : (
                <ul className="space-y-1 text-sm">
                  {check.flags.map((f, i) => (
                    <li key={i}><Badge tone={["unsupported_claim", "defamation_risk", "too_long", "banned_word"].includes(f.type) ? "danger" : "neutral"}>{f.type.replace("_", " ")}</Badge>{" "}
                      {f.platform && <span className="text-xs text-muted-foreground">{PLATFORM_LABEL[f.platform]}: </span>}{f.detail}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {(item.status === "queued" || item.status === "checked") && canAct && (
            <Card className="space-y-3">
              <CardTitle>Your decision</CardTitle>
              <div className="flex flex-wrap gap-2">
                {dirty && <Button variant="outline" disabled={!!busy} onClick={() => void run("save", saveEdits)}>Save edits</Button>}
                <Button disabled={!!busy} onClick={approve}>{busy === "approve" ? "Approving…" : check?.verdict === "failed" ? "Approve anyway" : "Approve"}</Button>
                <Button variant="outline" disabled={!!busy} onClick={reject}>Reject</Button>
              </div>
              <div className="space-y-2">
                <label className="block text-sm" htmlFor="fb">Request changes (the captions are rewritten)</label>
                <textarea id="fb" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. Make the X version punchier and drop the hashtags" className="w-full rounded-md border border-border bg-muted p-3 text-sm" />
                <Button variant="outline" disabled={!!busy || !feedback.trim()} onClick={requestChanges}>Request changes</Button>
              </div>
            </Card>
          )}

          {showSchedule && (
            <Card className="space-y-3">
              <CardTitle>Approved. Now choose when it goes out</CardTitle>
              <p className="text-xs text-muted-foreground">Approving does not publish anything. Scheduling is a separate step.</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-sm" htmlFor="when">Date and time ({tz})</label>
                  <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-10 rounded-md border border-border bg-muted px-3 text-sm" />
                </div>
                <Button disabled={!!busy || !when} onClick={() => void schedule(false)}>Schedule</Button>
                <Button variant="outline" disabled={!!busy} onClick={() => void schedule(true)}>Post now</Button>
              </div>
              <Button variant="ghost" disabled={!!busy} onClick={withdraw}>Withdraw approval and edit</Button>
            </Card>
          )}

          {(item.status === "scheduled" || item.status === "live") && (
            <Card className="space-y-2">
              <CardTitle>{item.status === "live" ? "Live" : "Scheduled"}{item.planned_for ? ` · ${formatInTz(item.planned_for, tz)}` : ""}</CardTitle>
              {publishJob && (publishJob.status === "failed" || (publishJob.status === "queued" && publishJob.error)) && <p role="alert" className="text-sm text-danger">Publishing problem: {publishJob.error}</p>}
              {publishJob && publishJob.status !== "succeeded" && !publishJob.error && <p className="text-xs text-muted-foreground" role="status">Publish job: {publishJob.status}…</p>}
              {pubs.filter((p) => p.mode !== "manual").length === 0 ? <p className="text-sm text-muted-foreground">Nothing is sent automatically. Use the Post by hand panel below at your scheduled time.</p> : (
                <ul className="space-y-1 text-sm">
                  {pubs.filter((p) => p.mode !== "manual").map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2">
                      <span className="capitalize">{p.platform} {p.format}</span>
                      <Badge tone={p.mode === "dry_run" ? "warning" : p.status === "failed" ? "danger" : "success"}>{p.mode === "dry_run" ? "dry run (not sent)" : p.status}</Badge>
                      {p.external_url && <a href={p.external_url} target="_blank" rel="noreferrer" className="text-primary underline">open ↗</a>}
                      {p.error && <span className="text-xs text-danger">{p.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {(item.status === "approved" || item.status === "scheduled" || item.status === "live") && (
            <HandoffCard itemId={item.id} imagePath={item.source_image_path} variants={variants} pubs={pubs} platformsCfg={brand?.settings.platforms ?? {}}
              canAct={canAct} onChanged={() => void load()} onMessage={setMsg} />
          )}
        </div>
      </div>
    </div>
  );
}
