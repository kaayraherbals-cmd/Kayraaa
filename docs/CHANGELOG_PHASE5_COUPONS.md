# Changelog: V5 Phase 5, advanced coupons and promotions

Base: `kaayra-herbals-v5-phase6-verified-reviews.zip` (reviews kept). Earlier checks in this session ran on `phase3h-verified`; the work was then merged into the Phase 6 tree with a three-way merge (one conflict in `server/admin/backoffice.ts`: both handlers kept).

## Added
- `supabase/coupons.sql` (migration 24): `coupons`, `coupon_redemptions`, `coupon_applications`; columns on `carts`, `orders`, `order_items`; `coupon_compute`, `coupon_quote`, `coupon_cart_apply/clear`, `coupon_reserve_for_order`, new `checkout_place(... , p_coupon)`, `orders_coupon_sync` trigger, `order_refund_basis`, `coupon_admin_list`, `coupon_analytics`.
- `supabase/coupons_selftest.sql`, `supabase/coupons_concurrency.sh`.
- `shared/coupons.ts`, `server/coupons.ts`, `server/admin/coupons.ts`, `src/pages/AdminCoupons.tsx`.
- Cart API: `coupon-apply`, `coupon-remove`; signed-in cart view now carries `coupon` and discount totals.
- Admin API: `coupons`, `coupon`, `coupon-toggle`, `coupon-options`, `coupon-analytics`, `refund-basis`.
- Permissions `coupons.read`, `coupons.write` (owner only). Error code `KH-CART-007`.
- Tests: `shared/coupons.test.ts` (26), `shared/coupons.parity.test.ts` (1, needs DATABASE_URL), `server/admin/coupons.test.ts` (12), `server/api-tests/coupons.test.ts` (14), 1 added to `payments.test.ts`.
- Docs: `docs/COUPONS.md`, this file, `test-results/PHASE5_RESULTS.md`, migration row in `DATABASE_MIGRATIONS.md`.

## Changed (existing behaviour)
- `checkoutTotals()` now returns `discountPaise` (0 when none). **Two existing assertions were updated only to include `discountPaise: 0`** (`shared/checkout.test.ts`, `server/api-tests/checkout.test.ts`). No test was removed or weakened.
- `canonicalRequest()` takes an optional coupon code (unchanged output without one).
- `checkout` quote/place read the bag's saved coupon; `placeOrder` passes `p_coupon`; `readOwnOrder` returns discount fields; `api/orders` returns discount fields.
- `cart_clear` also clears the bag's coupon (so a paid order empties both).
- UI additions only: coupon box in the cart summary, discount rows in checkout/summary/tracking/admin order, refund-basis helper, "Coupons" admin tab, ~10 CSS rules in `bag.css`. No redesign, no token or typography change.

## Not changed
Payment verification, webhook, idempotency, inventory reservation, refund processing, live-sales gate, credentials, brand, homepage, product cards.
