# SEO, AEO and GEO implementation

This project uses the same evidence-first approach across conventional search engines, answer engines, and generative search tools. These controls improve crawlability and source clarity; they do not guarantee rankings, citations, AI mentions, or traffic.

## Implemented in the source

### SEO — search engine optimisation
- Public routes are prerendered to HTML so page content is available without waiting for client-side JavaScript.
- Each public route has its own title, meta description, absolute self-canonical, Open Graph metadata, and one primary H1.
- `shared/routes.json` is the public route registry used by prerendering and the XML sitemap.
- `robots.txt` references the generated sitemap. Private application shells are excluded from the sitemap and receive `noindex` metadata/headers.
- Structured data includes `WebSite`, `Organization`, `FAQPage`, `BreadcrumbList`, `AboutPage` and `Article` where applicable. Markup must reflect visible, verifiable page content.
- There are no fabricated reviews, star ratings, prices, awards, certifications, product approvals, or medical outcomes.
- The build's `npm run seo:check` checks page metadata, schema JSON syntax, sitemap coverage, robots configuration, internal links, and machine-readable guide URLs.

### AEO — answer engine optimisation
- The homepage contains visible question-and-answer content, backed by FAQ structured data.
- Questions are phrased as real user questions and answers lead with a direct response before context.
- Dedicated pages explain company identity, product-development status, ingredients, quality boundaries, and medical disclaimers.
- Journal articles distinguish traditional use from clinical evidence and link to their sources where provided.
- Answers should be self-contained, precise, and consistent with the canonical page. FAQ markup does not guarantee a Google FAQ rich result.

### GEO — generative engine optimisation
- `public/llms.txt` gives a concise site map and factual summary for systems that choose to consume it.
- `public/llms-full.txt` provides a longer, answer-ready orientation with direct answers, canonical URLs, current product status, and explicit non-invention rules. The prerender build replaces `__SITE_URL__` with the configured production domain.
- The canonical HTML pages remain the source of truth. `llms.txt` is an emerging convention, not a Google ranking factor or a guarantee that an AI system will read or cite the site.
- Entity spelling is consistently “Kaayra Herbals”. External profiles should use the same spelling and link to the canonical domain.
- Medical and product claims are intentionally conservative. Do not add product schema until an actual product is approved for public sale and its name, image, price, availability and other required fields are accurate.

## Production deployment checklist

1. In Vercel, set `VITE_SITE_URL=https://kaayraherbals.com` for the Production environment and redeploy. Keep it as a bare HTTPS origin, with no path or trailing slash.
2. Run `npm run build`, then `npm run seo:check` against the production build.
3. Verify `https://kaayraherbals.com/robots.txt`, `/sitemap.xml`, `/llms.txt`, and `/llms-full.txt` return `200` and contain the production domain rather than `__SITE_URL__`.
4. Verify HTTP and `www` redirect to the single canonical HTTPS hostname in one redirect where configured.
5. In Google Search Console, verify the domain property, submit `https://kaayraherbals.com/sitemap.xml`, inspect the homepage and important public routes, and request indexing after deployment.
6. In Bing Webmaster Tools, verify the site and submit the same sitemap. Re-check index coverage after publishing substantive new content.
7. Keep the Instagram profile link and any legitimate business profiles consistent with the exact brand name and canonical URL. Do not buy links or create fake directory listings.
8. Add new public routes to `shared/routes.json`; add article publication dates only when accurate. Add real, source-backed articles and update the sitemap through the normal build.
9. Before making founder information more prominent through search, confirm each person's consent to public website disclosure. Search visibility can make existing public information easier to discover and copy.

## What this cannot do

- It cannot submit a sitemap to Google or Bing without account access.
- It cannot confirm live indexing, Search Console coverage, production redirects, or actual AI citations from a local source-code change.
- No schema type, prompt file, robots rule, or content strategy guarantees a ranking or citation.
- AI systems differ in whether they crawl the site, consume `llms.txt`, or cite a source. The most durable strategy is useful original content, clear facts, technical crawlability, accurate sourcing, and genuine third-party references.

## Phase 4 GEO
Structured data is built in `scripts/structured-data.mjs` with brand facts from `src/config/site.ts`. Entity map, audit, consistency report, results and open issues: `docs/PHASE4_GEO_*.md`. Run `npm run seo:schema` after any change to founders, routes, journal or the graphs.
