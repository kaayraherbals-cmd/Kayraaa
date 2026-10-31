# Kaayra Herbals: Complete Audit (Phase 1, static review plus executed baselines)

Date: 2026-10-24. Repo: kaayra-herbals-seo-aeo-geo-bing.zip (folder `kaayra-ui-refresh`). Node v22.22.2, npm 10.9.7.
No code was modified in this phase.

## 1. Executive assessment
The codebase is large and unusually well documented: about 16.7k lines in `src/`, 2.2k in `api/`, 13.5k in `server/`, 9.3k in `shared/`, 7.2k of SQL in `supabase/` (55 files). Lint and typecheck are clean, the production build succeeds, and 1177 of 1180 tests pass.
It is NOT production ready. Reasons, in order of weight:
1. The SQL migrations (all 30+ files) have never been run against PostgreSQL in this audit (no PostgreSQL in the sandbox). The project's own HANDOFF.md says the Stage 7 SQL was "never run".
2. Bundles cannot be purchased (no cart or checkout wiring). Loyalty has no wallet UI and no scheduler. Wishlist has no API tests.
3. Background jobs are daily only, so stock held by unpaid orders can stay reserved for up to a day unless a customer action triggers a sweep.
4. Dependency audit: 17 vulnerabilities. 2 are in production dependencies (react-router, moderate). The 3 critical ones are dev-only (vitest/tinypool, vercel CLI chain/tar).
5. `seo:check` fails with 42 problems, all caused by `VITE_SITE_URL` being unset in the local build (placeholder domain). This is a configuration issue, not a code defect; it must be set in Vercel.
6. 2 failing tests (see BUG_REGISTER: KH-001, KH-002).
7. External integrations unverified: Razorpay test mode, Resend SPF/DKIM/DMARC (docs/EMAIL_SETUP.md line 47 says "Not yet done").

## 2. What was actually executed (evidence)
| Command | Result |
|---|---|
| `npm ci` | OK, 382 packages |
| `npm run check:lockfile` | OK, root dependencies match package.json |
| `npm run lint` | exit 0, no findings |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 1: 2 failed, 1177 passed, 1 skipped (86 files, 83 passed) |
| `npm run build` | exit 0 (tsc, client, SSR, prerender: 17 routes + 404 + shells). Warns VITE_SITE_URL not set |
| `npm run seo:check` | exit 1: 42 problems, all placeholder-domain related |
| `npm audit` | exit 1: 17 vulns (7 moderate, 7 high, 3 critical); `--omit=dev`: 2 moderate |
| PostgreSQL self-tests (`scripts/db-verify.sh`) | NOT RUN: no PostgreSQL available |
| Playwright `npm run ui:check` | NOT RUN yet (Phase 2) |
Raw outputs were captured during the session; the exact commands are in section 6.

## 3. Architecture facts verified in source
- 12 files in `api/` = exactly the Vercel Hobby limit of 12 functions (contact, issues, products, subscribe, admin, auth, cart, checkout, media, orders, payments/webhook, reviews). Any new API file breaks the limit; new actions must go inside existing dynamic handlers.
- Crons (vercel.json): `/api/checkout/reconcile` daily 02:00, `/api/checkout/outbox` daily 02:30. Cart recovery rides on the outbox call (api/checkout/[action].ts lines 105-114).
- CSRF: same-origin check plus `x-kaayra-csrf: 1` header on state-changing customer routes (auth line 182, reviews line 74, checkout line 159, cart line 115); admin uses SameSite=Strict cookies plus the same pattern (admin line 55).
- Webhook: HMAC SHA-256 with `timingSafeEqual` (server/razorpay.ts lines 33-46; api/payments/webhook.ts line 47).
- Security headers present: nosniff, X-Frame-Options DENY, HSTS 2 years, Referrer-Policy, Permissions-Policy, CSP with a script hash (no `unsafe-inline` for scripts). `style-src 'unsafe-inline'` is allowed.
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in src, api, server or shared.
- No literal live secrets found (grep for sk_live, rzp keys, AIza, JWT, Resend keys): matches are only test fixtures and prefix checks.
- RLS enabled in 24 SQL files.

## 4. Findings summary
See BUG_REGISTER.md for the full register. Counts: P0 0 confirmed, P1 5, P2 6, P3 2, plus 9 items that need reproduction.

## 5. Scope limits of this phase (honest)
This is a targeted audit: executed baselines plus focused reading of cron paths, webhook, headers, CSRF, DOM sinks, secret patterns, test coverage and feature wiring. It is NOT a line-by-line review of all ~49k lines. Money/GST/refund arithmetic, RLS policy correctness, SQL function bodies, and admin permission matrices still need a dedicated pass in Phases 3 and 4. Anything not listed as verified above should be treated as unverified.

## 6. Commands to reproduce
```
npm ci && npm run check:lockfile && npm run lint && npm run typecheck
npm test            # 2 failures: shared/content-safety.test.ts, server/ai/customer.test.ts
npm run build
npm run seo:check   # fails until VITE_SITE_URL=https://kaayraherbals.com is set for the build
npm audit --omit=dev ; npm audit
grep -rn "CUSTOMER_MAX_TOKENS" server/ai/customer.ts
grep -n "clinically" public/llms-full.txt
```
