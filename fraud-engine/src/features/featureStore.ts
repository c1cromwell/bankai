/**
 * Feature store — the Flink-per-user-state + online feature store analog (Stage 3).
 *
 * Maintains rolling per-user state: velocity window, trailing max, seen payees,
 * recent-amount sequence (the sequence model's input), and last device/geo. The
 * interface is what a Tecton/Redis online store would expose; the SQLite impl is
 * the prototype stand-in.
 *
 * Reads are PII-light: the store keeps derived facts (counts, amounts, hashed-ish
 * ids the caller already passes), never raw KYC data.
 */

import type { Db } from "../db";
import type { RiskEvent } from "../types";

/** Velocity window: events by the same user inside this many seconds. */
export const VELOCITY_WINDOW_SECS = 60;
const MAX_RECENT = 20;

export interface UserFeatures {
  eventCount: number;
  transferOutCount: number;
  trailingMaxMinor: bigint;
  totalOutMinor: bigint;
  distinctPayees: string[];
  recentEventTs: string[];
  recentAmountsMinor: bigint[];
  lastGeo: string | null;
  lastDeviceId: string | null;
}

interface FeatureRow {
  event_count: number;
  transfer_out_count: number;
  trailing_max_minor: string | number;
  total_out_minor: string | number;
  distinct_payees: string;
  recent_event_ts: string;
  recent_amounts_minor: string;
  last_geo: string | null;
  last_device_id: string | null;
}

const EMPTY: UserFeatures = {
  eventCount: 0,
  transferOutCount: 0,
  trailingMaxMinor: 0n,
  totalOutMinor: 0n,
  distinctPayees: [],
  recentEventTs: [],
  recentAmountsMinor: [],
  lastGeo: null,
  lastDeviceId: null,
};

export interface FeatureStore {
  /** Current per-user state — the snapshot used to score the *next* event. */
  get(userId: string): Promise<UserFeatures>;
  /** Fold an event into the user's state. Call AFTER scoring with the pre-event snapshot. */
  update(event: RiskEvent, ts: string): Promise<void>;
}

export class SqliteFeatureStore implements FeatureStore {
  constructor(private db: Db) {}

  async get(userId: string): Promise<UserFeatures> {
    const row = await this.db.queryOne<FeatureRow>(
      "SELECT * FROM user_features WHERE user_id = ?",
      [userId]
    );
    if (!row) return { ...EMPTY };
    return {
      eventCount: Number(row.event_count),
      transferOutCount: Number(row.transfer_out_count),
      trailingMaxMinor: BigInt(row.trailing_max_minor),
      totalOutMinor: BigInt(row.total_out_minor),
      distinctPayees: JSON.parse(row.distinct_payees) as string[],
      recentEventTs: JSON.parse(row.recent_event_ts) as string[],
      recentAmountsMinor: (JSON.parse(row.recent_amounts_minor) as string[]).map((a) => BigInt(a)),
      lastGeo: row.last_geo,
      lastDeviceId: row.last_device_id,
    };
  }

  async update(event: RiskEvent, ts: string): Promise<void> {
    const cur = await this.get(event.userId);
    const isTransferOut = event.eventType === "transfer.send";
    const amount = event.amountMinor ?? 0n;

    const windowStart = Date.now() - VELOCITY_WINDOW_SECS * 1000;
    const recentTs = [...cur.recentEventTs, ts].filter((t) => Date.parse(t) >= windowStart).slice(-MAX_RECENT);
    const recentAmounts = [...cur.recentAmountsMinor, amount].slice(-MAX_RECENT);
    const payees = event.counterpartyId && !cur.distinctPayees.includes(event.counterpartyId)
      ? [...cur.distinctPayees, event.counterpartyId]
      : cur.distinctPayees;

    const next: UserFeatures = {
      eventCount: cur.eventCount + 1,
      transferOutCount: cur.transferOutCount + (isTransferOut ? 1 : 0),
      trailingMaxMinor: amount > cur.trailingMaxMinor ? amount : cur.trailingMaxMinor,
      totalOutMinor: cur.totalOutMinor + (isTransferOut ? amount : 0n),
      distinctPayees: payees,
      recentEventTs: recentTs,
      recentAmountsMinor: recentAmounts,
      lastGeo: event.geo ?? cur.lastGeo,
      lastDeviceId: event.deviceId ?? cur.lastDeviceId,
    };

    await this.db.execute(
      `INSERT INTO user_features
         (user_id, event_count, transfer_out_count, trailing_max_minor, total_out_minor,
          distinct_payees, recent_event_ts, recent_amounts_minor, last_geo, last_device_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         event_count=excluded.event_count,
         transfer_out_count=excluded.transfer_out_count,
         trailing_max_minor=excluded.trailing_max_minor,
         total_out_minor=excluded.total_out_minor,
         distinct_payees=excluded.distinct_payees,
         recent_event_ts=excluded.recent_event_ts,
         recent_amounts_minor=excluded.recent_amounts_minor,
         last_geo=excluded.last_geo,
         last_device_id=excluded.last_device_id,
         updated_at=excluded.updated_at`,
      [
        event.userId,
        next.eventCount,
        next.transferOutCount,
        next.trailingMaxMinor,
        next.totalOutMinor,
        JSON.stringify(next.distinctPayees),
        JSON.stringify(next.recentEventTs),
        JSON.stringify(next.recentAmountsMinor.map((a) => a.toString())),
        next.lastGeo,
        next.lastDeviceId,
        new Date().toISOString(),
      ]
    );
  }
}
