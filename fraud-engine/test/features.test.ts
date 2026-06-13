import { describe, it, expect, beforeEach } from "vitest";
import { freshContext, benignEvent } from "./helpers";
import { enrich } from "../src/features/enrichment";
import { SequenceModel } from "../src/models/sequenceModel";
import type { Context } from "../src/context";

describe("feature store + enrichment", () => {
  let ctx: Context;
  beforeEach(async () => {
    ({ ctx } = await freshContext());
  });

  it("accumulates per-user state across events", async () => {
    await ctx.engine.process(benignEvent({ amountMinor: 5_000n }));
    await ctx.engine.process(benignEvent({ amountMinor: 9_000n }));
    const f = await ctx.store.get("u-alice");
    expect(f.transferOutCount).toBe(2);
    expect(f.trailingMaxMinor).toBe(9_000n);
    expect(f.distinctPayees).toContain("u-bob");
  });

  it("marks a first-time payee as new, then known", async () => {
    let e = await enrich(benignEvent({ counterpartyId: "u-new" }), ctx.store);
    expect(e.newPayee).toBe(true);
    await ctx.store.update(benignEvent({ counterpartyId: "u-new" }), new Date().toISOString());
    e = await enrich(benignEvent({ counterpartyId: "u-new" }), ctx.store);
    expect(e.newPayee).toBe(false);
  });

  it("sequence model flags an extreme amount vs the trailing sequence", async () => {
    // Build a steady sequence, then enrich a spike.
    for (const amt of [5_000n, 5_200n, 4_900n, 5_100n]) {
      await ctx.store.update(benignEvent({ amountMinor: amt }), new Date().toISOString());
    }
    const e = await enrich(benignEvent({ amountMinor: 5_000_000n }), ctx.store);
    const out = new SequenceModel().score(e);
    expect(out.score).toBeGreaterThan(0);
    expect(out.reasons.map((r) => r.code).join(",")).toMatch(/sequence_zscore/);
  });
});
