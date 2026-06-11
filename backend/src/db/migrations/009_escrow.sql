-- Escrow & dispute layer — generalized from the Phase-8 marketplace escrow.
--
-- The "chargeback substitute" for irreversible (stablecoin) settlement
-- (docs/business/PAYMENT-NETWORK-STRATEGY.md §4): a payer→payee payment is held in
-- the `escrow` system ledger account, then released to the payee, refunded to the
-- payer, or disputed → mediated. Every money move is a balanced, idempotent ledger
-- journal through the existing `escrow` system account (ledgerService).
--
-- escrow_payments carries the mutable lifecycle state; escrow_events is the
-- append-only audit trail of transitions (added to APPEND_ONLY_TABLES). Money is
-- integer minor units; never float.

CREATE TABLE IF NOT EXISTS escrow_payments (
  id                TEXT PRIMARY KEY,
  payer_id          TEXT NOT NULL REFERENCES users(id),
  payee_id          TEXT NOT NULL REFERENCES users(id),
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  status            TEXT NOT NULL DEFAULT 'held',  -- held | disputed | released | refunded
  memo              TEXT,
  hold_journal_id   TEXT,                          -- payer_cash → escrow
  settle_journal_id TEXT,                          -- escrow → payee (release) or payer (refund)
  dispute_reason    TEXT,
  resolution        TEXT,                          -- release | refund (when resolved from a dispute)
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Append-only transition log (immutable, like audit_logs / ledger_entries).
CREATE TABLE IF NOT EXISTS escrow_events (
  id          TEXT PRIMARY KEY,
  escrow_id   TEXT NOT NULL REFERENCES escrow_payments(id),
  event       TEXT NOT NULL,                       -- held | disputed | released | refunded | dispute_resolved
  actor       TEXT,                                -- user id / 'mediator' / 'system'
  detail      TEXT DEFAULT '{}',                   -- JSON
  journal_id  TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_escrow_payments_payer ON escrow_payments(payer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_payee ON escrow_payments(payee_id, created_at);
CREATE INDEX IF NOT EXISTS idx_escrow_events_escrow ON escrow_events(escrow_id, created_at);
