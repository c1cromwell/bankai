-- X-Money response F4 — card cashback paid as USDC (an asset you own, not points).
--
-- On capture, the card program pays a configurable % of the captured amount as USDC
-- to the cardholder (CARD_CASHBACK_BPS). Append-only reward record; the money is a
-- balanced, idempotent ledger journal (card_rewards system account → user_cash USDC).

CREATE TABLE IF NOT EXISTS card_rewards (
  id           TEXT PRIMARY KEY,
  auth_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USDC',
  journal_id   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_card_rewards_user ON card_rewards(user_id, created_at DESC);
