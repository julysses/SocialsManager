import { spawn } from "node:child_process";
import { UsageLimitError, type CompleteRequest, type CompleteResult, type ModelProvider } from "./provider.js";

/** Env for the child process: no API keys (subscription only) and a whitespace-free OAuth token (terminals wrap long tokens when copied). */
export function buildChildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN.replace(/\s+/g, "");
  return env;
}

export interface ClaudeCliOptions {
  /** Executable name or path. */
  bin?: string;
  model?: string;
}

/**
 * Runs `claude -p` using the subscription token in CLAUDE_CODE_OAUTH_TOKEN.
 * ANTHROPIC_API_KEY is stripped from the child env so a stray key can never switch billing to the API.
 */
export class ClaudeCliProvider implements ModelProvider {
  readonly mode = "claude-cli";
  constructor(private readonly opts: ClaudeCliOptions = {}) {}

  buildArgs(req: CompleteRequest): string[] {
    const args = ["-p", "--output-format", "json", "--append-system-prompt", req.system, "--max-turns", "4"];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (req.attachments?.length) {
      const dirs = [...new Set(req.attachments.map((f) => f.replace(/\/[^/]*$/, "") || "/"))];
      args.push("--allowedTools", "Read", "--add-dir", ...dirs);
    }
    else args.push("--tools", "");
    return args;
  }

  complete(req: CompleteRequest): Promise<CompleteResult> {
    const started = Date.now();
    const env = buildChildEnv(process.env);
    const prompt = req.attachments?.length
      ? `${req.prompt}\n\nFiles you may read:\n${req.attachments.map((p) => `- ${p}`).join("\n")}`
      : req.prompt;

    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.bin ?? "claude", this.buildArgs(req), { env, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`claude timed out after ${req.timeoutMs ?? 240_000}ms`));
      }, req.timeoutMs ?? 240_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          resolve(parseCliOutput(out, err, code, Date.now() - started));
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.end(prompt);
    });
  }
}

const LIMIT_RE = /(usage limit|rate limit|limit reached|quota)/i;

export function parseCliOutput(stdout: string, stderr: string, code: number | null, durationMs: number): CompleteResult {
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    /* fall through to error handling */
  }
  const text: string | undefined = typeof parsed?.result === "string" ? parsed.result : undefined;
  const isError = parsed?.is_error === true || code !== 0;
  if (isError) {
    const msg = `${text ?? ""} ${stderr}`.trim() || `claude exited with code ${code}`;
    if (LIMIT_RE.test(msg)) throw new UsageLimitError(msg.slice(0, 300), parseRetryAt(msg));
    throw new Error(msg.slice(0, 500));
  }
  if (text === undefined) throw new Error("claude returned no result field");
  return {
    text,
    model: parsed?.model,
    tokensIn: parsed?.usage?.input_tokens,
    tokensOut: parsed?.usage?.output_tokens,
    durationMs,
  };
}

/** Best-effort parse of "resets at 3pm" style hints; otherwise retry in 30 minutes. */
export function parseRetryAt(msg: string, now = new Date()): Date {
  const epoch = msg.match(/\|(\d{10})\b/);
  if (epoch) return new Date(Number(epoch[1]) * 1000);
  const hm = msg.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (hm) {
    let h = Number(hm[1]) % 12;
    if (hm[3]!.toLowerCase() === "pm") h += 12;
    const d = new Date(now);
    d.setHours(h, Number(hm[2] ?? 0), 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  return new Date(now.getTime() + 30 * 60_000);
}
