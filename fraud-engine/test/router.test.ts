import { describe, it, expect, beforeEach } from "vitest";
import { freshContext, benignEvent } from "./helpers";
import { actionFor } from "../src/router/router";
import type { Context } from "../src/context";

describe("router — registry, shadow, canary, thresholds", () => {
  let ctx: Context;
  beforeEach(async () => {
    ({ ctx } = await freshContext());
  });

  it("runs the shadow model and records it on the decision", async () => {
    // seq-v0 ships in shadow; a scored event should carry a shadow result.
    const d = await ctx.engine.process(benignEvent({ amountMinor: 950_000n }));
    expect(d.shadow?.some((s) => s.modelVersion === "seq-v0")).toBe(true);
  });

  it("promotes a shadow model to prod and uses it as the effective model", async () => {
    await ctx.registry.promote("seq-v0", "prod");
    await ctx.registry.promote("rules-v1", "retired");
    const d = await ctx.engine.process(benignEvent());
    expect(d.modelVersion).toContain("seq-v0");
  });

  it("respects a threshold change from routing config", async () => {
    // Drop block threshold to 100 milli so a mild event blocks.
    await ctx.db.execute(
      "UPDATE routing_config SET block_at = 100, challenge_at = 50, flag_at = 10 WHERE id = 'default'"
    );
    const d = await ctx.engine.process(benignEvent({ counterpartyId: "u-new", amountMinor: 950_000n }));
    expect(d.action).toBe("block");
  });

  it("actionFor only escalates to freeze on the async path", () => {
    const t = { blockAt: 800, challengeAt: 500, flagAt: 250, freezeAt: 900 };
    expect(actionFor(0.95, t, "async")).toBe("freeze");
    expect(actionFor(0.95, t, "score")).toBe("block");
  });

  it("canary at 100% supplies the effective decision for all users", async () => {
    await ctx.registry.promote("seq-v0", "canary", 100);
    const d = await ctx.engine.process(benignEvent({ amountMinor: 950_000n }));
    expect(d.modelVersion).toContain("seq-v0");
  });
});
