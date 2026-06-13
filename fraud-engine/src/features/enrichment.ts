/**
 * Enrichment — turns a raw RiskEvent into an EnrichedEvent by joining the
 * per-user feature snapshot (Stage 3). This is the Flink "stateful enrichment"
 * step: read state-as-of-now, derive features, hand the enriched record to the
 * model router. The store is updated separately (after scoring) so the score
 * reflects the user's history *before* this event.
 */

import type { FeatureStore, UserFeatures } from "./featureStore";
import { VELOCITY_WINDOW_SECS } from "./featureStore";
import type { RiskEvent } from "../types";

export interface EnrichedEvent {
  raw: RiskEvent;
  features: UserFeatures;
  /** Count of events inside the velocity window (pre-event). */
  velocity: number;
  /** True when this counterparty was never seen before. */
  newPayee: boolean;
  /** Largest prior amount (minor units). */
  trailingMaxMinor: bigint;
  /** Mean prior out amount (minor units, 0 when no history). */
  avgOutMinor: bigint;
  /** Recent amount sequence including this event's amount (sequence model input). */
  amountSequence: bigint[];
  /** Geo differs from the user's last-seen geo. */
  geoChanged: boolean;
  /** Device differs from the user's last-seen device. */
  deviceChanged: boolean;
}

export async function enrich(event: RiskEvent, store: FeatureStore): Promise<EnrichedEvent> {
  const f = await store.get(event.userId);

  const windowStart = Date.now() - VELOCITY_WINDOW_SECS * 1000;
  const velocity = f.recentEventTs.filter((t) => Date.parse(t) >= windowStart).length;

  const avgOutMinor = f.transferOutCount > 0 ? f.totalOutMinor / BigInt(f.transferOutCount) : 0n;
  const amount = event.amountMinor ?? 0n;

  return {
    raw: event,
    features: f,
    velocity,
    newPayee: event.counterpartyId ? !f.distinctPayees.includes(event.counterpartyId) : false,
    trailingMaxMinor: f.trailingMaxMinor,
    avgOutMinor,
    amountSequence: [...f.recentAmountsMinor, amount],
    geoChanged: !!event.geo && !!f.lastGeo && event.geo !== f.lastGeo,
    deviceChanged: !!event.deviceId && !!f.lastDeviceId && event.deviceId !== f.lastDeviceId,
  };
}
