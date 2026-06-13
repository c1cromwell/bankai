/**
 * Router — the fraud-team's config-driven model router (Stage 4).
 *
 * Reads the live registry + routing_config and decides, per event:
 *   - which model(s) are PROD (ensembled — conservative max-score union),
 *   - whether a CANARY model is active for this user (deterministic hash bucket
 *     by canary_pct) and therefore supplies the effective decision,
 *   - which models run as SHADOW (scored, compared, logged — never acted on).
 *
 * Promotion is a registry status change, picked up on the next event — no
 * redeploy. This is the "update config → prod switches routing" property.
 */

import { createHash } from "crypto";
import type { ModelServer } from "../models/serving";
import type { ModelRegistry } from "../models/registry";
import type { EnrichedEvent } from "../features/enrichment";
import type { Db } from "../db";
import type { FraudAction, ModelOutput, ShadowResult, Reason, Contribution } from "../types";

export interface Thresholds {
  blockAt: number;
  challengeAt: number;
  flagAt: number;
  freezeAt: number;
}

export interface RouteResult {
  output: ModelOutput;
  action: FraudAction;
  /** Action ignoring the freeze ceiling — what a sync caller would gate on. */
  shadow: ShadowResult[];
  effectiveModel: string;
}

/** Deterministic 0..99 bucket for a (user, model) pair. */
function bucket(userId: string, version: string): number {
  const h = createHash("sha256").update(`${userId}:${version}`).digest();
  return h[0]! % 100;
}

export function actionFor(score: number, t: Thresholds, mode: "score" | "async"): FraudAction {
  const milli = Math.round(score * 1000);
  // Only the async path can escalate to a freeze recommendation (it's a standing
  // remediation, not a synchronous money gate).
  if (mode === "async" && milli >= t.freezeAt) return "freeze";
  if (milli >= t.blockAt) return "block";
  if (milli >= t.challengeAt) return "challenge";
  if (milli >= t.flagAt) return "flag";
  return "allow";
}

/** Conservative ensemble: max score, union of reasons/explanation. */
function ensemble(outputs: ModelOutput[]): ModelOutput {
  if (outputs.length === 1) return outputs[0]!;
  let best = outputs[0]!;
  const reasons: Reason[] = [];
  const explanation: Contribution[] = [];
  const versions: string[] = [];
  for (const o of outputs) {
    if (o.score > best.score) best = o;
    reasons.push(...o.reasons);
    explanation.push(...o.explanation);
    versions.push(o.modelVersion);
  }
  return { score: best.score, reasons, explanation, modelVersion: `ensemble[${versions.join("+")}]` };
}

export class Router {
  constructor(
    private registry: ModelRegistry,
    private server: ModelServer,
    private db: Db
  ) {}

  async thresholds(): Promise<Thresholds> {
    const row = await this.db.queryOne<{
      block_at: number;
      challenge_at: number;
      flag_at: number;
      freeze_at: number;
    }>("SELECT block_at, challenge_at, flag_at, freeze_at FROM routing_config WHERE id = 'default'");
    return {
      blockAt: Number(row?.block_at ?? 800),
      challengeAt: Number(row?.challenge_at ?? 500),
      flagAt: Number(row?.flag_at ?? 250),
      freezeAt: Number(row?.freeze_at ?? 900),
    };
  }

  async route(ev: EnrichedEvent, mode: "score" | "async"): Promise<RouteResult> {
    const t = await this.thresholds();
    const [prod, canaries, shadows] = await Promise.all([
      this.registry.byStatus("prod"),
      this.registry.byStatus("canary"),
      this.registry.byStatus("shadow"),
    ]);

    // PROD ensemble (fall back to rules-v1 if nothing marked prod yet).
    const prodVersions = prod.map((m) => m.version).filter((v) => this.server.has(v));
    const prodOutputs =
      prodVersions.length > 0
        ? await Promise.all(prodVersions.map((v) => this.server.score(v, ev)))
        : [await this.server.score("rules-v1", ev)];
    let effective = ensemble(prodOutputs);

    const shadowResults: ShadowResult[] = [];

    // CANARY: active for this user → supplies the effective decision; else shadow.
    for (const c of canaries) {
      if (!this.server.has(c.version)) continue;
      const out = await this.server.score(c.version, ev);
      const active = bucket(ev.raw.userId, c.version) < c.canaryPct;
      if (active) {
        effective = out;
      } else {
        shadowResults.push({ modelVersion: out.modelVersion, score: out.score, action: actionFor(out.score, t, mode) });
      }
    }

    // SHADOW: scored, never acted on.
    for (const s of shadows) {
      if (!this.server.has(s.version)) continue;
      const out = await this.server.score(s.version, ev);
      shadowResults.push({ modelVersion: out.modelVersion, score: out.score, action: actionFor(out.score, t, mode) });
    }

    return {
      output: effective,
      action: actionFor(effective.score, t, mode),
      shadow: shadowResults,
      effectiveModel: effective.modelVersion,
    };
  }
}
