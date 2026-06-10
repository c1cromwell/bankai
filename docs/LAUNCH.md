# Argus Financial Partners — Launch Readiness & Go-To-Market

The single end-to-end (E2E) launch document: what we ship at launch, the legal posture that keeps it
shippable, the gates that must be green, and who signs off. It ties the **technical** gate
(`docs/E2E-VALIDATION.md`) to the **legal/corporate** gate (`docs/business/CORPORATE-STRUCTURE.md`).

> **Read order:** this doc → `CORPORATE-STRUCTURE.md` (the compliance ramp) → `E2E-VALIDATION.md` (the
> technical journey gate) → `ARGUS-PLAN.md` (phase build status + the 17–20 roadmap).

---

## 1. Launch thesis — Phase A, non-custodial software

**We launch as an AI-operated, tokenization-first money app — *not* "a bank."** This is the
`CORPORATE-STRUCTURE.md` **Phase A** posture (§1, §6): deliver real product value while staying outside
the two most expensive US regimes (money-transmitter licensing and broker-dealer registration) for as
long as possible.

What keeps us in scope at launch (CORPORATE-STRUCTURE §6, "What you CAN do in Phase A"):
- **Non-custodial by architecture** — keys live in the user's Secure Enclave; the server never holds a
  user's private key (a *locked* architecture decision). We hold no customer funds → generally not a
  money transmitter.
- **Tokenization framed as software** — we build the rails; we are not the issuer of record taking in
  investor money. Demo securities stay explicitly labeled "not a real offering."
- **Partner out everything that touches money** — no fiat on/off-ramp run by us; route crypto purchases
  to a licensed third party under *their* license.

**Compliance-safe messaging (non-negotiable — the reason for the Argus rebrand).** Per CORPORATE-STRUCTURE
§1 and §9(4), "bank"/"banking" are regulated terms; using them without a charter invites a
cease-and-desist. The rebrand from "BankAI" to **Argus Financial Partners** removes that trap. Marketing
copy says: **"tokenized assets," "non-custodial wallet," "agentic finance."** It must **never** say:
"deposits," "FDIC," "bank account," "your bank," or promise investment returns.

**What we CANNOT do at launch (Phase A):** hold customer USD or crypto, run an exchange/order book as
intermediary, issue and sell securities to the public, or move money between users as the middleman.
Those are Phases 17–20 (`ARGUS-PLAN.md`), gated on the **Corp B/C** ramp.

---

## 2. MVP-launchable scope (what ships)

The Phase 0–16 build (141 backend tests pass / 3 todo) is launchable as non-custodial software once the
§3 blockers clear:

| Capability | Status | Notes |
|---|---|---|
| Passkey-first auth (WebAuthn) | ✅ built | password only behind `ALLOW_PASSWORD_AUTH` (forbidden in prod) |
| DID / Verifiable Credentials | ✅ built | RS256 VC JWT, key rotation, BitstringStatusList revocation; issuer `did:web:argusfinancial.com` |
| Tiered identity ladder + risk-adaptive onboarding | ✅ built | Phase 5A; simulated IDV/sanctions providers (real vendor is a Phase-19 cutover, optional for Phase A) |
| Double-entry ledger (integer minor units) | ✅ built | the single source of truth for balances |
| Hedera USDC **non-custodial** wallet | ✅ built | receive/send; on-device signing; testnet (mainnet is Phase 20) |
| SmartChat NL → 90s operation token → transfer | ✅ built | MFA gate above $500 |
| External agent: OID4VP → VP-verified → MCP scoped op | ✅ built | VP signature verified before any access; 90s scoped token; per-agent rate limit |
| Tokenized marketplace (collectibles, HTS) | ✅ backend | the intended first real-money surface; frontend tabs land in Phase 9 |
| Real-estate / securities tokenization | ⚠ demo only | Tier-2, simulated identities, testnet; **legal hold** until counsel sign-off (→ Phase 18) |
| Stage-1 fraud seam | ✅ built | screens the money path (`fraudService` → append-only `fraud_decisions`) |
| Admin console + RBAC | ✅ built | review/compliance surfaces gated |

---

## 3. Hard blockers (go/no-go gates)

Launch is blocked until each of these is cleared. Engineering gates are verifiable today; legal/custody
gates require external action.

| # | Blocker | Type | Owner | Clears when |
|---|---|---|---|---|
| B1 | **iOS wallet verification** — source written, never compiled (Phase 10 "unverified") | Eng | Engineering | Xcode build + sign + on-device Secure-Enclave/biometric + OID4VP/Hedera smoke pass |
| B2 | **Frontend portal (Phase 9)** completion + UI smoke | Eng | Engineering | Web portal flows green (browser-driver added to E2E) |
| B3 | **E2E validation green** (see §4) | Eng | Engineering | `e2e-validator full` PASS; no §4 money-invariant FAIL |
| B4 | **Securities counsel sign-off** before any **real-money** RWA listing | Legal | Counsel | Reg D 506(c) (or other) wrapper approved; real-estate/securities stay demo until then |
| B5 | **Collectibles legal memo** — confirm the HTS-collectibles path is safe-to-launch | Legal | Counsel | Memo approves the first real-money surface |
| B6 | **Entity + Phase-A compliance pack** (see §5) | Compliance | Founder/Counsel | LLC formed, IP assigned, AML policy + officer, OFAC screening live, ToS/Privacy published |
| B7 | **Hedera posture** — testnet for Phase A; **mainnet requires KMS/HSM** treasury key | Eng/Sec | Engineering | either ship testnet-only with clear labeling, or complete Phase-20 custody hardening before mainnet |

**Not blockers for Phase A** (deferred, per CORPORATE-STRUCTURE Phase B+): partner-bank fiat rails, real
KYC vendor, ATS/broker-dealer, Temporal/Conductor, data warehouse, fraud Stages 2–4.

---

## 4. E2E validation gate (technical)

The technical launch gate is a **green `e2e-validator full` run** — see `docs/E2E-VALIDATION.md` for the
runbook. A green run = every non-PENDING journey passes and the deterministic money-invariant floor (§4 of
that doc) is green. **Any FAIL on a money-critical invariant blocks launch regardless of journey results.**

Required before sign-off:
- Deterministic floor: `cd backend && npm run typecheck && npx vitest run e2e` — green (full suite 141 pass / 3 todo today).
- Hybrid pass: `e2e-validator full` — journeys **J1–J8** PASS across channels (Web, Mobile, Agentic CLI).
- Cross-cutting invariants (money = integer minor units; balances ledger-derived; append-only audit/ledger;
  Idempotency-Key on money POSTs; **VP signature verified before access**; stable `ErrorCode`) — all PASS.
- Channels: Web + Agentic CLI exercised; **Mobile (iOS)** gated on B1; on-chain leg runs simulated until
  Hedera creds are present (Phase-20 reconciliation check skipped until then).

---

## 5. Corporate & compliance readiness (legal)

The legal launch gate is the **Phase-A pack** in `docs/business/CORPORATE-STRUCTURE.md` (§5, §6, §8, §9–10).
The Argus rebrand satisfies the §9(4) "bank-naming" item directly.

Phase-A checklist (must be complete before onboarding real users):
- **Entity** — Argus Financial Partners LLC (Wyoming), registered agent, **EIN**, foreign-qualify home state (§9–10).
- **IP assignment** — assign all repo code/designs/marks to the LLC (§5; "#1 thing acquirers/investors diligence").
- **Operating agreement** — adopted even as a single member (§4–5).
- **AML/BSA policy + named compliance officer**; **OFAC/sanctions screening** at onboarding (§6, §8 — the
  identity ladder + VC + append-only audit are ~70% of the evidence layer already).
- **ToS / Privacy / E-Sign / risk disclosures** published before any signup (§6, §9).
- **"Not advice" disclaimers** on tokenized-asset surfaces (§9).
- **Trademark** the Argus Financial Partners brand (§9).
- **Phase-B trigger written down** (CORPORATE-STRUCTURE §10) — the user need that forces partners + FinCEN
  MSB registration (maps to Phase 19), so we advance deliberately, not by accident.

> The Argus rebrand also means the **legal entity** in `CORPORATE-STRUCTURE.md` is now
> **Argus Financial Partners LLC** → (on conversion) **Argus Financial Partners, Inc.** holdco with
> **Argus Tech / Argus Markets / Argus Transfer** subsidiaries.

---

## 6. Go / No-Go checklist + sign-offs

Launch proceeds only when every gate is **GO** and all four functions sign off.

| Gate | Source | Status | Sign-off |
|---|---|---|---|
| iOS wallet verified (B1) | §3 | ☐ | Engineering |
| Frontend portal complete (B2) | §3 | ☐ | Engineering |
| `e2e-validator full` green (B3 / §4) | §4 | ☐ | Engineering |
| Money invariants — zero FAIL | §4 | ☐ | Engineering |
| Securities counsel sign-off (B4) | §3 | ☐ | Legal |
| Collectibles legal memo (B5) | §3 | ☐ | Legal |
| Entity + IP assignment + operating agreement (B6) | §5 | ☐ | Compliance |
| AML policy + officer + OFAC screening (B6) | §5 | ☐ | Compliance |
| ToS / Privacy / disclaimers published (B6) | §5 | ☐ | Compliance |
| Hedera testnet-labeled OR mainnet KMS/HSM (B7) | §3 | ☐ | Engineering / Security |
| Compliance-safe messaging review (no "bank"/"deposits"/"FDIC") | §1 | ☐ | Product / Legal |
| Phase-B trigger documented | §5 | ☐ | Product |

**Decision:** ☐ GO ☐ NO-GO — date: ________  ·  Engineering: ____  Legal: ____  Compliance: ____  Product: ____

---

*Roadmap beyond launch (full bank / trading / production tokenization) lives in `docs/ARGUS-PLAN.md`
Phases 17–20, each gated on the corporate ramp (Corp A → B → C) in `docs/business/CORPORATE-STRUCTURE.md`.*
