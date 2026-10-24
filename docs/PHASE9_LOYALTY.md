# Phase 9: Kaayra Rewards (Step 1: database core and arithmetic)

## Baseline and scope
- The uploaded ZIP was **kaayra-herbals-v5-phase7-cart-recovery.zip**. The brief expected a Phase 8 baseline. **Phase 8 (business intelligence / financial analytics) is not in this ZIP and nothing here pretends it exists.** Section 19 of the brief (Phase 8 financial integration) is therefore NOT done; it needs the Phase 8 ZIP.
- No loyalty code existed before this step (searched the whole tree).
- Done in this step: `supabase/loyalty.sql`, `supabase/loyalty_selftest.sql`, `supabase/loyalty_concurrency.sh`, `shared/loyalty.ts`, `shared/loyalty.test.ts`.
- NOT done (next steps): checkout wiring (applying a reservation to the order total and the Razorpay amount), customer API and wallet screen, owner "KAAYRA REWARDS" admin section and its API, scheduler calls for activation and expiry, e-mails, read-only analytics wrappers in `server/`, the remaining automated tests in brief section 23 (API, regression of reviews/cart recovery are covered only by the existing suite), Phase 8 integration.
- Gemini AI: not touched, no dependency added.

## Decisions (change only with the owner)
| Topic | Rule |
|---|---|
| Earning basis | Eligible net merchandise: line total minus coupon discount; GST and shipping excluded. Integer paise, floor. |
| Default rate | Rs 100 = 10 points (owner-configurable). |
| States | PENDING (paid) -> AVAILABLE (delivered + `activation_days`, default 7) -> RESERVED -> REDEEMED / EXPIRED / REVERSED. |
| Ledger | `loyalty_ledger` is append-only (update, delete and truncate raise `KH:APPEND_ONLY`). Balances are sums of its deltas. `loyalty_lots` is a projection for earliest-expiry-first spending; selftest 24 proves the two agree. |
| Expiry | 12 months after activation (configurable, or never). Reserved points are held outside the lot while a checkout is open, so the sweep cannot touch them. |
| Redemption | 100 points = Rs 10 (configurable), whole blocks, minimum 100, at most 20% of eligible net, and never below Rs 1 payable. The order is read from the database; the only customer inputs are a point count and an idempotency key. |
| Coupons | Default `exclusive`: an order with a coupon cannot also use points. `both` is available to the owner; the coupon is applied first and points are capped on the remaining value. |
| Refunds | Cumulative and proportional: target reversal = floor(earned x refunded / total). A repeated refund event computes a difference of 0. Pending points go first, then available. Already-spent points become `debt_points`, recovered from the next points that activate. No balance is ever negative. |
| Redeemed points on refund | Restored only on a FULL refund or cancellation (once). Partial refunds keep the redemption. |
| Tiers | One model: eligible lifetime net spend of orders whose points activated, less proportional refunds. SILVER / GOLD / PLATINUM thresholds (Rs 0 / 5,000 / 20,000) and multipliers (1.00x / 1.10x / 1.25x) are **starting values for the owner to review**. No expiry or renewal yet. A tier is a status, not a paid plan. |
| Milestones | Off by default, one grant per member per milestone. Not revoked by a later refund (owner policy to confirm). |
| Birthday | Off by default, month and day only (no year), a change locks for 365 days, one claim per calendar year, removing and re-adding does not reset the claim, needs enrolment age and one completed order. |
| Marketing | Enrolment never touches marketing consent (selftest 2d). E-mails not yet built. |
| Accounting (for Phase 8 when it exists) | Redeemed value is a discount (price reduction) at redemption. Outstanding points are an estimated liability, not an expense when issued (`loyalty_overview.liability_paise_estimate`: available + reserved points at the current redemption rate; pending excluded). |

## How points are protected
- RLS on every table, no grants to `anon` or `authenticated`, every function revoked from them: only the server (service role) can call them.
- Earning is triggered by an order becoming `paid`, which the existing `orders_require_capture` guard only allows after a captured Razorpay payment, so a forged status cannot mint points.
- Same-member operations serialise on the `loyalty_accounts` row lock. Race test: 80 rounds of two checkouts spending the same 100 points; never two winners.
- Reservation keys are unique across the table. Derive the key on the server from the order id; a client-chosen key that collides with another order's key raises a unique-violation (a refusal, not a double spend).

## Known limits and open points
- Nothing here has run against the real Supabase project; only a disposable PostgreSQL 16 (with a stubbed `storage` schema).
- Redemption is not connected to `checkout_place`, so no discount can reach a real order yet. Wiring needs `orders.loyalty_discount_paise` (and the `orders_total_matches` constraint, line allocation for refunds, and the Razorpay amount) and is the next step.
- Release of a reservation relies on the existing order-expiry sweep cancelling the unpaid order (same pattern as coupons); a late Razorpay capture after cancellation is handled by existing payment logic and needs an integration test.
- `loyalty_selftest.sql` test 8 only proves a refusal, not which one.
- Concurrent earning/expiry races were not stress-tested, only reservations.

## Verification run in this session
| Check | Result |
|---|---|
| `npm ci` | ran, ok |
| `npm run lint` | ran; initially 1 error that ALREADY existed in the Phase 7 ZIP (unused import `hashRestoreToken` in `server/api-tests/cart-recovery.test.ts`); removed the import, now clean |
| `npm run typecheck` | same error (TS6133), which would have failed `npm run build`; clean after the fix |
| `npm test` | 923 passed, 1 skipped before the new file; `shared/loyalty.test.ts` adds 16, all pass |
| `npm run build` | ran, ok |
| `npm audit` | **22 vulnerabilities (6 moderate, 13 high, 3 critical: tar, tinypool, vitest)**. Not fixed: they are in the existing toolchain and fixes are breaking upgrades. Needs your decision. |
| SQL | `loyalty.sql` applied twice (rerun-safe); `loyalty_selftest.sql` passes (28 groups); `loyalty_concurrency.sh` passes (80 rounds) on disposable PostgreSQL 16 |
| Not run | Browser, Razorpay, e-mail, real Supabase, RLS from a real authenticated JWT |
