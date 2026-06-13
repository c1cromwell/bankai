/**
 * Case service — the analyst alert/case queue. A case is the mutable state
 * machine (open → assigned → resolved/dismissed); every transition writes an
 * immutable case_events row (the audit trail). This is the human-in-the-loop
 * surface: the engine recommends, deterministic policy auto-remediates severe
 * cases, and analysts review/resolve the rest.
 */

import { v4 as uuidv4 } from "uuid";
import type { Db } from "../db";
import { casesTotal } from "../observability/metrics";

export type Severity = "low" | "medium" | "high" | "critical";
export type CaseStatus = "open" | "assigned" | "resolved" | "dismissed";

export interface CaseRecord {
  id: string;
  userId: string;
  decisionId: string | null;
  severity: Severity;
  status: CaseStatus;
  assignee: string | null;
  summary: string | null;
  createdAt: string;
}

interface CaseRow {
  id: string;
  user_id: string;
  decision_id: string | null;
  severity: Severity;
  status: CaseStatus;
  assignee: string | null;
  summary: string | null;
  created_at: string;
}

export function severityFor(score: number): Severity {
  if (score >= 0.9) return "critical";
  if (score >= 0.7) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

export class CaseService {
  constructor(private db: Db) {}

  private async event(caseId: string, action: string, actor: string, detail?: string): Promise<void> {
    await this.db.execute(
      "INSERT INTO case_events (id, case_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [uuidv4(), caseId, action, actor, detail ?? null, new Date().toISOString()]
    );
  }

  async open(args: { userId: string; decisionId?: string; severity: Severity; summary?: string }): Promise<CaseRecord> {
    const id = uuidv4();
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO cases (id, user_id, decision_id, severity, status, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
      [id, args.userId, args.decisionId ?? null, args.severity, args.summary ?? null, now, now]
    );
    await this.event(id, "opened", "system", args.summary);
    casesTotal.inc({ severity: args.severity });
    return { id, userId: args.userId, decisionId: args.decisionId ?? null, severity: args.severity, status: "open", assignee: null, summary: args.summary ?? null, createdAt: now };
  }

  async list(status?: CaseStatus, limit = 100): Promise<CaseRecord[]> {
    const capped = Math.min(Math.max(limit, 1), 500);
    const rows = status
      ? await this.db.query<CaseRow>("SELECT * FROM cases WHERE status = ? ORDER BY created_at DESC LIMIT ?", [status, capped])
      : await this.db.query<CaseRow>("SELECT * FROM cases ORDER BY created_at DESC LIMIT ?", [capped]);
    return rows.map(toRecord);
  }

  async get(id: string): Promise<CaseRecord | null> {
    const row = await this.db.queryOne<CaseRow>("SELECT * FROM cases WHERE id = ?", [id]);
    return row ? toRecord(row) : null;
  }

  async resolve(id: string, actor: string, status: "resolved" | "dismissed", note?: string): Promise<void> {
    await this.db.execute("UPDATE cases SET status = ?, updated_at = ? WHERE id = ?", [status, new Date().toISOString(), id]);
    await this.event(id, status, actor, note);
  }

  /** Record an analyst/system action against a case (e.g. a freeze request). */
  async recordAction(id: string, action: string, actor: string, detail?: string): Promise<void> {
    await this.event(id, action, actor, detail);
  }

  async events(caseId: string): Promise<{ action: string; actor: string; detail: string | null; createdAt: string }[]> {
    const rows = await this.db.query<{ action: string; actor: string; detail: string | null; created_at: string }>(
      "SELECT action, actor, detail, created_at FROM case_events WHERE case_id = ? ORDER BY created_at",
      [caseId]
    );
    return rows.map((r) => ({ action: r.action, actor: r.actor, detail: r.detail, createdAt: r.created_at }));
  }
}

function toRecord(r: CaseRow): CaseRecord {
  return {
    id: r.id,
    userId: r.user_id,
    decisionId: r.decision_id,
    severity: r.severity,
    status: r.status,
    assignee: r.assignee,
    summary: r.summary,
    createdAt: r.created_at,
  };
}
