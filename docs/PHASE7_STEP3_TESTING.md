# Phase 7 Step 3 testing

Executed: logic smoke test only (see AUDIT). Everything else: NOT RUN.

Run first on a networked machine:
`npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit`
Likely first failures: the edited tests listed in CHANGES (written without execution), and any test elsewhere that still assumes COMMERCE_ENABLED=false (grep `selling is off`).

Environment matrix covered by shared/flags.test.ts: staging/preview/local, production unapproved, production approved, partial approval (each variable missing), approval variables on preview ignored, NODE_ENV fail-closed, live key without approval, test key in production.

Still to do: DB migrations + self-tests on disposable Postgres, Razorpay test-mode scenarios, email tests, concurrency tests, responsive (360/390/768/1024/1440) and WCAG 2.2 AA checks.

## Added in continue session (all UNRUN)
shared/tracking.test.ts. Still missing: API tests for api/orders (401, cross-account 404, bad id 400, 405), admin shipment form/dashboard tests.

`server/api-tests/orders.test.ts` added (401, own list, own track, cross-account 404, bad id 400, 405, unknown action 404). UNRUN. Network retry this session: `npm ci` still installed nothing (empty node_modules), so no baseline was possible.
