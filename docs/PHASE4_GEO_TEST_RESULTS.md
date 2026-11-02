# Phase 4 GEO: test results (25 Oct 2026)

Environment: Node v22.22.2, npm 10.9.7, no network (DNS for registry.npmjs.org does not resolve), no `node_modules` in the ZIP.

## Did NOT run (could not)
| Check | Result |
|---|---|
| `npm ci` | NOT RUN to completion: the registry is unreachable (`npm view` timed out, curl: could not resolve host). A partial install was removed. |
| `tsc --noEmit` (typecheck) | NOT RUN (TypeScript not installed) |
| ESLint | NOT RUN |
| Vitest (`npm test`) | NOT RUN, so the existing suite and the four new tests in `shared/seo.test.ts` are unverified |
| Production build (`vite build`, SSR build) | NOT RUN, so the real React render of the pages was not exercised |
| `npm run seo:check` on a real build | NOT RUN |
| Google Rich Results Test / schema.org validator | NOT RUN (no network) |

## Ran, and what it proves
1. `node --test scripts/structured-data.check.mjs` (`npm run seo:schema`): 11 of 11 passed. It builds the JSON-LD for all 17 public routes from the real config, routes, founders, FAQ and journal files and checks: JSON round-trip; unique `@id` per page and every reference resolving; one Organization with the stable `@id` and identical identity facts everywhere; Instagram is the configured account only; the 3 founders with approved names and roles linked both ways; no qualification, email or credential in structured data; articles (Organization author and publisher, headline and date equal to the journal source, routes.json dates equal journal dates, no person, no reviewer or modified date); no Offer, Product, Review, Rating, price, availability or logo; WebSite; the FAQ markup equal to `faq.json`; llms files carry the configured Instagram, legal name, location, date and founder roles and no qualifications.
2. Real `scripts/prerender.mjs` followed by real `scripts/seo-check.mjs`, run in a scratch copy with a STAND-IN renderer (a stub `vite.loadEnv` and a tiny `entry-server.js` that outputs an H1, the FAQ questions, founder names and the article `<time>`). Result: 17 public routes, 14 private shells, 17 sitemap URLs, `[seo-check] OK`, including the new section 2c. This tests the prerender wiring and every seo-check rule, but not the real React pages.
3. Negative tests on that output, all caught by seo-check: a founder role changed to "Co-founder"; the llms Instagram changed to the wrong account; an article author changed to a person.
4. `node --check` on every `scripts/*.mjs`: all parse. `node scripts/check-lockfile.mjs`: passes.
5. `node scripts/build-site-knowledge.mjs`: ran; the generated file changed only in the company facts and Founders entries (no qualification text remains).
6. The existing source-string assertions in `shared/seo.test.ts` (WebSite, Organization, graph order, no forbidden keys, Person, BreadcrumbList, `r.date ?`, founders.json) were re-evaluated by hand with Node against the new sources: all hold. This is not a substitute for running Vitest.

## First thing to run on your side
`npm ci && npm run typecheck && npm run lint && npm test && npm run build && VITE_SITE_URL=https://<your domain> npm run seo:check && npm run seo:schema`
Possible friction: the new test code in `shared/seo.test.ts` (typing of the `routes` JSON union) has never been compiled.
