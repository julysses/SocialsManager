import type { CompleteRequest, CompleteResult, ModelProvider } from "./provider.js";

/**
 * Stub for paid tenants (Anthropic API key). Deliberately not wired to anything in v1:
 * the worker never constructs it and `createProvider` refuses it.
 */
export class ApiProvider implements ModelProvider {
  readonly mode = "api";
  async complete(_req: CompleteRequest): Promise<CompleteResult> {
    throw new Error("ApiProvider is not enabled in v1 (subscription mode only)");
  }
}
