# Phase 4 GEO: changelog (structured data and brand entity consistency)

Scope: structured data and factual consistency only. No layout, colour, typography, animation, navigation, portrait or customer-flow change.
Phase 3 AEO work is preserved: FAQ text and question list, claim-safe wording, the AI knowledge generator and the Gemini retriever (`server/ai/sitePages.ts`, `gemini.ts`) are untouched except for the two generator edits listed below.

## Owner decisions applied
- Roles published: Nitesh Jaiswal, Founder & CEO; Ritika Jaiswal, Co-Founder; Anuj Kumar, Co-Founder.
- Founder qualifications stay on the founders page only. They are not in structured data, `llms.txt`, `llms-full.txt` or the AI knowledge file.
- Brand-authored journal articles keep "Kaayra Herbals" (the Organization) as author and publisher. No individual author, reviewer, modified date or rating was added.
- Instagram: the account configured in `src/config/site.ts` (`kaayra.herbals`) is untouched and is the only social profile in structured data. `@kaayraherbals_official` appears nowhere (checked in source, built output and AI files).

## Changes
1. `scripts/structured-data.mjs` (new): all JSON-LD is now built in one pure module. Stable `@id`s: `/#organization`, `/#website`, `/#faq`, `/founders#<person-slug>`, `<page>#article`.
2. `scripts/brand-facts.mjs` (new): reads brand name, legal name, tagline, incorporation date, location and the Instagram account from `src/config/site.ts` (and `VITE_INSTAGRAM_URL` when set, like the footer). The old hard-coded copies in `prerender.mjs` are gone, so the config is the one source.
3. `scripts/prerender.mjs`: uses the two modules; `og:type` is `article` on journal articles. Sitemap, canonical, hreflang and every other output are unchanged.
4. Organization: one entity with one shape wherever it appears (home, founders, articles). Before, the founders page emitted a second, thinner Organization with the same `@id`, and article pages emitted two un-identified Organization objects.
5. Person: each founder is now its own node with a stable `@id`, `jobTitle`, portrait `image`, own Instagram `sameAs`, and `worksFor` the Organization. `Organization.founder` references them by `@id` (before: full Person objects embedded with no `@id`, and no `worksFor` on the home page).
6. Article: `headline` and `datePublished` are now read from the rendered page (its H1 and `<time>`), and the build stops if the date differs from `routes.json`. Before, `headline` was the shortened meta title, which did not match the visible H1 for the first article ("Traditional use and clinical evidence" vs the page's "...: how to read a herbal claim"). Added `@id`, `url`, `mainEntityOfPage` (WebPage), `isPartOf` the WebSite, author and publisher as references to the Organization, and a Home > Journal > article breadcrumb.
7. WebSite is also present on founders and article pages so `isPartOf` and `publisher` resolve inside each page's graph.
8. `shared/founders.json`: roles "Co-founder" became "Co-Founder" (approved wording); the two portrait alt texts follow. This is the only visible text change (role line on the founder cards).
9. `public/llms.txt`, `public/llms-full.txt`: added the three founders with roles, the Founders page in both page maps, a "Who founded Kaayra Herbals?" answer (roles only, tells models not to infer qualifications), and an authorship rule (journal articles are by the organisation; do not attribute to a person). Nothing else was reworded.
10. `scripts/build-site-knowledge.mjs` (two small edits) and regenerated `server/ai/siteContent.generated.ts`: the Founders page no longer pulls `founders.json`, which had copied a partial, inconsistent set of qualifications into the AI knowledge (Nitesh showed only "BAMS (pursuing)", Anuj none). The company facts now carry the three roles and the authorship line. Everything else in the generated file is identical.
11. `scripts/seo-check.mjs`: new section 2c (see the test results file for the list of checks). `scripts/structured-data.check.mjs` (new, `npm run seo:schema`): 11 dependency-free checks. `shared/seo.test.ts`: existing source-string assertions now also read `structured-data.mjs`; four new Phase 4 tests.
12. `package.json`: added the `seo:schema` script only (lockfile check still passes).

## Not changed on purpose
FAQ (8 questions, see remaining issues), Instagram configuration, footer, founder photos and cards, route titles and descriptions, `site.ts`, CSP, `robots.txt`, sitemap logic, Gemini retriever and prompts.
