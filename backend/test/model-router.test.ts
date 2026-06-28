/**
 * M4 — Model router (task class → tier → provider seam + model_invocations telemetry).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";

const TMP_DB = `./data/test-model-router-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.MODEL_ROUTER_ENABLED = "1";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("model router", () => {
  it("routes kyc_review to standard tier (Sonnet-class)", async () => {
    const { selectModels } = await import("../src/operations/modelRouter/router");
    const chain = selectModels("kyc_review");
    expect(chain[0]?.id).toBe("claude-sonnet-4");
    expect(chain[0]?.tier).toBe("standard");
  });

  it("routes legal_draft to high tier (Opus-class) with fallback chain", async () => {
    const { selectModels } = await import("../src/operations/modelRouter/router");
    const chain = selectModels("legal_draft");
    expect(chain[0]?.id).toBe("claude-opus-4");
    expect(chain.some((m) => m.id === "claude-sonnet-4")).toBe(true);
    expect(chain.some((m) => m.id === "claude-haiku-4")).toBe(true);
  });

  it("routing preview covers all task classes", async () => {
    const { routingPreview } = await import("../src/operations/modelRouter/registry");
    const preview = routingPreview();
    expect(preview.length).toBeGreaterThanOrEqual(8);
    expect(preview.find((p) => p.taskClass === "triage")?.tier).toBe("fast");
  });

  it("logs error invocation when anthropic key missing", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { invokeModel, listInvocations } = await import("../src/operations/modelRouter/router");
    await expect(
      invokeModel({
        taskClass: "summary",
        skill: "test-skill",
        system: "test",
        userContent: "{}",
        maxTokens: 16,
      })
    ).rejects.toThrow();
    const rows = await listInvocations(5);
    expect(rows.some((r) => r.status === "error" && r.taskClass === "summary")).toBe(true);
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  });

  it("model_invocations is append-only", async () => {
    const { getDb } = await import("../src/db");
    const db = getDb();
    await db.execute(
      `INSERT INTO model_invocations
         (id, task_class, model_id, vendor, input_tokens, output_tokens, cost_micro_usd, latency_ms, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["inv-test-1", "general", "claude-haiku-4", "anthropic", 10, 5, 100, 50, "ok", new Date().toISOString()]
    );
    await expect(
      db.execute("UPDATE model_invocations SET status = 'bad' WHERE id = ?", ["inv-test-1"])
    ).rejects.toThrow(/append-only/i);
  });
});
