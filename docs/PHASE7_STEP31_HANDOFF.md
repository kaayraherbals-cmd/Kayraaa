# Phase 7 Step 3.1 handoff

State: `COMMERCE_ENABLED = true`; production live sales gated by LIVE_SALES_* (docs/COMMERCE_STATE.md). Not production ready: typecheck, lint, 641 unit tests and build pass in the sandbox, but no database, Razorpay, Resend, browser or accessibility run has happened.

Do first:
1. Get a networked run (GitHub Actions `ci.yml` or local): `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit`. Send the output.
2. Disposable Postgres: DONE (migrations, re-apply, 8 self-tests, concurrency; see TESTING.md). Still to do on a separate Supabase STAGING project: RLS as real anon/authenticated, two-session payment checks. (Shipment concurrency test: done, see TESTING.md.)
3. Staging env vars: Razorpay TEST keys, test webhook secret, Resend test key, CRON_SECRET, RATE_LIMIT_SALT. Never set LIVE_SALES_* on staging.
4. Admin shipment screens are BUILT (src/pages/AdminShipments.tsx) but untested in a browser or against a database: click through create, dispatch, fail, resolve on staging with each role.
5. `npm audit`: 3 critical / 13 high in dev tooling (vitest, vite, @vercel/node, tar). Plan the major upgrades.
6. Remaining: redesign (item 10), responsive and accessibility testing, email and Razorpay verification, refund coordination review.

Rule: always hand back an updated zip and this handoff before the budget runs out.


Browser click-through (not done; needs staging and a person): sign in as support (can read shipments, no write buttons), manager and owner. As manager: create a shipment from a packed order with a partial quantity, dispatch it (courier + tracking), mark delivery failed with a reason, confirm the problem shows on the dashboard, resolve it, retry out for delivery, deliver. Expected: order ships only when every unit is dispatched and is delivered only after every shipment is.
