import { describe, expect, it } from "vitest";
import { AgentOutputError, ClaudeCliProvider, MockProvider, UsageLimitError, createProvider, extractJson, helloAgent, runAgent } from "../src/index.js";
import { parseCliOutput, parseRetryAt } from "../src/claude-cli.js";
import { ApiProvider } from "../src/api-provider.js";

describe("extractJson", () => {
  it("handles plain, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":3} done')).toEqual({ a: 3 });
    expect(() => extractJson("nope")).toThrow();
  });
});

describe("runAgent", () => {
  it("returns validated data", async () => {
    const r = await runAgent(new MockProvider(), helloAgent, "ping");
    expect(r.data.status).toBe("ok");
    expect(r.promptHash).toHaveLength(16);
  });

  it("retries once on invalid output then succeeds", async () => {
    const p = new MockProvider((_r, n) => (n === 1 ? "garbage" : '{"status":"ok","message":"fixed"}'));
    const r = await runAgent(p, helloAgent, "ping");
    expect(r.data.message).toBe("fixed");
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1]!.prompt).toContain("previous reply was invalid");
  });

  it("fails after one retry and keeps the raw output", async () => {
    const p = new MockProvider(() => '{"status":"nope"}');
    await expect(runAgent(p, helloAgent, "ping")).rejects.toMatchObject({ name: "AgentOutputError", raw: '{"status":"nope"}' });
    expect(p.calls).toHaveLength(2);
  });
});

describe("ClaudeCliProvider", () => {
  it("disables tools for text-only agents and only allows Read with attachments", () => {
    const p = new ClaudeCliProvider();
    expect(p.buildArgs({ system: "s", prompt: "p" })).toEqual(expect.arrayContaining(["--tools", ""]));
    expect(p.buildArgs({ system: "s", prompt: "p", attachments: ["/x.png"] })).toEqual(expect.arrayContaining(["--allowedTools", "Read"]));
  });

  it("parses a successful CLI result", () => {
    const r = parseCliOutput(JSON.stringify({ result: "hi", usage: { input_tokens: 3, output_tokens: 4 } }), "", 0, 10);
    expect(r).toMatchObject({ text: "hi", tokensIn: 3, tokensOut: 4 });
  });

  it("maps usage-limit errors to UsageLimitError", () => {
    expect(() => parseCliOutput(JSON.stringify({ is_error: true, result: "Claude usage limit reached. resets at 3pm" }), "", 1, 1)).toThrow(UsageLimitError);
  });

  it("throws plain errors for other failures", () => {
    expect(() => parseCliOutput("", "boom", 1, 1)).toThrow(/boom/);
  });

  it("parses reset hints", () => {
    const now = new Date("2026-01-01T10:00:00");
    expect(parseRetryAt("resets at 3pm", now).getHours()).toBe(15);
    expect(parseRetryAt("no hint", now).getTime() - now.getTime()).toBe(30 * 60_000);
  });
});

describe("provider factory", () => {
  it("only supports claude-cli and mock; ApiProvider is inert", async () => {
    expect(createProvider("claude-cli").mode).toBe("claude-cli");
    expect(() => createProvider("api")).toThrow(/unsupported/);
    await expect(new ApiProvider().complete({ system: "", prompt: "" })).rejects.toThrow(/not enabled/);
  });
});
