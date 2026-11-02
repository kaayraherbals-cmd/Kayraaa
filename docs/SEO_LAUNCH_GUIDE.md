# Search (Google) readiness: what the code does and what only you can do

## Already in the code (checked by `npm run build` then `node scripts/seo-check.mjs`)
- Every public page is prerendered to real HTML (crawlers see the content without running JavaScript), with its own title, description, canonical URL and Open Graph tags.
- `sitemap.xml` and `robots.txt` are generated from `shared/routes.json`; private pages (admin, login, account) are `noindex` and not in the sitemap.
- Structured data: WebSite + Organization (with founder Person nodes) and visible FAQPage content on the homepage; a `/founders` page with Person markup; BreadcrumbList on inner pages; Article on journal posts. No rating, review, price, logo or contact detail is claimed.
- `llms.txt` and `llms-full.txt` provide concise and expanded factual summaries for AI systems that choose to consume them. Both are generated with the production URL during prerendering.
- New: a dedicated `/founders` page (own URL, title and description) so people searching for the founders or the company can land on it. Menu, footer and homepage link to it.

## Only you can do these (needed for Google to find and rank the site)
1. Set `VITE_SITE_URL` in Vercel to the real production domain (https, no path), then redeploy. The build refuses placeholder domains.
2. Add the site in Google Search Console (Domain property), verify it with the DNS record, then submit `https://YOUR-DOMAIN/sitemap.xml`. Use "URL inspection > Request indexing" for `/`, `/founders`, `/our-story`, `/collection`.
3. Add the site in Bing Webmaster Tools (it can import from Search Console).
4. After deployment, verify `https://YOUR-DOMAIN/llms.txt` and `https://YOUR-DOMAIN/llms-full.txt` return 200 and contain no `__SITE_URL__` placeholders. These files are supplementary conventions, not a ranking guarantee.
5. Link the website from the Instagram profile bio, and use the same brand name spelling everywhere ("Kaayra Herbals").
6. Keep publishing real Journal articles (the sitemap dates come from them). Product pages are indexed only once real approved products exist.
7. A Google Business Profile needs a real business address and verification; none is in the project, so none was added.

## Honest limits
Nobody can promise rankings or traffic. A new domain usually takes weeks to be indexed and months to build visibility; the code removes technical blockers, content and links do the rest.
