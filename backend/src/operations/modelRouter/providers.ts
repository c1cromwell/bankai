/**
 * M4 — Provider seam: Anthropic live; OpenAI/Google/local stubs.
 */

import { AppError, ErrorCode } from "../../errors";
import { config } from "../../config";
import type { ModelInvokeRequest, ModelInvokeResult, RegistryEntry } from "./types";

function microCost(entry: RegistryEntry, inputTokens: number, outputTokens: number): number {
  return Math.round(
    (inputTokens * entry.inputMicroUsdPer1k) / 1000 + (outputTokens * entry.outputMicroUsdPer1k) / 1000
  );
}

async function invokeAnthropic(entry: RegistryEntry, req: ModelInvokeRequest): Promise<ModelInvokeResult> {
  if (!config.ANTHROPIC_API_KEY) {
    throw new AppError(ErrorCode.INTERNAL, "ANTHROPIC_API_KEY required for anthropic provider");
  }
  const started = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: entry.model,
    max_tokens: req.maxTokens ?? 512,
    system: req.system,
    tools: req.tools,
    tool_choice: req.toolChoice,
    messages: [{ role: "user", content: req.userContent }],
  });
  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;
  const latencyMs = Date.now() - started;
  return {
    modelId: entry.id,
    vendor: entry.vendor,
    tier: entry.tier,
    raw: message,
    inputTokens,
    outputTokens,
    latencyMs,
    costMicroUsd: microCost(entry, inputTokens, outputTokens),
  };
}

function stubProvider(vendor: string): never {
  throw new AppError(ErrorCode.NOT_IMPLEMENTED, `${vendor} model provider not wired — use anthropic tier`);
}

export async function invokeProvider(entry: RegistryEntry, req: ModelInvokeRequest): Promise<ModelInvokeResult> {
  switch (entry.vendor) {
    case "anthropic":
      return invokeAnthropic(entry, req);
    case "openai":
      return stubProvider("OpenAI");
    case "google":
      return stubProvider("Google");
    case "local":
      return stubProvider("Local");
    default:
      throw new AppError(ErrorCode.INTERNAL, `Unknown vendor ${entry.vendor}`);
  }
}

export { microCost };
