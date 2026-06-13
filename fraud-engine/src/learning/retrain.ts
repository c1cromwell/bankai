/**
 * Retrain — the lakehouse + training-pipeline analog (Stage 4). In the north-star
 * this aggregates labeled features from the lake, trains a new Transformer version,
 * and registers it for shadow testing. Here it does the *workflow* faithfully:
 * read accumulated labels (drift signal), mint a new candidate model version,
 * register a serving backend for it, and land it in the registry as SHADOW —
 * never straight to prod. Promotion stays a deliberate, audited config change.
 */

import type { Db } from "../db";
import type { ModelRegistry } from "../models/registry";
import type { ModelServer } from "../models/serving";
import type { LabelStore } from "./labelStore";
import { SequenceModel } from "../models/sequenceModel";
import { retrainTotal } from "../observability/metrics";

export interface RetrainResult {
  candidateVersion: string;
  status: "registered" | "insufficient_labels";
  labels: { confirmed_fraud: number; legit: number; chargeback: number; total: number };
  driftScore: number;
}

/** Minimum labels before a retrain is meaningful (prototype gate). */
const MIN_LABELS = 1;

export class Retrainer {
  constructor(
    private db: Db,
    private registry: ModelRegistry,
    private server: ModelServer,
    private labels: LabelStore
  ) {}

  async retrain(): Promise<RetrainResult> {
    const counts = await this.labels.recentCounts();
    const fraud = counts.confirmed_fraud + counts.chargeback;
    const driftScore = counts.total > 0 ? fraud / counts.total : 0;

    if (counts.total < MIN_LABELS) {
      retrainTotal.inc({ result: "insufficient_labels" });
      return { candidateVersion: "", status: "insufficient_labels", labels: counts, driftScore };
    }

    // Mint a new candidate version. In a real pipeline this artifact comes from a
    // training run; here it is the same sequence scorer registered under a new
    // version so it genuinely runs in shadow and is comparable to prod.
    const candidateVersion = `seq-v0+r${Date.now()}`;
    const base = new SequenceModel();
    this.server.registerBackend({
      version: candidateVersion,
      async score(ev) {
        const out = base.score(ev);
        return { ...out, modelVersion: candidateVersion };
      },
    });
    await this.registry.register(
      candidateVersion,
      "sequence",
      "shadow",
      `retrain candidate; drift=${driftScore.toFixed(2)} over ${counts.total} labels`
    );

    retrainTotal.inc({ result: "registered" });
    return { candidateVersion, status: "registered", labels: counts, driftScore };
  }
}
