# Search Console "Discovered - currently not indexed": audit and fix (27 October 2026)

URLs: `/collection`, `/product-development`, `/quality-and-transparency` (first detected 24 Oct 2026, last crawled N/A).

## Confirmed findings
| # | Finding | How verified |
|---|---|---|
| 1 | **The company was incorporated on 16 Oct 2026** (`src/config/site.ts`). The domain is days old, so Google has not yet scheduled a crawl. "Discovered" with "Last crawled: N/A" means Google knows the URL but has not fetched it. This is the main cause and no code change removes it. | config + GSC data supplied |
| 2 | **Thin initial HTML.** Visible words in the prerendered page: `/collection` 121, `/product-development` 180, `/quality-and-transparency` 164 (other public pages: 270 to 1,000+). | Real page components rendered to HTML before and after (harness below) |
| 3 | **`/collection` prerenders a loading skeleton.** Products load client-side from `/api/products`, so the server HTML held only the hero, skeleton blocks and one notice. | Read `Collection.tsx`, `lib/products.ts` |
| 4 | **Weak inbound linking.** `/product-development` was linked only from the footer, Founders and Collection; `/collection` and `/quality-and-transparency` mostly from the footer and Home. No journal article, ingredient page or Approach page linked to them. | grep of `src` |
| 5 | **Titles/descriptions were generic** (`Products`, `Development Status`) and overlapped in wording. | `shared/routes.json` |

## Checked and found correct (no change made)
Routes are prerendered; self-referencing canonical equal to the sitemap URL; no meta noindex; no `X-Robots-Tag` rule matches these paths (the noindex rule covers only the private routes); `robots.txt` does not disallow them; present in `sitemap.xml`; one H1 each; no broken internal links; JSON-LD is WebPage-type with breadcrumb only, no Product/Offer/Review/Rating.

## Changes
| File | Change |
|---|---|
| `src/pages/Collection.tsx` | Three static sections (what the collection is and will/will not contain, how ingredients are chosen, where to read next) that do not depend on the API. Product list, filters and pre-launch state unchanged. |
| `src/pages/ProductDevelopment.tsx` | Rewritten: done so far (company incorporation, library and journal counts read from the site's own data, written rules), in progress and not started (existing Ledger), five gate questions, what is undecided, links. |
| `src/pages/Quality.tsx` | Kept the four principles and the "nothing here yet" statement; added what exists vs does not exist, identification, traditional use vs evidence vs safety limits, what may be published at launch, and the two NIH sources already used by the ashwagandha entry. |
| `shared/routes.json` | New unique titles for `/collection` and `/product-development`; sharper description for `/quality-and-transparency`. URLs unchanged. |
| `src/pages/Home.tsx`, `Story.tsx`, `Approach.tsx`, `Ingredients.tsx`, `JournalArticle.tsx` | One descriptive in-text link each to the relevant page(s). |
| `server/ai/siteContent.generated.ts` | Regenerated with `node scripts/build-site-knowledge.mjs` so Kaayra AI uses the new page text. |
| `docs/SEO_INDEXING_FIX_2026-10-27.md` | This file. |

Nothing invented: no product types, suppliers, tests, certificates, reviewers or reviews. Product forms are not named because no public project source announces any.

## Tests actually run (offline; no `npm ci`, no real `vite build`)
Harness: the real React page components were bundled with esbuild, with a stub `react-router-dom` (links only) and no site layout, and rendered to HTML; the real `scripts/prerender.mjs` and `scripts/seo-check.mjs` were then run on that output.
- `prerender.mjs`: PASS (19 routes, sitemap, robots, 404, shells).
- `seo-check.mjs`: PASS (19 public routes, 14 private shells, 19 sitemap URLs).
- `node --test scripts/structured-data.check.mjs`: 21/21 PASS. `check-lockfile.mjs`: PASS.
- Ad hoc check of the three URLs (sitemap, canonical, noindex, header rules, robots, H1, internal links, JSON-LD types, unique titles/descriptions across all 19 routes): all PASS.
- Visible words in initial HTML, before to after: collection 121 to 433, product-development 180 to 529, quality 164 to 522.
- Syntax/type check of the edited pages with global `tsc` (React and Vite types missing): no errors in the new code; remaining messages come from the missing type packages.
- NOT RUN: `npm ci`, project `tsc`, ESLint, Vitest (needs `vitest`; two script tests failed to load for that reason), real `vite build`, browser/mobile check, live HTTP status, Rich Results Test. The header and footer (from `Layout`) were not part of the harness.

## Human steps
1. `npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm run seo:check && npm run seo:schema`; fix any small type or lint error.
2. Deploy to Vercel production.
3. Search Console: URL Inspection > Test live URL for each page (expect "available to Google", "indexing allowed"), then Request indexing. Confirm the sitemap shows Success. Do not use VALIDATE until a real defect is fixed.
4. Link the site from the Instagram bio and any other profile you control; allow several weeks.
5. No journal article has had a practitioner review, so the pages say so; do not change that wording until one has.

Nothing here guarantees indexing or ranking.
