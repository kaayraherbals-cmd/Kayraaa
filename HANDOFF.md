# Whole-site languages v8 handoff (read first; applied on kaayra-herbals-v7-gstin)
- DONE: every public page, product, ingredient, journal, legal and form text is translated at run time into the chosen language; details in `docs/LANGUAGES.md` ("Whole-site translation"). Logo alt localised, footer note added, admin stays English.
- RAN: `shared/translate.test.ts` and `server/translate.test.ts` (17 pass, Node harness), all 13 dictionaries have every key with matching placeholders, Chromium test of `pageTranslator.ts` (text, attributes, spacing, React-style updates, new nodes, skip rules, restore). NOT RUN: npm ci, typecheck, lint, Vitest, build, real Gemini translations.
- RUN FIRST: `npm ci && npm run typecheck && npm run lint && npm test && VITE_SITE_URL=https://kaayraherbals.com npm run build`. Then set `AI_ENABLED=on` and `GEMINI_API_KEY`, open the site, choose a language, and read the legal and product pages.
- ADDED after first delivery: whole-sentence translation with inline tags (`parseRun` in shared/translate.ts, `collectRun` in pageTranslator.ts), Chromium-checked (reorder, link kept, bad tags fall back, no loop, restore).
- OPEN: native-speaker review of legal/medical/product pages; consider `TRANSLATE_MAX_PER_DAY` once traffic is known.

# Merge handoff: admin-ui-v9-logo + languages + admin-ui-v10-ci-fix2 (read first)
- DONE: base = `v10-ci-fix2` (it already contains everything in `v9-logo`, with the later logo rework + CI fixes, so the v9 logo files are dropped: `ci` wins). Overlaid the whole `languages` tree on it: `src/i18n/*`, `shared/languages.ts`, `shared/aiLanguage.ts`, `LanguageSwitcher`, `i18n.css`, `lang-names.css`, `public/fonts/lang`, Noto font deps (`package.json` + lockfile), `/fonts/lang` cache header in `vercel.json`, Kaayra AI language support (`server/ai/*`, `shared/ai.ts`), translated `AccountMenu`, `SearchOverlay`, `CartBadge`, `CartDrawer`, `docs/LANGUAGES.md`.
- HAND-MERGED (both sides edited): `Layout.tsx` (translated strings + remembered bag state/announce bar + new logos), `KaayraAI.tsx` (translated + remembered on/off, request starts at once), `aiApi.ts` (shared 20 s config + `language` and error `kind`), `main.tsx` (I18nProvider + `warmSiteState`).
- RAN: seo:schema 22/22; every `t('key')` used exists in `en.ts`; all 13 dictionaries have every key with matching `{placeholders}`. NOT RUN: npm ci (registry unreachable), tsc, ESLint, Vitest, build, seo:check, browser.
- RUN FIRST: `npm ci && npm run typecheck && npm run lint && npm test && VITE_SITE_URL=https://kaayraherbals.com npm run build && VITE_SITE_URL=https://kaayraherbals.com npm run seo:check`. Then look at the header at 320 to 390 px: the globe button was added next to search/account/bag while the logo collapses to the K mark below 22.49rem; not checked visually.
- OPEN: the languages tree's own HANDOFF had no entry for languages; see `docs/LANGUAGES.md` (native-speaker review before launch).

# Logo integration handoff (read first)
- DONE: supplied logo wired everywhere (see `docs/LOGO_INTEGRATION.md`); Organization.logo in structured data; favicons/og-image rebuilt by `scripts/brand-logo.py`.
- RUN: seo:schema 22/22, Chromium mock. NOT RUN: npm ci, typecheck, lint, Vitest, build, seo:check. Run `npm ci && npm run typecheck && npm run lint && npm test && VITE_SITE_URL=https://kaayraherbals.com npm run build && npm run seo:check`.
- OPEN: owner to approve derived horizontal/dark/mono versions; old public/brand/kaayra-k-logo-source.png (gold K) is unused.

# Admin UI V9 handoff (read first)
- DONE: top-bar search renamed `.admin-topsearch` (it clashed with every screen's `.field.admin-search`); phone header + labelled bottom bar; dark `--forest`; order/product/stock row layouts; table cards; tab changes use a transition; products/stock paint from cache; order details mount on open; session skeleton. All in `src/admin-premium.css` (end of file), `src/pages/Admin*.tsx`, `src/lib/adminKit.tsx`.
- CHECKED: Chromium with a stubbed API at 390/768/1440, light and dark. NOT RUN: real phone, live API.

# Ritika education line handoff (read first)
- DONE: `institution` ("Dr. A. P. J. Abdul Kalam Technical University") added to Ritika in `shared/founders.json` (qualification stays `B.Pharm (Modern)`). Shown under her qualification on the Founders page (`FounderCards.tsx`, `.founder-institution`) and in the home showcase (`FoundersShowcase.tsx`, `.fx-institution`). Card only: the existing guards (`seo-check.mjs`, `structured-data.check.mjs`, `shared/seo.test.ts`) now also fail if an institution leaks into structured data or llms files.
- RAN: Chromium render of both layouts with the real CSS. NOT RUN: tsc, ESLint, Vitest, seo:schema, build.

# Home flash / Kaayra AI button fix handoff (read first; applied on the v4 indexing-fix tree)
- DONE: reloads no longer show the pre-launch hero then swap; the announcement bar and the "Ask Kaayra AI" button are right in the first frame on repeat visits. Remembered state in `src/lib/siteHints.ts`; details, causes, what was checked and what was NOT run: `docs/HOME_FLASH_FIX_2026-10-29.md`.
- RAN: siteHints logic (Node, 5 checks), hero markup in Chromium (layout measured). NOT RUN: npm ci, tsc, ESLint, Vitest, real build, real device.
- RUN FIRST: `npm ci && npm run typecheck && npm run lint && npm test && VITE_SITE_URL=https://kaayraherbals.com npm run build`.

# Women's line pink theme (read first)
- DONE: `src/styles/womens.css` (imported last in `src/main.tsx`) gives themed products a baby-pink, rose-gold card and product page. Which products: `src/content/themes.ts` (`pcos-syrup`, `pcos-cap`, `leucorrhoea-syp`); add a slug there to theme another product. Colour only: no text, claims, prices or images added. Palette is PROPOSED and needs brand approval.
- CHECKED: rendered a static mock of the card and product page in Chromium (desktop and phone widths) using the real CSS files. NOT RUN: the real app, real product photos on the pink background, typecheck/lint/tests/build.

# SEO / AEO / GEO pass handoff (read first; applied on geo-gemini-merged-v2)
- DONE: see `docs/SEO_AEO_GEO_AUDIT_2026-10-26.md` (findings, changes, test table, founder inputs, deployment and post-deployment checklists).
- RAN: indexnow:test 14/14, seo:schema 20/20, prerender + seo-check (stand-in renderer), lockfile. NOT RUN: npm ci, tsc, ESLint, Vitest, real build, browser, GitHub Actions.
- RUN FIRST: `npm ci && npm run typecheck && npm run lint && npm test && VITE_SITE_URL=https://kaayraherbals.com npm run build && VITE_SITE_URL=https://kaayraherbals.com npm run seo:check && npm run seo:schema && npm run indexnow:test`. Expect at most small type/lint fixes in JournalArticle, Ingredients, Founders, FounderCards.
- OPEN (needs founders): real authors/reviewers, founder experience and profiles, ingredient safety notes for 8 plants, review of the two new articles, "nothing for sale" wording once selling starts.

# Add-product flow (admin) handoff (read first)
- DONE and RUN (typecheck, lint, 1210 tests, build): after "Create draft" the new product is placed first in the list, opens by itself, scrolls into view and a confirmation line explains the next step; search/filter are cleared so it is never hidden; the photo description is pre-filled from the product name and the button explains why it is disabled if the description is too short. Only `src/pages/AdminProducts.tsx` changed. NOT run: a real browser check against Supabase.

# Merge handoff: GEO/polish/founders tree + Gemini-only AI (read first)
- DONE: merged `kaayra-herbals-gemini-only` into `kaayra-herbals-geo-phase4-1-merged-1` (the geo tree is the base: GEO structured data, Phase 4.1 FAQ, UI polish, new founder portraits, Anuj `B.Pharm (Ayurveda)` only, stage7 SQL `integer` fix). Taken from the Gemini-only tree: Gemini-only AI config (`AI_BACKUPS`), whole-site fallback and wider site context for the customer AI, 12 s customer deadline, Kaayra AI widget motion (typed reveal, fade-out, warm-up), admin AI wording, admin live photo check and auto-saved uploads, product image alt fallback, shorter product cache (15 s edge / 20 s browser), their AI tests.
- Left out on purpose: `src/styles/motion.css` (the older site-wide motion pass; the base's `polish.css` replaces it), the older menu/bag/layout/App/main changes, and the Gemini tree's founders.json (`BAMS (pursuing)`) and stage7 SQL (`bigint`).
- RAN on the merged tree: typecheck, lint, 1210 tests, build, seo:schema (all pass). Two fixes were needed after the merge: the Phase 4.1 FAQ test now uses the wider 8-section / 8,000-character limits, and a lint error in the new providers test. NOT RUN: real-device check, `seo:check` (needs `VITE_SITE_URL`), SQL.

# Phase 4.1 handoff (read first; applied on the UI-polish ZIP)
- DONE: FAQ restored to 11 (reconstructed from published text), AI knowledge regenerated (deterministic), `seo:schema` works without a Node flag (12/12), FAQ regression tests added. See `docs/PHASE4_1_*.md`.
- STATUS: merged with the verified Phase 4.1 files (verification was done on the pre-polish tree) plus the new founder portraits and Anuj's qualification (B.Pharm (Ayurveda) only). See the merge result in the delivery note.

# UI/UX polish handoff (read first; applied on the GEO Phase 4 tree)
- DONE and RUN (typecheck, lint, 1198 tests, build, seo:schema, ui:check, motion probe): new-page scroll jump fixed, bag/menu exit animations, one `.reveal` system, hover/press/focus polish, branded admin loader, checkout summary wrap, stale AI test. See `docs/UI_POLISH_PHASE4.md`.
- OPEN: real-device check; `seo:check` needs `VITE_SITE_URL`; earlier GEO items in the section below are unchanged.

# Phase 4 GEO handoff (read first; applied on the audit ZIP)
- DONE: JSON-LD moved to `scripts/structured-data.mjs` (stable @ids, one Organization, Person nodes for the three founders linked both ways, Article headline/date read from the page, Organization as author), brand facts read from `src/config/site.ts` via `scripts/brand-facts.mjs`, roles "Founder & CEO / Co-Founder / Co-Founder", llms files + AI knowledge updated (roles only, no qualifications), Instagram untouched (`kaayra.herbals`). See `docs/PHASE4_GEO_*.md`.
- RAN: `npm run seo:schema` (11/11), real prerender + seo-check against a stand-in renderer (OK), syntax checks. NOT RUN: npm ci, tsc, ESLint, Vitest, vite build, real seo:check (no network).
- RUN FIRST: `npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm run seo:check && npm run seo:schema`.
- OPEN: brief said 11 FAQ questions, the file has 8 (unchanged); portraits look AI-generated; see `docs/PHASE4_GEO_REMAINING_ISSUES.md`.

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
