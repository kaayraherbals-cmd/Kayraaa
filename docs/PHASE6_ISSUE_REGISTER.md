> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Phase 6 — Step 1: Repository audit (in progress)

Baseline: `kaayra-herbals-phase5-admin-simple2.zip` (= phase5-fixed2 plus the admin simplification in `docs/CHANGES_ADMIN_SIMPLIFY.md`; `supabase/` is byte-identical to phase5-fixed2). Node v22.22.2 / npm 10.9.7 (`.nvmrc` says 20; `engines` >=20).
Code changed in this step: KH6-001 only (lint). Everything else is documentation.

## Command results (actual, run in a clean extract of the baseline above)

| Command | Exit | Result |
|---|---|---|
| `npm ci` | 0 | Installed. npm reports 22 vulnerabilities (3 critical, 13 high, 6 moderate). |
| `npm run lint` | 0 | Clean after the KH6-001 fix. **Before the fix: exit 1, 14 errors.** Also clean when re-run after a build. |
| `npm run typecheck` | 0 | Clean. |
| `npm test` | 0 | 36 files, 483 tests passed (477 before KH6-012). |
| `npm run build` | 0 | Built; prerender used the placeholder site URL (expected without `VITE_SITE_URL`). |

`docs/CHANGES_ADMIN_SIMPLIFY.md` says these commands were "not run". They have now been run and pass.
Still not run: real Razorpay test-mode calls (KH6-007), browser, screen-reader and Core Web Vitals checks. The admin CSS visibility fix is therefore **not visually verified**.

## Database verification (new in this pass)
Run on a local **plain PostgreSQL 16**, with stand-ins for Supabase's `anon`, `authenticated`, `service_role` roles and the `storage.buckets` table. This is NOT Supabase: no PostgREST, no JWT-based RLS, no real `auth` schema. Role-level privileges were tested by switching roles.

| Check | Result |
|---|---|
| All 17 files applied in `docs/DATABASE_MIGRATIONS.md` order | All succeeded. |
| Every file applied a second time | All succeeded (idempotent). |
| `phase3`, `refunds`, `payments`, `checkout`, `payments_checkout` self-tests | All pass (9, 6, 7, 10 and 17 PASS notices, each ending ALL PASSED). The last two had never been run before. The last has the KH6-012 section added; one older step was adjusted (order C's authorised attempt is aged 25 hours) because it relied on the behaviour that was fixed. |
| `public_products` with seed data | 0 rows. |
| `select` on every `public` table as `anon` and as `authenticated` | Denied on all. No table has RLS disabled. |
| `admin_audit` update and delete | Both blocked ("append-only"). |
| Race: 8 parallel sessions, 8 different customers, stock of 3 | 3 orders created, 5 rejected with `KH:INSUFFICIENT_STOCK`. Reserved = 3. No batch below zero. |
| Race: 6 parallel submits, same customer, same idempotency key | 1 order, 1 reservation. |

Still unverified on a database: duplicate and delayed webhook delivery through the HTTP layer, the two-session payment checks listed at the end of `payments_checkout_selftest.sql`, and real RLS through Supabase's API.

## Coverage so far
Read: package/config, vercel.json, flags/commerce switches, webhook handler, mail layer and templates, email/shipping/order schema.
NOT yet reviewed in depth: admin permission matrix, inventory concurrency SQL, RLS policies, cart/checkout server logic line by line,
account pages, React components, accessibility, performance. Findings below are therefore incomplete.

## Issue register

### Confirmed
| ID | Sev | Files | Root cause | Fix | Verify |
|---|---|---|---|---|---|
| KH6-001 | Medium (**FIXED, verified**) | `server/mfa.ts:91`, `server/totp.ts:142`; `*.test.ts` in `server/`, `server/api-tests/`, `server/admin/` | `npm run lint` fails: 13 × `no-explicit-any` in test files; 1 × `rules-of-hooks` false positive because `useRecoveryCode` starts with "use". Release gate is red. | Done: renamed to `consumeRecoveryCode` (totp.ts, mfa.ts, totp.test.ts). `no-explicit-any` is now off for `*.test.ts` only (test doubles read loosely shaped JSON), and `dist-server` is ignored by ESLint. Shipped code still forbids `any`. | `npm run lint` exit 0 (also after a build); 477 tests pass |
| KH6-002 | High (for the brief) | `shared/checkout.ts`, `supabase/checkout.sql`, `supabase/inventory_orders.sql` | Shipping is a flat-rate PIN table plus a single `orders.tracking_no` column. No shipments table, zones, delivery estimates, exception or return-to-origin states, provider adapter. | New provider-independent shipments model with manual fulfilment adapter. | SQL self-test + unit tests |
| KH6-003 | High | `shared/mailTemplates.ts`, `server/mail.ts`, `supabase/email_outbox.sql` | Only 5 mail kinds exist. Missing: order confirmation, payment failure, shipped, delivered, cancellation, refund initiated/completed. Outbox stores no body, so failed mail cannot be retried. Idempotency key is a fresh `randomUUID()` per call, so it does not deduplicate. | Add templates; outbox with payload reference, attempt count, dedupe key; retry job. | Template tests; failed-send retry test |
| KH6-004 | High | `vercel.json`, `api/checkout/[action].ts:77` | `/api/checkout/reconcile` needs an external scheduler, and `vercel.json` has no `crons` entry. Stock held by unpaid orders is released only on checkout activity or admin action. | Add a scheduler (Vercel cron or external) calling reconcile with `CRON_SECRET`. Confirm current Hobby cron limits before choosing. | Staging run releases an expired hold |
| KH6-005 | Medium | `server/http.ts:25` | Rate limiting is per serverless instance, in memory (the code comment says so). Ineffective across instances. | Persistent limiter (database counter) or Vercel Firewall rules. | Test across two instances |
| KH6-006 | Medium | `api/` | 10 of the 12 allowed functions are used (`SESSION_RULES.md` limit). New endpoints (shipping, email retry, webhooks) must go through existing `[action].ts` routers. | Design constraint, not a defect. | `ls api` count ≤ 12 |
| KH6-013 | **High** (**FIXED, verified**) | `shared/orders.ts` (transitions), `server/admin/backoffice.ts` (`order-status`), `supabase/payments_checkout.sql` | Any admin with `orders.write` (the manager role) could move a customer's unpaid **online** order from placed to paid by hand. It could then be packed and shipped with no money received. Demonstrated on the database: an online order with no payment row moved to paid. | Done, in three layers: a database trigger (`orders_require_capture`) refuses `paid` for an online order unless a captured payment exists; the admin API returns a clear 409 and logs `order_paid_by_hand_refused`; the Orders screen no longer shows "Mark paid" for online orders. Manual (cash or bank transfer) orders can still be marked paid. **Staging databases must re-run `payments_checkout.sql`.** | Self-test went red then green; 3 API tests; both new code paths mutation-checked. UI change not checked in a browser. |

### Suspected / not verifiable here
| ID | Sev | Note |
|---|---|---|
| KH6-007 | High | **Razorpay test-mode integration tests cannot run in this environment**: no test credentials, and the sandbox network allowlist does not include `api.razorpay.com`. Existing Razorpay tests are mocked. I will not claim real-API verification. You would need to run these against your test keys, or give me a way to. |
| KH6-008 | Medium | Dependencies: 22 advisories. Runtime impact is limited to `react-router` 6.x (2 moderate: open redirect, SSR hydration deserialisation). The critical and high ones sit in `vitest`, `vite`, `@vercel/node` and their transitive tooling. Exploitability in this app is unconfirmed, and I have not verified that a non-breaking fix exists. |
| KH6-009 | Low | Mail kind `launch_confirm` is allowed only by `supabase/launch_optin.sql`; `email_outbox.sql` alone rejects it, and `record()` swallows the error. Safe if migrations run in documented order. Worth a migration-order check. |
| KH6-011 | Low | `server/admin/dbHint.ts` picks the SQL file named in the admin hint by first-match regex on the error text, so it can name the wrong file for a missing table. The hint contains only an HTTP status and file names, never raw database text, and is returned only by the signed-in admin API. Overview blocks that fail are now listed under "could not be loaded", which is right, but a persistent failure would be easy to overlook. |
| KH6-012 | Medium (**FIXED, verified**) | `supabase/payments_checkout.sql` (`orders_due_for_expiry`, `order_expire`), `server/checkoutPayments.ts` | Expiry could cancel an order, and release its stock, while an authorised payment was still pending. | Done: an attempt authorised in the last 24 hours holds the order. It is not listed as due, and `order_expire` returns `held` (counted as `deferred`). After 24 hours of silence it expires as before; a later capture is flagged `order_not_open` for a manual refund. **Staging databases must re-run `payments_checkout.sql`.** | New self-test section (Order E) went red before the fix and green after; three new TS tests; mutation check confirmed the race test fails without the `held` handling. Not done: the Razorpay per-order calls still run in series (up to 25 orders per run), so a slow Razorpay can still exceed a short function timeout. |
| KH6-010 | Info | Commerce guard design: `COMMERCE_ENABLED` is a compile-time `false`; flags are forced off when `VERCEL_ENV=production`. Preview/staging can enable test flags, which matches the brief. Whether any server path reaches order creation without checking `COMMERCE_ENABLED` is still to be audited. |

## Admin permission matrix (reviewed)
Every admin action and method was traced to a `need()` check: subscribers, messages, issues, products, product-image, variants, gallery, inventory, batches, orders, order-status, order-note, exports, audit, team, members, payments, refunds. All admin actions run only after the two-step state is `ok`. Notes:
- Product PATCH rejects price and photo fields, so prices change only through variants, which need `products.price` (owner). Variant DELETE also needs it.
- `dashboard` has no single check; each block is gated by `can()` per permission, which is fine.
- Admin requests send an `x-kaayra-admin` header and an origin; I did not yet verify that the server enforces it (CSRF) beyond seeing the test harness send it.
- Suspected, not fixed: `order-status` allows `paid → cancelled` and `placed → cancelled` without any refund step. A cancelled paid order leaves a captured payment and no automatic refund; refunds are a separate screen and permission. Needs a business decision.
- The only defect found was KH6-013.

## Next in Step 1
1. Line-by-line review of cart, checkout, payments SQL (reservation concurrency, amount reconciliation, duplicate and delayed webhooks).
2. Admin permission matrix against `shared/roles.ts`.
3. RLS review of every SQL file.
4. Component and accessibility pass.

## Note on test doubles
`server/api-tests/payments.test.ts` re-implements the SQL functions in TypeScript. Any SQL rule change must be mirrored there by hand (KH6-012 was), or the unit tests can pass while the database behaves differently. The SQL self-tests are the authority.
