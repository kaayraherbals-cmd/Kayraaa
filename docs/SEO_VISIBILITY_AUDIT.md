# Google visibility and brand SEO audit (2026-10-22)

Scope: make https://kaayraherbals.com/ understood as the official Kaayra Herbals site. No ranking is guaranteed.
No Search Console data was available to this session. Nothing here claims otherwise.

## 1. Findings

### Confirmed (evidence from the repo, a clean production build, and the live homepage and /contact page)
| ID | Sev | Finding | Where | Status |
|---|---|---|---|---|
| C1 | P1 | The homepage H1 was the tagline. The brand name was not in the H1. | `src/pages/Home.tsx` | Fixed |
| C2 | P1 | No `WebSite` structured data. Only an `Organization` node existed, so no explicit site-name signal. | `scripts/prerender.mjs` | Fixed |
| C3 | P2 | Homepage title did not use the agreed brand title. | `shared/routes.json`, `index.html` | Fixed |
| C4 | P2 | Three journal titles ended in "Kaayra Journal", a second site name that conflicts with "Kaayra Herbals". | `shared/routes.json` | Fixed |
| C5 | P3 | Every sitemap URL carried today's build date as `<lastmod>`. That is not a real modification date. | `scripts/prerender.mjs` | Fixed (only dated articles get lastmod) |
| C6 | P3 | Favicon was SVG only. No PNG sizes and no apple-touch icon. | `index.html`, `public/` | Fixed |
| C7 | P3 | The Our Story page had no company-details block and few onward links. | `src/pages/Story.tsx` | Fixed |
| C8 | P3 | Articles linked back to the journal only, not to the homepage, story or ingredients. | `src/pages/JournalArticle.tsx` | Fixed |

### Confirmed healthy (no change needed)
- Production serves the intended build. The live homepage and /contact show the same title, absolute self-canonical, og:* tags and prerendered body content as a local production build.
- Homepage content is in the server HTML, not only in client-rendered DOM.
- Canonical URLs are absolute and self-consistent on all 16 public routes. Exactly one title, one description and one H1 per route.
- No `noindex` on public routes. Sign-in, account, bag, checkout, admin and product-shell pages are `noindex` in the HTML. `vercel.json` also sends `X-Robots-Tag: noindex` for those paths.
- robots.txt references the sitemap. It blocks no public route and no assets.
- No meta keywords. No fabricated reviews, ratings, prices, awards or certifications in any markup.

### Hypotheses (cannot be confirmed from here)
- H1, most likely: the brand and domain are days old. The company was incorporated on 16 October 2026 and the first journal articles are dated 14 October 2026. A new site with no history and no external references often does not rank for its own name quickly.
- H2: "Kaayra" is an uncommon spelling. Google may treat the query as a variant of Kiara, Kiyara or Kaira and favour established brands.
- H3: no third-party corroboration yet (Instagram bio link, directory or press mentions). Nothing in the repo can fix this.
- H4: why Images appears before Web cannot be determined. The homepage has no content `<img>` elements. Only `og-image.png` and CSS or SVG art exist.

### Not verifiable in this session (state limitation)
www to non-www behaviour, the redirect chain, live HTTP headers (`X-Robots-Tag`), live `robots.txt` and `sitemap.xml` contents, JavaScript-rendered DOM as Google sees it, and everything in Search Console. The sandbox cannot reach kaayraherbals.com directly. Commands for the manual checks are in section 4.

### Recommendations (not defects)
- P2, when products go public: `/collection/:slug` pages are client-rendered with `noindex` in the raw HTML and flip to `index` through JavaScript. Google may skip rendering a page whose raw HTML says `noindex`. Before products are meant to rank, prerender approved products at build time or send the robots tag from the server. They are not in the sitemap today and nothing is for sale, so this is not a current cause.
- P2: no `Product` JSON-LD was added. There are no approved public products, prices or availability to mark up truthfully.
- P3: `/login`, `/signup`, `/account`, `/admin` and `/report-a-problem` are both disallowed in robots.txt and noindex. A disallowed URL cannot show its noindex. Harmless while nothing links to them externally.
- P3: `Organization.logo` is omitted because no approved logo artwork exists (`src/content/brand.ts`). The favicon is not claimed as the logo. When artwork is approved, add its URL to the Organization node.
- P3: `WebSite.alternateName` is "Kaayra", which the site already uses as shorthand. Owner to confirm it is the intended short name. Remove it in `scripts/prerender.mjs` if not.
- P3: the 15 to 16 URL sitemap is fine for a site this size. No sitemap index is needed.

## 2. Changes made
- `src/pages/Home.tsx`: H1 is now "Kaayra Herbals". The tagline "Ancient Wisdom. Modern Thinking. Better Living." is a visible supporting paragraph with the original display type.
- `src/styles/home.css`, `src/styles/legacy.css`: new `.hero-brandname` and `.hero-tagline` rules. The tagline keeps its size, font, colours and animation. The brand name is a small label above it.
- `shared/routes.json`: homepage title `Kaayra Herbals | Official Ayurvedic Wellness Brand`, and a description that leads with the brand. Journal titles now end `| Kaayra Herbals`. New article route added.
- `index.html`: same default title and description as the homepage route. Added 48px and 192px PNG favicon links and the apple-touch icon.
- `public/favicon-48x48.png`, `public/favicon-192x192.png`, `public/apple-touch-icon.png`: rendered from the existing `favicon.svg`. No new artwork.
- `scripts/prerender.mjs`: homepage JSON-LD is one `@graph` with `WebSite` and `Organization`, linked by `@id`. Article JSON-LD gains `inLanguage` and the publisher URL. Sitemap `<lastmod>` only comes from a real article date.
- `src/pages/Story.tsx`: "Company details" paragraph (values already published in the footer) with links to approach, quality and contact. Closing links to the ingredient library, journal and homepage.
- `src/pages/JournalArticle.tsx`: publisher line linking to the homepage and story, a "Keep reading" list, and an optional Sources section.
- `src/content/journal.ts`, `shared/routes.json`: one new article, `traditional-use-and-clinical-evidence`. It separates traditional use from clinical evidence, uses ashwagandha as the example, makes no claims about any Kaayra product, and cites two NIH sources that were opened and read. It is marked `practitionerReviewed: false` like the others.
- `scripts/seo-check.mjs`, `package.json` (`npm run seo:check`), `shared/seo.test.ts`: automated checks described below.

Not changed: visual identity, layouts, commerce, authentication, forms, admin, API, SQL, `vercel.json`, robots.txt.

## 3. Verification (actually run in this session, network on)
| Check | Result |
|---|---|
| `npm ci` | Passed |
| `tsc --noEmit` | Passed |
| `eslint .` | No output, clean |
| `vitest run` | 971 passed, 1 skipped (pre-existing), 69 files. Includes 8 new SEO tests |
| `npm run build` with `VITE_SITE_URL=https://kaayraherbals.com REQUIRE_SITE_URL=1` | Passed, 16 routes prerendered |
| `npm run seo:check` | OK: 16 public routes, 12 private shells, 16 sitemap URLs |
| Negative test of the checker | A broken canonical and a broken WebSite node were both reported |
| Chromium render of the homepage at 1440px and 390px | One H1, no horizontal overflow, hero looks as before |

`seo:check` covers titles, canonicals, robots meta, single H1, descriptions, JSON-LD parse and node counts, noindex shells, sitemap equals public routes, robots.txt sitemap line and blocked paths, internal link targets, brand misspellings, icon files.

Not run: Google Rich Results Test and Schema Markup Validator (no access), live header and redirect checks, `npm audit`, any Search Console report.

## 4. Manual steps after you deploy
Confirm `VITE_SITE_URL=https://kaayraherbals.com` is set in Vercel production, then redeploy.

Check these yourself:
- `curl -sI https://kaayraherbals.com/` should return 200.
- `curl -sI http://kaayraherbals.com/` and `curl -sI https://www.kaayraherbals.com/` should each return one 301 to `https://kaayraherbals.com/`.
- `curl -s https://kaayraherbals.com/robots.txt` and `https://kaayraherbals.com/sitemap.xml` should show the production domain and 16 URLs.
- `curl -sI https://kaayraherbals.com/bag` should include `X-Robots-Tag: noindex, nofollow`.

In Search Console:
1. Use a Domain property or confirm both www and non-www are covered.
2. Sitemaps: resubmit `https://kaayraherbals.com/sitemap.xml`. Expect 16 discovered URLs.
3. URL Inspection on `https://kaayraherbals.com/`: Test live URL, check the rendered HTML shows the H1 and body text, then Request indexing. Do the same for `/our-story` and the new article.
4. Pages report: look for "Crawled, currently not indexed" or "Discovered, currently not indexed" on any URL.
5. Test the homepage in the Rich Results Test and the Schema Markup Validator. WebSite and Organization are not rich-result types, so the point is only that the JSON-LD parses.

## 5. Prioritised actions
- P0: none found. Nothing in the code blocks indexing.
- P1: deploy this build, request indexing for the homepage, resubmit the sitemap. Update the Instagram bio to link to `https://kaayraherbals.com/` with the name spelt "Kaayra Herbals".
- P2: check www and HTTP redirects and live headers. Plan product prerendering before products are public. Get one or two genuine external references (below).
- P3: approve logo artwork and add it to Organization. Confirm `alternateName`. Practitioner review of the journal articles.

External checklist (manual, genuine only):
- Instagram bio: name "Kaayra Herbals", website link `https://kaayraherbals.com/`.
- Same spelling and URL on any real business profile (LinkedIn page, founders' profiles, MCA-linked listings).
- Legitimate references: partners, suppliers, Ayurveda or wellness publications, local Varanasi business bodies.
- Google Business Profile only if the business meets Google's current eligibility rules (a service-area or storefront with in-person contact). A pre-launch online-only business may not qualify.
- No purchased links, fake listings or invented endorsements.

## 6. Monitoring, weeks 1 to 4
- Day 0 to 2: deploy, request indexing, resubmit sitemap.
- Week 1: URL Inspection on the homepage every 2 to 3 days. Look for "URL is on Google" and a recent crawl date.
- Weeks 1 to 4, Performance report: add a Query filter (contains) for `kaayra herbals`, then `kaayra`. Set Search type to Web, then compare Image. Track impressions, clicks, average position, weekly. Impressions appearing before clicks is the normal first sign.
- Also filter Pages for the homepage and look at which queries it shows for.
- Week 2: search `kaayra herbals` in a private window, once. Note whether Google offers "Did you mean". Do not repeat the search many times.
- Week 4: decide. If the homepage is indexed but still not ranking for the exact name, the cause is likely authority and ambiguity (H1 to H3), and the fix is external references and time, not more code.
- Site-name display in results can lag the first appearance by weeks and Google may not show it.

## 7. Limitations
No Search Console access, no live header or redirect testing, no real-browser rendering of the live site, no Rich Results Test. The diagnosis that the main cause is the brand's age is a hypothesis supported by dates, not proof.

Sources: https://developers.google.com/search/docs/essentials , https://developers.google.com/search/docs/appearance/site-names , https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls , https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
