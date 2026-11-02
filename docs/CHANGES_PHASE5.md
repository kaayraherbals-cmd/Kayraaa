> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Phase 5 changes

Evidence rule (same as Phase 4): "Verified" means a command was run and passed in this sandbox. The sandbox has **no network**, so `npm ci`, the real Vitest, ESLint, the full `tsc` typecheck, `vite build` and every Supabase or Razorpay call could not run. Tests below were run on a small stand-in runner using `tsx`, not Vitest.

## Section 1: audit and baseline

- `npm ci` failed here (no network). Lint, typecheck, test and build: **not run**. Run them on a networked machine and record the output before trusting anything below.
- Lockfile is structurally consistent (v3, 412 packages, all resolved). Only a real `npm ci` confirms it.
- Found missing: cart, checkout, addresses, shipments, tracking, customer order history, and per-feature flags. `COMMERCE_ENABLED` was a constant only.
- The Content-Security-Policy (`script-src 'self'`, `connect-src 'self'`) will block Razorpay Checkout. Allow its domains narrowly in Section 4, only when the payment test flag is on.
- Rate limiting is per serverless instance; checkout and payment endpoints need shared limits (Vercel Firewall or a database counter) before launch.

## Section 2: shopping bag (development preview)

Customer copy says "bag"; code says "cart".

| Area | Files |
|---|---|
| Flags (five, all off by default, forced off in production) | `shared/flags.ts`, `.env.example` |
| Rules: validation, eligibility, stock clamp, totals | `shared/cart.ts` |
| Database | `supabase/carts.sql` (stores variant ids and quantities only; RLS on, no grants to anon/authenticated; atomic `cart_set_item`, `cart_merge`, `cart_clear`) |
| Server | `server/cart.ts`, `api/cart/[action].ts` (`config`, `variants`, `validate`, `view`, `set`, `merge`, `clear`) |
| Errors | `KH-CART-001` to `006` in `shared/errors.ts` and `docs/ERROR_CODES.md` |
| Client | `src/lib/cartApi.ts`, `src/lib/cart.tsx`, `src/components/cart/*` (CartBadge, CartDrawer, CartList, CartItem, CartSummary, EmptyCart, AddToBag), `src/pages/Bag.tsx`, `src/cart.css` |

Behaviour:
- The browser sends variant ids and quantities only. Price, tax, name, stock and eligibility are read from the database on every request; browser prices are ignored.
- Purchasable only if: product `APPROVED_FOR_SALE`, variant active, price set, GST rate and HSN present, and sellable stock (active batches, not within 30 days of expiry, on hand minus reserved).
- Signed-in customers: server-backed bag. Guests: ids and quantities in `localStorage`, re-priced by the server on every view; merged once into the saved bag at sign-in.
- Everything except `config` returns 404 unless `FEATURE_CART_PREVIEW=on`, and the flag cannot be on when `VERCEL_ENV=production`.
- `checkoutOpen` is always `false` while `COMMERCE_ENABLED` is false. The checkout button is disabled and says so. No order can be created.
- Prices are MRP including GST (the same basis as `order_create`); the summary shows the GST contained, shipping "calculated at checkout".

### Test evidence (stand-in runner, not Vitest)

`shared/flags.test.ts`, `shared/cart.test.ts`, `api/cart/cart.test.ts`, `shared/errors.test.ts`: 57 passed, 0 failed. Mutation checks (trusting a client price, dropping the status check, removing the flag guard, taking the member id from the request body) each made tests fail, then were reverted.

### Not verified

- Full `tsc` typecheck: React and Vercel types are not installed here. Only `shared/*` and `server/cart.ts` were type-checked (strict, no errors apart from missing `@types/node`). `api/cart/[action].ts` and all `src/` files were parse-checked only.
- No browser rendering, keyboard pass, screen-reader pass or mobile device test of the bag UI.
- `supabase/carts.sql` has not been run on any database. No SQL self-test yet.
- No concurrency test against a real database (the 20-line limit relies on the locked cart row in `cart_set_item`).
- Guest-to-account merge in the browser is untested end to end.
- Stock shown in the bag is not reserved; reservation happens at checkout (Section 4).

### Known gaps to close in later sections

- The checkout link targets `/checkout`, which does not exist until Section 3.
- Shipping serviceability and the "shipping supported" eligibility rule arrive with checkout (Sections 3 and 6).
- Cart abandonment analytics (Section 8) need a consent decision before anything is recorded.

## Section 3: checkout (development testing)

Checkout creates an **unpaid test order and holds stock**. It takes no payment (Section 4) and ships nothing.

| Area | Files |
|---|---|
| Rules: PIN and phone validation, address, shipping quote, request validation, request fingerprint, gate | `shared/checkout.ts` |
| Database | `supabase/checkout.sql` (`orders.member_id`, `is_test`, `pay_by`; `shipping_pincodes`; `checkout_attempts`; atomic `checkout_place`), `supabase/checkout_selftest.sql` |
| Server | `server/checkout.ts`, `api/checkout/[action].ts` (`config`, `quote`, `place`) |
| Errors | `KH-CHK-001` to `008` in `shared/errors.ts` and `docs/ERROR_CODES.md`; new `KH:` mappings in `shared/inventory.ts` |
| Client | `src/lib/checkoutApi.ts`, `src/pages/Checkout.tsx`, `src/components/checkout/*` (CustomerDetails, AddressForm, ShippingMethod, OrderReview, PaymentStep, OrderConfirmation), `src/checkout.css`, route `/checkout` (noindex, no-store) |

Behaviour:
- Closed (404) unless `checkoutOpen()`: the master switch, or `FEATURE_CHECKOUT_TESTING` together with `FEATURE_CART_PREVIEW`. Both flags are forced off when `VERCEL_ENV=production`. `COMMERCE_ENABLED` is unchanged (`false`). The bag's checkout link follows the same gate.
- Needs a signed-in member (re-checked against `members`), same-origin plus CSRF header, and a per-address and per-member rate limit.
- Items come from the customer's **saved bag**, never from the request. Price, GST, shipping and total are recomputed on the server, and prices again inside `order_create`. The only number the browser sends is `expectedTotalPaise`, used to refuse the order if the price moved (`KH:PRICE_CHANGED`), never as an amount.
- Delivery is refused for any PIN code not in `shipping_pincodes`. The table ships **empty**, so nothing is deliverable until rows are added on purpose.
- `checkout_place` runs in one transaction: per-member advisory lock, idempotency key lookup, reuse of an open unpaid order with identical contents, cap of 3 open unpaid orders, serviceability, `order_create` (atomic stock reservation, first-expiry-first-out), total check, ownership and 30-minute hold. Same key with different contents is refused.
- Orders made while the master switch is off are `is_test` and must never be fulfilled.
- The bag is **not** cleared at placement. It is cleared when payment is verified (Section 4), so a failed payment keeps the customer's bag.

### Test evidence (stand-in runner, not Vitest)

Whole suite on the stand-in runner: **404 passed, 0 failed** (includes 22 new in `shared/checkout.test.ts` and 30 new in `api/checkout/checkout.test.ts`). Mutation checks (gate always open, wrong expected total, trusting client items, skipping serviceability) each made tests fail, then were reverted.
Strict `tsc` on the new and changed server, shared and client-API files: no errors in them. The React files were parse-checked with esbuild only.

Two existing tests were changed on purpose:
- `shared/commerce.test.ts` used to assert there is no checkout route. It now asserts there is no payment or order route, no payment provider in `vercel.json`, and that the checkout page and API sit behind the gate.
- `server/password.test.ts` expected `'Asha bRaob'`; `cleanName` strips `<` and `>` only, so the correct value is `'Asha bRao/b'`. This failure was already recorded in `docs/CHANGES_PHASE4.md`. The code was not changed.

### Not verified

- `npm ci`, ESLint, the real Vitest, the full typecheck and `vite build` did not run (no network). `src/` files other than `checkoutApi.ts` are parse-checked only.
- `supabase/checkout.sql` and `checkout_selftest.sql` have **never been run**. The API tests use a mocked database that imitates the function, so they prove what the API sends and how it maps errors, not that the SQL is right. Atomicity, the advisory lock and concurrent purchases are untested until the self-test and a real concurrency test run on staging.
- No browser, keyboard, screen-reader or mobile pass on the checkout page.
- The real sign-in flow with the checkout page was not exercised. The page links to `/login` and does not return to checkout afterwards.

### Launch blockers added by this section

1. Run `checkout.sql` and `checkout_selftest.sql` on staging and record the output.
2. Populate `shipping_pincodes` deliberately (or replace it with the courier provider in Section 6).
3. GST treatment of the shipping charge needs the company's tax adviser. Shipping is treated as tax-inclusive with no separate tax line.
4. Rate limits are per serverless instance; add shared limits (Vercel Firewall or a database counter) before launch.
5. Unpaid orders hold stock for 30 minutes (`pay_by`) but nothing releases it yet. Section 4 must add expiry and release.
6. Saved addresses are not stored; the address lives on the order only. Section 7 adds saved addresses.
7. `PaymentFailure` is not built. It belongs with Razorpay in Section 4.
8. The sign-in redirect back to `/checkout` is missing.

### Environment variables

No new variables. `FEATURE_CHECKOUT_TESTING` already exists in `.env.example`; set it to `on` only on a staging deployment that also has `FEATURE_CART_PREVIEW=on`.

## Section 4: Razorpay customer payment (test mode)

A signed-in customer can pay for their own unpaid test order through Razorpay Checkout **in test mode only**. Live payments stay impossible: `COMMERCE_ENABLED` is unchanged (`false`), a live key is refused, and every flag is forced off when `VERCEL_ENV=production`.

| Area | Files |
|---|---|
| Rules: when payment is open, request validation, what a provider payment means for our order, what the customer's screen shows | `shared/payments.ts` (additions) |
| Razorpay client: read a payment, read an order's payments (ids checked before they go in a URL) | `server/razorpay.ts` (additions) |
| Database | `supabase/payments_checkout.sql`: `payment_prepare`, `payment_attach`, `order_cancel_own`, `orders_due_for_expiry`, `order_expire`; **replaces** `payment_apply_event` (adds: empty the bag when paid). `supabase/payments_checkout_selftest.sql` |
| Server | `server/checkoutPayments.ts`; actions `pay`, `verify`, `status`, `cancel`, `reconcile` added to `api/checkout/[action].ts` (no new serverless function) |
| Errors | `KH-PAY-001` to `008` |
| Client | `src/lib/razorpay.ts` (loads Razorpay's script on demand), `src/lib/checkoutApi.ts`, `src/components/checkout/PaymentStep.tsx`, `PaymentFailure.tsx`, `OrderConfirmation.tsx`, `src/pages/Checkout.tsx`, `src/checkout.css` |
| Headers | `vercel.json`: the Content-Security-Policy is split; only `/checkout` may load Razorpay |

How it maps to your 12-step flow: (1) sign-in re-checked against `members`; (2, 3) bag and totals as in Section 3; (4, 5) order and atomic stock hold from `checkout_place`; (6) `pay` creates the Razorpay order for the amount **read from the order**; (7) Razorpay Checkout opens; (8) `verify` checks Razorpay's signature then asks Razorpay for the payment; (9) the existing webhook is unchanged and uses the same database function; (10) `reconcile` asks Razorpay about overdue orders; (11) an order becomes paid only inside `payment_apply_event`; (12) `reconcile` and `order_expire` release stock for orders nobody paid.

Behaviour you can rely on (each has a test; the database half is imitated, see below):
- The browser sends only an order id, and Razorpay's callback fields. No amount is ever read from it.
- The callback is **not** proof. A good signature with Razorpay unreachable shows "processing", never "paid".
- Order id, amount (exact paise), currency and status must all match; any mismatch applies nothing, or flags `amount_mismatch` for a person.
- An open attempt is reused (a double tap makes one Razorpay order, or the second request is handed the first). An authorised payment is never duplicated or cancelled under.
- A failed attempt keeps the order and the bag; a new attempt is allowed until the 30-minute window ends.
- Money after cancellation is flagged `order_not_open` for refund; the order stays cancelled.
- Duplicate or late events (webhook, callback, reconcile) change nothing the second time.
- Stock is released after expiry only after Razorpay has been asked; if Razorpay cannot be reached the order is deferred, never cancelled.
- Cross-account: ownership is part of every query and database function; another customer's order looks missing (404).
- Logs and audit rows carry order, Razorpay ids and amounts only. Responses carry the public key id only.

### Test evidence (stand-in runner, not Vitest)

Whole suite on the stand-in runner: **473 passed, 0 failed** (was 404 at the start of this section). New: `api/checkout/payments.test.ts` (51), additions to `shared/payments.test.ts`, `server/razorpay.test.ts` and `shared/commerce.test.ts`. Mutation checks, each made tests fail and was then reverted: skipping the signature check; ignoring the key mode (accepting a live key); skipping the comparison of Razorpay's order amount with ours; expiring an order when Razorpay could not be asked; not stopping at "processing" for an authorised payment; removing the amount comparison in `decideVerification` (caught only by its unit test, because the database function also compares amounts, so two layers guard it).
Strict `tsc` (project options, stubbed `@vercel/node`, real `@types/node`) on `shared/payments.ts`, `shared/errors.ts`, `shared/inventory.ts`, `server/razorpay.ts`, `server/checkoutPayments.ts`, `api/checkout/[action].ts`, `api/payments/webhook.ts` and `src/lib/checkoutApi.ts`: no errors in them. The React files were parse-checked with esbuild only.

Two existing tests were changed on purpose: `shared/commerce.test.ts` (it said no payment provider may appear in `vercel.json`; it now says only the `/checkout` rule may name Razorpay, and no other provider anywhere) and its checkout-page assertion (`checkoutApi.config()` replaces `checkoutApi.open()`).

### Not verified (read this before trusting any of it)

- `npm ci`, ESLint, the real Vitest, the full typecheck and `vite build` did not run (no network).
- **Nothing was run against Razorpay**, test mode included. The request shapes follow Razorpay's documented API from memory: `POST /orders`, `GET /payments/:id`, `GET /orders/:id/payments`, the callback signature `HMAC_SHA256(order_id|payment_id)` and the webhook signature. Confirm each on staging.
- **`payments_checkout.sql` and its self-test have never been run.** The API tests use an in-memory imitation of the SQL functions that I wrote from the same design, so a mistake in my reading would appear in both. Atomicity, the row locks and concurrent purchases are untested until the self-test and the two-session checks run.
- The CSP hosts for Razorpay Checkout are from memory and untried in a browser. The `vercel.json` source pattern `/((?!checkout$).*)` (every path except `/checkout`) has not been tried on Vercel: after the first deploy, check the response headers of `/` and `/checkout`.
- No browser, keyboard, screen-reader, mobile or reduced-motion pass on the payment screens. `PaymentStep` polling (10 tries, 3 seconds apart) is untested in a browser.
- The Razorpay popup, the real webhook arriving before or after the callback, and Razorpay's automatic capture setting are untested.

### Launch blockers added or confirmed by this section

1. Run `payments_checkout.sql` and its self-test on staging, then the two-session checks, and record the output.
2. Run a real test-mode payment on staging for each case: success, failure, closed window, late webhook, duplicate webhook, wrong amount (Razorpay's dashboard cannot easily force this; keep the mocked test and review the code path), refund of a captured test payment.
3. Decide how stock is released on a schedule (Razorpay-aware reconcile every few minutes needs a paid Vercel plan or an external scheduler; see `docs/RAZORPAY_SETUP.md`).
4. Rate limits are still per serverless instance; `pay` and `verify` need shared limits (Vercel Firewall or a database counter) before launch.
5. Section 3's blockers still stand: `shipping_pincodes` is empty, GST on shipping needs the tax adviser, the sign-in return to `/checkout` is missing, saved addresses are not stored.
6. Emails (payment confirmed, payment failed, order cancelled) are not sent yet: Section 5. The paid screen says a confirmation email follows "once email sending is switched on" and must be reworded when Section 5 is done.
7. The webhook route does not look at Razorpay's event timestamp. Replay protection is the event id (each delivery is applied once). Add a timestamp window if you want a second layer.
8. A customer cannot cancel or return a **paid** order from the site yet (Section 7).

### Environment variables

New: `CRON_SECRET` (optional, for `/api/checkout/reconcile`). Needed for test payments on staging: `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (test keys), `RAZORPAY_WEBHOOK_SECRET`, and `FEATURE_PAYMENT_TEST_MODE=on` together with `FEATURE_CHECKOUT_TESTING=on` and `FEATURE_CART_PREVIEW=on`. Never set any `FEATURE_*` flag in production: it is ignored there by design.

