# Phase 7: intelligent abandoned cart recovery

Built on `kaayra-herbals-v5-phase5-promotions.zip` (reviews, coupons and every earlier phase kept). **Recovery ships OFF.** Nothing is detected or sent until migration 25 is run, an email provider is configured, and the owner switches it on in Admin > Shop > Cart recovery.

## 0. What is verified and what is not (read first)
| Item | Status |
|---|---|
| 96 new tests (shared logic, email templates, tokens, worker, public API, admin) | **Run and passing through a stand-in test runner**, not the real `vitest` (npm registry blocked in this session) |
| Existing suites touched or adjacent (roles, outbox-cron, cart, admin coupons, mail templates, outbox) | Run through the same stand-in: pass |
| `server/api-tests/coupons.test.ts` | 6 failures under the stand-in **on the untouched promotions ZIP too**, so they come from the stand-in, not this phase; the ZIP's own results file records them passing under real vitest |
| `npm run lint`, full `npm run typecheck`, `npm run build`, real `vitest` | **NOT run** (no `node_modules`, no network). Phase 7 server/shared files and the two API handlers were type-checked with the global compiler against stubbed Node types and show no errors; React files were only parsed, not type-checked |
| `supabase/cart_recovery.sql` and `cart_recovery_selftest.sql` | **NOT run** (no PostgreSQL available). Written carefully against the existing schema (columns were checked) but unexecuted SQL can contain mistakes. Run the self-test on staging first |
| Resend sending, Razorpay, Supabase project, scheduler, browser, mobile | **NOT tested** (no credentials, network or browser) |
| Phase 4 Gemini owner AI | **Absent from every ZIP supplied**, so no AI tools were added (Section 11) |
Do not treat this as production ready. See Section 12.

## 1. Audit of the existing project (confirmed)
| Area | Finding |
|---|---|
| Carts | Server carts exist **only for signed-in members** (`carts`, `cart_items`: variant ids and quantities, plus `coupon_code`). Guest bags live only in the browser. Prices, tax, stock are always read live |
| Cart activity | `carts.updated_at` is bumped by every change (including coupon apply/remove) and is the authoritative server timestamp used here |
| After purchase | `payment_apply_event` empties the bag when an order is paid (`payments_checkout.sql`); recovery additionally treats any paid order created after the last bag change as superseding the bag |
| Checkout / payments | `orders.member_id`, `order_payments` (`created`, `authorized`, `captured`, `failed`), 30-minute stock hold, reconcile sweep |
| Email | Resend via `server/mail.ts`; ledger `email_outbox`; durable queue renders **order** mail only; launch-list unsubscribe pattern (signed link, confirm page, RFC 8058 one-click) |
| Scheduling | `vercel.json`: two daily crons (`/api/checkout/reconcile`, `/api/checkout/outbox`). `api/` holds exactly 12 functions (Hobby limit) |
| Marketing consent | **Only the launch list** had consent. Customer accounts had **no** marketing preference. Checkout email is not consent and is not treated as such |
| Coupons | Present (Phase 5): code on the bag, `coupon_quote` re-checks live, reserved at order placement |
| Abandoned cart | **Did not exist.** Nothing duplicated |
| Confirmed gaps | No cart-reminder consent; no suppression list; no recovery tables; guests cannot be reached (no email, and none is collected secretly) |

## 2. How it works
`runRecoveryJob` (server/recovery.ts), one pass: **sync** (close cycles that no longer need a reminder, attribute recovered orders, retention) > **detect** (open a cycle per newly abandoned, consented bag) > **claim** due reminders > for each: **database pre-send re-check**, **live re-price from the database**, **send**, **record**.
- *Abandoned* = the bag holds at least one buyable item (published product, active pack, priced), has been idle at least `inactivity_minutes` (default 60, configurable 15 to 10,080) by the **database clock**, is not superseded by a paid order, is not in an active checkout, and the customer opted in and is not suppressed.
- *Active checkout* = an unpaid order inside 3 hours, or a payment `authorized` but not captured within 3 days (being reconciled). While that holds the reminder is **postponed**, not sent and not consumed.
- *Reminders* are due `step_delays_minutes` after abandonment (defaults 60, 1,440, 4,320 minutes; suggestions only, validated strictly increasing). Per bag at most 3; per customer at most 3 in 7 days; never two within `min_gap_hours` (default 12), so an outage cannot cause a burst.
- *Stops immediately* (next sync or next pre-send check) on: purchase, bag emptied or changed, unsubscribe, suppression, consent withdrawn, 14 days elapsed, pause, disable.
- *Pre-send checks* (`cart_recovery_preflight`, in the database): cycle open, bag exists and non-empty and unchanged, no superseding order, no active payment, consent on, not suppressed, step not already sent, cycle and 7-day limits, minimum gap. The TypeScript then re-prices the saved bag; if nothing can be bought, **no email is sent**.
- *Duplicates* are prevented by `unique (cycle_id, step)`, a unique idempotency key, row locking (`for update skip locked`, 10-minute lock), and a fixed provider `Idempotency-Key` per reminder.
- *Mail*: three templates (`shared/recoveryMail.ts`) with your exact subjects; branded layout; sender line (legal name and address from `VITE_LEGAL_ENTITY_NAME` / `VITE_CONTACT_ADDRESS`, omitted if blank); unsubscribe link and `List-Unsubscribe` one-click headers; today's prices; no urgency, scarcity, invented discount, price history or health claim (tested by pattern). Marketing mail is sent through the existing `sendMail`, so it is recorded in the existing `email_outbox` ledger.
- *Why not the order-mail queue*: that queue renders from an order and re-checks an order fact. Recovery needs its own pre-send checks, so it uses the same mailer and ledger but its own `cart_recovery_messages` table. This is a deliberate reuse of the provider, not a second email service.

## 3. Consent, unsubscribe, privacy (Section 12 of your list)
- Reminders are treated as **marketing**. Default: **off**. The only way on is the customer's own switch in Account > Email reminders (shown only while recovery is available), stored with the **wording version** (`cart-reminders-v1`) and the time. Signing up or entering an email at checkout never switches it on. No checkout checkbox was added (your UI is finalized); if you want one, it must be unticked by default and call the same `prefs` action.
- Turning it off, or pressing the unsubscribe link in any reminder (page `/subscription?a=cart-unsubscribe&t=...`, button press required so mail scanners cannot unsubscribe anyone; also RFC 8058 one-click `POST /api/cart/unsubscribe?u=...`), writes a **persistent suppression** (SHA-256 of the lower-cased address; no plain address), cancels waiting reminders, revokes links and closes the cycle in one transaction. Unsubscribe links never expire and carry only a member id, signed.
- Re-enabling needs a **new explicit opt-in by the signed-in customer**. A suppression for `bounced`, `complaint` or `admin` is **not** cleared by that: the screen says we cannot email the address. (Nothing yet *writes* `bounced`/`complaint`: there is no Resend webhook receiver in this project. Add one before relying on provider feedback.)
- Guests: not contacted. Their bag is only in their browser, we hold no email for it, and none is collected secretly.
- Retention: closed cycles and their items, messages and tokens are deleted after 180 days (configurable column `retention_days`); expired tokens after 30 days more; attribution rows (order-level money records) stay with the link to the cycle removed. Deleting an account cascades everything personal; the hash-only suppression stays so the address is never emailed again. Cycle items store variant ids and quantities only (no names, prices or addresses). Logs carry counts and error classes only. The Privacy page has a new "Bag reminder emails" paragraph (**have it reviewed by your adviser**; this is not legal advice).
- Provider terms: use only a verified sending domain, keep complaint rates low, and do not email people who did not opt in.

## 4. Restore links
`/bag?recover=<token>`. Token = 32 CSPRNG bytes (43 base64url characters), carries **no data**; only its SHA-256 (with a prefix) is stored; expires (default 168 hours, configurable); revoked when the bag is bought, emptied, changed, or the customer unsubscribes; requires the **signed-in owner**. The page removes the token from the address bar at once. With nobody signed in the token waits in the tab's `sessionStorage` until sign-in returns to `/bag`. A different signed-in account gets "this link is for a different account" and **no cart data**. Clicks are counted only for the right signed-in customer, so link scanners are never counted. The bag is the customer's own saved bag, returned **re-priced and re-stocked from live data with the coupon re-validated** (`signedView`); an old price or old total is never shown or trusted. Checkout runs all its normal checks; the bag grants nothing.
Rate limit: 20 requests a minute per IP on `recover` and `unsubscribe`.

## 5. Coupons (Section 9)
Reminders **never create, apply, reserve, consume or advertise a coupon**, and the email text contains no discount wording (tested). The bag keeps whatever code the customer applied; on restore `coupon_quote` re-checks expiry, limits, product rules, minimums and eligibility and an invalid code simply gives no discount (tested); at checkout the Phase 5 engine validates and reserves as before. Per-customer and total usage are untouched by reminders.

## 6. Owner dashboard (Admin > Shop > Cart recovery)
Owner only (`recovery.read`, `recovery.manage`; manager and support get nothing). Shows status, provider/link readiness, on/off and pause buttons, timing and limits, the numbers for 7/30/90 days with a definition for each, top products in abandoned bags, open cycles (masked email like `a***@g***.com`, item count, timings; no names, amounts or tokens), and recent failures/skips. Every settings change is validated (unknown fields rejected; same limits as database CHECKs) and **audited with before and after**. There is no route that sends mail, edits a bag, issues a discount or touches orders, payments or stock (tested). Existing admin components and classes only; no new CSS.

## 7. Metrics (exact definitions, `cart_recovery_stats`)
| Metric | Definition |
|---|---|
| Abandoned carts | Bags last changed in the period, idle at least the inactivity time, holding a buyable item, not superseded by an order, not mid-checkout; consent not required |
| Eligible abandoned carts | Of those, cycles opened (consented, not suppressed) |
| Emails queued / sent / failures | Reminders scheduled in the period / accepted by the provider in the period / ended `failed` after three tries. Acceptance is not inbox delivery |
| Link clicks | Reminders whose link the signed-in owner opened (first click in period) |
| Recovered orders / carts / revenue | Rows in `cart_recovery_attribution`: an order created **after a click** and within `attribution_window_days` (7), paid or captured. Primary key `order_id` means an order is counted once |
| Conversion rate | Recovered carts / carts that were emailed in the period |
| Unsubscribe rate | Unsubscribes via a reminder link / distinct customers emailed in the period |
Revenue is **attributed**, not proven incremental: some of those customers would have bought anyway, and there is no holdout group. The dashboard says so. Nothing is estimated.

## 8. Scheduling (Section 14)
- Vercel Hobby (as I understand it; **check the live Vercel pricing/limits page**): 2 cron jobs per account, each at most once a day, with imprecise timing. Both slots are already used, so **no cron was added**: recovery runs inside the existing daily `/api/checkout/outbox` call (failure isolated from order mail). Reminder times are therefore "next daily run after due", not exact: a "1 hour" reminder can arrive up to about a day late.
- Better, free-ish option already in the repo: `supabase/scheduler_pg_cron.sql.example` (pg_cron + pg_net, needs your Supabase plan's extensions) can call `GET /api/checkout/recovery` with `Authorization: Bearer <CRON_SECRET>` hourly. That endpoint exists now and returns counts only. Nothing paid was enabled. Pro-plan Vercel cron is the other option (your decision).
- Safe with overlap and interruption: claims lock rows; a dead worker's claim expires after 10 minutes; failed sends retry up to 3 times 30 minutes apart; batch size is configurable (default 25, max 100) and each run is bounded.

## 9. Security report (design review; no penetration test was done)
| Threat | Control | Evidence |
|---|---|---|
| Unauthorised cart access | Link needs the signed-in owner; wrong account gets nothing; tables have RLS on and no grants | API tests; SQL self-test (unrun) |
| Token guessing / replay | 256-bit random token, format checked first, hash-only storage, expiry, revocation, rate limit 20/min/IP | token and API tests |
| Email enumeration | Same responses for unknown/malformed tokens; unsubscribe always succeeds from the visitor's side | API tests |
| Cross-customer exposure | Admin shows masked email only; logs hold no addresses (tested for the failure path) | admin and worker tests |
| Excessive sending | Per bag 3, per customer 3 per 7 days, min gap, batch cap, pause, off by default | worker + SQL |
| Price/coupon manipulation | Prices live from the database; coupon re-validated; browser sends only a token | API tests |
| Duplicate attribution | `order_id` primary key | SQL self-test (unrun) |
| Unauthorised admin | Server-side permission, owner only, denials audited | admin tests |
| Open redirect / token leak | Token removed from the address bar; no email, price or order detail in any URL | code review |
Known limits: link previews that execute JavaScript are not a concern (no click without a session); the signed unsubscribe token cannot be revoked per link (rotate `SUBSCRIBE_TOKEN_SECRET`, which also invalidates old launch-list links); the restore token sits in `sessionStorage` while signing in (useless without the account); no bounce/complaint feedback loop yet.

## 10. Environment variables
No new variables. Reused: `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO`, `SUBSCRIBE_TOKEN_SECRET` (32+ chars, signs unsubscribe links), `SITE_URL`/`VITE_SITE_URL` (real https), `CRON_SECRET`, `VITE_LEGAL_ENTITY_NAME`, `VITE_CONTACT_ADDRESS`, `SUPABASE_*`. If the provider key, the secret or a real https address is missing, recovery opens nothing and sends nothing (tested). Production live-sales gating is unchanged: reminders only matter once real carts exist.

## 11. Owner AI (Gemini)
Not present in any ZIP supplied, so nothing was integrated. Ready for it: `GET /api/admin/recovery-overview` (read-only; owner only; returns the metrics above). Any AI tool must call only that and must never be given `recovery-settings` or any cart, coupon, order, payment or inventory route. The test "overview only reads" guards the read path. If you send the Phase 4 ZIP, wiring read-only tools is a small follow-up.

## 12. Deployment (staging first)
1. Back up. Run `supabase/cart_recovery.sql` on **staging**, then `cart_recovery_selftest.sql` (rolls back). Expect PASS notices; fix anything that fails before going on.
2. On a networked machine: `npm ci && npm run lint && npm run typecheck && npm test && npm run build`. Fix anything the stand-in could not catch.
3. Set the variables in Section 10 on staging. Use a Resend test domain and **your own test addresses only**. Never send test campaigns to real customers.
4. Deploy. Sign in as owner > Shop > Cart recovery: check "Email provider" and "Email links" show Configured.
5. As a test customer: Account > switch on Email reminders; add an item; wait past the inactivity time (set it to 15 minutes for the test); call `GET /api/checkout/recovery` with the bearer secret; read the email; click it signed in and signed out and as another account; unsubscribe; buy and confirm no further reminders.
6. Only then turn recovery on for the live site, with the owner's approval. Leave `LIVE_SALES_*` as it is.

## 13. Changelog
Added: `supabase/cart_recovery.sql`, `cart_recovery_selftest.sql`; `shared/recovery.ts`, `shared/recoveryMail.ts`; `server/recovery.ts`, `server/recoveryToken.ts`, `server/admin/recovery.ts`; `src/pages/AdminRecovery.tsx`; tests `shared/recovery.test.ts`, `shared/recoveryMail.test.ts`, `server/recoveryToken.test.ts`, `server/recovery.test.ts`, `server/api-tests/cart-recovery.test.ts`, `server/admin/recovery.test.ts`.
Changed (additive): `api/cart/[action].ts` (`recover`, `unsubscribe`, `prefs`); `api/checkout/[action].ts` (recovery in the outbox call; `recovery` action); `server/admin/backoffice.ts`; `shared/roles.ts` (`recovery.read`, `recovery.manage`, owner only); `shared/mailTemplates.ts` (three kinds); `src/pages/Admin.tsx` (one tab); `src/pages/Bag.tsx` (handles the link; layout unchanged); `src/pages/Account.tsx` (one card); `src/pages/Subscription.tsx` (cart unsubscribe); `src/pages/Privacy.tsx` (one paragraph); `src/lib/cartApi.ts`; `.env.example`, `docs/DATABASE_MIGRATIONS.md`, `SESSION_RULES.md`.
Not changed: homepage, product pages, cart layout, checkout, colours, typography, animations, payment and coupon code, `vercel.json`, `api/` function count (12).

## 14. Not done / needs you
Run migration 25 and its self-test; real `npm ci`, lint, typecheck, vitest, build; Resend staging delivery test; scheduler choice; bounce/complaint webhook; adviser review of the privacy text and consent wording; optional unticked checkout opt-in; browser and mobile check of the Account card, Bag notice and admin tab (no screenshots were taken); Gemini wiring if you send that ZIP.
