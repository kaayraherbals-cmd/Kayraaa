> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Razorpay setup (payments and refunds)

**Status: admin side and customer test payment built, both switched off. Never run against Razorpay or a database (see `docs/CHANGES_PHASE5.md`, Section 4).** Selling is still off (`COMMERCE_ENABLED = false`), so no customer can pay and no order can be created. What exists is the server plumbing that a later checkout will sit on. Nothing here was run against Razorpay or a real database while this version was prepared: do steps 1 to 5 in **test mode** first.

## What was added

| Piece | What it does |
|---|---|
| `supabase/payments.sql` | `order_payments` (one row per Razorpay order), `payment_events` (every webhook once, keyed by Razorpay's event id), two database functions, and `gateway_refund_id` on `order_refunds`. |
| `supabase/payments_selftest.sql` | Rolled-back test of the two functions. Must end with `ALL PASSED`. |
| `api/payments/webhook.ts` | Receives Razorpay's signed events. Checks the signature on the raw body, then records the event once. |
| `server/razorpay.ts` | Small API client (no SDK, no new dependency), signature checks, key loading. |
| `server/admin/payments.ts` | Admin actions: `payments` (view), `payment-create` (locked while selling is off), `refund-gateway` (owner pays an approved refund back through Razorpay). |
| Refunds tab | An approved refund shows **Refund through Razorpay**. **Mark refunded** (bank reference) still works for money paid any other way. |

## Rules it enforces

1. The amount charged is the order total stored in the database. The browser never supplies an amount.
2. An order becomes **paid** only when a signed `payment.captured` (or `order.paid`) event arrives for **exactly** that amount. A different amount is flagged `amount_mismatch` and the order stays unpaid.
3. Money that arrives for an order already cancelled is flagged `order_not_open` and written on the order timeline, so a person refunds it.
4. Each webhook event is applied once (Razorpay's event id is the key); a redelivery does nothing. A failed attempt never undoes a capture.
5. Gateway refunds send the refund id as Razorpay's idempotency key and save Razorpay's refund id **before** marking the refund done, so a retry cannot pay twice. A refund cannot exceed what is left on the Razorpay payment.
6. Only the public key id is ever sent to a browser. Secrets live in Vercel only and are never logged or echoed.
7. The webhook is **not** blocked by `COMMERCE_ENABLED` on purpose: a payment Razorpay has already taken must still be recorded. With selling off every event lands as `unknown_order`.

## Set-up steps (test mode first)

1. In the Razorpay Dashboard switch to **Test mode** and create API keys (`rzp_test_...`).
2. In Vercel add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (a new random value you choose, 12+ characters, different from the key secret). Redeploy.
3. In Supabase SQL editor run `supabase/payments.sql`, then paste and run `supabase/payments_selftest.sql` (must end `ALL PASSED`).
4. In Razorpay Dashboard > Webhooks add `https://YOUR-DOMAIN/api/payments/webhook`, paste the same webhook secret, and tick: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`. Use the dashboard's test-event feature to confirm a 200 reply.
5. Check automatic capture is on for your account (otherwise authorised payments are not captured and are returned to the customer after Razorpay's hold period; check their current rule).
6. Only after written business approval and the go-live review (section C of `REGULATORY_PUBLICATION_CHECKLIST.md`): switch to live keys, create a live webhook, and change `COMMERCE_ENABLED` in code.

## Permissions

`payments.read` (all roles), `payments.write` (owner, manager: start a charge), refunding through Razorpay needs `refunds.approve` (owner only, same as approving).

## Customer payment (Phase 5, Section 4)

Staging only. It opens when **all** of these are true: `FEATURE_CART_PREVIEW=on`, `FEATURE_CHECKOUT_TESTING=on`, `FEATURE_PAYMENT_TEST_MODE=on`, `VERCEL_ENV` is not `production`, and `RAZORPAY_KEY_ID` is a **test** key (`rzp_test_...`). A live key is refused while `COMMERCE_ENABLED` is false. Everything else answers 404.

Flow: customer places the order (stock held 30 minutes) > `POST /api/checkout/pay` creates the Razorpay order for the amount stored on the order (the browser sends only the order id) > Razorpay Checkout opens in Razorpay's own window > the page sends Razorpay's callback to `POST /api/checkout/verify` > the server checks the signature **and** asks Razorpay for the payment (order id, amount, currency, status must all match) > only then does the database mark the order paid and empty the bag. The signed webhook and the reconcile job go through the same database function, so any of the three can arrive first, late, or twice.

Extra set-up for staging:
1. Run `supabase/payments_checkout.sql`, then `supabase/payments_checkout_selftest.sql` (must end `ALL PASSED`), and do the two-session checks at the bottom of that file.
2. Add `shipping_pincodes` rows for the PIN codes you want to test (the table ships empty; nothing is deliverable until you do).
3. Set the three flags above and the test keys in the **staging** environment only.
4. Optional but recommended: set `CRON_SECRET` and have a scheduler call `GET /api/checkout/reconcile` with `Authorization: Bearer <CRON_SECRET>` every 5 to 10 minutes. Vercel Cron on the free Hobby plan runs once a day at most; every few minutes needs a paid plan or an external scheduler. It is not in `vercel.json` on purpose so a deploy cannot fail on plan limits. Without it, unpaid orders are released when another customer reaches the place step (up to 5 per call) or when an admin cancels them.
5. Content-Security-Policy: only `/checkout` allows `checkout.razorpay.com` (script), `api.razorpay.com` (frame and connect) and `lumberjack.razorpay.com` (connect). **These host lists come from memory of Razorpay's guidance and have not been tried in a browser.** On the first staging payment open the browser console, fix any blocked-request message by adding that exact host to the `/checkout` rule only, and keep `shared/commerce.test.ts` green.
6. Test with Razorpay's test cards and test UPI ids from their documentation: success, failure, and closing the window. Then trigger a late webhook (pay, close the tab before the callback) and confirm the order becomes paid.

## Not built yet

- Payment methods beyond what Razorpay Checkout shows by default (no COD, no saved cards; Razorpay's window does that).
- Payment status shown on the order screen, and settlement matching against Razorpay payouts.
- COD, coupons, GST invoices, courier integration (unchanged from `ECOMMERCE_ARCHITECTURE.md`).
- A dashboard count for payments flagged `amount_mismatch` or `order_not_open` (they are in the audit log as `payment_amount_mismatch` and `payment_order_not_open`).
