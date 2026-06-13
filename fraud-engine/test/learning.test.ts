import { describe, it, expect, beforeEach } from "vitest";
import { freshContext } from "./helpers";
import type { Context } from "../src/context";

describe("learning loop — labels + retrain", () => {
  let ctx: Context;
  beforeEach(async () => {
    ({ ctx } = await freshContext());
  });

  it("reports insufficient labels before any feedback", async () => {
    const r = await ctx.retrainer.retrain();
    expect(r.status).toBe("insufficient_labels");
  });

  it("registers a SHADOW candidate after labels arrive (never straight to prod)", async () => {
    await ctx.labels.record({ userId: "u-1", label: "confirmed_fraud", source: "analyst" });
    await ctx.labels.record({ userId: "u-2", label: "legit", source: "analyst" });
    const r = await ctx.retrainer.retrain();
    expect(r.status).toBe("registered");
    expect(r.candidateVersion).toMatch(/^seq-v0\+r/);
    expect(r.driftScore).toBeCloseTo(0.5, 5);

    const models = await ctx.registry.list();
    const candidate = models.find((m) => m.version === r.candidateVersion);
    expect(candidate?.status).toBe("shadow");
    // The candidate is served, so it actually runs (and would show up in shadow[]).
    expect(ctx.server.has(r.candidateVersion)).toBe(true);
  });
});
