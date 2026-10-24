# Phase 12 Stage 7B to 7E(part 1) handoff (read first; applied on the v9 tree)
- 7E part 1 DONE (unrun): owner bundle screen (`server/admin/bundles.ts`, `src/pages/AdminBundles.tsx`, owner-only `bundles.*` permissions), `bundle_admin_list` in `stage7_commerce.sql`, public read-only `/bundles` page + `GET /api/cart/bundles`. NOT DONE: customers ordering bundles (cart lines, quote, checkout UI, API passing bundle ids to `checkout_place_full`). Add an admin API test modelled on `server/admin/coupons.test.ts`.
- 7D DONE (unrun): wishlists. API actions inside `api/cart/[action].ts` (project is at the 12-function limit), `server/wishlist.ts`, `shared/wishlist.ts(+test)`, `src/lib/wishlist*.ts`, `WishlistButton`, `/wishlist` page, account-menu link. See the 7D section of `docs/PHASE12_STAGE7_CHANGELOG.md`. Still to write: a mocked API test for the four actions (copy the pattern in `server/api-tests/cart.test.ts`).
- DONE, NEVER RUN (no PostgreSQL, no network, partial node_modules): `supabase/stage7_commerce.sql` + `stage7_selftest.sql` (file 31; `ai.sql` stays file 30), `shared/money.ts` (+test, run only under a home-made shim), self-test edits, `docs/PHASE12_STAGE7_*.md`.
- 7C DONE (also unrun except a syntax parse): optional `loyaltyPoints` on the place request (`shared/checkout.ts`), included in the request fingerprint, new error messages (`shared/inventory.ts`), `server/checkout.ts` calls `checkout_place_full` ONLY when points > 0 (otherwise the original `checkout_place` path and its tests are untouched), `api/checkout` passes the points. Not done: bundle lines in the cart, quote preview of points, any UI, shipping re-check for plain orders (only in `checkout_place_full`).
- RUN FIRST: `PGDATABASE=kh_verify_s7 bash scripts/db-verify.sh` (add `ai` and `ai_selftest` yourself if you want them in that run), then `npm ci && npm run lint && npm run typecheck && npm test && npm run build`. Expect fixes.
- NEXT: 7D wishlists, 7E bundles UI + cart lines, 7F loyalty wallet/owner screens, 7G finance + Razorpay-dashboard refunds, 7H reports. Owner decisions: `docs/PHASE12_STAGE7_REMAINING_ISSUES.md`.

# Founder portraits (v9)
- DONE: portraits for Nitesh (left), Ritika (middle), Anuj (right) cropped from the supplied group photo into `public/images/founders/*-{320,640}.{jpg,webp}`; `photo` added per founder in `shared/founders.json`; `FounderCards.tsx` shows a large 4:5 portrait at the top of each card (round initials avatar stays as the fallback for anyone without a photo); styles appended to `src/styles/home.css`; Person structured data in `scripts/prerender.mjs` now includes `image`. Nitesh's Instagram is now `nitesh__jaiswal12` (two underscores, as supplied).
- NOTE: the source photo carries a Gemini sparkle mark (cropped out) and looks AI-generated; replace with real photographs when available (swap the files, same names). Not run: build, tests, full-site browser check.

# Instagram update (v8)
- DONE: Instagram changed to @kaayra.herbals (link `https://www.instagram.com/kaayra.herbals?srtk=MXc4aXA3YmsycWRldg==`, structured data uses the clean profile URL). New `src/components/InstagramPreview.tsx` on the homepage (card always visible; Instagram's live post grid loads only on tap). `vercel.json` general CSP gained `frame-src https://www.instagram.com` (checkout policy untouched). Privacy page wording updated. Test in `shared/content-safety.test.ts` updated.
- WATCH: if `VITE_INSTAGRAM_URL` is set in Vercel to the old account, it overrides the new default: clear it. Not run: build, tests, browser, the live Instagram embed (no network).

# Merge handoff: v6 + phase 13 Gemini AI (read first)
- DONE: merged `kaayra-herbals-v5-phase13-gemini-ai` into `kaayra-herbals-v6-menu-fix` (v6 is the base: SEO, founders, favicon, admin fix, menu fix kept). Added: Kaayra AI widget (`src/components/KaayraAI.tsx`, mounted in Layout), Kaayra Intelligence admin tab, `server/ai/*`, `server/admin/ai.ts`, `server/analyticsService.ts` (extras.ts now uses it), `shared/ai*.ts`, `supabase/ai.sql`, `@google/genai`, `functions.maxDuration` in vercel.json, AI env block. See `docs/PHASE13_GEMINI_AI.md`.
- AI ships OFF. Run `supabase/ai.sql` (file #30, after finance.sql) before enabling; set `AI_ENABLED` and `GEMINI_API_KEY` (server-only).
- NOT DONE: `npm ci`, typecheck, tests, build and browser check of the merged tree (no network). Run `npm ci && npm run lint && npm run typecheck && npm test && npm run build` first; the CSP hash in vercel.json is checked by the build.

# SEO audit handoff (read first)
- DONE: see `docs/SEO_AUDIT_FIXES.md` (code fixes + what only you can do: primary-domain redirect, SPF/DMARC DNS, social profiles, backlinks).
- WATCH: if `public/boot.js` changes, the build tells you the new hash for `vercel.json`. Update the FAQ "for sale" answer when selling starts.

# Admin smoothness handoff (read first)
- DONE: root cause of admin lag found and fixed. `useMe()` returned a new object on every render; Shipment detail and Team screens list `me` in effect dependencies, so they refetched on every render in a loop. It is now memoised (`src/lib/adminKit.tsx`). Also: the overview no longer refetches when you leave it (`useHome`), and tab list, groups and "waiting" counts are memoised so the header tools (already `memo`) stop re-rendering on every change. Test added in `src/lib/adminKit.test.ts`.
- NOT DONE: run `npm ci && npm test` and open /admin (Shipments detail, Team) to confirm the request loop is gone in the Network tab; no browser check was possible here. No other lag source was found by reading the code; if a specific screen still feels slow, tell me which one.

# SEO + premium founders handoff (read first)
- DONE: premium founder cards (monogram ring, gold rule, qualification chips, mail/Instagram rows); founders data now in `shared/founders.json` (one source for site + structured data); new indexable `/founders` page in routes.json, menu, footer, Home; Story page links to it; Person/BreadcrumbList structured data in `scripts/prerender.mjs`; tests in `shared/seo.test.ts`, check in `scripts/seo-check.mjs`; `docs/SEO_LAUNCH_GUIDE.md` (Search Console steps only the owner can do).
- NOT DONE: install/typecheck/tests/build/browser check (no network; only syntax-checked); founder photos/bios.

# Menu + Founders handoff (read first)
- DONE: mobile menu now has a visible "Close" button inside the sheet (the sheet used to cover the header toggle while the announcement bar was showing); Escape and the toggle still work. Founders added on Home, menu and footer (now linking to /founders).
- NOT DONE: founder photos and bios (add to founders.ts; cards show initials until then), role wording beyond "Founder" (none supplied), npm ci / typecheck / tests / browser check (no network here).

# Phase 12 handoff (read first)
- DONE (Stages 1-2): audit, Phase 8 archive merged, DB verification script, cart_recovery self-test fixture fixed. See `docs/PHASE12_*.md`.
- NEXT: Stage 3 checkout consistency, then bundles/wishlists, loyalty, security, final reports.

# Phase 8 handoff (read first)
- DONE: Business Intelligence (owner only): revenue, profit engine, product costs (append-only history), expenses, product profitability, inventory valuation, refund/customer analytics, forecast, KPI targets, CSV exports, read-only service for a future owner AI. See `docs/PHASE8_FINANCE.md` (definitions, security, limits).
- BASELINE: the Phase 7 ZIP named in the brief was not supplied. Built on the Phase 12 audit ZIP. Phase 12 itself was not touched.
- RUN FIRST: `supabase/finance.sql` then `finance_selftest.sql` on STAGING. Then enter product costs (Business Intelligence > Product costs); until then profit says "Profit unavailable: cost data incomplete."
- NOT DONE: screens for entering payment fees and carrier costs (API actions exist), settlement/carrier import, seasonal forecast, browser/visual check of the new screens.
- KNOWN, NOT MINE: `cart_recovery_selftest.sql` fails on a clean PG16 without finance.sql (attribution check, line 138). See `test-results/PHASE8_RESULTS.md`.

# Admin V8 handoff (read first)
- DONE: Analytics group in the admin (Reports, Sales, Stock health) built from real orders, order items, PIN-code states and stock batches. See `docs/V8_ADMIN_ANALYTICS.md`.
- RUN FIRST on your side: open /admin with real data and check the numbers against a few real orders; `supabase/delivery_areas.sql` must be applied for the by-state list to have names.
- NOT DONE (no data or out of scope): sales-goal gauge, stock in/out history chart, Catalog gallery, Activity/Alerts overview tabs.

# Phase 10 Step 1 handoff (read first)
- ALSO DONE: signed-in customers join the launch list in one click (no email/name fields; consent tick; confirmed at once; one "you have joined" email). `api/subscribe.ts` action `join_member`, `src/components/SignupForm.tsx`, run `supabase/launch_optin_member.sql` first. 8 new API tests. Browser not checked.
- DONE: bundles, gift sets, wishlists, related products, frequently bought together, analytics as database core + `shared/bundles.ts`. See `docs/PHASE10_BUNDLES_WISHLISTS.md` (decisions, limits, verification).
- BASELINE WARNING: the ZIP received was Phase 9 Step 1 on the Phase 7 base. No Phase 8, no loyalty checkout wiring. Apply on top of a later ZIP if you have one.
- NOT DONE: API routes, cart/checkout wiring, Razorpay amount path, UI (hearts, wishlist page, bundle cards, owner tab), loyalty/coupon rules for bundles, Phase 8 hookup, component costs.
- Run `supabase/bundles_wishlists.sql` then `bundles_wishlists_selftest.sql` on STAGING first.

# Phase 9 Step 1 handoff (read first)
- DONE: loyalty database core + arithmetic; see `docs/PHASE9_LOYALTY.md` (decisions, limits, verification table).
- BASELINE WARNING: built on the Phase 7 ZIP. Phase 8 is missing; if you have it, apply Phase 9 on top of it instead of this ZIP.
- NEXT: checkout wiring (`orders.loyalty_discount_paise`, Razorpay amount), customer API + wallet, owner admin section, scheduler for `loyalty_activate_due` / `loyalty_expire_due`, e-mails, analytics wrappers, Phase 8 integration.
- Run `supabase/loyalty.sql` then `loyalty_selftest.sql` on STAGING first.

# Phase 7 handoff (read first)
- DONE: abandoned cart recovery (ships OFF). See `docs/PHASE7_CART_RECOVERY.md` and `test-results/PHASE7_RESULTS.md`.
- FIRST on a networked machine: `npm ci && npm run lint && npm run typecheck && npm test && npm run build`; run `supabase/cart_recovery.sql` then `cart_recovery_selftest.sql` on STAGING (neither was run).
- No Gemini owner AI exists in any ZIP; nothing added there.

# Phase 5 (coupons) handoff, read first
- DONE: coupons, redemption safety, cart/checkout/Razorpay integration, refund basis, admin screen, analytics. See `docs/COUPONS.md`, `docs/CHANGELOG_PHASE5_COUPONS.md`, `test-results/PHASE5_RESULTS.md`.
- Next on your side: run `supabase/coupons.sql` on staging, Razorpay test-mode discounted order, visual check. Gemini owner AI was not in the ZIP.

# Phase 7 Step 3 handoff (read first)
- DONE: COMMERCE_ENABLED=true plus separate production live-sales gate; tests rewritten (UNRUN); docs/PHASE7_STEP3_*.md.
- ALSO DONE (continue session): customer tracking API (api/orders), TrackOrder page and routes, shared/tracking + tests (unrun); API tests in server/api-tests/orders.test.ts (unrun).
- ALSO: test/live key-mode guard, issue register docs/PHASE7_STEP3_ISSUES.md. Network still blocked (npm ci installs nothing).
- ALSO: tracking page styled (src/track.css), Account links to it. Network still blocked.
- NOT DONE: baseline run, DB verification, Razorpay/email verification, scheduler, admin shipment dashboard/form UI, styling of tracking page, UI redesign, responsive/a11y, screenshots.
- Next: run `npm ci && npm run lint && npm run typecheck && npm test && npm run build`, fix failures, then continue with sections 3-9 of the brief.

# Handoff (Kaayra Herbals, phase 7 step 3)

## State
- `COMMERCE_ENABLED = true` (owner decision); production purchases need the separate live-sales approval. See `docs/COMMERCE_STATE.md`.
- No stock / price / GST / HSN => the product shows unavailable and cannot be bought.
- Admin: status "Approved for sale" selectable (owner only), product manager restyled (search, filter, sticky save, cards), tables become cards on narrow screens (no sideways scroll).
- Public Products page: gallery grid with form filter chips.

## Still to do (owner)
1. Set Razorpay keys in Vercel (docs/RAZORPAY_SETUP.md). A live key is accepted now.
2. Add pack sizes with MRP, GST, HSN, then stock batches with expiry, for each product.
3. Run `npm test` and a build (not run in the authoring environment; node_modules were unavailable). Tests changed for the selling-on state were edited without being run, so fix any failures first.
4. Deploy to a Vercel preview, place one small test order, then go live.

## To close production selling
Remove `LIVE_SALES_APPROVED` in Vercel and redeploy. Do not set `COMMERCE_ENABLED` to false.

## Phase 7 status
See `docs/PHASE7_INITIAL_AUDIT.md`. First step on a networked machine: `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit`, then fix failures.

# Phase 12 Stage 7 handoff (read first)
- UPDATE: baseline now EXECUTED (npm ci, typecheck, lint, 1037 unit tests, 15 DB self-tests all pass; see audit addendum). Sandbox now has PG16 + npm network, so Stage 7B can be verified for real.
- NEXT: Step 7B (money columns, allocation, combined checkout function). Owner decisions still needed: loyalty debt policy, loyalty GST treatment, confirm earn/redeem values.

# Phase 12 Stage 7 handoff (read first)
- DONE: Step 7A, source audit: `docs/PHASE12_STAGE7_INITIAL_AUDIT.md` (classification, findings, 7B-7H plan).
- NOT DONE: everything else in the Stage 7 brief. No code or SQL for loyalty checkout, bundles, wishlists, finance or refunds exists yet.
- No PostgreSQL / node_modules / network in the authoring sandbox: nothing has been executed.
- OWNER DECISIONS NEEDED before activation: loyalty debt (negative balance) policy; loyalty tax (GST) treatment; confirm earn/redeem values.
- NEXT: say "Continue" for Step 7B (money columns, allocation, combined checkout function).

# Menu + founder roles handoff (read first)
- DONE: mobile menu redesigned (numbered links with one-line notes, arrow, gold-glow midnight sheet, solid/outline account buttons, tagline + Instagram footer; Close button, Escape, focus trap unchanged). Desktop nav: slightly wider letter-spacing, 2px rounded active underline. Files: `src/components/Layout.tsx`, `src/styles/layout.css`.
- DONE: roles in `shared/founders.json`: Nitesh Jaiswal = "Founder & CEO" (listed first); Ritika Jaiswal and Anuj Kumar = "Co-founder". Founders page intro, route description and Our Story sentence reworded to match. Schema.org `founder` still lists all three (co-founders are founders in markup).
- NOT DONE: `npm ci && npm run lint && npm run typecheck && npm test && npm run build` (no node_modules / network here) and a visual check at 360px and 1280px (`scripts/ui-check.py`). Please open the menu on a phone and tell me what to adjust.

# Admin smoothness handoff (read first)
- DONE: root cause of admin lag found and fixed. `useMe()` returned a new object on every render; Shipment detail and Team screens list `me` in effect dependencies, so they refetched on every render in a loop. It is now memoised (`src/lib/adminKit.tsx`). Also: the overview no longer refetches when you leave it (`useHome`), and tab list, groups and "waiting" counts are memoised so the header tools (already `memo`) stop re-rendering on every change. Test added in `src/lib/adminKit.test.ts`.
- NOT DONE: run `npm ci && npm test` and open /admin (Shipments detail, Team) to confirm the request loop is gone in the Network tab; no browser check was possible here. No other lag source was found by reading the code; if a specific screen still feels slow, tell me which one.

# SEO + premium founders handoff (read first)
- DONE: premium founder cards (monogram ring, gold rule, qualification chips, mail/Instagram rows); founders data now in `shared/founders.json` (one source for site + structured data); new indexable `/founders` page in routes.json, menu, footer, Home; Story page links to it; Person/BreadcrumbList structured data in `scripts/prerender.mjs`; tests in `shared/seo.test.ts`, check in `scripts/seo-check.mjs`; `docs/SEO_LAUNCH_GUIDE.md` (Search Console steps only the owner can do).
- NOT DONE: install/typecheck/tests/build/browser check (no network; only syntax-checked); founder photos/bios.

# Menu + Founders handoff (read first)
- DONE: mobile menu now has a visible "Close" button inside the sheet (the sheet used to cover the header toggle while the announcement bar was showing); Escape and the toggle still work. Founders added on Home, menu and footer (now linking to /founders).
- NOT DONE: founder photos and bios (add to founders.ts; cards show initials until then), role wording beyond "Founder" (none supplied), npm ci / typecheck / tests / browser check (no network here).

# Phase 12 handoff (read first)
- DONE (Stages 1-2): audit, Phase 8 archive merged, DB verification script, cart_recovery self-test fixture fixed. See `docs/PHASE12_*.md`.
- NEXT: Stage 3 checkout consistency, then bundles/wishlists, loyalty, security, final reports.

# Phase 8 handoff (read first)
- DONE: Business Intelligence (owner only): revenue, profit engine, product costs (append-only history), expenses, product profitability, inventory valuation, refund/customer analytics, forecast, KPI targets, CSV exports, read-only service for a future owner AI. See `docs/PHASE8_FINANCE.md` (definitions, security, limits).
- BASELINE: the Phase 7 ZIP named in the brief was not supplied. Built on the Phase 12 audit ZIP. Phase 12 itself was not touched.
- RUN FIRST: `supabase/finance.sql` then `finance_selftest.sql` on STAGING. Then enter product costs (Business Intelligence > Product costs); until then profit says "Profit unavailable: cost data incomplete."
- NOT DONE: screens for entering payment fees and carrier costs (API actions exist), settlement/carrier import, seasonal forecast, browser/visual check of the new screens.
- KNOWN, NOT MINE: `cart_recovery_selftest.sql` fails on a clean PG16 without finance.sql (attribution check, line 138). See `test-results/PHASE8_RESULTS.md`.

# Admin V8 handoff (read first)
- DONE: Analytics group in the admin (Reports, Sales, Stock health) built from real orders, order items, PIN-code states and stock batches. See `docs/V8_ADMIN_ANALYTICS.md`.
- RUN FIRST on your side: open /admin with real data and check the numbers against a few real orders; `supabase/delivery_areas.sql` must be applied for the by-state list to have names.
- NOT DONE (no data or out of scope): sales-goal gauge, stock in/out history chart, Catalog gallery, Activity/Alerts overview tabs.

# Phase 10 Step 1 handoff (read first)
- ALSO DONE: signed-in customers join the launch list in one click (no email/name fields; consent tick; confirmed at once; one "you have joined" email). `api/subscribe.ts` action `join_member`, `src/components/SignupForm.tsx`, run `supabase/launch_optin_member.sql` first. 8 new API tests. Browser not checked.
- DONE: bundles, gift sets, wishlists, related products, frequently bought together, analytics as database core + `shared/bundles.ts`. See `docs/PHASE10_BUNDLES_WISHLISTS.md` (decisions, limits, verification).
- BASELINE WARNING: the ZIP received was Phase 9 Step 1 on the Phase 7 base. No Phase 8, no loyalty checkout wiring. Apply on top of a later ZIP if you have one.
- NOT DONE: API routes, cart/checkout wiring, Razorpay amount path, UI (hearts, wishlist page, bundle cards, owner tab), loyalty/coupon rules for bundles, Phase 8 hookup, component costs.
- Run `supabase/bundles_wishlists.sql` then `bundles_wishlists_selftest.sql` on STAGING first.

# Phase 9 Step 1 handoff (read first)
- DONE: loyalty database core + arithmetic; see `docs/PHASE9_LOYALTY.md` (decisions, limits, verification table).
- BASELINE WARNING: built on the Phase 7 ZIP. Phase 8 is missing; if you have it, apply Phase 9 on top of it instead of this ZIP.
- NEXT: checkout wiring (`orders.loyalty_discount_paise`, Razorpay amount), customer API + wallet, owner admin section, scheduler for `loyalty_activate_due` / `loyalty_expire_due`, e-mails, analytics wrappers, Phase 8 integration.
- Run `supabase/loyalty.sql` then `loyalty_selftest.sql` on STAGING first.

# Phase 7 handoff (read first)
- DONE: abandoned cart recovery (ships OFF). See `docs/PHASE7_CART_RECOVERY.md` and `test-results/PHASE7_RESULTS.md`.
- FIRST on a networked machine: `npm ci && npm run lint && npm run typecheck && npm test && npm run build`; run `supabase/cart_recovery.sql` then `cart_recovery_selftest.sql` on STAGING (neither was run).
- No Gemini owner AI exists in any ZIP; nothing added there.

# Phase 5 (coupons) handoff, read first
- DONE: coupons, redemption safety, cart/checkout/Razorpay integration, refund basis, admin screen, analytics. See `docs/COUPONS.md`, `docs/CHANGELOG_PHASE5_COUPONS.md`, `test-results/PHASE5_RESULTS.md`.
- Next on your side: run `supabase/coupons.sql` on staging, Razorpay test-mode discounted order, visual check. Gemini owner AI was not in the ZIP.

# Phase 7 Step 3 handoff (read first)
- DONE: COMMERCE_ENABLED=true plus separate production live-sales gate; tests rewritten (UNRUN); docs/PHASE7_STEP3_*.md.
- ALSO DONE (continue session): customer tracking API (api/orders), TrackOrder page and routes, shared/tracking + tests (unrun); API tests in server/api-tests/orders.test.ts (unrun).
- ALSO: test/live key-mode guard, issue register docs/PHASE7_STEP3_ISSUES.md. Network still blocked (npm ci installs nothing).
- ALSO: tracking page styled (src/track.css), Account links to it. Network still blocked.
- NOT DONE: baseline run, DB verification, Razorpay/email verification, scheduler, admin shipment dashboard/form UI, styling of tracking page, UI redesign, responsive/a11y, screenshots.
- Next: run `npm ci && npm run lint && npm run typecheck && npm test && npm run build`, fix failures, then continue with sections 3-9 of the brief.

# Handoff (Kaayra Herbals, phase 7 step 3)

## State
- `COMMERCE_ENABLED = true` (owner decision); production purchases need the separate live-sales approval. See `docs/COMMERCE_STATE.md`.
- No stock / price / GST / HSN => the product shows unavailable and cannot be bought.
- Admin: status "Approved for sale" selectable (owner only), product manager restyled (search, filter, sticky save, cards), tables become cards on narrow screens (no sideways scroll).
- Public Products page: gallery grid with form filter chips.

## Still to do (owner)
1. Set Razorpay keys in Vercel (docs/RAZORPAY_SETUP.md). A live key is accepted now.
2. Add pack sizes with MRP, GST, HSN, then stock batches with expiry, for each product.
3. Run `npm test` and a build (not run in the authoring environment; node_modules were unavailable). Tests changed for the selling-on state were edited without being run, so fix any failures first.
4. Deploy to a Vercel preview, place one small test order, then go live.

## To close production selling
Remove `LIVE_SALES_APPROVED` in Vercel and redeploy. Do not set `COMMERCE_ENABLED` to false.

## Phase 7 status
See `docs/PHASE7_INITIAL_AUDIT.md`. First step on a networked machine: `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit`, then fix failures.
