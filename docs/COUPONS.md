# Coupons, discounts and promotions (V5 Phase 5)

Built on `kaayra-herbals-v5-phase6-verified-reviews.zip` (Phase 6 reviews kept intact). **The Gemini owner AI (Phase 4 of your brief) is not in any ZIP supplied, so Step 11 could not be integrated.** What is ready for it: `coupon_analytics()` and `GET /api/admin/coupon-analytics` are read-only and owner-only. See section 9.

## 1. Audit of what existed (confirmed)
| Area | Finding |
|---|---|
| Coupons / discounts | **None.** No table, column, API or UI. Nothing to duplicate. |
| Pricing authority | Prices come from `product_variants` inside `order_create()`; the browser never sends a price. Subtotal = sum of line totals. |
| Totals | `orders.total_paise = subtotal + shipping`. Shipping from `shipping_pincodes` (free above a threshold). GST is inside MRP (informational). |
| Payment amount | `payment_prepare` reads `orders.total_paise`; `payment_attach` refuses an amount that differs; the webhook flags a captured amount that differs (`amount_mismatch`). **So putting the discount into `orders.total_paise` makes Razorpay charge it with no change to payment code.** |
| Lifecycle | Every cancel and expiry goes through `order_set_status`; every payment through `payment_apply_event` -> `order_set_status('paid')`. One trigger on `orders.status` therefore covers customer cancel, expiry sweep, admin cancel and webhook. |
| Refunds | `refund_create` caps total refunds at `orders.total_paise` (the amount paid). Refund amounts are typed by staff; there was no per-line basis. **Gap closed** by `order_refund_basis()`. |
| Admin authorisation | Permissions in `shared/roles.ts`, enforced server-side by `need()`. Owner holds all. |
| "Category" | The catalogue has no category table; `products.form` (Syrup, Tablet...) is the category. |
| Confirmed gaps | No discount model; refunds had no discount-aware basis; orders had nowhere to record a discount. All addressed below. |

## 2. Rules (all enforced in `supabase/coupons.sql`, function `coupon_compute`)
- Money is integer paise. Percentage is stored as basis points (10% = 1000).
- **Rounding:** percentage discount = floor(eligible subtotal x bps / 10000), i.e. rounded **down** to the paisa.
- Order of limits: rounding -> maximum-discount cap -> eligible subtotal -> **payable floor**.
- **Payable floor:** items + shipping - discount is never below 100 paise (Rs 1); Razorpay cannot take zero, and totals can never be negative. A coupon that would discount nothing is refused (`NO_DISCOUNT`).
- Discount applies to **items only**, never shipping. Free-delivery eligibility still uses the **pre-discount** subtotal (existing behaviour preserved; a business decision you can revisit).
- Minimum order is compared with the **eligible items' subtotal**.
- Product list and category (form) list: when both are set an item must match **both**.
- The discount is split across eligible lines in proportion to value (largest remainder, ties by line id) so line parts always sum to the discount. Stored in `order_items.discount_paise`.
- **One coupon per order, no stacking:** unique index on `coupon_redemptions.order_id` plus a check in the reserve function.
- First-order: refused if the customer has any paid/packed/shipped/delivered order, or another unpaid order still inside its payment window.
- Codes: 3-32 chars, A-Z 0-9 `_` `-`, stored in capitals, **permanent** once created (database trigger). A coupon is switched off, never deleted.
- Inactive and unknown codes give the same customer message, so a switched-off code is not confirmed to exist.

## 3. Redemption lifecycle
| Event | Redemption |
|---|---|
| Order placed with coupon | `reserved` (counts toward limits; same transaction as order and stock, under a lock on the coupon row) |
| Payment captured (`paid`) | `committed` (once; a duplicate event finds nothing reserved) |
| Unpaid order cancelled by customer or expired by the sweep | `released` (`unpaid_order_cancelled`) |
| **Paid** order cancelled (admin, before shipping) | `released` (`paid_order_cancelled`): customer is refunded, use is given back |
| Partial or full **refund** of a shipped/delivered order | stays `committed` (the use is consumed; documented rule, no second adjustment is ever made) |
| Failed payment | nothing changes: the order stays unpaid and keeps its reservation until its window ends, then it is released |
Limits count `reserved + committed`. An abandoned checkout holds a use only until the existing expiry sweep cancels it (30-minute window, plus the existing 24-hour hold for an authorised payment); `checkout_place` also runs that sweep.

## 4. Refunds
Customers pay `orders.total_paise` (net of discount). `refund_create` already refuses more than that in total. For partial refunds use **Refund basis** (shown in the order's refund form when a coupon was used; `GET /api/admin/refund-basis?order=`): per line, `net = line total - discount`; q of the line's units = floor(net x q / qty); all units = net exactly. Delivery paid is shown separately. Because a refund is never mirrored back onto the coupon, there is nothing to apply twice.

## 5. Where things are
| Piece | Files |
|---|---|
| Migration 24 | `supabase/coupons.sql`, `coupons_selftest.sql`, `coupons_concurrency.sh` |
| Rules, messages, validation | `shared/coupons.ts` (+ tests) |
| Customer server calls | `server/coupons.ts`; `api/cart/[action].ts` (`coupon-apply`, `coupon-remove`, view carries the coupon); `api/checkout/[action].ts` (quote, place) |
| Admin | `server/admin/coupons.ts`; `src/pages/AdminCoupons.tsx`; Admin tab "Coupons" (Shop group) |
| Permissions | `coupons.read`, `coupons.write` in `shared/roles.ts`: **owner only**. Manager and support get nothing new. |
| UI | Coupon box in `CartSummary`; discount rows in `CheckoutSummary`, `OrderReview`, `TrackOrder`, admin order detail; small rules appended to `bag.css` |

## 6. Security properties
- The browser sends a **code and nothing else**. The code applied to a bag lives in `carts.coupon_code`; checkout reads it from there. A coupon, discount or total in a checkout request is ignored (tested).
- `expectedTotalPaise` remains a consent check only; the database compares it with the real discounted total.
- Prices/GST/shipping recalculated server-side as before. Razorpay amount = `orders.total_paise` (tested at API and SQL level).
- New tables: RLS on, **no grants** to `anon`/`authenticated`; every new function revoked from them (verified in the self-test).
- Guessing: per-IP limit on `coupon-apply` plus 10 failed attempts / 15 min per member inside the database; every attempt recorded in `coupon_applications`.
- Admin: every endpoint checks the permission server-side; denials are audited; create, edit and on/off write audit entries with before/after values; no delete; code immutable; unknown fields ignored.

## 7. Setup
1. Back up, then run `supabase/coupons.sql` on **staging first** (needs migrations 1-23; see `DATABASE_MIGRATIONS.md`). Re-runnable. It adds columns to `carts`, `orders`, `order_items`, replaces `cart_clear`, adds a new 9-argument `checkout_place` (the old 8-argument one is left in place, revoked, and no longer called) and a status trigger on `orders`.
2. Run `coupons_selftest.sql` (rolls back). Run `coupons_concurrency.sh` **in its own disposable database** (it commits rows).
3. Deploy. Sign in as owner -> Admin -> Shop -> Coupons -> New coupon. Nothing is created for you.
4. The migration adds `orders_total_matches` (total = subtotal - discount + shipping) only if every existing order already satisfies it; otherwise it prints a notice and skips.

## 8. Needs external credentials / real environment (NOT done)
- Run on your Supabase **staging** project (all DB verification here used a disposable PostgreSQL 16 with stubbed Supabase roles).
- Razorpay **test-mode** end-to-end: pay a discounted order in the Razorpay test checkout, confirm the amount shown, the webhook, a refund. Needs your test keys.
- Browser/mobile visual check of the new coupon box and admin screen (no screenshots were taken here).
- Not production-ready until the above, plus the existing live-sales approval gate, are completed. Nothing here enables live payments or touches payment credentials.

## 9. Owner AI (Step 11)
No Gemini/owner-AI code exists in the ZIPs supplied, so nothing was added to it. Read-only building blocks for it: `coupon_analytics(from, to)` (totals, per coupon, by day, active campaigns, expired, reserved) and `coupon_admin_list`. Any AI tool must call these through the owner-only admin API and must never be given `coupon`, `coupon-toggle` write routes. If you send the Phase 4 AI ZIP, wiring read-only tools is a small follow-up.

## 10. Analytics honesty
"Sales with a coupon" = amount paid on orders that committed a coupon. It is attribution, **not** incremental revenue; the screen says so. All figures come from `coupon_redemptions` and `orders`; refunded money is shown separately. No figure is estimated.

## 11. Known limits / decisions for you
- Free-delivery threshold uses the pre-discount subtotal (kept as before).
- GST is shown on the discounted amount for display; order lines keep line total and line discount so an invoice can show either. Confirm GST-on-discount treatment with your tax adviser (as with shipping GST in earlier phases).
- A customer with one unpaid coupon order cannot reuse a one-per-customer coupon until it is paid, cancelled or expires.
- Order e-mails state the amount payable (already net); they have no separate discount line.
- Refund amounts are still typed by staff; the basis is a helper, not an enforced per-item refund.
