# Security Audit (Phases 3-4: static review plus executed checks)
Scope honesty: focused review of the highest-risk paths. Not an exhaustive review of every SQL function or every admin action. No live penetration testing, no database, no live Razorpay or Supabase.

## Verified good (read in source)
| Area | Evidence |
|---|---|
| Webhook authenticity | Raw body, HMAC-SHA256, `timingSafeEqual` (server/razorpay.ts:33-46); 256 KB cap; bad signature returns 401; Razorpay event id used for idempotency (api/payments/webhook.ts:47-70; SQL `on conflict do nothing` in payments_checkout.sql) |
| Webhook not blocked by feature flags | Intentional, a taken payment must always be recorded (webhook.ts header comment) |
| Cron endpoints | Bearer secret, minimum length 16, constant-time compare, returns 404 on failure (server/checkoutPayments.ts:289-295) |
| CSRF | Same-origin check plus custom header `x-kaayra-csrf: 1` on customer POST routes; SameSite=Strict session cookies; one-click unsubscribe deliberately token-based |
| Cookies | HttpOnly; Secure when HTTPS; SameSite Strict (Lax only for the OAuth round trip) (server/oauth.ts:87-94) |
| XSS sinks | No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` in src/api/server/shared |
| Headers | nosniff, X-Frame-Options DENY, HSTS 2y with subdomains, Referrer-Policy, Permissions-Policy, CSP with script hash and no script `unsafe-inline`; Razorpay script origin only on /checkout |
| Secrets | No live key literals found by pattern search (only test fixtures and prefix checks). `.env.example` has no values for secrets |
| Refund cap | `refund_create` locks the order row (`for update`), sums requested/approved/refunded refunds, rejects totals above order total (supabase/refunds.sql:28-84); function revoked from public/anon/authenticated |
| App-initiated gateway refunds | Razorpay refund call carries an idempotency header (server/razorpay.ts:104) |
| RLS | Enabled in 24 SQL files; no `grant ... to anon/public` found by grep |

## Findings
| ID | Sev | Finding | Evidence | Action |
|---|---|---|---|---|
| KH-018 | P1 | Refunds made directly in the Razorpay dashboard are not reconciled. A `refund.processed` event whose refund id is not in `order_refunds` is labelled `refund_unknown`, written to the audit log, and nothing else changes: order state, refunded total and finance stay as if no refund happened. | supabase/payments_checkout.sql:89-94; api/payments/webhook.ts NOTABLE set | Needs a business rule (which order state; GST treatment) and a DB-tested reconcile RPC: verify the payment belongs to a known order, enforce the cumulative cap, idempotent on refund id. Blocked by owner decision. Do not implement silently. |
| KH-007 | P1 | react-router-dom 6.x production advisories (open redirect via backslash, SSR deserializeErrors). Moderate. | npm audit --omit=dev | Check for patched 6.x; else planned v7 migration with regression tests. |
| KH-008 | P2 | Dev-only advisories: vitest/tinypool (critical), tar via @vercel/node (critical/high), vite/esbuild. Not in the production bundle but present on developer and CI machines (CI runs `npm ci`). | npm audit | Upgrade on a branch with full regression run; never `audit fix --force` blindly. CI already blocks only on runtime high+. |
| KH-011 | P2 | CSP allows `style-src 'unsafe-inline'`. | vercel.json | Evaluate removal later. |
| KH-019 | P2 | Rate limiter and RLS behaviour when the database is unreachable not verified end to end. The checkout place route returns an error on 'unavailable' (api/checkout/[action].ts:217-218) which fails closed there; other routes not checked. | read | Test each limiter caller in Phase 7. |

## Not verified (do not treat as passing)
MFA and passkey flows, password recovery, OAuth callback edge cases, admin role matrix per action (role/403 tests exist in server/admin/*.test.ts but coverage per action not measured), upload validation (reviews image upload), RLS policy correctness per table, SQL injection review of every `rest()` query string (PostgREST filters are built by string interpolation in places such as server/admin/payments.ts:90; ids appear to come from validated UUIDs but each needs confirmation), backup and recovery, audit log immutability (docs/DATABASE_MIGRATIONS.md checks it, not run).


## Checklist review, 2026-10-30 (static only; registry unreachable, so npm ci, tsc, tests, npm audit were NOT run)
| Item | Result |
|---|---|
| Private storage buckets | Pass. product-images and review photo buckets are `public=false`; served only via /api/media and /api/reviews?action=image, and only while an approved product/review points at the file. |
| RLS | Pass. Every table has RLS on; 23 tables looked missing by simple grep but are enabled in `do $$ foreach` loops (loyalty.sql, finance.sql, cart_recovery.sql) with `revoke all from anon, authenticated`. |
| Auth on every API route | Pass. Admin: signed cookie + allowlist re-check + role per action. Customer: signed user cookie. Cron: bearer secret. Webhook: HMAC. Public routes are intentionally public and rate-limited. |
| Never trust frontend | Pass. Server prices, ownership by member_id on every order/review query. |
| Rate limiting | Pass. Every route limited; admin, checkout, reviews, AI fail closed. |
| Sanitize input / parameterized queries | Pass with note. PostgREST filters use UUID-validated or encodeURIComponent values; no raw SQL. Keep the UUID_RE check on any new `id=eq.${}`. |
| CORS | Pass. No CORS headers sent; same-origin + custom header CSRF check. |
| HTTPS, headers | Pass. HSTS 2y, nosniff, DENY, CSP with script hash. Gap: style-src unsafe-inline (KH-011). |
| Webhook signatures | Pass (HMAC, timingSafeEqual, idempotent event id). |
| No commands from chat text / lock tools | Pass. Customer and admin AI have no tools, no DB or SQL access; injection screening present. |
| Debug off in prod | Pass. No debug flags; error bodies carry codes, details only in logs. |
| Hide admin pages | Partial. Server API is gated and noindex; but robots.txt `Disallow: /admin` names the path and the /admin UI shell is public (login form). Acceptable; do not rely on obscurity. |
| Vulnerable packages | NOT VERIFIED here. CI blocks on `npm audit --omit=dev --audit-level=high`. KH-007/KH-008 still open. |
| File upload types | Pass. Magic-byte sniff, random names, size cap, metadata stripped, private bucket. |
| IDOR | Pass on orders, reviews, cart, wishlist (member_id enforced in query). |
| Log admin actions | Pass with caveat. admin_audit is append-only (trigger). `writeAudit` is best effort and swallows failures, so an action can succeed with no log line if the insert fails. Consider failing closed for refunds, role/passkey changes and deletes. |
| Admin session | Note. Stateless 8h HMAC cookie; revocation is by removing the email from ADMIN_EMAILS or deleting the passkey. No per-session revoke or rotate-secret-on-logout. |

Change made: `clientIp` (server/http.ts) now prefers `x-vercel-forwarded-for`, so rate-limit keys cannot be chosen by the client on any proxy path. Untested; run `npm test` first.
