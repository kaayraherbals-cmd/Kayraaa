# Phase 10 Step 1: bundles, gift sets, wishlists, recommendations (database core)

Status: DATABASE CORE AND PURE LOGIC ONLY. No customer or owner screen, no API route and no cart wiring exists yet. Not production ready.

## Baseline warning
The uploaded ZIP was `kaayra-herbals-v5-phase9-step1-loyalty-core.zip`, not the expected `phase9-loyalty-rewards.zip`. It has Phase 9 Step 1 (loyalty database core, no checkout wiring) on a Phase 7 base. **Phase 8 (Business Intelligence) is not in it**, so bundle analytics are SQL read functions only and are not plugged into any Phase 8 dashboard. Loyalty has no checkout wiring yet; earning from bundle orders is therefore untested end to end. If you have the later ZIP, apply `bundles_wishlists.sql` on top of it instead.

## What exists
`supabase/bundles_wishlists.sql` (migration 27, needs 26) and `bundles_wishlists_selftest.sql`, `bundles_concurrency.sh`, `shared/bundles.ts` + `.test.ts`.

| Area | Where | Notes |
|---|---|---|
| Bundle definitions | `product_bundles`, `bundle_components` | Components are real `product_variants`. At least 2 different variants, qty 1 to 10. Bundles cannot contain bundles, so a circular bundle cannot be expressed. |
| Kinds | `bundle`, `wellness_kit`, `gift_set`, `promo` | Gift messages are allowed only on `gift_set` (DB check). No gift-wrap, packaging or packaging stock is modelled. |
| Pricing | `bundle_price_from`, `bundle_price` | fixed price, percent off (discount floors), amount off. Refused when final <= 0 (`BUNDLE_PRICE_INVALID`) or above the combined price (`BUNDLE_NO_SAVING`: no fake saving). Policy **live**: price follows current component prices at each checkout; orders keep a snapshot. |
| Availability | `bundle_availability` | MIN over components of floor(free / qty), same batch rules as `order_create` (active, not near expiry, minus reservations). No bundle stock of its own. |
| Management | `bundle_upsert`, `bundle_set_status` | Transactional, audited in `admin_audit`, activation revalidates components and price. |
| Checkout | `checkout_place_with_bundles` | Expands bundles into ordinary lines (one per variant), calls the unchanged `checkout_place`, then stores the saving as `order_items.discount_paise` and in `bundle_order_allocations` (immutable snapshot). Reservations, cancel, ship, refund basis and idempotency are the existing code, so nothing is deducted twice. |
| Refunds | existing `order_refund_basis`, new `bundle_order_basis` | Refund amounts use paid value per line (list value less allocated saving), never current prices. Full refund, partial component refund and cancellation use the existing refund and `order_set_status` paths. Restock rules are unchanged (no automatic restock of damaged or expired stock was added). |
| Coupons | refusal in the checkout function | Conservative default: an order containing a bundle cannot use a coupon (`BUNDLE_COUPON_EXCLUDED`). Per-bundle coupon eligibility is NOT built. |
| Wishlist | `wishlist_items`, `wishlist_add/remove/merge/list/track_to_cart` | Per member, no duplicates, 100 cap, only approved products, list shows current price and stock and no historical price, no stock held. No guest storage was added (guest list stays in the browser; `wishlist_merge` takes the ids on sign-in). |
| Related | `product_relationships`, `related_products` | Owner-curated first, then same product form; in-stock approved products only; never the product itself. |
| Frequently bought together | `frequently_bought_together` | Distinct paid-or-later, non-cancelled orders; at least 5 orders (never below 3); otherwise empty, and the caller shows related products under the "related" label. |
| Analytics | `bundle_analytics`, `bundle_inventory_constraints`, `wishlist_trends` | Read only, bounded. **Profit is reported incomplete: no component cost exists in this schema.** Wishlist-to-purchase is attribution only and says so. `wishlist_events` has no member column. |

All new tables: RLS on, no grants to anon or authenticated; all functions revoked from public roles (service role only).

## Verification (what actually ran, 2026-10-22)
- Baseline before changes: typecheck, lint clean; 923 tests passed, 1 skipped.
- All 26 earlier migrations then `bundles_wishlists.sql` applied (twice) on a disposable PostgreSQL 16, stand-in `auth`/`storage`/roles (not Supabase).
- `bundles_wishlists_selftest.sql`: 56 checks passed (creation rules, pricing, availability, checkout, replay, refusals leave no trace, history unchanged after edits, cancel releases stock, wishlist, related, FBT threshold, analytics, immutability).
- `bundles_concurrency.sh`: 20 rounds, two buyers racing for the last bundle, exactly one winner each round, no oversell, no double reservation.
- `shared/bundles.test.ts`: 17 tests.
- NOT run: Razorpay, Supabase project, browser, the other items below.

## Not built yet (next steps, in order)
1. API: public bundle list/detail, wishlist and recommendation reads, owner bundle CRUD with role check and audit (must fit the 12-function Vercel limit: add actions to existing routes, no new files in `api/`).
2. Cart and checkout: carry `bundle_id` lines through `shared/cart.ts`/`server/checkout.ts`, call `checkout_place_with_bundles`, send the exact order total to Razorpay.
3. UI: heart on product cards, wishlist page, bundle cards/page, owner Bundles tab (existing tokens, no redesign).
4. Loyalty earning/redemption on bundle orders (needs Phase 9 checkout wiring first), per-bundle coupon rules, Phase 8 analytics hookup, component costs for profit.
5. Read-only owner-AI service wrappers (`getBundlePerformance` etc.) over the three analytics functions; they would be thin RPC wrappers. No Gemini code exists or was added.

## Deployment
Run `bundles_wishlists.sql` then `bundles_wishlists_selftest.sql` on STAGING first. Run `bundles_concurrency.sh` only in a disposable database. Nothing here is reachable from the site until the API and cart steps are done, so applying it changes no customer behaviour.
