> **Notice (V5 Phase 2):** this file records a run from an earlier session. It is not evidence for the Phase 2 package: an independent
> audit found `package-lock.json` inconsistent with `package.json`. In Phase 2 the lockfile was regenerated and `npm ci`, lint, typecheck,
> tests and build were re-run and passed (see section 0 of `docs/INDEPENDENT_TESTING.md`). The Playwright UI results below were NOT
> re-run and remain unverified for this package. See `docs/INDEPENDENT_TESTING.md`. Original text kept unchanged below.

# Test results (executed, not assumed)
Date: 2026-10-21. 
- npm ci: ok. npm run lint: ok (0 problems). npm run typecheck: ok. npm test: 49 files, 646 tests passed. npm run build: ok (prerender used placeholder VITE_SITE_URL).
- Responsive check (scripts/ui-check.py, Chromium; serves dist/ like vercel.json; API stubbed): 12 pages x 360/390/768/1024/1440px = 60 page checks, 0 issues (no horizontal overflow, console or hydration errors, missing alt text, wrong h1 count); 17 interaction checks passed (mobile menu + Escape/focus return, search dialog, filters, PIN check ok/not serviceable, sticky buy bar, add to bag, reduced motion).
- Found and fixed during checks: /checkout was missing from shared/private-routes.json (no page would be served on Vercel); AdminProducts.tsx in the upload did not compile; stale tests (old palette, "no price on cards") rewritten.
- Not tested: live Supabase, Razorpay payment, emails, real catalogue copy and prices.
