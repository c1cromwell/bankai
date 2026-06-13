/**
 * seq-v0 — a deterministic, time-aware *sequence* scorer standing in for the
 * served Transformer in FraudEngine.md. It consumes the user's recent amount
 * sequence (the feature-store sequence state) and scores how anomalous the
 * current step is relative to the learned-so-far distribution.
 *
 * It is NOT a neural net — it is a transparent statistical sequence model
 * (robust z-score of the latest amount vs the trailing sequence, plus a
 * burstiness term). It satisfies the same Model interface and decision/audit
 * contract, so a real Transformer endpoint slots in behind ServingBackend later
 * with zero change upstream.
 */

import type { Model } from "./modelTypes";
import { clamp01 } from "./modelTypes";
import type { EnrichedEvent } from "../features/enrichment";
import type { ModelOutput, Reason, Contribution } from "../types";

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export class SequenceModel implements Model {
  readonly version = "seq-v0";
  readonly kind = "sequence" as const;

  score(ev: EnrichedEvent): ModelOutput {
    const reasons: Reason[] = [];
    const explanation: Contribution[] = [];
    let score = 0;

    const add = (code: string, weight: number) => {
      score += weight;
      reasons.push({ code, weight });
      explanation.push({ feature: code, contribution: weight });
    };

    const seq = ev.amountSequence.map((a) => Number(a));
    const current = seq[seq.length - 1] ?? 0;
    const history = seq.slice(0, -1);

    // Sequence anomaly — robust z-score of the current amount vs the trailing
    // sequence. Needs a few prior points to be meaningful.
    if (history.length >= 3 && current > 0) {
      const m = mean(history);
      const s = std(history, m);
      const z = s > 0 ? (current - m) / s : current > m * 2 ? 3 : 0;
      if (z >= 4) add("sequence_zscore_extreme", 0.6);
      else if (z >= 2.5) add("sequence_zscore_high", 0.35);
    }

    // Burstiness — the velocity window is filling faster than the user's norm.
    if (ev.velocity >= 8) add("sequence_burst", 0.3);

    // Escalation pattern — a monotonically increasing tail of amounts (cash-out ramp).
    if (history.length >= 3) {
      const tail = seq.slice(-4);
      const increasing = tail.every((v, i) => i === 0 || v >= (tail[i - 1] ?? 0));
      if (increasing && current > 0) add("sequence_escalation", 0.25);
    }

    return { score: clamp01(score), reasons, explanation, modelVersion: this.version };
  }
}
