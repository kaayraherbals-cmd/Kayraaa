# V5 Phase 3H: verification report (2026-10-22)

No UI or styling was changed. Nothing here enables live payments; `COMMERCE_ENABLED` and the `LIVE_SALES_*` gate (`shared/liveSales.ts`) are untouched.

## 1. Changelog
| ID | Change | Files |
|---|---|---|
| KH-V5-001 (security, confirmed) | A session signed in with a passkey was meant to end when that passkey was removed (by its owner, or by an owner-initiated removal). It ended only when `ADMIN_MFA=required`. With `ADMIN_MFA=optional` and an admin who had not enrolled an authenticator, the removed-passkey session fell through to the two-step check, which returned "ok", so the session stayed fully authorised until its 8-hour expiry. Fix: a session carrying a passkey fingerprint is now valid only while that passkey exists; otherwise the cookie is cleared and the reply is 401. If the passkey lookup itself fails the reply is 503 (fail closed, session kept). | `api/admin/[action].ts` |
| Tests | New regression tests (optional mode, passkey lookup error). Two older tests updated: a removed or foreign passkey fingerprint now gives 401 and a cookie clear, where it used to give 200 with `mfa: "enroll"`. | `server/admin/admin-api.test.ts` |
| Docs | `PASSKEYS.md` removal wording, `DATABASE_MIGRATIONS.md` execution record, `SESSION_RULES.md`, this report. | `docs/` |
| Database | Migrations 21 and 22 applied to the Supabase project `kaayra-herbals` (see section 3). | Supabase |

## 2. Automated checks: what ran and what did not
**Could not run: `npm ci`, `npm run typecheck`, `npm run lint`, real `vitest`, `npm run build`, `npm audit`.** The sandbox proxy returns 403 for registry.npmjs.org (policy denial, not retried) and the npm cache holds only a fragment of the lockfile. These must be run on a networked machine or in CI (`.github/workflows/ci.yml`). `package.json` and `package-lock.json` are in sync (`npm run check:lockfile` passed).

What did run instead (labelled so it is not mistaken for the real thing):
- **Stand-in test runner** (a small vitest look-alike: describe, it, expect, hooks; Node 22 type stripping). All 53 `*.test.ts` files: **711 passed, 0 failed** after the fix. Before the fix the new regression test failed (200 instead of 401), proving it detects KH-V5-001. This is not vitest; matcher semantics are approximations. Re-run `npm test` for the authoritative result.
- **Partial type check** with the globally installed `tsc` over `server`, `shared`, `api` (no test files, no `src`): the only errors were the missing `@vercel/node` types. That is a weak check (request and response types become `any`). `src` (React) was not type-checked.
- Lint and build: not run in any form.

## 3. Database verification
### Disposable PostgreSQL 16.15 (local, Supabase roles and `storage.buckets` stubbed; default privileges to anon/authenticated/service_role set as Supabase does)
- All 22 migrations applied in the documented order, then **applied a second time**: no errors (re-runnable).
- Self-tests, each ending in its pass notice: `phase3`, `refunds`, `payments`, `checkout`, `delivery_areas`, `payments_checkout`, `shipments`, `email_outbox`, `rate_limits`.
- `concurrency_test.sh`: rate limiter exact (1000 of 1000), 100 mails claimed exactly once by 10 workers, one row for 20 racing enqueues, no shipment over-shipping, each shipment dispatched once.
- Roles: `anon` and `authenticated` hold **zero** grants on any public table or view and cannot read `public_products` or `orders`. RLS is enabled on every public table. The only functions they can execute are trigger functions and two pure helpers (`shipment_transition_ok`, `variants_default_hsn`'s trigger); every business function is revoked. So the database is reachable only through the server's service-role key, as designed.
- Not covered by this run: `admin_audit` update/delete rejection checked as a limited role (check 6 in `DATABASE_MIGRATIONS.md`), and the two-session checks listed at the end of `payments_checkout_selftest.sql`.

### Supabase project `kaayra-herbals` (ref mbmkeiihfeysxqnvzcda, ap-south-1)
- Files 1 to 19 were already applied. Applied today: `delivery_areas` and `admin_passkeys`.
- Verified: `city` and `state` columns exist; `admin_passkeys` has RLS on, no grants to anon or authenticated; `delivery_areas_upsert` is not executable by anon.
- Advisor (security): RLS-enabled-no-policy INFO on all tables (intended); `function_search_path_mutable` WARN on 45 functions (open, low risk because execute is revoked from anon and authenticated, but worth fixing); leaked-password protection off (an Auth setting, owner to enable).
- **This project is the only Supabase project and already holds real rows** (members, a launch subscriber, audit entries). It is not a staging environment. Self-tests were NOT run there (they roll back, but several write function calls; do this on a separate project). **A separate staging project has not been created**: that needs your decision because it creates a billable project; see section 6.

## 4. Passkeys (tested with a software authenticator and mocked database, not a real device)
Verified by tests (all pass): registration and sign-in verification for ES256 and RS256; replay and sign-count handling; challenge-ticket expiry and tamper; wrong origin or rpId; decoy credentials for unknown addresses; adding a passkey needs a fully signed-in session; 10-passkey limit; rename and self-delete scoped to the caller; owner removal of another admin's passkey needs `team.manage` (manager and support get 403), refuses removing your own through that route (409), 404 and 400 for unknown or malformed ids; audit entry `passkey_removed_by_owner` with target and name; session revocation (after KH-V5-001, in every two-step mode); rate limits fail closed.
Not verified: a real browser or phone authenticator, the Admin UI (Security tab, Team table), ADMIN_PASSKEY_RP_ID across `www` and apex hosts.

## 5. Commerce, payments, email
Verified by automated tests only (mocked Razorpay and mocked PostgREST, plus the SQL self-tests above): order creation, stock reservation and release, price and amount checks, webhook signature, duplicate and late webhooks, failed payments, capture-before-paid guard, refunds (partial, over-refund refused, idempotency key), shipments, outbox claiming, retry and permanent failure, cron endpoint auth.
**Not tested at all (blocked, needs credentials or network):**
- Razorpay: no test key was available, and the sandbox cannot reach api.razorpay.com. Success, failure, duplicate webhook and refund flows against the real gateway are unverified.
- Resend: no API key; real delivery, bounce handling and domain authentication (SPF, DKIM) unverified.
- Scheduler: no deployed Vercel cron or `pg_cron` to run; `outbox-cron.test.ts` covers the handler only.
- Browser flows and the admin UI with each role; accessibility and screenshots.

## 6. Remaining blockers and next steps
1. Run `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit` on a networked machine and send me any failure. (The last full run on record, Step 3.1, left 3 critical and 13 high advisories in dev tooling; unresolved.)
2. Decide on a staging Supabase project (create one, run `supabase/*.sql` in the documented order, then the self-tests and `concurrency_test.sh`).
3. Provide Razorpay **test** keys and webhook secret, and a Resend key for staging; I will run the gateway and mail flows.
4. Optional hardening: set `search_path` on the 45 functions; enable leaked-password protection.
5. Live payments remain off until you authorise them: `LIVE_SALES_APPROVED=on`, `LIVE_SALES_APPROVED_BY` and `LIVE_SALES_APPROVAL_REF` must all be set.

## 7. Deployment instructions
1. Database: migrations 1 to 22 are applied on `kaayra-herbals`. For a new project, follow the order table in `docs/DATABASE_MIGRATIONS.md`.
2. Environment (Vercel, server only): see `docs/VERCEL_SETUP.md` and `docs/PHASE4_HANDOFF.md`. For passkeys optionally set `ADMIN_PASSKEY_RP_ID`.
3. Deploy to a preview, sign in at `/admin`, add a passkey in Security, remove it, and confirm the passkey session ends on the next click (KH-V5-001).
4. Place one test order with Razorpay test keys before any live step.
