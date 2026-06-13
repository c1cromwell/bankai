import { describe, it, expect, beforeEach } from "vitest";
import { freshContext, benignEvent } from "./helpers";
import type { Context } from "../src/context";
import type { Db } from "../src/db";

describe("DecisionEngine — sync scoring", () => {
  let ctx: Context;
  let db: Db;
  beforeEach(async () => {
    ({ ctx, db } = await freshContext());
  });

  it("allows a benign transfer", async () => {
    const d = await ctx.engine.process(benignEvent());
    expect(d.action).toBe("allow");
    expect(d.modelVersion).toContain("rules-v1");
  });

  it("blocks a velocity burst (deterministic threshold)", async () => {
    // Prime >10 transfers in the window so velocity_burst (0.7) + new payees fire.
    for (let i = 0; i < 12; i++) {
      await ctx.engine.process(benignEvent({ counterpartyId: `p-${i}`, amountMinor: 5_000n }));
    }
    const d = await ctx.engine.process(benignEvent({ counterpartyId: "p-new" }));
    expect(["block", "challenge"]).toContain(d.action);
    expect(d.reasons.map((r) => r.code)).toContain("velocity_burst");
  });

  it("persists the event and an append-only decision", async () => {
    const d = await ctx.engine.process(benignEvent());
    const ev = await db.queryOne<{ id: string }>("SELECT id FROM events WHERE id = ?", [d.eventId]);
    expect(ev).not.toBeNull();

    // decisions table is append-only — UPDATE must be rejected by the trigger.
    await expect(
      db.execute("UPDATE decisions SET action = 'allow' WHERE id = ?", [d.decisionId])
    ).rejects.toThrow(/append-only/);
  });

  it("includes a SHAP-like explanation on every decision", async () => {
    const d = await ctx.engine.process(benignEvent({ amountMinor: 950_000n }));
    expect(d.explanation.length).toBeGreaterThan(0);
    expect(d.explanation[0]).toHaveProperty("feature");
    expect(d.explanation[0]).toHaveProperty("contribution");
  });
});
