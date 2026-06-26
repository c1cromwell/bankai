/**
 * X-Money response F4 — Visa-bridge card differentiators:
 *   1. cashback paid in USDC on capture ("earn an asset you own, not points").
 *   2. cashback off when CARD_CASHBACK_BPS = 0.
 *   3. a USDC-funded card authorizes on the NATIVE rail (spend from your USDC).
 *
 * The card lifecycle (issue/authorize/capture) is the existing Phase-19.4 cardService;
 * F4 adds the cashback payout + confirms native-rail funding.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-cardcb-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { CARDS_ENABLED: boolean }).CARDS_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ } }
});

async function balance(userId: string, currency: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", currency));
}
async function newUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`cb-${Date.now()}-${Math.random()}@test.com`, "C");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 USD opening
  return u.id;
}
async function fundUsdc(userId: string, amount: bigint): Promise<void> {
  const { getSystemAccount, getOrCreateUserAccount, postJournal } = await import("../src/services/ledgerService");
  const src = await getSystemAccount("bank_settlement", "USDC");
  const dst = await getOrCreateUserAccount(userId, "user_cash", "USDC");
  await postJournal(
    [{ ledgerAccountId: src, direction: "debit", amountMinor: amount, currency: "USDC" },
     { ledgerAccountId: dst, direction: "credit", amountMinor: amount, currency: "USDC" }],
    "Fund USDC (test)", { idempotencyKey: `fund:${userId}` }
  );
}

describe("Card cashback + native-rail funding (F4)", () => {
  it("pays 3% cashback in USDC on capture; getCardRewards reflects it", async () => {
    const { config } = await import("../src/config");
    (config as { CARD_CASHBACK_BPS: number }).CARD_CASHBACK_BPS = 300; // 3%, like X's card
    const { issueCard, authorize, capture, getCardRewards } = await import("../src/services/cardService");
    const u = await newUser();
    const card = await issueCard(u, "USD");
    const usdcBefore = await balance(u, "USDC");

    const auth = await authorize({ userId: u, cardId: card.id, amountMinor: 10_000n, merchant: "Coffee", idempotencyKey: uuidv4() });
    const cap = await capture(auth.id);
    expect(cap.cashbackMinor).toBe("300"); // 10000 × 3% = 300 micro-USDC

    expect(await balance(u, "USDC")).toBe(usdcBefore + 300n); // cashback is a real USDC asset
    const rewards = await getCardRewards(u);
    expect(rewards.totalMinor).toBe("300");
    expect(rewards.currency).toBe("USDC");
    expect(rewards.rewards).toHaveLength(1);
  });

  it("no cashback when CARD_CASHBACK_BPS = 0", async () => {
    const { config } = await import("../src/config");
    (config as { CARD_CASHBACK_BPS: number }).CARD_CASHBACK_BPS = 0;
    const { issueCard, authorize, capture } = await import("../src/services/cardService");
    const u = await newUser();
    const card = await issueCard(u, "USD");
    const auth = await authorize({ userId: u, cardId: card.id, amountMinor: 5_000n, idempotencyKey: uuidv4() });
    const cap = await capture(auth.id);
    expect(cap.cashbackMinor).toBe("0");
    expect(await balance(u, "USDC")).toBe(0n);
  });

  it("a USDC-funded card authorizes on the native rail (spend from your USDC)", async () => {
    const { issueCard, authorize } = await import("../src/services/cardService");
    const u = await newUser();
    await fundUsdc(u, 50_000n); // 50 USDC
    const card = await issueCard(u, "USDC"); // funded from the native rail, not USD
    const usdcBefore = await balance(u, "USDC");
    const auth = await authorize({ userId: u, cardId: card.id, amountMinor: 20_000n, merchant: "Shop", idempotencyKey: uuidv4() });
    expect(auth.currency).toBe("USDC");
    expect(await balance(u, "USDC")).toBe(usdcBefore - 20_000n); // held from USDC, no Visa pull from USD
  });
});
