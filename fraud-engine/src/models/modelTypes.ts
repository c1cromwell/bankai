/**
 * Model interface — every scorer (rules, sequence, future served Transformer)
 * implements this. score() is pure given the enriched event, so models are fully
 * unit-testable offline (the FraudEngine.md serving target is the eventual
 * drop-in: a ServingBackend that calls a Triton/vLLM endpoint behind this iface).
 */

import type { EnrichedEvent } from "../features/enrichment";
import type { ModelOutput } from "../types";

export interface Model {
  readonly version: string;
  readonly kind: "rules" | "sequence";
  score(ev: EnrichedEvent): ModelOutput;
}

/** Clamp a score into 0..1. */
export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
