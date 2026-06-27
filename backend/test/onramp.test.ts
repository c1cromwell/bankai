/**
 * Fiat → USDC on-ramp (buy USDC with fiat — the activation gap).
 *
 *   - quote applies the on-ramp fee (bps) over a 1:1 USD→USDC value;
 *   - an order delivers net USDC into the user's ledger balance and is idempotent on replay;
 *   - the fee is captured (gross = net + fee, balanced journal);
 *   - the account-freeze gate blocks a frozen account;
 *   - ONRAMP_ENABLED gates the rail (ONRAMP_DISABLED when off);
 *   - an un-wired real provider refuses an order (NOT_IMPLEMENTED);
 *   - productionFatals refuses the simulated on-ramp in prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-onramp-${Date.now()}.db`;
let seq = 0;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { ONRAMP_ENABLED: boolean }).ONRAMP_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function newUser() {
  const { createUser } = await import("../src/services/authService");
  return createUser(`onramp-${seq++}-${Date.now()}@test.com`, "On-ramp User");
}
async function usdc(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USDC"));
}

describe("quote", () => {
  it("applies the on-ramp fee over a 1:1 USD→USDC value", async () => {
    const { quote } = await import("../src/services/onRampService");
    const { config } = await import("../src/config");
    (config as { ONRAMP_FEE_BPS: number }).ONRAMP_FEE_BPS = 100; // 1%
    const q = quote({ fiatAmountMinor: 10_000n }); // $100.00
    expect(q.usdcGrossMinor).toBe(100_000_000n); // 100 USDC (6dp)
    expect(q.feeMinor).toBe(1_000_000n);          // 1 USDC fee
    expect(q.usdcNetMinor).toBe(99_000_000n);     // user receives 99 USDC
    expect(q.asset).toBe("USDC");
  });
});

describe("createOrder", () => {
  it("delivers net USDC into the ledger and is idempotent on replay", async () => {
    const { createOrder } = await import("../src/services/onRampService");
    const user = await newUser();
    const before = await usdc(user.id);
    const key = `onramp-${uuidv4()}`;

    const order = await createOrder({ userId: user.id, fiatAmountMinor: 10_000n, idempotencyKey: key });
    expect(order.status).toBe("completed");
    expect(order.usdcNetMinor).toBe("99000000");
    expect(order.journalId).toBeTruthy();

    const after = await usdc(user.id);
    expect(after - before).toBe(99_000_000n);

    // Replay with the same key — same order, no double credit.
    const replay = await createOrder({ userId: user.id, fiatAmountMinor: 10_000n, idempotencyKey: key });
    expect(replay.id).toBe(order.id);
    expect(await usdc(user.id)).toBe(after);
  });

  it("captures the fee (gross = net + fee)", async () => {
    const { createOrder } = await import("../src/services/onRampService");
    const user = await newUser();
    const order = await createOrder({ userId: user.id, fiatAmountMinor: 5_000n, idempotencyKey: `onramp-${uuidv4()}` });
    expect(BigInt(order.usdcGrossMinor)).toBe(BigInt(order.usdcNetMinor) + BigInt(order.feeMinor));
  });

  it("blocks a frozen account", async () => {
    const { createOrder } = await import("../src/services/onRampService");
    const { placeHold } = await import("../src/services/accountHoldService");
    const user = await newUser();
    await placeHold({ userId: user.id, reason: "test freeze", source: "admin" });
    await expect(createOrder({ userId: user.id, fiatAmountMinor: 10_000n, idempotencyKey: `onramp-${uuidv4()}` }))
      .rejects.toMatchObject({ code: ErrorCode.ACCOUNT_FROZEN });
  });
});

describe("gating", () => {
  it("ONRAMP_DISABLED when the rail is off", async () => {
    const { quote } = await import("../src/services/onRampService");
    const { config } = await import("../src/config");
    (config as { ONRAMP_ENABLED: boolean }).ONRAMP_ENABLED = false;
    try {
      expect(() => quote({ fiatAmountMinor: 10_000n })).toThrow();
    } finally {
      (config as { ONRAMP_ENABLED: boolean }).ONRAMP_ENABLED = true;
    }
  });

  it("an un-wired real provider refuses an order", async () => {
    const { createOrder, setOnRampProvider } = await import("../src/services/onRampService");
    const { config } = await import("../src/config");
    const user = await newUser();
    setOnRampProvider(null); // fall back to config selection
    (config as { ONRAMP_PROVIDER: string }).ONRAMP_PROVIDER = "moonpay";
    try {
      await expect(createOrder({ userId: user.id, fiatAmountMinor: 10_000n, idempotencyKey: `onramp-${uuidv4()}` }))
        .rejects.toMatchObject({ code: ErrorCode.NOT_IMPLEMENTED });
    } finally {
      (config as { ONRAMP_PROVIDER: string }).ONRAMP_PROVIDER = "simulated";
      setOnRampProvider(null);
    }
  });

  it("productionFatals refuses the simulated on-ramp in prod", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, BANK_RAILS_ENABLED: false,
      ONRAMP_ENABLED: false, ONRAMP_PROVIDER: "simulated",
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("ONRAMP_ENABLED"))).toBe(false);
    const on = { ...base, ONRAMP_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("ONRAMP_ENABLED"))).toBe(true);
  });
});
