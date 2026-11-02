# Phase 4.1: test report

Environment: Linux sandbox with network access to the npm registry, Node v22.22.2, npm 10.9.7, clean `npm ci` from `package-lock.json`. `.nvmrc` is 22. Raw output for each command is in `docs/evidence/phase4_1/`.

| # | Command | Result |
|---|---|---|
| 1 | `npm ci` | success (265 packages; npm reports 17 vulnerabilities, not addressed here) |
| 2 | `npm run typecheck` | pass, exit 0 |
| 3 | `npm run lint` | pass, exit 0 |
| 4 | `npm test` | **87 files passed, 1 skipped; 1,209 tests passed, 1 skipped; 0 failed** |
| 5 | `npm run build` | pass, exit 0; "17 routes + 404 + admin and sign-in shells, sitemap and robots written" |
| 6 | `npm run seo:check` | pass: "17 public routes, 14 private shells, 17 sitemap URLs"; "FAQ: 11 visible, 11 in FAQPage JSON-LD, 11 in faq.json, identical" |
| 7 | `npm run seo:schema` | **14 passed, 0 failed** (11 original + 3 new) |

## Things that failed on the way, and what they were

- First `npm test` run: 1 failure (`customer.test.ts`, 900 vs 1,024 tokens). Reproduced on the untouched ZIP, so pre-existing. Stale test fixed; rerun fully green.
- First `seo:check` run: 24 findings. Cause: I built with the placeholder site URL while the checker validates the production domain. Rebuilt with `VITE_SITE_URL=https://kaayraherbals.com` (the same value the schema tests use); rerun green. These were not code defects.
- The skipped test is `shared/coupons.parity.test.ts`: it compares SQL and TypeScript coupon maths and needs a real `DATABASE_URL`. Not run.

## Node compatibility of the schema command

| Node | `node --test scripts/structured-data.check.mjs` |
|---|---|
| 22.16.0 (before the fix) | **fails**, `ERR_UNKNOWN_FILE_EXTENSION` (reproduced) |
| 20.19.0, 22.16.0, 22.22.2 (after) | 14 passed, 0 failed on each |

Node 22.16.0 and 20.19.0 binaries were fetched from the npm registry (`node-linux-x64`).

## Independent inspection of the built `dist/` (103 checks, 0 failed)

Run by `docs/evidence/phase4_1/verify-built-html.mjs` (paths are for the sandbox; edit `root` to rerun), separate from the project's own checker:

- 17 public routes; sitemap has the same 17 URLs; no private route in the sitemap.
- Canonical and `og:url` equal the page URL on all 17; `og:title` and `og:description` present; no `noindex` on public pages.
- 12 private shells exist as files and all have `noindex` (seo-check counts 14; the other two are parameterised routes with no static file).
- One Organization (`@id` `/#organization`, name "Kaayra Herbals"), `sameAs[0]` is `https://www.instagram.com/kaayra.herbals/`; the wrong handle appears nowhere.
- One WebSite pointing at the Organization.
- Founders page: 3 Person entities (Nitesh Jaiswal, Founder & CEO; Ritika Jaiswal, Co-Founder; Anuj Kumar, Co-Founder), each linked to the Organization.
- 4 articles: author and publisher are the Organization; no personal author, reviewer or modified date; headline equals the visible H1; `datePublished` equals the visible date and `routes.json`; `mainEntityOfPage` is the canonical URL.
- Home: 11 visible FAQ questions, 11 FAQPage entries, the 3 restored questions present in both, approval disclaimer visible. FAQPage appears on the home page only.
- No Offer, Product, Review, Rating, price or availability markup on any page.

## Not done

- **No external JSON-LD validator was run** (Schema.org validator, Google Rich Results Test). They need access to external sites that this environment blocks. The structural checks above are not a substitute.
- Real Gemini calls were not made (no API key). The retriever was tested directly, including its 3,000-character limit.
- No browser or visual check: nothing visual was changed.
