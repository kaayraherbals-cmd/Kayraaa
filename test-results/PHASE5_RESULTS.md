# Phase 5 verification results (2026-10-22)

Environment: Node 22, real `npm ci`, real `vitest 2.1.9`, PostgreSQL 16.15 installed locally as a disposable database with Supabase roles stubbed (`anon`, `authenticated`, `service_role`, `storage.buckets`). **No Supabase project, Razorpay account or browser was used.**

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npx tsc --noEmit` | clean |
| `npm run check:lockfile` | in sync |
| `npm test` (no database) | 59 files passed, 1 skipped; **811 passed**, 1 skipped (parity, needs DATABASE_URL) |
| `npm test` with disposable DB | **60 files, 812 passed** (parity: SQL and TypeScript agree on 300 seeded random bags) |
| `npm run build` | passes (placeholder-domain notice is the existing guard; set `VITE_SITE_URL` for real deploys) |
| Migrations 1-24 on fresh PostgreSQL 16 | applied; `coupons.sql` re-run with no errors |
| `coupons_selftest.sql` | 20 PASS notices, 0 errors (fresh DB) |
| Existing self-tests (phase3, refunds, payments, payments_checkout, checkout, delivery_areas, shipments, email_outbox, rate_limits, reviews) | all pass on a fresh DB with migration 24 applied |
| `coupons_concurrency.sh` (real parallel sessions) | 20 racing checkouts for a 3-use coupon -> exactly 3 reservations; 8 simultaneous orders by one member with a 1-per-customer coupon -> exactly 1; totals consistent; 3 concurrent double-cancels -> each released once |

Note: `checkout_selftest.sql` fails with a duplicate PIN code if run in a database where `coupons_concurrency.sh` already ran (the script commits rows). Use separate databases; confirmed it passes on a fresh one.

## Security matrix (Step 12)
| # | Test | Where |
|---|---|---|
| 1 invalid codes | unknown/malformed -> same message | SQL self-test 4, API test, shared test |
| 2 expired / 3 inactive / not started | refused | SQL 4 |
| 4 usage exhaustion | refused; released on cancel | SQL 8, concurrency 1 |
| 5 per-customer | refused | SQL 15, concurrency 2 |
| 6 first order | refused for returning/open-order members | SQL 15 |
| 7/8 product, category | only eligible lines discounted; both lists = intersection | SQL 5, parity |
| 9 minimum order | refused with amount | SQL 2 |
| 10 cap | applied | SQL 1, parity |
| 11 concurrent redemptions | exact | concurrency 1-2 |
| 12 duplicate checkout | replay, no second reservation | SQL 9; API fingerprint test |
| 13 failed payment | order stays unpaid, reservation kept until window ends, then released | SQL 13 (expiry) |
| 14 abandoned checkout | expiry releases | SQL 13 |
| 15/16 refunds | basis uses discounted values; over-refund refused; partial keeps use; paid-order cancel releases once | SQL 11, 12 |
| 17 unauthorised admin | manager/support 403 on all 7 coupon routes, audited, no DB call | admin tests |
| 18 manipulated prices | ignored: request coupon/discount/total/price fields never reach the database | API tests |
| 19 negative totals | clamp + payable floor (>= Rs 1) | shared + SQL 3 + 2,000-case property test |
| 20 stacking | blocked in function and by unique index | SQL 14 |
| Razorpay amount = order total | `payment_attach` refuses undiscounted amount; wrong capture flagged, order not paid; API charges discounted total | SQL 10, payments API test |
| Public DB access | RLS on, no grants, functions not executable by anon/authenticated | SQL 19 |

## Not verified (needs your environment)
Supabase staging run; Razorpay test-mode payment, webhook and refund with a discounted order; real browser and mobile rendering of the new UI; the Gemini owner AI (not present in the ZIPs).
