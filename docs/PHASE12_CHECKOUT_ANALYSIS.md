# Phase 12 Stage 3: checkout and payment consistency analysis

Method: code reading of `api/checkout/[action].ts`, `server/checkout.ts`, `server/checkoutPayments.ts`, `api/payments/webhook.ts`, and the SQL functions `checkout_place` (coupons.sql), `payment_apply_event`/`payment_prepare` (payments_checkout.sql), `checkout_place_with_bundles` (bundles_wishlists.sql), `loyalty_*` (loyalty.sql). Backed by the passing unit tests and the passing `payments_checkout_selftest` / `checkout_selftest` on disposable PostgreSQL 16 (see TEST_REPORT). NO checkout, Razorpay or webhook flow was executed end to end here. No code was changed in this stage.

## 1. What is already correct (keep; do not rebuild)
| Rule in the brief | Where it holds |
|---|---|
| One server-authoritative calculation | Items come from the member's saved bag, never the request. Prices read from `product_variants` inside `order_create`; the API recomputes and the database recomputes again. |
| Client cannot choose a price | The browser sends only `expectedTotalPaise`, used as a consent/stale-price guard (`KH:PRICE_CHANGED`), never as the amount. |
| Shipping from the server | Computed in the API from `shipping_pincodes`, not from the body. |
| Razorpay amount = order total | `payment_prepare` returns `orders.total_paise`; the code refuses if Razorpay echoes a different amount or currency. |
| Never paid on browser say-so | The verify action checks the signature, then asks Razorpay for the payment, matches order, amount, currency and status, then calls `payment_apply_event`. |
| Webhook signature | Verified over the raw body before parsing (401 on failure). |
| Duplicate webhook | `payment_events.rp_event_id` unique; a repeat returns `duplicate`. The browser path and webhook use different event ids but serialize on `order_payments ... for update`, so a double capture is harmless. |
| Duplicate order / double submit | Advisory lock per member plus `checkout_attempts` (key + request hash); max 3 open orders. |
| Amount mismatch | Flagged `amount_mismatch`, order stays unpaid. A capture after cancellation is flagged `order_not_open` for a person to refund. |
| Refund basis | `order_refund_basis` uses what the customer paid per line (line total less discount). |

## 2. Findings
| # | Finding | Severity | Action |
|---|---|---|---|
| C-1 | **Loyalty redemption is not applied to any order.** `loyalty_reserve` returns `discount_paise` but never changes `orders.total_paise`; there is no `orders.loyalty_discount_paise` or per-line allocation. Nothing calls it. | Blocking for Phase 9 | Stage 4 loyalty step |
| C-2 | Because `payment_prepare` reads `orders.total_paise`, the Razorpay amount follows automatically once the total includes the loyalty discount. No new Razorpay path is needed. | Design note | none |
| C-3 | Partial-refund maths would over-refund if loyalty were deducted only from the order total. `order_refund_basis` sums per-line nets, and a loyalty discount not allocated to lines makes those nets exceed what was paid. It needs its own per-line allocation (separate column from coupon and bundle discounts so Phase 8 can report it apart). | High once C-1 is built | design in Stage 4 |
| C-4 | `checkout_place_with_bundles` refuses any coupon with a bundle (`KH:BUNDLE_COUPON_EXCLUDED`), and does not pass the coupon to `checkout_place` (passes null). The brief requires an explicit documented policy, not a silent bypass. Current behaviour is a valid conservative policy, but the API/UI must show a clear message. | Needs owner decision | Stage 4 |
| C-5 | Loyalty and bundles stack cleanly by construction: `loyalty_net_eligible` is line total minus per-line discount, and bundle savings are stored in `order_items.discount_paise`. The `v_value > subtotal - discount - 100` rule keeps at least Rs 1 payable. | Design note | none |
| C-6 | `checkout_place_with_bundles` and `checkout_place` take `shipping_paise` from the payload without re-deriving it from `shipping_pincodes` in the database. The API is the only caller and the functions are not granted to browser roles, so this is defence in depth, not an exploitable hole today. | Low | harden when wiring bundles |
| C-7 | Free-shipping threshold is judged on the list subtotal; with a bundle the customer pays less than the list subtotal. Whether the threshold should use the discounted subtotal is a business rule nobody has stated. | Policy question | ask owner |
| C-8 | A refund created outside the app (for example in the Razorpay dashboard) yields `refund_unknown` and an audit row only; no order or loyalty adjustment happens. | Medium | document; owner process |
| C-9 | `cart` and the bundle flow: the cart/bag tables hold variants only. Bundles in the cart need either a bundle line type or expansion at add time. Not decided yet. | Design | Stage 4 |

## 3. Design for Stage 4 (to be confirmed before coding)
1. New additive migration `loyalty_checkout.sql`: `orders.loyalty_points`, `orders.loyalty_discount_paise`, `order_items.loyalty_discount_paise`; a wrapper that calls `checkout_place` (or the bundle wrapper), then `loyalty_reserve`, then allocates the value across eligible lines (largest remainder, as `bundle_alloc` does), then updates `total_paise`, and re-checks the expected total. All inside one transaction.
2. `order_refund_basis` extended so line net = line total - coupon/bundle discount - loyalty discount. Existing orders unaffected (columns default 0).
3. Reservation release on cancel/expiry and commit on paid already exist as order-status triggers (`orders_loyalty_sync`); the self-test must be extended to prove the wiring end to end.
4. Phase 8: report loyalty redemptions as their own line; GST treatment of a points discount (reduces the taxable price or not) is a tax decision for the owner's accountant, not something to guess.

## 4. Decisions needed from the owner before Stage 4
1. Loyalty rules: points per rupee of eligible spend, rupee value per redeemed block, minimum and maximum redemption, expiry. (The SQL has settings and ships OFF; I will not invent numbers.)
2. Coupons with bundles: keep "bundle orders cannot use coupons" (current), or allow coupons on non-bundle lines of a mixed cart only?
3. Free shipping threshold with bundles: judge on list subtotal (current) or on the discounted subtotal?
4. Does a loyalty redemption count as a price discount for GST? (Ask your accountant.)
