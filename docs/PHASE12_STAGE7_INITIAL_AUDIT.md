# Phase 12 Stage 7: initial source audit

Baseline: `kaayra-herbals-v5-phase12-s6-founder-update.zip` (plus the menu and founder-role edits made on 2026-10-23, see HANDOFF.md).
Method: every SQL function was searched for in `api/`, `server/`, `src/`, `shared/`, `scripts/` (test files excluded). A function with no hit is NOT connected, whatever the docs say.

## Environment limits of this audit (read first)
- No PostgreSQL, no `node_modules`, network disabled in the authoring sandbox. Nothing below was executed; this audit is by reading source only.
- Therefore no SQL, unit, integration, concurrency, lint, typecheck, build or SEO result is claimed for Stage 7. See "Verification plan".

## Classification

| Area | Item | Class |
|---|---|---|
| Checkout | `checkout_place` (9-arg coupon version, `coupons.sql`) called from `server/checkout.ts`, `api/checkout/[action].ts` | Implemented and connected |
| Payments | `payment_prepare` / `payment_attach` / `payment_apply_event` (Razorpay amount = `orders.total_paise` read inside the DB) | Implemented and connected; DB not run here |
| Refunds | `refund_create` / `refund_set_status` (cap: committed + new <= `orders.total_paise`) | Implemented and connected |
| Coupons | whole flow | Implemented and connected |
| Finance | `finance_lines` etc. via `server/financeService.ts`, `server/admin/finance.ts` | Implemented and connected; uses `subtotal - discount_paise` as goods net |
| Loyalty | 28 functions in `loyalty.sql` | Implemented but unused (no call site) |
| Loyalty | triggers `orders_loyalty_sync_trg`, `refunds_loyalty_sync_trg` | Partially connected: fire inside the DB on paid/cancelled/refunded once `loyalty.sql` is applied. Untested. |
| Loyalty | `orders.loyalty_discount_paise`, `order_items.loyalty_discount_paise`, allocation, wallet, owner screen, cron, emails | Missing |
| Bundles | `bundle_*` (9), `checkout_place_with_bundles` | Implemented but unused. `shared/bundles.ts` only mirrors price math. |
| Bundles | cart/checkout support, public pages, owner screen | Missing |
| Wishlists | `wishlist_add/remove/list/merge/track_to_cart` | Implemented but unused. No API, page or heart button. |
| Related products / FBT | `related_products`, `frequently_bought_together` | Implemented but unused |
| External Razorpay refunds | webhook `refund.processed` with unknown `gateway_refund_id` | Unsafe/incomplete: only outcome `refund_unknown` + audit row; no order_refunds row, no loyalty/finance effect |

## Findings that change the design

1. **Loyalty never touches an order.** `loyalty_reserve` returns a rupee value but does not change `orders.total_paise`. `orders_total_matches` (`total = subtotal - discount + shipping`) has no loyalty term. Wiring needs: new additive columns, a changed constraint, allocation across lines, and one transaction that places the order, reserves points and re-checks the expected total, before `payment_prepare` reads the total.
2. **Bundle saving is stored in the coupon discount columns.** `checkout_place_with_bundles` adds the bundle saving to `orders.discount_paise` and `order_items.discount_paise`, the same columns coupons use. The brief requires separate columns for bundle, coupon and loyalty. Today this is safe only because bundle orders cannot carry a coupon (`KH:BUNDLE_COUPON_EXCLUDED`, server-side, good). Plan: add `bundle_discount_paise` columns and move the saving there, keeping `bundle_order_allocations` as the immutable snapshot. This touches `orders_total_matches`, `finance_lines`, refund basis and `loyalty_net_eligible`.
3. **Bundle wrapper has not been exercised.** It re-implements totals in two passes (compares list-price total minus saving to `p_expected_total` before placing, again after). It needs a disposable-DB run (single order, replay, concurrency: `supabase/bundles_concurrency.sh` exists, never run here).
4. **Loyalty debt policy is already baked into SQL.** `loyalty_reverse_for_order` writes `delta_debt` / `loyalty_accounts.debt_points` when earned points were already spent. The brief says not to invent a negative-balance policy. Decision needed from the owner; until then the refund/cancel path that can create debt should stay disabled or the policy documented as "pending".
5. **Loyalty refund maths uses `orders.total_paise`**, which includes shipping and (after wiring) will include the loyalty discount effect. Earned-point reversal for partial refunds is pro-rata on `refunded / total`. Needs checking against the line-level loyalty allocation once it exists. Redeemed points are restored only on a full refund or cancellation (partial refunds keep the redemption): that is a policy choice already in the SQL and must be confirmed.
6. **Loyalty defaults exist as "starting values to review"** (10 points per Rs 100, 100 points = Rs 10, max 20% of eligible net, 7-day activation, `stacking = exclusive`). Program is `enabled = false` by default (good). The brief says do not invent business values, so the owner screen must show these as unconfirmed and activation stays blocked until the owner confirms them.
7. **GST:** `finance_lines` computes GST on `line_total - discount_paise`. Loyalty must NOT silently reduce taxable value. Until a tax treatment is approved, loyalty must stay a separate payment-side reduction, not folded into `discount_paise`. This is the likely activation blocker (Section 11 of the brief).
8. **External Razorpay refunds** (finding above): a safe reconciliation is feasible only with verification that the refund's payment belongs to a captured Kaayra payment and the cumulative refunded amount does not exceed the paid amount. Plan below; otherwise documented as an activation blocker.
9. **Wishlists:** `wishlist_*` functions are server-only (RLS on, grants revoked), so ownership is enforced by passing the session member id from the API. Table key `(member_id, product_id)` already prevents duplicates.
10. **API shape:** serverless functions are grouped by `[action].ts`. New customer endpoints (wishlist, loyalty, bundles) should be new `action` branches in existing routes (`api/cart`, `api/orders`, `api/admin`), not new files.
11. **Free shipping** uses the list subtotal in `shipping_pincodes.free_above_paise` (read in `server/checkout.ts`). Bundle wrapper receives `shipping_paise` from the caller; `order_create` should be checked to confirm it re-derives or validates it (open question, Step 7B).

## Implementation plan (one step per "Continue")

| Step | Scope | Needs DB to verify |
|---|---|---|
| 7A | This audit (done) | no |
| 7B | Migration `loyalty_checkout.sql` + `bundle_columns.sql`: separate discount columns, constraint, allocation functions, wrapper `checkout_place_full` (bundles + loyalty), TS in `server/checkout.ts`, shared money maths + unit tests | yes (not available here) |
| 7C | Checkout API: loyalty redemption request, bundle items in cart, coupon+bundle message, failure/success lifecycle, refund wiring | yes |
| 7D | Wishlist API + page + heart button (existing cards) | partly |
| 7E | Bundles: public list/detail, add to cart, owner admin screen | partly |
| 7F | Loyalty: wallet page, owner settings screen, cron hooks (activate/expire) | partly |
| 7G | Finance integration (bundle, loyalty, liability) and external-refund reconciliation | yes |
| 7H | Docs, test report, security report, deployment doc, matrix; final zip | n/a |

## Verification plan
On a machine with Node 20 and PostgreSQL 16: `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run seo:check && npm audit`; apply migrations in the order of `docs/DATABASE_MIGRATIONS.md` plus the new files; run each `*_selftest.sql` and the `*_concurrency.sh` scripts. Until then every DB claim is "written, not run".

## Addendum: executed baseline (2026-10-23, before any Stage 7 change)
This session had Node 22.22, npm 10.9, network to the npm registry and apt, and PostgreSQL 16 (installed via apt, disposable DB `kh_verify`). The baseline below was ACTUALLY RUN on the unmodified Stage 7A ZIP.

| Check | Result |
|---|---|
| `npm ci` | OK (241 packages) |
| `npm run typecheck` | OK, no errors |
| `npm run lint` | OK, no output |
| `npm test` (vitest) | 72 files passed, 1 skipped; 1037 tests passed, 1 skipped |
| `scripts/db-verify.sh` (all migrations applied twice, idempotent) | both passes clean |
| Self-tests: phase3, refunds, payments, checkout, payments_checkout, shipments, email_outbox, rate_limits, delivery_areas, reviews, coupons, cart_recovery, loyalty, bundles_wishlists, finance | all 15 OK |

Not yet run at baseline: `npm run build`, `seo:check`, `npm audit`, the three `*_concurrency.sh` scripts, browser checks.
Consequence: statements in the audit above that said "DB not run here" are now partly superseded: the existing loyalty and bundle SQL pass their own self-tests on PG16. They are still NOT connected to the application, so the classification table is unchanged.


## Addendum (Stage 7B session)
This session had no PostgreSQL and no network, so 7B was written but not executed. Finding 11 (shipping trusted from the caller) is confirmed: `order_create` stores `shipping_paise` from the request and `checkout_place` only checks that the PIN is active. 7B adds a database check in `checkout_place_full`. Also found: `checkout_place_with_bundles` calls `checkout_place` with a null coupon, so it must not be used for coupon carts; `checkout_place_full` routes accordingly.
