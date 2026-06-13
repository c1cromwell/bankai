import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import { freshContext } from "./helpers";
import { buildApp } from "../src/server";
import { config } from "../src/config";

describe("HTTP API — service auth + ingest", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const { ctx } = await freshContext();
    const app = buildApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => {
    server?.close();
  });

  const auth = { authorization: `Bearer ${config.FRAUD_ENGINE_API_KEY}`, "content-type": "application/json" };

  it("serves /health without auth", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("rejects /v1 without a service token", async () => {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType: "transfer.send", userId: "u" }),
    });
    expect(res.status).toBe(401);
  });

  it("scores a sync event (mode=score) and returns a decision", async () => {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ eventType: "transfer.send", userId: "u-api", counterpartyId: "p", amountMinor: "5000", currency: "USD" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("allow");
    expect(body.modelVersion).toContain("rules-v1");
  });

  it("accepts an async event with 202", async () => {
    const res = await fetch(`${base}/v1/events?mode=async`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ eventType: "transfer.send", userId: "u-api2", counterpartyId: "p", amountMinor: "5000", currency: "USD" }),
    });
    expect(res.status).toBe(202);
    expect((await res.json()).accepted).toBe(true);
  });

  it("lists models and promotes one", async () => {
    const list = await (await fetch(`${base}/v1/models`, { headers: auth })).json();
    expect(list.models.find((m: { version: string }) => m.version === "rules-v1")).toBeTruthy();

    const promote = await fetch(`${base}/v1/models/seq-v0/promote`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ status: "canary", canaryPct: 25 }),
    });
    expect(promote.status).toBe(200);
    expect((await promote.json()).model.status).toBe("canary");
  });
});
