import { describe, expect, it } from "vitest";
import { summarizeHealth, type JobRow } from "./health";

const j = (over: Partial<JobRow>): JobRow => ({
  id: "x", kind: "hello", status: "queued", error: null, attempts: 0,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...over,
});

describe("summarizeHealth", () => {
  it("is idle with no jobs", () => {
    expect(summarizeHealth([])).toMatchObject({ queueDepth: 0, state: "idle", lastJobAt: null });
  });
  it("counts queued/running and reports busy", () => {
    const h = summarizeHealth([j({ status: "queued" }), j({ status: "running" })]);
    expect(h).toMatchObject({ queueDepth: 1, running: 1, state: "busy" });
  });
  it("flags attention when the latest finished job failed", () => {
    const h = summarizeHealth([
      j({ status: "succeeded", updated_at: "2026-01-01T01:00:00Z" }),
      j({ status: "failed", error: "boom", updated_at: "2026-01-01T02:00:00Z" }),
    ]);
    expect(h).toMatchObject({ state: "attention", lastError: "boom", lastJobAt: "2026-01-01T02:00:00Z" });
  });
  it("is healthy again once a later job succeeds", () => {
    const h = summarizeHealth([
      j({ status: "failed", error: "boom", updated_at: "2026-01-01T01:00:00Z" }),
      j({ status: "succeeded", updated_at: "2026-01-01T02:00:00Z" }),
    ]);
    expect(h.state).toBe("idle");
  });
});
