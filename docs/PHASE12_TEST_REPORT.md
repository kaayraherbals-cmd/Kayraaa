# Phase 12 test report (through Stage 2)

Environment: sandbox, Node v22.22.2, npm 10.9.7, PostgreSQL 16.13 (plain, disposable, stand-in Supabase roles). No Supabase, Razorpay, Resend, Vercel, browser or production access was used.

| Command | Result | Status |
|---|---|---|
| `npm ci` | installed; 22 audit findings reported | pass |
| `npm run check:lockfile` | ok | pass |
| `npm run lint` | exit 0 (after Phase 8 merge) | pass |
| `npm run typecheck` | exit 0 (after merge) | pass |
| `npm test` | 72 files passed, 1 skipped; 1034 tests passed, 1 skipped (`shared/coupons.parity.test.ts`) | pass |
| `VITE_SITE_URL=https://kaayraherbals.com npm run build` | exit 0 | pass |
| `npm run seo:check` after that build | OK | pass |
| `npm run seo:check` after a build WITHOUT `VITE_SITE_URL` | fails (placeholder domain) | FAIL by design; set the variable in Vercel |
| `bash scripts/db-verify.sh` on fresh `kh_verify2` | every migration applied twice, no error; 15 of 15 self-tests ended without error: phase3, refunds, payments, checkout, payments_checkout, shipments, email_outbox, rate_limits, delivery_areas, reviews, coupons, cart_recovery, loyalty, bundles_wishlists, finance | pass |
| `cart_recovery_selftest.sql` before the fixture fix | FAIL: attribution count 0, expected 1 | see Changelog |

Not run: `loyalty_concurrency.sh`, `bundles_concurrency.sh`, `concurrency_test.sh`, `coupons_concurrency.sh` (separate disposable-database scripts); `npm run ui:check`; any test as the real Supabase `anon` / `authenticated` role through PostgREST; any live Razorpay, Resend or Supabase call; production site checks; `npm audit` fixes.

Limits: passing database self-tests show the SQL behaves as its own tests expect on plain PostgreSQL 16. They do not prove Supabase RLS, JWT claims or production data.
