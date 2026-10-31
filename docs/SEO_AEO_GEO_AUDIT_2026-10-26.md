# SEO, AEO, GEO and technical audit (26 October 2026)

Scope: the supplied project `kaayra-herbals-geo-gemini-merged-v2`. Primary domain stays `https://kaayraherbals.com/` (no www migration).
Environment: no network, no `node_modules`. Everything below says what was actually run.

## 1. How this was checked
- Read: `package.json`, lockfile check, `shared/routes.json`, `shared/private-routes.json`, `vercel.json`, `index.html`, `scripts/prerender.mjs`, `seo-check.mjs`, `structured-data.mjs` (+ its tests), `indexnow.mjs`, `public/robots.txt`, `llms*.txt`, CI workflow, journal / ingredient / founder content and pages, navigation links.
- Run for real: `node --test` on the new IndexNow tests (14/14), `seo:schema` (20/20), the real `prerender.mjs` and the real `seo-check.mjs`, `check-lockfile.mjs`, `node --check` on every changed script, YAML parse of both workflows.
- Important limit: `prerender` and `seo-check` ran against a **stand-in page renderer** and stubbed `vite` / `typescript` packages (test-only, in /tmp, not shipped), because the real build needs `npm ci`. They prove the scripts, the head tags, the sitemap, robots, headers and JSON-LD are right; they do not prove the real React pages render the way the stand-in does.

## 2. Findings (verified) and what was done
| Severity | Finding | Verified how | Status |
|---|---|---|---|
| High | `/wishlist` and `/bundles` are private (meta noindex shell) but `vercel.json` sent no `X-Robots-Tag` for them. The other 12 private routes had it. | Compared `private-routes.json` with the header rule; the new check fails on the old rule (mutation test). | Fixed in `vercel.json`; new `seo-check` section 5b fails if any private route lacks the header. |
| Medium | IndexNow submitted the whole sitemap every run; no timeout, retry, rate-limit handling, change tracking or per-URL log; any 200 was printed as success. | Read `scripts/indexnow.mjs`. | Rewritten (see 3.4). Tested end to end against a local fake IndexNow server. |
| Medium | CI ran lint, typecheck, tests, build only. `seo:check` and `seo:schema` were never run in CI. | Read `ci.yml`. | Added to the `app` job, after the build, with `VITE_SITE_URL=https://kaayraherbals.com`. |
| Medium | Only `twitter:card` existed. No Twitter title, description or image. | Read `index.html`, `prerender.mjs`. | Added, route-specific; checked for every public page. |
| Low | Articles had no `article:published_time`. | Same. | Added from the route date; checked. |
| Low | Generic pages had only BreadcrumbList; no WebPage entity. | Read `structured-data.mjs`. | WebPage / AboutPage / ContactPage / CollectionPage added, tied to the WebSite and the single Organization. |
| Low | `robots.txt` disallows `/login`, `/signup`, `/account`, `/report-a-problem`, `/admin`, which also carry noindex. A blocked URL cannot show its noindex to a crawler. | Read robots + shells. | Left alone (no indexing risk found; changing it could surprise existing indexing). The newer private routes are deliberately not disallowed so noindex stays visible. |
| Info | Footer and menus link to `/bag`, `/track-order`, `/report-a-problem`, account pages (functional, noindex). `/bundles` and `/wishlist` are not linked from any public prerendered page (now checked). | grep + new check. | Kept: working features. |
| Info | One share image (`/og-image.png`, 1200x630, verified size) for every page. | Read file header. | Kept: it is the only verified brand image. No logo artwork was invented. |
| Info | hreflang `en-IN` and `x-default` point at the same URL. Harmless. | Read prerender. | Kept. |

Checked and found correct (no change): canonical per page equals the sitemap URL; sitemap holds only the public routes (now 19) and `lastmod` only where a real date exists; no private route in the sitemap; robots does not block any public route or `/assets`; one `<h1>` per page; one Organization with a stable @id; FAQ markup identical to the visible FAQ; no Product / Offer / Review / Rating markup; llms files carry company facts, roles (not qualifications) and the "nothing for sale" status.

## 3. What changed
### 3.1 Private routes
`vercel.json` X-Robots-Tag rule now covers `wishlist|bundles` too. `seo-check` now verifies, for every entry in `private-routes.json` plus `/admin` and `/track-order/<id>`: a covering noindex+nofollow header rule, meta noindex, no canonical, no social tags, absent from the sitemap; that no public page is covered by a noindex rule; and that no public page links to `/bundles` or `/wishlist`.

### 3.2 Social metadata
`index.html` and `prerender.mjs`: `og:title/description/url/image(+alt)`, `twitter:card/title/description/image(+alt)` for every public page, route-specific text, absolute URLs on the primary domain. `seo-check` verifies each tag equals the route values and that the image file exists in `dist`.

### 3.3 CI
`ci.yml` (`app` job): after `npm run build`: `npm run seo:check`, `npm run seo:schema`, `npm run indexnow:test`. New `indexnow.yml` (after a successful Production deployment, or by hand). **Neither workflow has run on GitHub yet.**

### 3.4 IndexNow (`scripts/indexnow.mjs`, `scripts/lib/indexnow-core.mjs`)
Reads the live sitemap, skips private paths, other hosts and any page that is not a plain 200 with no noindex and its own canonical, fingerprints the readable content (title, description, canonical, text, link targets, JSON-LD; asset file names excluded so a rebuild alone changes nothing), compares with a saved state, and submits only new or changed URLs in batches of 100. 10 s timeouts, 3 attempts with backoff and `Retry-After`, 429 stops the run, 403/422 are fatal. A URL is saved to the state only after HTTP 200/202. Every URL is logged as SUBMITTED, SKIPPED (with the reason) or FAILED; the exit code is 1 on any failure; "accepted" is never called "indexed". State file: atomic write, damaged file set aside, never deleted. Modes: `DRY_RUN=1`, `INDEXNOW_BASELINE=1` (record without sending), `INDEXNOW_FORCE=1`.
End-to-end run against a local fake server: dry run saves nothing; first run sends 2 public pages and skips the private and noindex ones; an unchanged run sends nothing; one changed page sends only that page; an outage (HTTP 500) exits 1 and keeps the page for next time; the next run submits it.

### 3.5 Structured data (`scripts/structured-data.mjs`)
WebPage-type nodes; Article now supports a **named author, reviewer (`reviewedBy`, `lastReviewed`), `dateModified` and `citation` only when the article's own data has them**. With today's data nothing changes: the Organization stays author and publisher, no Person on articles. `citation` is emitted for the one article that already shows sources. Founder `profiles` (e.g. LinkedIn), when supplied, go into the Person `sameAs`. `seo-check` and `seo:schema` enforce: a review exists exactly when `practitionerReviewed` is true; named people must be visible on the page; no `hasCredential`, ratings, offers or products.

### 3.6 Content credibility
- Journal model (`src/content/journal.ts`): optional `author`, `review`, `updated`, `related`, `ingredients`. Page shows author line and bio, "Reviewed by NAME, CREDENTIALS, on DATE" only for a real review, otherwise states plainly that the article has not been reviewed by a qualified practitioner; related ingredients; related reading.
- Two new articles on real questions: "What is Ayurveda?" and "How botanical ingredients are identified" (about 600 words each, question-style headings, no health claims, no dose, no external links because no source could be opened in this session). **Both need a qualified practitioner's review before anyone calls them reviewed.**
- Ingredient library: optional fields for synonyms, Sanskrit names, identification, traditional context, evidence limits, safety, references, related articles. A "How to read an entry" block separates traditional use from clinical evidence. Only ashwagandha is filled in, restating what the existing article already says from its two NIH sources. Entries without a safety note say so instead of implying safety.
- Founders page: sections "Who founded Kaayra Herbals?", mission, product-development approach, and an honest note that experience and professional profiles appear only when supplied. Only existing site wording and the three confirmed qualifications are used.
- `llms-full.txt` and the AI site knowledge (`siteContent.generated.ts`, regenerated) include the new articles and three direct answers.

## 4. Not changed on purpose
- Homepage: it already states "in development, nothing is for sale", has the launch-list call to action and a status note. No change was justified without a browser to judge it.
- Navigation and account/bag features: working features; their dependencies were not re-verified, so none removed.
- Performance and accessibility: no Lighthouse or browser was available. Static review only: fonts are preloaded and `boot.js` is inlined (existing), portraits have width/height and lazy loading, new links have text, headings keep order. Contrast, INP, LCP and CLS are **not measured**.

## 5. Needs founder or company input
1. Real author names and bios for the journal, and a qualified reviewer (name, credentials, date) for any article to be called reviewed.
2. Founders' professional experience (LinkedIn links for Nitesh and Anuj were added 26 Oct; Ritika has a note that she is not on LinkedIn). Portraits look AI-generated (HANDOFF note): replace with real photos.
3. Reviewed safety and evidence notes, synonyms and Sanskrit names for the other 8 ingredients, confirmed by a botanist or practitioner.
4. Practitioner review of the two new articles.
5. Wording conflict to decide: `COMMERCE_ENABLED` is true (shop features on; real production payments gated by `LIVE_SALES_*`). The FAQ, llms files and meta descriptions say nothing is for sale. That is accurate only while live sales stay unapproved. Update them on the day selling starts.
6. DNS/Vercel: confirm `www.kaayraherbals.com` redirects to the apex with a single 301 (not verifiable here).
7. Google Search Console and Bing Webmaster verification and sitemap submission (owner only).

## 6. Test results
| Check | Result |
|---|---|
| `check:lockfile` | PASS (ran) |
| IndexNow unit tests (`indexnow:test`) | PASS 14/14 (ran) |
| IndexNow CLI end to end vs local fake server | PASS, 6 scenarios (ran, ad hoc script, not shipped) |
| `seo:schema` (JSON-LD, journal, ingredient and founder data) | PASS 20/20 (ran, with a test-only TypeScript shim) |
| Prerender + `seo-check` (titles, canonicals, noindex, social tags, sitemap, robots, llms, internal links, JSON-LD, private routes) | PASS (ran against a **stand-in renderer**, not the real React output) |
| Mutation tests (old header rule, missing Twitter tag, public link to /bundles, missing published_time, reviewed-without-reviewer, invisible author) | each correctly FAILED the check (ran) |
| Workflow YAML parse | PASS (ran); not run on GitHub |
| `npm ci`, `tsc` typecheck, ESLint, Vitest (1210+ tests), real `vite build`, real prerender, `ui:check` | **NOT RUN** (no network or dependencies) |
| Browser / real-device / Lighthouse / Rich Results Test / live URL checks | **NOT RUN** |

TypeScript files changed without a compiler: `JournalArticle.tsx`, `Ingredients.tsx`, `Founders.tsx`, `FounderCards.tsx`, `content/journal.ts`, `content/ingredients.ts`, `content/founders.ts`. Expect to fix, at most, small type or lint errors on the first `npm run typecheck && npm run lint`.

## 7. Deployment
1. `npm ci && npm run check:lockfile && npm run typecheck && npm run lint && npm test`
2. `VITE_SITE_URL=https://kaayraherbals.com npm run build && VITE_SITE_URL=https://kaayraherbals.com npm run seo:check && npm run seo:schema && npm run indexnow:test`
3. Deploy to Vercel (push). Confirm `VITE_SITE_URL` is set to `https://kaayraherbals.com` in Production.
4. After the deploy is live: run the `indexnow` workflow by hand with **baseline = true** once if the pages were submitted before (so unchanged pages are not resent), otherwise with dry_run first.

## 8. Post-deployment checklist
- `curl -sI https://kaayraherbals.com/wishlist` and `/bundles` show `x-robots-tag: noindex, nofollow`; same for `/forgot-password`, `/set-password`.
- `curl -sI https://www.kaayraherbals.com/` redirects once to the apex.
- Every URL in `/sitemap.xml` returns 200; `/robots.txt` points to the sitemap; `/llms.txt`, `/llms-full.txt` load.
- View source of `/`, `/founders` and two articles: one canonical, OG and Twitter tags with the apex URLs.
- Paste two article URLs into Google's Rich Results Test and the Schema Markup Validator; confirm no errors.
- Open `/journal/what-is-ayurveda`, `/ingredients` (ashwagandha) and `/founders` on a phone and with the keyboard.
- Search Console: submit the sitemap; check Page indexing for unexpected "Excluded by noindex" on public pages.
- Do not expect immediate indexing or citation by AI assistants; nothing here guarantees either.
