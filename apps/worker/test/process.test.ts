import { describe, expect, it } from "vitest";
import { MockProvider, UsageLimitError, type ModelProvider } from "@socialos/agents";
import { processJob, runWorker } from "../src/process.js";
import type { Job, WorkerDb } from "../src/types.js";
import { FakeDb } from "./fake-db.js";

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", brand_id: "b1", content_item_id: null, kind: "hello", payload: {}, attempts: 1, max_attempts: 3, ...over,
});

function fakeDb(queue: Job[] = []) {
  const f = new FakeDb();
  f.queue = queue;
  return { db: f as WorkerDb, calls: f.calls, runs: f.runs };
}

const limited: ModelProvider = { mode: "mock", complete: async () => { throw new UsageLimitError("limit", new Date("2026-01-01T15:00:00Z")); } };
const broken: ModelProvider = { mode: "mock", complete: async () => { throw new Error("boom"); } };

describe("processJob", () => {
  it("succeeds and writes agent_runs", async () => {
    const { db, calls, runs } = fakeDb();
    expect(await processJob(job(), { db, provider: new MockProvider() })).toBe("succeeded");
    expect(calls[0]).toMatchObject({ fn: "succeed", args: ["j1", { status: "ok" }] });
    expect(runs[0]).toMatchObject({ agent_key: "hello", provider_mode: "mock", job_id: "j1" });
  });

  it("retries with backoff before max attempts", async () => {
    const { db, calls, runs } = fakeDb();
    const now = new Date("2026-01-01T00:00:00Z");
    expect(await processJob(job({ attempts: 1 }), { db, provider: broken, now: () => now })).toBe("retry");
    const [, , retryAt] = calls[0]!.args as [string, string, Date];
    expect(retryAt.getTime() - now.getTime()).toBe(2 * 60_000);
    expect(runs[0]!.error).toBe("boom");
  });

  it("fails permanently on the last attempt and keeps raw output for invalid agent output", async () => {
    const { db, calls, runs } = fakeDb();
    const bad = new MockProvider(() => "not json");
    expect(await processJob(job({ attempts: 3 }), { db, provider: bad })).toBe("failed");
    expect(calls[0]!.args[2]).toBeNull();
    expect(runs[0]!.raw_output).toBe("not json");
  });

  it("re-queues on usage limit without consuming an attempt", async () => {
    const { db, calls } = fakeDb();
    expect(await processJob(job(), { db, provider: limited })).toBe("limit");
    expect(calls[0]!.args[1]).toBe("Claude limit reached, retrying at 15:00 UTC");
    expect(calls[0]!.args[3]).toBe(true);
  });

  it("fails jobs of unknown kind", async () => {
    const { db, runs } = fakeDb();
    await processJob(job({ kind: "nope", attempts: 3 }), { db, provider: new MockProvider() });
    expect(runs[0]!.error).toMatch(/no handler/);
  });
});

describe("runWorker", () => {
  it("drains the queue and stops when empty", async () => {
    const { db, calls } = fakeDb([job({ id: "a" }), job({ id: "b" })]);
    const r = await runWorker({ db, provider: new MockProvider() });
    expect(r.processed).toBe(2);
    expect(calls.filter((c) => c.fn === "succeed")).toHaveLength(2);
  });
});
