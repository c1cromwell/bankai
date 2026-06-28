/**
 * M4 — Claude-tiered model registry (+ vendor stubs for OpenAI/Google/local).
 */

import { config } from "../../config";
import type { CapabilityTier, RegistryEntry, TaskClass } from "./types";

export const TASK_TIER: Record<TaskClass, CapabilityTier> = {
  legal_draft: "high",
  launch_decision: "high",
  compliance_analysis: "standard",
  code_review: "standard",
  kyc_review: "standard",
  triage: "fast",
  summary: "fast",
  general: "fast",
};

/** Default registry — Anthropic live; other vendors are routing placeholders. */
export const MODEL_REGISTRY: RegistryEntry[] = [
  {
    id: "claude-opus-4",
    vendor: "anthropic",
    tier: "high",
    model: "claude-opus-4-20250514",
    contextWindow: 200_000,
    inputMicroUsdPer1k: 15_000,
    outputMicroUsdPer1k: 75_000,
    latencyClass: "slow",
    enabled: true,
  },
  {
    id: "claude-sonnet-4",
    vendor: "anthropic",
    tier: "standard",
    model: "claude-sonnet-4-20250514",
    contextWindow: 200_000,
    inputMicroUsdPer1k: 3_000,
    outputMicroUsdPer1k: 15_000,
    latencyClass: "normal",
    enabled: true,
  },
  {
    id: "claude-haiku-4",
    vendor: "anthropic",
    tier: "fast",
    model: config.ANTHROPIC_MODEL,
    contextWindow: 200_000,
    inputMicroUsdPer1k: 250,
    outputMicroUsdPer1k: 1_250,
    latencyClass: "fast",
    enabled: true,
  },
  {
    id: "gpt-4o-stub",
    vendor: "openai",
    tier: "standard",
    model: "gpt-4o",
    contextWindow: 128_000,
    inputMicroUsdPer1k: 2_500,
    outputMicroUsdPer1k: 10_000,
    latencyClass: "normal",
    enabled: false,
  },
  {
    id: "gemini-pro-stub",
    vendor: "google",
    tier: "standard",
    model: "gemini-1.5-pro",
    contextWindow: 128_000,
    inputMicroUsdPer1k: 1_250,
    outputMicroUsdPer1k: 5_000,
    latencyClass: "normal",
    enabled: false,
  },
  {
    id: "local-llm-stub",
    vendor: "local",
    tier: "fast",
    model: "local/default",
    contextWindow: 32_000,
    inputMicroUsdPer1k: 0,
    outputMicroUsdPer1k: 0,
    latencyClass: "fast",
    enabled: false,
  },
];

export function registryForTier(tier: CapabilityTier): RegistryEntry[] {
  return MODEL_REGISTRY.filter((e) => e.tier === tier && e.enabled);
}

export function getRegistryEntry(id: string): RegistryEntry | undefined {
  return MODEL_REGISTRY.find((e) => e.id === id);
}

export function routingPreview(): Array<{ taskClass: TaskClass; tier: CapabilityTier; primaryModel: string; vendor: string }> {
  return (Object.keys(TASK_TIER) as TaskClass[]).map((taskClass) => {
    const tier = TASK_TIER[taskClass];
    const primary = registryForTier(tier).sort((a, b) => a.inputMicroUsdPer1k - b.inputMicroUsdPer1k)[0];
    return {
      taskClass,
      tier,
      primaryModel: primary?.id ?? "none",
      vendor: primary?.vendor ?? "anthropic",
    };
  });
}
