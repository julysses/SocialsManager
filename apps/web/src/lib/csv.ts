/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportedPost {
  platform: "instagram" | "facebook" | "x" | "threads" | "bluesky" | "tiktok";
  text: string;
  posted_at: string | null;
  external_id: string | null;
  metrics: Record<string, number>;
}

const pick = (header: string[], names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
const num = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[, %]/g, ""));
  return Number.isFinite(n) && (v ?? "").trim() !== "" ? n : null;
};

function platformOf(v: string | undefined, fallback: ImportedPost["platform"]): ImportedPost["platform"] {
  const s = (v ?? "").toLowerCase();
  if (s.includes("insta")) return "instagram";
  if (s.includes("face")) return "facebook";
  if (s === "x" || s.includes("twitter")) return "x";
  if (s.includes("thread")) return "threads";
  if (s.includes("bsky") || s.includes("bluesky")) return "bluesky";
  if (s.includes("tiktok")) return "tiktok";
  return fallback;
}

/** Turns a Metricool-style (or any) export into post rows. Column names are matched loosely. */
export function csvToPosts(text: string, fallback: ImportedPost["platform"]): { posts: ImportedPost[]; skipped: number; error?: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { posts: [], skipped: 0, error: "The file has no data rows." };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const iText = pick(header, ["text", "caption", "message", "content", "post"]);
  if (iText < 0) return { posts: [], skipped: 0, error: `No caption column found. Columns: ${rows[0]!.join(", ")}` };
  const iDate = pick(header, ["published", "posted", "date", "time", "created"]);
  const iNet = pick(header, ["network", "platform", "channel"]);
  const iId = pick(header, ["post id", "id", "url", "link", "permalink"]);
  const metricCols: [string, number][] = (["likes", "comments", "shares", "saves", "views", "impressions", "reach", "clicks", "engagement"] as const)
    .map((m) => [m, header.findIndex((h) => h === m || h.startsWith(m))] as [string, number])
    .filter(([, i]) => i >= 0);

  let skipped = 0;
  const posts: ImportedPost[] = [];
  for (const r of rows.slice(1)) {
    const t = (r[iText] ?? "").trim();
    if (!t) { skipped++; continue; }
    const d = iDate >= 0 ? new Date(r[iDate] ?? "") : null;
    const metrics: Record<string, number> = {};
    for (const [m, i] of metricCols) { const n = num(r[i]); if (n !== null) metrics[m] = n; }
    posts.push({
      platform: platformOf(iNet >= 0 ? r[iNet] : undefined, fallback),
      text: t,
      posted_at: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      external_id: iId >= 0 && (r[iId] ?? "").trim() ? (r[iId] ?? "").trim() : null,
      metrics,
    });
  }
  return { posts, skipped };
}
