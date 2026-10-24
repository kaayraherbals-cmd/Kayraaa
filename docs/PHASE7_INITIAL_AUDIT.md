# Phase 7 initial audit (Kaayra Herbals)

Baseline: `kaayra-herbals-phase6-buildfix.zip`.

## Evidence standard (read this first)
This audit was done in a sandbox with **no network access**. `npm ci` failed (exit 1, "Exit handler never called"; `curl` to the npm registry returned nothing). So **no command was run**: not lint, typecheck, tests, build or audit. Everything below is from **reading the source**, marked "Confirmed by reading". Nothing is reported as working. The latest verified results are Phase 6's (483 tests passing on the Phase 5 baseline). Edits made since then, including the Phase 6 build-fix and the Phase 7 flag flip, are **unrun**.

Phase 6 fixes KH6-001, KH6-012 and KH6-013 were left untouched.

## Issue register
Priority: P0 security/release blocker, P1 important functionality, P2 UI/UX, P3 future.

| ID | Pri | Status | Affected files | Confirmed? | Root cause | Reproduction | Recommended fix | Test plan | Resolution |
|---|---|---|---|---|---|---|---|---|---|
| KH7-001 | P0 | Code changed, **unrun** | `shared/commerce.ts`; `HANDOFF.md`; `SESSION_RULES.md`; tests | Confirmed by reading | Phase 6 set `COMMERCE_ENABLED = true` (owner decision at the time). The Phase 7 brief requires `false`. Checkout, payment and the bag were open in production. | Read `shared/commerce.ts`; `checkoutOpen()`, `paymentsOpen()`, `readFlags()` all key off it. | Set to `false` and rewrite on-state tests (done): `shared/{commerce,flags,checkout,payments}.test.ts`, `server/api-tests/{cart,checkout,payments}.test.ts`, `server/admin/admin-api.test.ts`. | Run `npm test`. Expect failures where my blind edits are wrong. | Pending a test run |
| KH7-002 | P0 | Open | Test suite | Confirmed | Phase 6 tests were edited and never run; Phase 7 edits also unrun. Release gate is unknown. | `npm ci && npm test` on a networked machine. | Run, fix failures. | Full suite, lint, typecheck, build. | Open |
| KH6-002 (P1) | P1 | Open | `supabase/inventory_orders.sql:50,301` | Confirmed: only `orders.tracking_no`; no `shipments` table in `supabase/` | No shipments, items, events, zones, exceptions or RTO model. | `grep shipments supabase/*.sql` returns nothing. | New migration with provider-independent tables and a manual adapter. | SQL self-test plus unit tests. | Open |
| KH6-003 | P1 | Open | `server/mail.ts:83`, `shared/mailTemplates.ts` | Confirmed | `Idempotency-Key` is a fresh `randomUUID()` per call, so no deduplication. Templates cover contact, launch and issue mail only; none of the 10 required order/shipping/refund mails exist. Outbox stores no body, so retry is not possible. | Read both files. | Outbox with dedupe key, payload, attempts, retry job. | Template, retry, duplicate and provider-failure tests. | Open |
| KH6-004 | P1 | Open | `vercel.json`, `api/checkout/[action].ts` | Confirmed: no `crons` in `vercel.json` | `/api/checkout/reconcile` exists (needs `CRON_SECRET`) but nothing calls it. Held stock is released only on checkout activity. | Read `vercel.json`. | Add a scheduler; check current Hobby cron limits first. | Staging run releases an expired hold. | Open |
| KH6-005 | P1 | Open | `server/http.ts:25` | Confirmed | Limiter is per-instance, in memory; its own comment says so. | Read the code. | Database-backed counter or Vercel Firewall rules. | Two-instance test. | Open |
| KH6-006 | Constraint | Noted | `api/` | Confirmed: 10 functions (admin, auth, cart, checkout, media, payments/webhook, contact, issues, products, subscribe) of 12 | Hobby limit. | `find api -name '*.ts'` | Route new endpoints through existing `[action].ts` files. | Count stays <= 12. | Noted |
| KH6-007 | P1 | Unverified | `server/razorpay.ts` | Cannot test here | No Razorpay test credentials or network. Tests are mocked. | n/a | Run against test keys in staging. | Real test-mode payment, webhook, refund. | Open |
| KH6-008 | P1 | Unverified | `package.json`, lockfile | Not run | 22 advisories reported in Phase 6; `react-router` locked at 6.30.6. | `npm audit` | Update safely, no `audit fix --force`. | Build and tests after each update. | Open |
| KH6-009/011 | P3 | Open | `supabase/launch_optin.sql`, `server/admin/dbHint.ts` | From Phase 6, not re-verified | Migration ordering; hint picks wrong file. | See Phase 6 register. | Per Phase 6. | n/a | Open |
| KH7-003 | P1 | Open (Phase 6 note) | `server/admin/backoffice.ts` (`order-status`) | From Phase 6, not re-verified | `paid -> cancelled` has no refund step. | Read transitions in `shared/orders.ts`. | Tie to the refund-obligation workflow (Part 15). | SQL and API tests. | Open |
| KH7-004 | P2 | Open | `src/` | Not audited | Design system, header, collection, product, cart, checkout redesign (Parts 3-9, 13, 14) not started. | n/a | Staged in later sessions. | Visual and accessibility checks in a browser. | Open |

## Reviewed in this session (by reading)
`shared/commerce.ts`, `shared/flags.ts`, `shared/checkout.ts`, `api/checkout/[action].ts`, `api/payments/webhook.ts`, `vercel.json`, `server/http.ts`, `server/mail.ts` (partial), `HANDOFF.md`, `SESSION_RULES.md`, Phase 6 register.

Observations, not defects: the webhook verifies the raw-body signature, uses Razorpay's event id for replay protection and is deliberately not blocked by the master switch. Checkout takes items from the saved bag and compares the browser total only as a consent check. CSP and security headers are set in `vercel.json`.

## Not reviewed
Admin dashboard UI, account pages, RLS policies line by line, components, accessibility, performance, SEO output, dependency advisories.

## Step 2 update
KH6-002 (shipments), KH6-003 (outbox, templates), KH6-004 (cron) and KH6-005 (rate limiting) now have code written but **not executed**. They remain Open until tested. See `docs/PHASE7_STEP2_ISSUES.md`.
