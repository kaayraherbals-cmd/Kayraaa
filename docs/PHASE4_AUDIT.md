> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Phase 4, Section 1: repository audit

Method: read the code, SQL, config and docs in the repository. **Nothing was executed.** `npm ci`, lint, typecheck, tests, build and every database migration are Section 2 and 3 work and have not been run. "Confirmed" means the statement is visible in the code or docs I read. "Suspected" means it needs a run or a staging check to prove.

Severity: P0 release blocker, P1 high, P2 improvement, P3 future.

## 1. Architecture (confirmed)

- Vite + React 18 + React Router 6, TypeScript strict. Static prerender via `scripts/prerender.mjs` (SSR build, sitemap, robots, 404, JSON-LD). Admin, sign-in and product shells are client-rendered and noindex.
- Vercel serverless: `api/contact`, `subscribe`, `issues`, `products`, `media/[file]`, `auth/[action]`, `admin/[action]`, `payments/webhook`. Logic lives in `server/` and `shared/` (shared code is used by both browser and server).
- Supabase (service-role key, server only) with 17 SQL files in `supabase/`. Resend for site mail, Supabase SMTP for verification and recovery.
- Admin: HttpOnly, SameSite=Strict signed session cookie, allowlist (`ADMIN_EMAILS`), roles (`ADMIN_ROLES`), TOTP two-step with recovery codes, audit log, origin plus `X-Kaayra-CSRF` header check.
- Security headers and a strict CSP are set in `vercel.json` (`default-src 'self'`, `font-src 'self' data:`, `img-src 'self' data:`).
- `COMMERCE_ENABLED = false as const` in `shared/commerce.ts`, with a test asserting it, and server order and payment endpoints checking it.
- 24 test files exist (shared, server, admin API, payments webhook).

## 2. Implemented

Public pages (home, story, approach, collection, product detail, ingredients, quality, journal, legal, privacy, medical disclaimer, contact, report a problem), launch-list form, contact form, problem reports, member sign-up and sign-in (email + Google), set/forgot password, admin (products, inventory, orders, refunds, payments, members, security, audit), packaging SVG templates, Instagram grid component (hidden while empty), skip link.

## 3. Incomplete (confirmed)

- No logo files at all: `public/` has only `favicon.svg`, `og-image.png`, `boot.js`, `robots.txt`. The wordmark is text.
- Every photo slot in `src/content/images.ts` is `null`; `instagramPhotos` is empty, so the Instagram section only shows its fallback.
- Packaging has one palette (master brand). No women's wellness variant exists.
- No unsubscribe mechanism and no double opt-in anywhere (no "unsubscribe" string exists in the code or SQL).
- No single, ordered migration guide for the 17 SQL files (docs give partial orders in `README.md` lines 32 and 92 and `docs/VERCEL_SETUP.md` line 20).

## 4. Findings

| # | Sev | Status | Finding |
|---|---|---|---|
| 1 | P0 | Confirmed | `parseAdminRoles` (`shared/roles.ts` line 114): when `ADMIN_ROLES` is empty, **every** `ADMIN_EMAILS` address becomes `owner`. This is the exact behaviour the Phase 4 brief forbids. `.env.example` documents it as intended. |
| 2 | P0 | Confirmed (my change) | The font change edited `package.json` but not `package-lock.json`. `npm ci` fails when the two disagree, so the Section 2 command and any `npm ci` deploy will fail until the lock is regenerated with network access. The two new font packages are also not yet confirmed to install and bundle. |
| 3 | P0 | Confirmed | Marketing consent is single opt-in. `api/subscribe.ts` saves the address and immediately sends the welcome mail, with no confirmation click. There is no unsubscribe link or route and no withdrawal timestamp (`launch_subscribers` has `consented_at` only). The brief requires double opt-in, unsubscribe and accurate consent tracking. |
| 4 | P0 | Confirmed | Canonical, sitemap, robots and Open Graph fall back to the placeholder `https://kaayraherbals.example` when `VITE_SITE_URL` is unset. The build only warns. A production deploy could ship placeholder canonicals. (Docs elsewhere assume `kaayraherbals.com`, which is not confirmed as your domain.) |
| 5 | P1 | Confirmed | Rate limiting is per serverless instance (`server/http.ts` says so). It does not stop a distributed or multi-instance attack. Needs Vercel Firewall rules or a shared store. |
| 6 | P1 | Suspected | Admin MFA defaults to `required` but production-required settings (`ADMIN_SESSION_SECRET`, `ADMIN_MFA_KEY`, `SITE_URL`) fall back or warn in places. Needs a test that production refuses to start admin without them. |
| 7 | P1 | Suspected | RLS, stock reservation, duplicate payment protection, refunds and audit logging are covered by `*_selftest.sql` files, but none has been run against a database by me. |
| 8 | P1 | Suspected | Email: SPF, DKIM and DMARC are only mentioned in `docs/EMAIL_SETUP.md` (one line). Nothing verifies them. Delivery and provider-failure paths have unit tests but no live test. |
| 9 | P1 | Confirmed | The three business facts the site hides when blank (`VITE_CONTACT_EMAIL`, `VITE_CONTACT_PHONE`, `VITE_CONTACT_ADDRESS`, `VITE_LEGAL_ENTITY_NAME`) are unset. Legal and privacy pages cannot name a real data controller or contact. |
| 10 | P2 | Confirmed | Homepage has the Phase 4 sections in code (hero, philosophy, pillars, collection, ingredients, Kashi, journal, Instagram, launch signup) but also a "founding team" section and no real imagery. It is text and illustration only. |
| 11 | P2 | Confirmed | Packaging SVGs use Cormorant Garamond and Manrope (consistent with the site) but all are the master palette and zone-only concepts. No shared logo lockup because no logo exists. |
| 12 | P2 | Suspected | Accessibility: skip link and focus-visible styles exist (55 matches for skip, live regions, reduced motion and focus rules combined). Contrast, form labelling, keyboard order, heading order and zoom need a run to verify. WCAG 2.2 AA is not proven. |
| 13 | P2 | Suspected | Performance: admin is code-split (`lazy`). Font payload changed with this phase's font swap and has not been measured. Hero has no image, so LCP is text. No Lighthouse run. |
| 14 | P2 | Confirmed | `img-src 'self' data:` means remote images and Instagram embeds are blocked by CSP. That is correct for the brief (self-hosted photos only, no embeds), but any embed would need a deliberate CSP change. |
| 15 | P3 | n/a | Reviews, ratings, pricing and checkout are intentionally absent. Keep it that way until approved. |

## 5. Missing business information (cannot be invented)

Production domain, legal entity name as it should appear, contact email, phone and registered address, final approved logo vectors (horizontal, stacked, K icon, light, dark, monochrome), real photography, approved Instagram photos, manufacturer and licence details, regulatory reviewer sign-off for packaging and any product claim, the owner, manager and support email addresses for `ADMIN_ROLES`.

## 6. What was not verified

Everything that needs execution or a network: dependency install, lint, typecheck, tests, build, prerender output, migrations, self-tests, email delivery, Lighthouse, screen-reader and keyboard testing.

## 7. Proposed order

Section 2 starts by fixing finding 2 once the lock can be regenerated, then fixes findings 1, 3 and 4 in code (they are code changes, not configuration).

## 8. Update after the first code fixes

| Finding | Status |
|---|---|
| 1 Default owner | Fixed in code and tested. Needs `ADMIN_ROLES` set in Vercel or the admin will refuse everyone. |
| 2 Stale lock file | **Still open.** Needs `npm install` with network. |
| 3 Single opt-in | Fixed in code and tested with a fake database and fake mail provider. Not yet run against a real Supabase or real Resend. |
| 4 Placeholder domain | Fixed in the build script and tested (function only; a full `npm run build` has not been run). |
| New | `api/**` tests were excluded from `npm test` (`api/payments/webhook.test.ts` never ran). Now included. |

## Verification status

Run with a minimal stand-in test runner (not vitest, because dependencies cannot be installed offline), using `tsx`:
`api/subscribe.test.ts` 25, `shared/roles.test.ts` 11, `shared/mailTemplates.test.ts` 12, `shared/subscribe.test.ts` 4, `scripts/site-url-check.test.ts` 5, `server/admin/admin-api.test.ts` 37, `server/admin/payments.test.ts` 15, `api/payments/webhook.test.ts` 8: all passed.
Not run: the other test files, `npm ci`, lint, typecheck (no `@types` or React packages offline), build, prerender, any database, any real email.
Session continuation: `shared/brand.test.ts` (4) and `scripts/packaging-variants.test.ts` (2) passed on the same stand-in runner. See `docs/PHASE4_HANDOFF.md`.
