import { openDbAt, closeDb, type Db } from "../src/db";
import { runMigrations } from "../src/db/migrate";
import { buildContext, type Context } from "../src/context";

/** Build a fresh engine over an in-memory SQLite DB. */
export async function freshContext(): Promise<{ db: Db; ctx: Context }> {
  await closeDb().catch(() => {});
  const db = openDbAt(":memory:");
  await runMigrations(db);
  const ctx = await buildContext(db);
  return { db, ctx };
}

/** A benign transfer event with no risk signals. */
export function benignEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventType: "transfer.send",
    mode: "score" as const,
    userId: "u-alice",
    counterpartyId: "u-bob",
    channel: "api",
    amountMinor: 5_000n, // $50
    currency: "USD",
    ...overrides,
  };
}
