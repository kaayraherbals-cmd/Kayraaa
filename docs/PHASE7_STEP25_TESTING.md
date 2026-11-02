> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Phase 7 Step 2.5: testing report

**Production readiness: NOT CLAIMED.** The required integration tests (real `npm test`, a staging database, Razorpay test mode, Resend, Vercel cron) did not run.

Result words: **PASS (stand-in)** = executed with the stand-in runner described below, against mocks (not vitest, no database, no Razorpay/Resend/Vercel); **PASS** is not used for anything else. **FAIL**, **BLOCKED** (cannot be done here), **NOT TESTED** (could be done, was not).

## Environment and the blocker (actual output)

```
$ npm ci --no-audit --no-fund
npm error This is an error with npm itself. Please report this error at:
npm error   <https://github.com/npm/cli/issues>          (exit 1; node_modules/.bin has none of vitest, tsc, eslint, vite)
$ curl -s -m 8 -o /dev/null -w "http %{http_code}\n" https://registry.npmjs.org/
http 000        (curl exit code 6: could not resolve host)
$ npm ci --offline
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/yocto-queue/-/yocto-queue-0.1.0.tgz failed: cache mode is 'only-if-cached' but no cached response is available.
$ pip download sqlglot      ->  ERROR: No matching distribution found for sqlglot
$ which psql postgres initdb docker   ->  (none found)
```
Node v22.22.2 is present. The sandbox's network setting is off; the fix is in Settings (network access) or the CI workflow added in this step (`.github/workflows/ci.yml`).

## The stand-in runner (what it is and is not)

`docs/evidence/vitest-standin.ts` + `run-standin.sh`: about 80 lines that provide `describe`, `it`, `expect` (the 18 matchers the repo's tests use), `beforeEach`, `afterEach`. Node 22 strips the TypeScript types (`--experimental-transform-types`), relative `.js` imports are rewritten to `.ts` in a temp copy, and `RATE_LIMIT_SHARED=off` is set because `vite.config.ts` sets it for vitest. The repo uses no `vi`, `.each`, snapshots or fake timers, so nothing was skipped. **It is not vitest.** Matcher semantics may differ in edge cases, so a pass here can hide a failure vitest would report, and a failure here can be a stand-in gap (two were: a missing `toBeLessThanOrEqual`). It does not type-check, lint or build.

Final run, all 45 `*.test.ts` files under `shared/`, `server/`, `api/`, `scripts/` (`docs/evidence/standin-run-final.txt`):
```
FILES=45  TOTAL pass=620  fail=0
```
`src/` has no test files. Earlier runs in this session: first run 605 pass, 3 fail (below); the very first run showed 503s because the runner had not applied the vitest env.

## Priority 1: baseline

| Item | Result | Evidence |
|---|---|---|
| `npm ci` | BLOCKED | output above |
| `npm run lint` | BLOCKED | needs eslint |
| `npm run typecheck` | BLOCKED | needs `tsc`. Partial, **syntax and imports only**: all 12 changed files (`shared/{shipments,orderMail,outbox,mailTemplates,roles,inventory}.ts`, `server/{outbox,http}.ts`, `server/admin/shipments.ts`, `api/{checkout,admin}/[action].ts`, `api/payments/webhook.ts`) parse and link under Node 22, which proves every imported name exists. That is not a type check. |
| `npm test` | BLOCKED (vitest) | stand-in: 620 pass, 0 fail (PASS (stand-in)) |
| `npm run build` | BLOCKED | needs vite and tsc |
| `npm audit` | BLOCKED | needs the registry |

Defects found by running tests this step, all fixed without weakening a test:
1. **Logs could contain customer data** (found by my own test): the outbox worker logged the first 60 characters of an unexpected error message. Now logs only the error class. Same fix in the outbox cron endpoint.
2. **Database error bodies were logged** (pre-existing, `server/rpc.ts`): up to 300 characters of the PostgREST error, whose `details` can quote the failing row (an email address, a street). Now only the SQLSTATE and our own `KH:` codes are logged (`safeDbError`, new `server/rpc.test.ts`).
3. **Stale mail rule**: a delayed "out for delivery" could still send after delivery, and "order received, waiting for payment" after payment. Added `superseded()` in `shared/outbox.ts`; such mail is now skipped. One existing test's expected skip *reason* changed from `fact_not_true` to `superseded` for a payment-failed mail whose payment was later captured (still a skip; I kept a case for the old reason).
4. Fail-closed rate limiting broke 70 tests when the env was missing: that exposed that tests depend on `RATE_LIMIT_SHARED=off` from `vite.config.ts`. Left as is (it is set there).

## Priority 2: database

| Item | Result |
|---|---|
| Staging Supabase project access | BLOCKED (no network, no credentials) |
| Migration order and dependencies | PASS by static check (see database report); **not applied** |
| Apply `shipments.sql`, `email_outbox_v2.sql`, `rate_limits.sql` | BLOCKED |
| RLS verification | BLOCKED (checked in the self-tests, which did not run) |
| SQL self-tests: shipments, transitions, ownership, append-only history | written; **NOT TESTED** |
| Email dedupe, retry schedule | written; **NOT TESTED** |
| Rate-limit counter concurrency | `rate_limits_selftest.sql`, `concurrency_test.sh` written; **NOT TESTED** |
| Admin permissions in SQL | See database report: enforced by the API, not SQL. API-level: PASS (stand-in) |

## Priority 3: email outbox

| Item | Result | Evidence |
|---|---|---|
| Message persistence (payload stored, erased on send) | NOT TESTED | SQL only; `email_outbox_selftest.sql` |
| HTML and plain-text rendering | PASS (stand-in) | `shared/orderMail.test.ts`: 46 tests, 10 templates |
| Retry behaviour, worker side | PASS (stand-in) | `server/outbox.test.ts`: 503 retries, 422 goes dead, not-configured waits |
| Retry schedule in SQL (1 m, 5 m, 30 m, 2 h, 12 h, dead) | NOT TESTED | numbers compared with SQL text only |
| Duplicate prevention | stable keys and provider idempotency key: PASS (stand-in); unique index and enqueue race: NOT TESTED | |
| Payment-confirmation eligibility | PASS (stand-in) | needs a captured payment row **and** an order at paid or later; checked at send time |
| Refund-confirmation eligibility | PASS (stand-in) | gateway refund must be `processed`, or an admin-recorded manual refund |
| Provider failure | PASS (stand-in) | |
| Concurrent workers | NOT TESTED | `concurrency_test.sh` (100 mails, 10 workers) |
| Retries cannot send an outdated notice | PASS (stand-in) | mail is rendered from the database at send time; `superseded()` drops stale kinds |
| Sensitive data not in logs | PASS (stand-in) for the outbox, `rpc` and cron paths; see security report for what was **not** proven | |

## Priority 4: payment reconciliation (mocked Razorpay and database)

| Scenario | Result | Evidence (test name) |
|---|---|---|
| Captured payments | PASS (stand-in) | "marks the order paid ... only when signature, order, amount and status all agree" |
| Authorised, not captured | PASS (stand-in) | "shows processing while only authorised"; "holds ... authorised recently"; "expires ... silent over 24 hours" |
| Failed payments | PASS (stand-in) | "records a failed payment, keeps the order open for a retry" |
| Abandoned checkout | PASS (stand-in) | "releases stock held by an unpaid order whose window ended"; "waits out the grace period" |
| Duplicate webhooks | PASS (stand-in) at API level; database idempotency NOT TESTED | webhook test "returns 500 on database trouble ... 200 for a duplicate"; "same callback twice captures once" |
| Delayed webhooks | PASS (stand-in) | "a late webhook-style capture found by reconciliation settles an order" |
| Expired reservations | PASS (stand-in) | idempotent expiry, deferral when Razorpay cannot be asked |
| Refund reconciliation | **NOT TESTED**: no API-level test exists for refund webhooks; SQL self-tests (`refunds_selftest.sql`, `payments_selftest.sql`) not run | gap, listed in the handoff |
| Webhook signature mandatory | PASS (stand-in) | rejects missing/wrong signature without touching the database; refuses to run without a secret |

## Priority 5: rate limiting

| Item | Result |
|---|---|
| Admin sign-in fails closed (503 when counter down, no password check made) | PASS (stand-in), `admin-login-limiter.test.ts` |
| Admin MFA fails closed | code written; **NOT TESTED** at API level (same helper as sign-in) |
| Public forms fall back to in-memory (open policy) | PASS (stand-in), `http.test.ts` |
| Start-payment fails closed, verify stays open | PASS (stand-in), `payments.test.ts` |
| Place-order fails closed | code written; **NOT TESTED** at API level |
| Break-glass window: 60-minute cap, expiry, in-memory still enforced | PASS (stand-in) |
| `RATE_LIMIT_SHARED=off` ignored by closed limiters in production | PASS (stand-in) |
| Concurrent requests across instances | simulated with two limiter objects (PASS (stand-in)); real database concurrency NOT TESTED |

## Priority 6: cron

| Item | Result |
|---|---|
| `CRON_SECRET` authentication, both endpoints | PASS (stand-in): hidden 404 without the secret, no database call; counts only |
| Runs with commerce off, in production | PASS (stand-in) |
| Vercel plan compatibility | BLOCKED (no account access) |
| Successful execution on a deployment | BLOCKED |
| Failure logging | PASS (stand-in) for content; real log delivery NOT TESTED |
| Retry handling end to end | NOT TESTED (needs the database) |
| Monitoring | `email_outbox_stats()` exists, **NOT TESTED**; no endpoint or screen exposes it |

## Priority 7: commerce safety

| Item | Result | Evidence |
|---|---|---|
| `COMMERCE_ENABLED = false` | PASS | `shared/commerce.ts` line 7; `shared/commerce.test.ts` (stand-in) |
| Production cannot open purchasing via flags | PASS (stand-in) | `flags`, `checkout`, `payments` shared tests and the cart, checkout and payments API gate tests all assert production forced closed, even with every flag on and a test key |
| Staging uses a separate Supabase project | BLOCKED | Vercel environment settings, not visible |
| Razorpay test credentials only in staging | BLOCKED; code refuses a live key unless commerce is on (PASS (stand-in)) | |
| Separate email configuration | BLOCKED | |

## Priority 8: reports
All four documents are produced. Nothing is production-ready.
