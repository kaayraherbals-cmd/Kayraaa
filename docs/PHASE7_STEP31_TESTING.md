# Phase 7 Step 3.1 testing

## Actually executed
- Node 22 type-stripped logic checks: commerce gate matrix (staging, production unapproved, production approved, preview ignores approval) and returnPath accept/reject lists. All passed.

## Written, NOT executed
shared/flags.test.ts, commerce.test.ts (incl. doc-drift test), checkout.test.ts, payments.test.ts (incl. keyMatchesOrder), tracking.test.ts, returnPath.test.ts; server/api-tests/{cart,checkout,payments,orders}.test.ts.

## Not tested at all
Database migrations and self-tests, concurrency, Razorpay test mode (success, failure, duplicate webhook, invalid signature, delayed, abandoned, refunds), email templates and Resend delivery, scheduler, browser rendering, responsive screenshots (360/390/768/1024/1440), WCAG 2.2 AA.

No test result in this document may be read as a pass.

## Run on this session's sandbox (network available for npm)
| Command | Result |
|---|---|
| `npm ci` | completed |
| `npm run typecheck` | pass (after the checkout fix) |
| `npm run lint` | pass (after the fixes in CHANGES.md) |
| `npm test` | 48 files, 641 tests, all pass |
| `npm run build` | pass (prerender used the placeholder `VITE_SITE_URL`) |
| `npm audit` | 22 vulnerabilities: 3 critical, 13 high, 6 moderate. `npm audit --omit=dev`: 2 moderate. Critical/high are in dev and build tooling (vitest, vite, @vercel/node, tar, tinypool and their transitive deps). Fixes need major upgrades; not applied blindly. OPEN. |

## Not run (still open)
- GitHub Actions `ci.yml` itself, the Postgres migrations and `*_selftest.sql`, a Supabase staging project, Razorpay test-mode flows, Resend delivery, concurrency tests, browser screenshots, accessibility audit.
- The new admin shipment screens are type-checked, linted and built but have NOT been exercised in a browser or against a database. There are no component tests for them; only `remainingToShip` is unit tested.

## Database run (disposable PostgreSQL 16 in the sandbox, not Supabase)
- All 20 migrations in `docs/DATABASE_MIGRATIONS.md` order applied without error. A second apply of every file also succeeded (only "already exists, skipping" notices): re-runnable confirmed.
- Self-tests, all ending in their ALL PASSED notice: `phase3`, `refunds`, `payments`, `checkout`, `payments_checkout`, `shipments`, `email_outbox`, `rate_limits`.
- `supabase/concurrency_test.sh`: rate limiter exact under 50 sessions x 20 hits (1000), 10 outbox workers claimed 100 mails exactly once, 20 concurrent enqueues of one key made one row.
- Bug in the test script found and fixed: its first check used an uncorrelated `lateral` subquery, which Postgres runs once per session, so it counted 50 instead of 1000 (proved: 20 rows counted as 1 hit). The limiter was correct. The check stays strict at exactly 1000.
- Stubs needed because this is not Supabase: roles `anon`, `authenticated`, `service_role` and a minimal `storage.buckets` table. Tests ran as the Postgres superuser.

### Still NOT verified by that run
- Row-level security and grants as the real Supabase `anon` / `authenticated` roles (checks 2, 3 and 6 in DATABASE_MIGRATIONS.md "Checks to run on staging").
- The two-session checks listed at the end of `payments_checkout_selftest.sql`.
- Everything in the browser: the admin shipment screens with each role (owner, manager, support), Razorpay, Resend.

## Shipment concurrency (check 4 in `supabase/concurrency_test.sh`, disposable PostgreSQL 16)
- 10 sessions each try to ship 1 unit of a 3-unit line: exactly 3 shipments and 3 units result (no over-shipping).
- 12 sessions (4 per shipment) race to dispatch those 3 shipments: each is dispatched exactly once (3 dispatch events) and the order ends `shipped`.
- Mutation check: with `for update` removed from `shipment_create`, the same test FAILED on 3 of 3 runs (9 to 10 units shipped against a 3-unit line). With the real function it passes. So the test detects the bug and the order-row lock is what prevents it.
- Limits: fixture rows are committed and cannot be deleted afterwards (history is append-only); run on isolated databases only. Not yet run on Supabase.
