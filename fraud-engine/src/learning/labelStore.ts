/**
 * Label store — outcome feedback for the learning loop. Analysts/partners report
 * whether a flagged user/decision was actually fraud; these labels feed the
 * retrain analog and the drift metrics. In the north-star this is the lakehouse
 * label table fed by the outcome stream.
 */

import { v4 as uuidv4 } from "uuid";
import type { Db } from "../db";

export type Label = "confirmed_fraud" | "legit" | "chargeback";

export interface LabelRecord {
  id: string;
  userId: string;
  decisionId: string | null;
  label: Label;
  source: string | null;
  createdAt: string;
}

export class LabelStore {
  constructor(private db: Db) {}

  async record(args: { userId: string; decisionId?: string; label: Label; source?: string }): Promise<LabelRecord> {
    const id = uuidv4();
    const now = new Date().toISOString();
    await this.db.execute(
      "INSERT INTO labels (id, user_id, decision_id, label, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, args.userId, args.decisionId ?? null, args.label, args.source ?? null, now]
    );
    return { id, userId: args.userId, decisionId: args.decisionId ?? null, label: args.label, source: args.source ?? null, createdAt: now };
  }

  async recentCounts(): Promise<{ confirmed_fraud: number; legit: number; chargeback: number; total: number }> {
    const rows = await this.db.query<{ label: Label; c: number }>(
      "SELECT label, COUNT(*) AS c FROM labels GROUP BY label"
    );
    const out = { confirmed_fraud: 0, legit: 0, chargeback: 0, total: 0 };
    for (const r of rows) {
      out[r.label] = Number(r.c);
      out.total += Number(r.c);
    }
    return out;
  }
}
