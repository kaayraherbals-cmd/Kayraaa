> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Phase 4 handoff (session s4a, continued)

Evidence rule: "Verified" means a command was run and passed in this sandbox. The sandbox has **no network**, so `npm ci`, lint, typecheck, vitest, build, prerender, Lighthouse, Supabase and Resend could not be run. Nothing below is production-ready until those run.

## Status by section

| Section | Status | Evidence |
|---|---|---|
| 1 Audit | Done | `docs/PHASE4_AUDIT.md` (read-only; findings 1, 3, 4 since fixed) |
| 2 Build and tests | **Not run** | Needs network. See "Run first" below |
| 3 Database | Documented, **not executed** | `docs/DATABASE_MIGRATIONS.md` (order derived from the SQL) |
| 4 Auth and admin | Partly fixed | No default owner (tested earlier, 37 admin API tests on a stand-in runner). MFA, session, CSRF, rate limiting not re-tested |
| 5 Email | Double opt-in and unsubscribe built | 25 subscribe tests passed on a stand-in runner with fake database and mail. SPF, DKIM, DMARC and live delivery unverified |
| 6 Brand system | Done in code | Palette overrides removed; `shared/brand.test.ts` (4 passed on a stand-in runner); contrast computed in `docs/DESIGN_SYSTEM.md`; logo slots in `src/content/brand.ts`, all empty |
| 7 Homepage | Already had the sections; Instagram section no longer looks empty | Not rendered in a browser this session |
| 8 Photography | Responsive picture support added | `ResponsiveImage.tsx` syntax-checked with `tsc`; no photographs supplied so nothing is rendered |
| 9 Instagram | Link-out section kept; no embed, no scraping, CSP unchanged | Grid appears when 3 or 4 approved photos are added to `instagramPhotos` |
| 10 Packaging | Women's wellness variants (labels and containers) generated from the master files | `scripts/packaging-variants.test.ts` (2 passed on a stand-in runner). Hex values proposed, need approval; 6 files covered |
| 11 Customer journey | Done in code | Account block moved below the launch sign-up and reworded as optional (it promised ordering, which is not available); hero gains a "Join launch notifications" link. Not browser-tested |
| 12 Admin UX | Reviewed only, no code change | Members and Audit pages already show loading, empty and error states (read in code). Tablet and phone layout, and the other pages, not tested in a browser |
| 13 Commerce safety | Unchanged, `COMMERCE_ENABLED` stays false | Existing test asserts it |
| 14 SEO and accessibility | Not re-verified | Prerender, sitemap and axe need a real build |
| 15 Performance | Not measured | No Lighthouse run |

## Run first (with network)

```
nvm use          # Node 20
npm install      # regenerates package-lock.json (font packages were changed in package.json only)
npm ci && npm run lint && npm run typecheck && npm test && npm run build
VERCEL_ENV=production VITE_SITE_URL=https://<your-domain> npm run build   # must refuse a placeholder domain
```

Expect to fix small things: front-end files were never type-checked against React types, and the stand-in runner is not Vitest.

## Environment variables

Public (build time): `VITE_SITE_URL` (real https domain, required for production builds), `VITE_CONTACT_EMAIL`, `VITE_CONTACT_PHONE`, `VITE_CONTACT_ADDRESS`, `VITE_LEGAL_ENTITY_NAME`, `VITE_INSTAGRAM_URL`.
Server only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`, `ADMIN_ROLES` (required: the admin refuses everyone without it), `ADMIN_SESSION_SECRET`, `ADMIN_MFA`, `ADMIN_MFA_KEY`, `ALLOWED_ORIGINS`, `SITE_URL`, `OAUTH_PROVIDERS`, `MEMBER_SIGNUP`, `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_OWNER_TO`, `MAIL_REPLY_TO`, `MAIL_AUTOREPLY`, `SUBSCRIBE_TOKEN_SECRET`.
Leave unset in staging and until sales are approved: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

## Remaining business requirements (cannot be invented)

Production domain; contact email, phone and registered address; approved logo vectors (horizontal, stacked, K icon, each light, dark, mono); real photography and 3 or 4 approved Instagram photos; approval of the women's wellness colours; manufacturer and licence details; regulatory sign-off for packaging and claims; owner, manager and support emails for `ADMIN_ROLES`; trademark clearance.

## Known limitations

Rate limiting is per serverless instance (add Vercel Firewall rules). Product pages are client-rendered and noindex. Hero uses an illustration until a photograph exists. Instagram section links out only. Admin pages were reviewed in code only.

## Phase 5 readiness

- [ ] Real install, lint, typecheck, vitest and build all pass
- [ ] Migrations applied on staging in the documented order; three self-tests pass; RLS checked with the anon key
- [ ] Resend domain verified (SPF, DKIM, DMARC); double opt-in tested end to end with a real inbox
- [ ] Unauthorised-access test of every admin endpoint on staging
- [ ] Browser test at phone, tablet and desktop widths; keyboard pass; axe; Lighthouse
- [ ] Logos, photographs and contact details supplied
- [ ] Commerce still off
