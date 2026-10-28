// Fails if code outside packages/publisher can call a social-platform write endpoint.
// Only the publisher module may post, schedule or send to a platform (see CLAUDE.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", "dist", ".git", ".wrangler"]);
const ALLOWED = ["packages/publisher/"];
// Only API hosts count. Plain links (e.g. the "Open Metricool" button) are not write calls.
const PATTERNS = [
  /api\.metricool\.com/i,
  /graph\.facebook\.com/i,
  /graph\.instagram\.com/i,
  /api\.(twitter|x)\.com/i,
  /graph\.threads\.net/i,
  /bsky\.social\/xrpc/i,
  /open\.tiktokapis\.com/i,
];
const SELF = "scripts/check-no-platform-writes.mjs";

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs|sql|yml|yaml)$/.test(name)) yield p;
  }
}

const bad = [];
for (const file of walk(root)) {
  const rel = relative(root, file);
  if (rel === SELF || ALLOWED.some((a) => rel.startsWith(a))) continue;
  const text = readFileSync(file, "utf8");
  for (const re of PATTERNS) if (re.test(text)) bad.push(`${rel}: references ${re}`);
}
if (bad.length) {
  console.error("Platform endpoints referenced outside packages/publisher:\n" + bad.join("\n"));
  process.exit(1);
}
console.log("ok: no platform write endpoints outside packages/publisher");
