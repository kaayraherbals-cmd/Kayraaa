# Phase 4 GEO: remaining issues

1. FAQ count: the brief says 11 questions; `shared/faq.json` has 8 (and the homepage FAQPage markup has the same 8). Nothing was added or removed. If three questions exist in another branch, send that file; otherwise tell me which three to add.
2. Not verified by running: typecheck, ESLint, Vitest, production build and the real `seo:check` (no network). See the test results file.
3. Portrait images are published in Person `image`. `HANDOFF.md` notes the supplied portraits look AI-generated. You asked to preserve them, so they were kept; consider replacing them with real photographs (same file names) before search engines associate them with the founders.
4. Founders' personal Instagram pages are in each Person's `sameAs` (as before). Confirm you want personal accounts linked to the entities.
5. Pre-launch status: structured data, llms files and the FAQ say nothing is for sale, while `docs/COMMERCE_STATE.md` records commerce as enabled behind a separate live-sales approval. Update the FAQ answer, llms files and (if you add one) product markup together when selling really starts. No Offer markup exists, by design.
6. `VITE_INSTAGRAM_URL` in Vercel overrides the configured account for the footer and now for structured data. Keep it unset or set to the same account. `seo:check` reads only the process environment, not `.env` files.
7. Production domain: tests use `https://kaayraherbals.com` as a stand-in; the real `VITE_SITE_URL` is set in Vercel. Primary-domain redirect and DNS are owner tasks (`docs/SEO_LAUNCH_GUIDE.md`).
8. No Organization `logo` is emitted because no approved logo artwork exists (`src/content/brand.ts`). Add it only when one is approved.
9. The AI knowledge file still contains the Corporate Identity Number (from `site.ts`, already in the earlier generator); the llms files do not. Left as is.
10. Client-side navigation updates title, description, canonical and og:url but not `og:type`; crawlers read the prerendered HTML, so this has no effect on indexing.
11. Founders page: if journal articles are ever reviewed by a qualified practitioner (`practitionerReviewed: true`) or given a named author, article markup needs a deliberate update; `seo:schema` fails if an article is marked reviewed, to force that decision.
