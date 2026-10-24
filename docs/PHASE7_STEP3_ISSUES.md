# Phase 7 Step 3 issue register

Confirmed = shown by reading code in this session. Suspected = needs a run to confirm. "Test" column: UNRUN means a test was written but never executed (no network in the authoring sandbox).

| ID | Sev | Type | File | Root cause | Fix | Test | Status |
|---|---|---|---|---|---|---|---|
| S3-001 | P0 | Confirmed | shared/flags.ts, checkout.ts, payments.ts | Old gating used `master ||`, so COMMERCE_ENABLED=true would have opened production checkout and live payments | Separate live-sales gate (shared/liveSales.ts); production needs LIVE_SALES_APPROVED=on + BY + REF | shared/flags.test.ts, checkout.test.ts, payments.test.ts, api-tests (UNRUN) | Fixed in code |
| S3-002 | P1 | Confirmed | api/admin/[action].ts | Admin manual order creation followed master switch only | Same gate as the shop | existing admin tests pass ctx explicitly; none added for the new gate | Fixed in code, test gap |
| S3-003 | P1 | Confirmed | server/checkoutPayments.ts | No check that order mode (test/live) matches the Razorpay key mode | `keyMatchesOrder` guard before any Razorpay order is created or reused | shared/payments.test.ts (UNRUN) | Fixed in code |
| S2-008 | P1 | Confirmed | (none) | No customer tracking API or page | api/orders, TrackOrder page, shared/tracking | tracking.test.ts, api-tests/orders.test.ts (UNRUN) | Fixed in code |
| S3-004 | P1 | Confirmed | whole repo | Baseline (ci, lint, typecheck, test, build, audit) never executed in the authoring sandbox: no network | Run on a networked machine / CI | n/a | OPEN, launch blocker |
| S3-005 | P1 | Suspected | supabase/*.sql | docs/DATABASE_MIGRATIONS.md says migrations were never run on any database; shipments, outbox v2, rate limits unverified | Run in order on disposable Postgres, then Supabase staging | existing *_selftest.sql | OPEN, launch blocker |
| S3-006 | P2 | Suspected | vercel.json | Crons are daily; 1-minute outbox and 5-minute reconcile targets need a plan that allows them (unconfirmed) | Confirm Vercel limits or use an external scheduler hitting the secret-protected endpoints | none | OPEN |
| S3-007 | P2 | Confirmed | admin UI | No shipment dashboard or creation form (admin API exists) | Build UI | none | OPEN |
| S3-008 | P2 | Confirmed | src/pages/TrackOrder.tsx | New tracking page was unstyled | src/track.css using brand tokens, focus styles; "Your orders" link on Account | none; not viewed in a browser | Fixed in code, visual check pending |
| S3-009 | P2 | Suspected | tests | Other tests may still assume commerce off (grep found copy only, e.g. admin tests that pass the flag explicitly) | Fix after first run | n/a | OPEN |
| S3-010 | P3 | Confirmed | src/components/cart/CartSummary.tsx | Empty bag with checkout open said "Checkout opens at launch" | Wording by state | none | Fixed |
| S3-011 | P2 | Not started | UI | Premium redesign (parts 4-9, 14, 15), responsive and WCAG checks, screenshots, SEO items | n/a | n/a | OPEN |
| S3-012 | P2 | Not started | email | Verification of ten templates, concurrency, real test delivery | n/a | n/a | OPEN |
| S31-001 | P2 | Confirmed | docs/* | Docs said commerce was off while code is on | COMMERCE_STATE.md, banners, drift test | shared/commerce.test.ts (UNRUN) | Fixed |
| S31-002 | P3 | Confirmed | TrackOrder/Login | No safe login return, pagination or retry | returnPath.ts, pager, retry button | returnPath.test.ts, orders.test.ts (UNRUN) | Fixed in code; sign-in flows may still land on /account |
