# Phase 7 Step 3 handoff

## Where things stand (honest)

| Area | State |
|---|---|
| Commerce | **On** (`COMMERCE_ENABLED = true`); production purchases need the separate live-sales approval. This file's older text below is history; see `docs/COMMERCE_STATE.md` |
| Source code | Written; 12 changed files parse and link on Node 22; **not type-checked, linted or built** |
| Tests | 620 pass / 0 fail across 45 files with a **stand-in runner** (mocks only). **Real `npm test`: not run** |
| Database | Three new migrations and four self-test files written; **nothing executed** |
| Integrations | Razorpay, Resend, Vercel cron, Supabase: **never exercised** |
| Production readiness | **Not ready.** Required integration tests have not passed |

## Do these first, in this order

1. **Get a networked environment.** Either enable network access for the sandbox (Settings) or push the zip to a GitHub repo: `.github/workflows/ci.yml` runs the six baseline commands and the database job with no secrets. (If you use another CI, run the same commands.)
2. **Baseline.** `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit`. Expect type and lint errors from the unrun Phase 6, Step 1 and Step 2 edits. Send the output; fix without weakening tests. Triage the 22 advisories without `npm audit fix --force`.
3. **Database job.** The CI `database` job applies all 20 migrations to a throw-away Postgres and runs eight self-tests and `supabase/concurrency_test.sh`. Fix what it finds. Treat the first failures as likely mistakes in my unexecuted SQL (see the database report for the three most likely).
4. **Staging project.** Create a **separate** Supabase project, apply the migrations in order, run the self-tests in its SQL editor. Never on production.
5. **Staging Vercel (Preview) environment variables**, different from Production: staging Supabase URL and keys; Razorpay **test** key and secret and a test webhook secret; a Resend test key and test recipient addresses; `CRON_SECRET`; `RATE_LIMIT_SALT`; `FEATURE_CART_PREVIEW`, `FEATURE_CHECKOUT_TESTING`, `FEATURE_PAYMENT_TEST_MODE` set to `on` **for Preview only**.
6. **Scheduler.** Run `supabase/scheduler_pg_cron.sql.example` on staging (after replacing the placeholders and storing the secret in Vault), or set Vercel Pro schedules. Watch `cron.job_run_details` and `email_outbox_stats()` for a day.
7. **Integration run on staging with test data only:** place an order, pay with a Razorpay test card, check the webhook, the confirmation mail, a dispatch through the admin API, a failed delivery, a cancellation, a refund and its webhook. Record each result.
8. Only after 1 to 7 pass: Step 3.

## Known gaps to close in Step 3 (all listed in `docs/PHASE7_STEP2_ISSUES.md` or the security report)

- No API-level tests for MFA fail-closed, place-order fail-closed, or refund webhooks / refund reconciliation.
- No customer tracking endpoint (the SQL ownership function exists), no admin shipment screens (API exists), no monitoring endpoint for the outbox.
- Cancellation and refund states (Part 15) beyond existing code; duplicate-refund protection needs its own test.
- Older `e.message` log lines to harden.
- `launch_optin.sql` check-constraint ordering trap.
- Manual (admin-created) orders get no automatic mail; cancel and refund mails come from the sweep, not at the moment of the event.
- Return to origin does not restock automatically.

## Files added or changed in Step 2.5

Added: `supabase/{shipments,email_outbox,rate_limits}_selftest.sql`, `supabase/rate_limits_concurrency.md`, `supabase/concurrency_test.sh`, `supabase/scheduler_pg_cron.sql.example`, `.github/workflows/ci.yml`, `server/rpc.test.ts`, `server/api-tests/admin-login-limiter.test.ts`, `docs/evidence/*`, the four `docs/PHASE7_STEP25_*` and `PHASE7_STEP3_*` documents.
Changed: `server/http.ts` (open/closed policy, break-glass), `api/admin/[action].ts`, `api/checkout/[action].ts`, `shared/errors.ts` (`KH-CHK-009`, `KH-PAY-009`), `shared/outbox.ts` (stale-mail rule), `server/outbox.ts` and `server/rpc.ts` (no customer data in logs), tests (`server/http.test.ts`, `shared/outbox.test.ts`, `server/api-tests/payments.test.ts`), `.env.example`.
Not changed: `package.json`, `package-lock.json`, the Razorpay module, reconcile logic, any UI.

## Do not
Turn commerce on; use live Razorpay or Resend credentials in staging; run any self-test or concurrency script on production; start the UI redesign before steps 1 to 3 pass.
