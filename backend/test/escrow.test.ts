/**
 * Escrow & dispute layer tests (docs/business/PAYMENT-NETWORK-STRATEGY.md §4).
 *
 *   1. hold → release: payer debited, payee credited, escrow nets to zero.
 *   2. hold → refund: payer made whole.
 *   3. hold → dispute → resolve(refund): mediated refund.
 *   4. hold → dispute → resolve(release): mediated release.
 *   5. hold is idempotent; insufficient funds rejected.
 *   6. invalid transitions throw CONFLICT; settle is idempotent.
 *   7. escrow_events is append-only.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-escrow-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function setup() {
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
}

describe("Escrow & dispute layer", () => {
  let payer: string;
  let payee: string;

  async function balances() {
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
    const p = await getOrCreateUserAccount(payer, "user_cash", "USD");
    const q = await getOrCreateUserAccount(payee, "user_cash", "USD");
    return { payer: await getBalance(p), payee: await getBalance(q) };
  }

  beforeAll(async () => {
    await setup();
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const p = await createUser("payer@escrow.test", "Payer");
    const q = await createUser("payee@escrow.test", "Payee");
    payer = p.id;
    payee = q.id;
    await getOrCreateUserAccount(payer, "user_cash", "USD"); // $10,000 opening
    await getOrCreateUserAccount(payee, "user_cash", "USD");
  });

  it("hold → release: payer debited, payee credited", async () => {
    const { hold, release } = await import("../src/services/escrowService");
    const before = await balances();

    const e = await hold({ payerId: payer, payeeId: payee, amountMinor: 25_000n, currency: "USD", idempotencyKey: "rel-1" });
    expect(e.status).toBe("held");
    const mid = await balances();
    expect(before.payer - mid.payer).toBe(25_000n); // held out of payer
    expect(mid.payee).toBe(before.payee); // payee not yet credited

    const released = await release(e.id);
    expect(released.status).toBe("released");
    const after = await balances();
    expect(after.payee - before.payee).toBe(25_000n); // payee credited
    expect(after.payer).toBe(before.payer - 25_000n);
  });

  it("hold → refund: payer made whole", async () => {
    const { hold, refund } = await import("../src/services/escrowService");
    const before = await balances();
    const e = await hold({ payerId: payer, payeeId: payee, amountMinor: 5_000n, currency: "USD", idempotencyKey: "ref-1" });
    const r = await refund(e.id);
    expect(r.status).toBe("refunded");
    const after = await balances();
    expect(after.payer).toBe(before.payer); // whole
    expect(after.payee).toBe(before.payee);
  });

  it("hold → dispute → resolve(refund): mediated refund", async () => {
    const { hold, openDispute, resolveDispute } = await import("../src/services/escrowService");
    const before = await balances();
    const e = await hold({ payerId: payer, payeeId: payee, amountMinor: 8_000n, currency: "USD", idempotencyKey: "dis-1" });
    const d = await openDispute(e.id, "item not delivered", payer);
    expect(d.status).toBe("disputed");
    const resolved = await resolveDispute(e.id, "refund");
    expect(resolved.status).toBe("refunded");
    expect(resolved.resolution).toBe("refund");
    const after = await balances();
    expect(after.payer).toBe(before.payer); // refunded to payer
  });

  it("hold → dispute → resolve(release): mediated release", async () => {
    const { hold, openDispute, resolveDispute } = await import("../src/services/escrowService");
    const before = await balances();
    const e = await hold({ payerId: payer, payeeId: payee, amountMinor: 8_000n, currency: "USD", idempotencyKey: "dis-2" });
    await openDispute(e.id, "buyer remorse", payer);
    const resolved = await resolveDispute(e.id, "release");
    expect(resolved.status).toBe("released");
    const after = await balances();
    expect(after.payee - before.payee).toBe(8_000n); // released to payee
  });

  it("hold is idempotent; insufficient funds rejected", async () => {
    const { hold } = await import("../src/services/escrowService");
    const { ErrorCode } = await import("../src/errors");

    const a = await hold({ payerId: payer, payeeId: payee, amountMinor: 1_000n, currency: "USD", idempotencyKey: "idem-1" });
    const b = await hold({ payerId: payer, payeeId: payee, amountMinor: 1_000n, currency: "USD", idempotencyKey: "idem-1" });
    expect(b.id).toBe(a.id); // same escrow, not double-held

    await expect(
      hold({ payerId: payer, payeeId: payee, amountMinor: 99_999_999n, currency: "USD", idempotencyKey: "broke-1" })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
  });

  it("invalid transition throws CONFLICT; settle is idempotent", async () => {
    const { hold, release, refund } = await import("../src/services/escrowService");
    const { ErrorCode } = await import("../src/errors");

    const e = await hold({ payerId: payer, payeeId: payee, amountMinor: 2_000n, currency: "USD", idempotencyKey: "conf-1" });
    await release(e.id);
    // re-release is an idempotent no-op...
    const again = await release(e.id);
    expect(again.status).toBe("released");
    // ...but refunding a released escrow is a conflict.
    await expect(refund(e.id)).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it("escrow_events is append-only", async () => {
    const { getDb } = await import("../src/db");
    await expect(
      getDb().execute("UPDATE escrow_events SET event = 'tamper' WHERE event = 'held'")
    ).rejects.toThrow(/append-only/i);
  });
});
