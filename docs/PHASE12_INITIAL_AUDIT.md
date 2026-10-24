# Phase 12 initial audit (Stage 1)

Date: 2026-10-22. Scope: the uploaded ZIP `kaayra-herbals-v5-phase12-admin-performance.zip` (project folder `kaayra-ui-refresh`), inspected as it arrived. Nothing was changed before this audit. Only commands listed in section 2 were run; nothing else is claimed.

## 1. The baseline is not what the brief says
- The brief names `phase11-seo-visibility` as the baseline. The ZIP received is the **admin V8 / "phase12-admin-performance"** build. `HANDOFF.md` still says the code base is the Phase 7 base plus Phase 9 Step 1 and Phase 10 Step 1 (database core only).
- No Phase 8 archive is in the ZIP. `grep` finds no Phase 8 financial layer (no refund netting, tax, fee, COGS or margin metrics anywhere in `api/`, `server/`, `src/`, `shared/`).
- No Gemini / owner AI code exists anywhere (only mentions in docs).
- SEO work is present (`docs/SEO_VISIBILITY_AUDIT.md`, `scripts/seo-check.mjs`, prerender, `shared/routes.json`, `shared/private-routes.json`).

## 2. Commands actually run on the unmodified ZIP (Node v22.22.2, npm 10.9.7, network available)
| Command | Result |
|---|---|
| `npm ci` | succeeded, 241 packages. Reports 22 vulnerabilities (3 critical, 13 high, 6 moderate) |
| `npm run check:lockfile` | pass |
| `npm run lint` | pass (exit 0, no output) |
| `npm run typecheck` | pass |
| `npm test` | pass: 70 files passed, 1 skipped (`shared/coupons.parity.test.ts`), 976 tests passed, 1 skipped |
| `npm run build` (no `VITE_SITE_URL`) | exit 0, but prerender used placeholder `https://kaayraherbals.example` |
| `npm run seo:check` after that build | **FAIL** (canonicals, JSON-LD and sitemap use the placeholder domain). This is a build-input problem, not a code defect: see next row |
| `VITE_SITE_URL=https://kaayraherbals.com npm run build` then `npm run seo:check` | build exit 0; seo:check: 16 public routes, 12 private shells, 16 sitemap URLs, **OK** |
| `npm audit --omit=dev` | 2 moderate (react-router / react-router-dom 6.x: open redirect, hydration constructor injection). Fix requires v7, a breaking change |
| `npm audit` (all) | critical: vitest, tinypool, tar. high: vite, @vercel/node and its tree. These are dev/build-time packages; not yet assessed individually |

NOT run, because not available or not yet attempted: database self-tests and concurrency scripts (no PostgreSQL in this sandbox: `psql`, `postgres`, `docker` absent), `npm run ui:check` (needs Playwright), any Razorpay, Resend, Supabase or Vercel call, production site check.

## 3. Findings by area
**Architecture constraints**
- 12 Vercel functions exist in `api/` (admin, auth, cart, checkout, contact, issues, media, orders, payments/webhook, products, reviews, subscribe). Docs state 12 is the budget. Any new route must go in as an action inside an existing `[action].ts` file (admin, cart, checkout, orders), not a new file.
- Crons: `/api/checkout/reconcile` (02:00) and `/api/checkout/outbox` (02:30). No loyalty activation/expiry cron is registered in `vercel.json`.
- Admin permissions use `can(role, permission)` in `server/admin/ctx.ts` and `shared/roles.ts`.
- Admin `analytics` is one GET action in `server/admin/extras.ts`.

**Phase 8 (BI): MISSING, one partial feature exists**
- Existing "Reports / Sales / Stock health" (V8) computes revenue as order total (goods + shipping) of non-cancelled orders; it explicitly does not net refunds, GST or discounts. It reads up to 10,000 orders and 10,000 items into the function and aggregates in JavaScript (`shared/analytics.ts`), not with database aggregates.
- No cost-of-goods data exists in the schema (no cost column in products, variants, batches or order items). Profitability must therefore be shown as unavailable, never as zero cost.
- No payment-fee or settlement data is stored (to be confirmed against `payments.sql` in Stage 2).

**Phase 9 (loyalty): DATABASE ONLY**
- Present: `supabase/loyalty.sql`, `loyalty_selftest.sql`, `loyalty_concurrency.sh`, `shared/loyalty.ts` + test.
- Absent: any call site in `api/`, `server/`, `src/`. No wallet page, no checkout redemption, no `orders.loyalty_discount_paise`, no earning trigger from paid order events, no refund reversal wiring, no owner screen, no scheduler or emails.

**Phase 10 (bundles / wishlists): DATABASE ONLY**
- Present: `supabase/bundles_wishlists.sql` (+ selftest, concurrency script), `shared/bundles.ts` + test. `src/lib/products.ts` and `src/main.tsx` contain only incidental "bundle" mentions (JS bundle, not product bundles; to be confirmed).
- Absent: API actions, cart/checkout wiring (`checkout_place_with_bundles` is never called), customer pages, hearts, wishlist page, owner bundle screen, coupon policy beyond the conservative refusal `BUNDLE_COUPON_EXCLUDED`, Razorpay amount path for bundles.

**Phase 11 (SEO): PRESENT, passes with the right build input**
- Passes `seo:check` only when `VITE_SITE_URL` is the production domain. Local and CI builds without it fail the check by design. Production reachability and indexing are NOT verified.

**Security (first look, not yet a full review)**
- Positive: CSP and HSTS headers in `vercel.json`, private routes carry `noindex, no-store`, webhook and rate-limit code and tests exist.
- Open: dependency vulnerabilities above; `react-router` 6.x advisories apply to production code. Role checks, RLS and function grants still to be read file by file in Stage 5.

**Documentation / process risks**
- `HANDOFF.md` and `README.md` are stale and contradictory (several phases stacked, different baselines). CI workflow header states it has never run on GitHub.
- `package.json` has no `@supabase/*` or Razorpay SDK (the project talks to them over REST in `server/`). That is consistent, not an error.

## 4. Proposed order of work (one stage at a time)
1. Stage 1: this audit and the first draft matrix (done).
2. Stage 2: read the SQL migrations in order, fix and document the migration sequence, stand up a disposable PostgreSQL if installable, run the existing self-tests.
3. Stage 3: checkout consistency (one calculation path, Razorpay amount, webhook idempotency) because loyalty and bundles both plug into it.
4. Stage 4: Phase 10 bundles and wishlists wiring, then Phase 9 loyalty wiring.
5. Stage 5: Phase 8 financial layer (refund-netted metrics, cost-unavailable states, CSV safety).
6. Stage 6: security review, dependency fixes, SEO regression tests, AI integration boundary document, final reports and ZIP.

Decision needed from the owner before Stage 4 (see the conversation): loyalty earning and redemption rules, and the bundle coupon policy.

## Addendum (Stage 2): the Phase 8 archive arrived
- `kaayra-herbals-v5-phase8-business-intelligence.zip` was supplied after Stage 1. It was built on this same base ZIP. Compared file by file: it adds 10 files and changes 5 (`server/admin/backoffice.ts` 2 lines, `shared/roles.ts` 5, `src/pages/Admin.tsx` 30, `docs/DATABASE_MIGRATIONS.md`, `HANDOFF.md`). Nothing it changed overlaps files edited in this phase. It was merged by copying; no conflicts.
- Section 3 "Phase 8: MISSING" is therefore superseded: Phase 8 is recovered. What it still lacks against the brief: bundle and loyalty reporting (neither is wired to checkout yet), screens for entering payment fees and carrier costs (API actions exist), settlement import, coupon performance inside the new group (the existing coupon analytics stay as they were).
- That archive's HANDOFF lists `cart_recovery_selftest.sql` failing as 'not mine'. Cause found and fixed in Stage 2 (test fixture, not production code). See Changelog.
