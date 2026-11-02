> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Phase 7 Step 2: changes

Read `docs/PHASE7_STEP2_TESTING.md` first: **no code in this step has been executed.** Every row below says IMPLEMENTED (code written) and UNTESTED (never run) unless it says BLOCKED. The TESTED column is empty on purpose.

Production commerce remains **off**: `COMMERCE_ENABLED = false`. Nothing here turns any sale, payment or shipment provider on.

| # | Feature | Implemented | Tested | Untested | Blocked |
|---|---|---|---|---|---|
| 1 | Commerce safety review | Yes (by reading; see section 1) | No | Yes | No |
| 2 | Test-change review | Yes (by reading; see testing report) | No | Yes | No |
| 3 | Baseline commands | n/a | No | n/a | **Yes: no network** |
| 4 | Shipping database | Yes: `supabase/shipments.sql` | No | Yes | Execution blocked: no database |
| 4b | Shipment admin API and permissions | Yes | No | Yes | No |
| 5 | Durable email outbox | Yes: `supabase/email_outbox_v2.sql`, `server/outbox.ts` | No | Yes | Execution blocked |
| 6 | Ten order email templates | Yes: `shared/orderMail.ts` | No | Yes | Real delivery blocked (Resend untested) |
| 7 | Scheduled jobs | Yes: `vercel.json` crons, `/api/checkout/outbox` | No | Yes | **Plan check blocked** |
| 8 | Shared rate limiting | Yes: `supabase/rate_limits.sql`, `server/http.ts` | No | Yes | Execution blocked |
| 9 | Documents | Yes | n/a | n/a | No |

## 1. Commerce safety (read from source)

- `shared/commerce.ts`: `COMMERCE_ENABLED = false as const`.
- `readFlags` (`shared/flags.ts`): when `VERCEL_ENV` is `production`, every flag reads off whatever the variables say. With the master switch off, nothing else opens the bag.
- `checkoutOpen` = (master or checkout-testing flag) and bag flag. `paymentsOpen` needs `checkoutOpen`, then, with the master off, the payment-test flag **and** a Razorpay **test** key; a live key is refused. So in production, which forces all flags off, none of these can be true.
- Endpoints: `/api/cart/*` closed unless the bag flag; `/api/checkout/{quote,place,pay,verify,status,cancel}` closed (404 or KH-CHK-001) unless `checkoutOpen`; admin `order-create` and `payment-create` return 409 `commerce_off` while the master is off.
- **Deliberately not gated by the switch:** the Razorpay webhook (a payment Razorpay already took must still be recorded), the reconcile and outbox cron endpoints (secret-protected), and admin refunds on already-paid orders.
- Not verifiable here: that Preview and Production use different Supabase projects and Razorpay keys. That is environment-variable scoping in Vercel (S2-016). The only code-level separation is the `VERCEL_ENV` check above.
- Changed: a stale comment in `flags.ts` that said selling needed the bag open in production.

## 4. Shipping (`supabase/shipments.sql`, additive)

- Tables: `shipments`, `shipment_items`, `shipment_events` (append-only trigger; status history and tracking events, `visible` flag for the customer), `delivery_exceptions`. All have RLS on and no grants to `anon` or `authenticated`.
- States: pending, dispatched, in_transit, out_for_delivery, delivered, delivery_failed, return_to_origin, returned, cancelled. Legal moves are in one SQL function and mirrored in `shared/shipments.ts`; a test compares the two.
- `shipment_create`: only for a **packed** order; quantities cannot exceed what is left to ship.
- `shipment_set_status`: courier and tracking number required to dispatch; a failed delivery needs a reason and opens a delivery exception; a delivery, return or retry resolves open exceptions; event time cannot be in the future.
- Order consistency: when dispatched shipments cover every unit the order moves packed to shipped through the existing `order_set_status` (the single place stock leaves the shelf); when every live shipment is delivered the order moves to delivered. Cancelling an order cancels its not-yet-dispatched shipments. A return to origin does not restock.
- Ownership: `shipments_for_member(member, order)` returns shipments only when `orders.member_id` matches, and only events marked visible. **No customer endpoint calls it yet.**
- Admin API (inside the existing `api/admin/[action].ts` router; no new serverless function): `shipments`, `shipment`, `delivery-exceptions` (need `shipments.read`); `shipment-create`, `shipment-status`, `shipment-note`, `delivery-exception-resolve` (need `shipments.write`). New permissions: owner both, manager both, support read only. All changes audited. No courier provider is connected.
- Error mapping added in `shared/inventory.ts` for `SHIPMENT_BAD_TRANSITION`, `BAD_STATE` and `INVALID` so the admin sees the real reason.

## 5. Email outbox (`supabase/email_outbox_v2.sql`, additive)

- Columns added: `dedupe_key` (unique), `payload` (template parameters: ids only), `attempts`, `next_attempt_at`, `locked_until`, `last_error`, `provider_response` (small JSON: error code or ok), `sent_at`, `updated_at`. Statuses: queued, sending, sent, failed (legacy), dead, skipped.
- Functions: `email_enqueue` (returns the existing row for a repeated key), `email_claim_due` (`for update skip locked`, 5-minute lock so a crashed worker's rows come back), `email_mark_sent`, `email_mark_failed` (backoff 1 min, 5 min, 30 min, 2 h, 12 h; dead after 6 attempts or a permanent provider error), `email_defer` (wait without using an attempt), `email_mark_skipped`, `email_purge`, `email_outbox_stats`.
- Privacy: the payload holds ids, never a rendered body or street address; it is erased when the mail is sent, and from dead mail after 30 days; finished rows are deleted after 90 days. `last_error` is the short provider code only, never a response body (which can echo addresses). Logs carry counts and codes, not addresses.
- Duplicates: stable keys (`payment_confirmed:<order>`, `shipment_dispatched:<shipment>`, `refund_completed:<refund>`, ...) plus a stable `Idempotency-Key` sent to Resend (`kaayra-outbox-<row id>`, previously a fresh random value on every call).
- The worker (`server/outbox.ts`) renders from the database at send time and **re-checks the fact the mail states** before sending (`shared/outbox.ts`): payment confirmed needs a captured payment row and an order at paid or later; refund completed needs a provider-processed gateway refund (or an admin-recorded manual one); shipment mails need the matching shipment state. If not yet true it waits (10 minutes, no attempt used) and gives up quietly after 48 hours. A shipment id belonging to another order is ignored.
- Queued from: checkout order creation (`order_created`); verified captures in the browser-verify callback and the webhook (`payment_confirmed`); admin shipment moves; and a scheduled sweep that queues any missing payment, cancellation, shipment and refund mail for **online** orders. Nothing is queued from the frontend callback alone: a mail waits for the database's own record.
- Marketing consent is not touched: these are service messages to the customer who placed the order.

## 6. Templates (`shared/orderMail.ts`)

Order created, payment confirmed, payment failed, order cancelled, shipment dispatched, out for delivery, delivered, refund initiated, refund completed, return received. Fixed subjects, HTML with inline styles in the Kaayra look (Cormorant Garamond/Manrope with system fallbacks), plain text, order reference and support contact in every one. Refund initiated says "started"; only refund completed says the provider confirmed. No delivery-time promises or health claims.

## 7. Scheduled jobs

- `vercel.json` now has two crons: `/api/checkout/reconcile` at `0 2 * * *` (the existing endpoint, unchanged) and `/api/checkout/outbox` at `30 2 * * *`. Both need `Authorization: Bearer <CRON_SECRET>` (16+ characters, constant-time check, hidden 404 otherwise).
- The outbox job sweeps, drains up to 20 due mails, and purges old rows. It is safe to repeat and returns counts only. Two overlapping runs claim different rows.
- Reconcile already: asks Razorpay about late captures before releasing stock, leaves an order alone if Razorpay cannot be asked, keeps stock held for 24 hours after an authorisation (KH6-012), and is idempotent. Not changed.
- **Plan check not possible here (S2-004).** The schedules are daily because I believe Hobby allows no more; check the dashboard after deploy and shorten them on Pro.

## 8. Rate limiting

- New layer in `server/http.ts`: `createLimiter(window, max, name)` keeps the in-memory limit and adds `.shared(key)`, which calls `rate_limit_hit` (a fixed-window counter in the database). `isLimited(limiter, key)` checks both.
- Stored: bucket name, a salted SHA-256 of the IP or email, window start, count. No raw address.
- Now shared on: admin login, admin MFA, admin uploads; customer login, register, password reset, sign-in start, callback and setup; contact, issues, subscribe (and its token check); checkout (per IP), place order, pay and verify (per member).
- Fails open if the database is slow (1.5 s timeout) or down, with one log line a minute. `RATE_LIMIT_SHARED=off` disables the shared layer. Salt: `RATE_LIMIT_SALT`, or `ADMIN_SESSION_SECRET`.

## Files

New: `supabase/{shipments,email_outbox_v2,rate_limits}.sql`, `shared/{shipments,orderMail,outbox}.ts`, `server/outbox.ts`, `server/admin/shipments.ts`, eight test files (listed in the testing report), three `docs/PHASE7_STEP2_*.md`.
Changed: `shared/{mailTemplates,roles,inventory,flags}.ts`, `server/{mail,http,checkoutPayments}.ts`, `server/admin/backoffice.ts`, `api/{contact,issues,subscribe}.ts`, `api/{admin,auth,checkout}/[action].ts`, `api/payments/webhook.ts`, `vercel.json`, `vite.config.ts`, `.env.example`, `docs/DATABASE_MIGRATIONS.md`, plus the Step 1 edits.
Not changed: `package.json`, `package-lock.json`, the Razorpay module, the reconcile logic, the UI.

## Deploy order (staging first)

1. Apply `shipments.sql`, `email_outbox_v2.sql` (after `launch_optin.sql`) and `rate_limits.sql` to a staging Supabase project.
2. Set `CRON_SECRET`, optionally `RATE_LIMIT_SALT`, `MAIL_REPLY_TO`; keep `RESEND_API_KEY` on a test sender.
3. Deploy to Preview, confirm both cron jobs are listed, and trigger `/api/checkout/outbox` by hand with the secret.
4. Only then consider production, with commerce still off.
