# Phase 7 Step 2: testing report

**Nothing was executed.** The sandbox has no network access: `npm ci` fails ("Exit handler never called"), `curl https://registry.npmjs.org/` fails at DNS (exit 6), and npm's own log shows it could not fetch tarballs. There is no local PostgreSQL either. So there are no test, lint, typecheck, build or audit results to report. The last verified result in this project is Phase 6's 483 passing tests, taken before the Phase 6 build-fix edits and before every Phase 7 change.

Status words: **TESTED** means executed with a passing result. That count is zero. **IMPLEMENTED** means the code exists. **UNTESTED** means no execution happened (tests may be written and still unrun). **BLOCKED** means it cannot be done in this environment.

## Baseline commands (task section 3)

| Command | Status | Detail |
|---|---|---|
| `npm ci` | BLOCKED | Fails; no network. Attempted several times across the session. |
| `npm run lint` | BLOCKED | Needs `node_modules`. |
| `npm run typecheck` | BLOCKED | Needs `node_modules`. The one run before install (no packages) only failed on missing `vite/client` and `node` type packages, which says nothing about the code. |
| `npm test` | BLOCKED | `vitest` not installed. |
| `npm run build` | BLOCKED | `vite` not installed. |
| `npm audit` | BLOCKED | Needs the registry. |

No package file was changed: `package.json` and `package-lock.json` are exactly as uploaded.

## Review of the tests changed in Step 1 (task section 2)

Done by reading. None were run.

| File | Change | Business rule still checked? | Assertions weakened? |
|---|---|---|---|
| `shared/commerce.test.ts` | Flag expected `false` | Yes: pins the master switch | No |
| `shared/flags.test.ts` | Defaults and production: every flag `false` | Yes: production forces all off | No; stricter than Phase 6 (which exempted the bag) |
| `shared/checkout.test.ts` | Closed by default and in production; opens in staging only with bag + testing flags; every order is a test order | Yes | No; adds the "testing flag alone is not enough" case |
| `shared/payments.test.ts` | Opens only with the payment flag and a TEST key; a LIVE key never opens; production stays closed | Yes | No; adds the live-key refusal |
| `server/api-tests/cart.test.ts` | Preview flag gates the cart; production forced closed; `checkoutOpen` false without the testing flag | Yes | The removed "open with no variable" test asserted the Phase 6 behaviour that is now wrong |
| `server/api-tests/checkout.test.ts` | Gate tests for the off state | Yes | Same |
| `server/api-tests/payments.test.ts` | Gate tests: payment flag, LIVE key refused, production closed, testing flag required | Yes | Same |
| `server/admin/admin-api.test.ts` | Admin order creation now expects 409 and asserts **no** `order_create` RPC | Yes | Stronger than before |

Not changed and not weakened: payment verification (signature, amount and order matching, webhook replay), inventory reservation, and admin permission tests. The existing api-test environments already set `FEATURE_CART_PREVIEW`, `FEATURE_CHECKOUT_TESTING` and `FEATURE_PAYMENT_TEST_MODE`, so their checkout and payment paths still run in the off state; I confirmed that by reading. I have **not** confirmed that adding my enqueue calls to the verify, webhook and place-order paths leaves every existing assertion that counts fetch calls intact. The new calls are wrapped so they cannot throw, but a test that asserts an exact list of database calls may now fail.

## New tests written (all UNTESTED, never run)

| File | Covers |
|---|---|
| `shared/shipments.test.ts` | Transition table is compared pair-for-pair with the SQL function; final states; create and status validation; migration is additive, append-only, RLS on, ownership check present |
| `shared/orderMail.test.ts` | All 10 templates: fixed subjects, HTML plus text, order reference, support contact, HTML escaping, no address/phone/claims, refund wording, rupee format |
| `shared/outbox.test.ts` | Retry schedule matches the SQL; permanent vs retryable errors; stable idempotency keys; the facts each mail may state (payment confirmed needs a captured payment **and** a paid order); gate decisions |
| `server/outbox.test.ts` | Worker with mocked database and provider: no send before payment is verified; stable provider idempotency key; retry vs dead; not configured; bad rows; wrong-order shipment ignored; no customer data in logs or stored errors; enqueue stores ids only; sweep queues identical keys on repeat |
| `server/http.test.ts` | Shared limiter: sends a hash not the IP; shared across instances; fails open; switch-off |
| `server/admin/shipments.test.ts` | Support cannot write; manager and owner can; illegal move refused before the database; mail queued only after the database accepts the move; none when it refuses |
| `server/api-tests/outbox-cron.test.ts` | Cron endpoint hidden without the secret; counts only; works in production with commerce off; safe to repeat |
| `shared/roles.test.ts` | New `shipments.*` permissions |

`vite.config.ts` now sets `RATE_LIMIT_SHARED=off` for the test run, so existing tests do not call the shared limiter's database function. `server/http.test.ts` turns it back on for its own cases.

## Not covered by any test

- The SQL itself (shipments, outbox v2, rate limits): the new tests read the files as text. No migration, function, trigger or self-test was executed. There are no `*_selftest.sql` files for the three new migrations. Two-session concurrency checks (two workers claiming the same mail, two limiter hits at once) need a real database.
- Resend, Razorpay and Vercel cron: all mocked or not exercised.
- Cross-account access on a customer tracking endpoint: not built (see changes doc); ownership is enforced only inside the SQL function `shipments_for_member`.
- CSRF on the admin shipment actions relies on the existing admin router; it was not re-tested.

## What to run first

```
npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit
```
Then apply the three migrations to a **staging** Supabase project in the order in `docs/DATABASE_MIGRATIONS.md` and write self-tests for them.
