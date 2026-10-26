import type { CompleteRequest, CompleteResult, ModelProvider } from "./provider.js";

/** Deterministic provider for tests and dry-run pipelines. Never touches the network. */
export class MockProvider implements ModelProvider {
  readonly mode = "mock";
  readonly calls: CompleteRequest[] = [];
  constructor(private readonly responder: (req: CompleteRequest, n: number) => string = () => '{"status":"ok","message":"mock provider online"}') {}
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    this.calls.push(req);
    return { text: this.responder(req, this.calls.length), model: "mock", durationMs: 1 };
  }
}
