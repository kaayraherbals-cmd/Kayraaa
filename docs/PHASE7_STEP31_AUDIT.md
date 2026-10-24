# Phase 7 Step 3.1 audit

**Verification status: NOT VERIFIED.** The authoring sandbox has no network (`npm ci` installs nothing, checked again this session), so CI, lint, typecheck, tests, build, audit, PostgreSQL, Supabase, Razorpay and Resend could not be exercised. Only small Node type-stripped logic checks were run (liveSales/flags/checkout/payments gate matrix, returnPath validator): all passed.

## Exact blocker
No outbound network from the sandbox. The earlier handoff (docs/PHASE7_STEP3_HANDOFF.md) describes `.github/workflows/ci.yml`, which runs the six baseline commands plus a `database` job (all migrations on throw-away Postgres, self-tests, `supabase/concurrency_test.sh`) with no secrets.

## Commands to run elsewhere
`npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit`
Database: push to GitHub and let the `database` CI job run, or apply supabase/*.sql in the order in docs/DATABASE_MIGRATIONS.md on a disposable Postgres, then the *_selftest.sql files.

## Findings this session
- Stale documentation claiming commerce is off (confirmed, fixed): HANDOFF.md, SESSION_RULES.md, docs/PHASE7_STEP3_HANDOFF.md, docs/ECOMMERCE_ARCHITECTURE.md fixed; 13 older docs carry a "Historical document" banner; canonical `docs/COMMERCE_STATE.md` added; a test fails if current-state docs claim `COMMERCE_ENABLED = false`.
- Tracking login return (confirmed gap, fixed in code): `/login?return=` with an allow-listed same-site path only. Caveat: it works when the sign-in flow lands on /login with a session (Login redirects); the email sign-in `window.location.assign(server redirect)` and OAuth callbacks may still go to /account. Unverified.
- Full register: docs/PHASE7_STEP3_ISSUES.md.

## Not done (no execution possible or too large to ship unreviewed)
Items 2, 3 (runtime), 4, 6 (admin shipment screens), 7, 8, 9 (refund coordination review), 10 (redesign), 11 (screenshots, accessibility audit).
