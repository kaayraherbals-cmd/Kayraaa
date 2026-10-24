# V5 Phase 1: forensic audit (2026-10-21)

Input: kaayra-herbals-premium-ui-v4-home.zip (346 files). Environment: NO network.
`npm ci` fails here, so lint, typecheck, vitest (646 tests claimed), build, ui:check, npm audit, DB self-tests, Razorpay test mode, screenshots and the Option A/B typography comparison were NOT run. No test result is claimed.

## Executed in this phase
- Inventory (346 files); TypeScript syntax parse of 220 source files: 0 errors (before this phase's comment edits; re-run below).
- package.json vs package-lock.json comparison; CI workflow read; env template read.
- CSS audit by script: classes with no literal reference in src/shared/server/index.html, selectors defined in more than one stylesheet.
- Search for `any`, ts-ignore, eslint-disable, img without alt.

## Confirmed issues
| # | Severity | File | Problem | Impact | Fix / status |
|---|----------|------|---------|--------|--------------|
| 1 | Critical (deploy blocker) | package.json, package-lock.json | Lockfile is out of sync. package.json lists @fontsource-variable/fraunces, /instrument-sans, /noto-serif-devanagari (no lock entry); lock still lists manrope, cormorant-garamond, tiro-devanagari-hindi (removed from package.json). Introduced by the V4 font changes (my own, made offline). | `npm ci` errors out on a mismatched lock, so CI and the Vercel build fail. | NOT fixed: needs network. On a networked machine run `npm install`, commit package-lock.json. Verify with `npm ci`. |
| 2 | Medium | .github/workflows/ci.yml | `npm audit --audit-level=high` has `continue-on-error: true`; the file header says CI was never run. | High-severity advisories cannot fail the build. | NOT changed: findings are unknown offline. After triage, remove continue-on-error. |
| 3 | Medium | src/styles/legacy.css vs base.css / pages.css / home.css | 21 single-class selectors are defined in more than one stylesheet, e.g. .btn, .btn[disabled], .eyebrow, .lede, .split, .grid-2, .grid-3, .link-arrow, .badge, .page-enter, .article, .prose. legacy.css loads before base.css, so later files win per property, but properties that only legacy sets still leak in. | Possible subtle styling conflicts; harder maintenance. | Not changed. Needs rendered comparison before consolidating (Phase 9). Impact on pixels is unverified. |
| 4 | Low | docs/comments | Comments in admin.css, brand.ts and legacy.css still named Cormorant/Manrope/Tiro. | Misleading docs. | FIXED this phase (comments only). docs/DESIGN_SYSTEM.md rationale paragraph and shared/mailTemplates.ts font stacks still mention the old fonts. |

## Suspected, not confirmed
- 18 classes have no literal reference in source: legacy.css (account-band-grid, acct-btn, ingredient-bot, ingredient-part, num, pdetail, plist-media, plist-row, section--products, section--sage, section-head--products, split--solo, theme-womens, no-reveal), admin.css (admin-main-gap, admin-tabs, product-thumbs), shop.css (theme-womens). Some may be built dynamically (e.g. no-reveal, theme-womens). Not deleted.
- Type safety: production code (src, api, server non-tests, shared) has no `any` or ts-ignore. `any` appears only in test mocks (about 20 places). Four eslint-disable comments for no-control-regex have justifications. Low risk.
- Accessibility: no <img> without alt found by grep; click-only <div> backdrops are aria-hidden and sit beside a close button. Full a11y needs a browser.
- Daily crons (reconcile 02:00, outbox 02:30): emails may lag up to ~24 h on the Hobby plan.
- .env.example holds no secrets (only feature defaults such as ADMIN_MFA=required).

## Carried from earlier audit (static review, unchanged)
Webhook signature check, event idempotency and payment_apply_event locking looked correct on reading (api/payments/webhook.ts, supabase/payments_checkout.sql). Not executed.

## Verdict for this phase
NOT READY: nothing could be built or tested. Next, on a networked machine: `npm install`, then `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run ui:check && npm audit`, plus the CI database job locally or in GitHub.

## Addendum: scheduled jobs and expiry (Phases 15/16, static review only, nothing executed)
Files: api/checkout/[action].ts (reconcile, outbox), server/checkoutPayments.ts (cronAuthorised, reconcileExpired), vercel.json, supabase/checkout.sql.
- Auth: both cron routes require `Authorization: Bearer <CRON_SECRET>`; the secret must be at least 16 characters; comparison is constant-time (timingSafeEqual) on equal-length buffers; failures return 404, so the routes do not advertise themselves. This matches how Vercel cron sends its secret. No defect found.
- Duplicate runs: reconcile feeds Razorpay-captured payments through payment_apply_event with a synthetic, deterministic event id, so a second run (or a run racing the webhook) returns 'duplicate' rather than double-applying. If Razorpay cannot be reached the order is counted as "deferred" and is not expired, so a paid order is not released by mistake. Looks correct; needs the DB self-tests and a concurrency run to prove.
- Daily schedule effect on stock: unpaid orders hold stock until pay_by passes. The nightly sweep alone could leave that stock held for hours, but placing any new order first runs reconcileExpired(limit 5), which releases expired holds before reserving. Residual risk (Low, suspected): product pages may show held stock as unavailable until the next order attempt or the nightly run. Also email outbox: up to ~24 h delay on Hobby. Mitigation options: Vercel Pro (more frequent crons) or an external scheduler calling both URLs with the Bearer secret every 5-15 minutes. Needs owner decision and the actual plan.
- Retries and logging: outbox job has retries (per earlier review); handlers log only error names/messages, no personal data. 
No code changed in this addendum.

## Addendum 2: admin API authorization, static review (nothing executed, no code changed)
Files: api/admin/[action].ts, server/admin/{ctx,backoffice,extras,payments,refunds,shipments}.ts, server/session.ts, shared/admin.ts.
- Order of checks in the handler: config present -> non-GET requests need same-origin + `x-kaayra-admin: 1` header -> login/logout -> valid signed session whose email is STILL on the admin allowlist (re-checked every request, so removing an address revokes access) -> two-step (MFA) state; if `ADMIN_MFA=required` and the MFA table is unreachable the API answers 503 rather than letting anyone through -> hard gate `state !== 'ok'` returns 401 before any data action -> per-action permission via `need(ctx, '<permission>')`.
- Per-action permissions: every data action in api/admin/[action].ts (subscribers, messages, issues, products, product-image, export) calls need() with a specific permission (read / update / delete / create / price / status / export). Product publication fields additionally require products.status; setting a price requires products.price. need() records a `permission_denied` audit entry and returns 403. Handler modules call need() 22 (backoffice), 4 (extras), 3 (payments), 3 (refunds), 7 (shipments) times. I did not map each action to its permission one by one in those modules; that is the remaining work for this item.
- Session cookie: HttpOnly, SameSite=Strict, Secure on secure deployments.
- Admin search is sanitised to [A-Za-z0-9@._+- ] and 80 chars before it is placed in a PostgREST `or=(...)` filter, so commas, parentheses and wildcards cannot alter the filter. CSV export neutralises formula injection.
- Not found: any admin data route reachable without the session, MFA gate, or a permission check. Not proven: this is a code reading. Needs the admin-api tests to be run and a manual attempt with a lower role and with a customer session.
