import { createProvider } from "@socialos/agents";
import { SupabaseDb } from "./supabase-db.js";
import { runWorker } from "./process.js";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const db = new SupabaseDb(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"));
const provider = createProvider(process.env.MODEL_PROVIDER || "claude-cli");
const { processed, minutes } = await runWorker({ db, provider, log: (m) => console.log(m) });
console.log(`::notice title=Worker::${processed} job(s), ${minutes.toFixed(2)} min`);
