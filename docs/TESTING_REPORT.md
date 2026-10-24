# Testing report: Phase 2

Environment: an offline sandbox. `npm install` was not possible, so the project's own toolchain (`npm run lint`, `typecheck`, `test`,
`build`, Vitest, Vite) was **not run**. Checks below used the TypeScript compiler, Node, Playwright/Chromium and a minimal stand-in for
the few Vitest functions the tests use. Please run the real commands before deploying.

## Ran, and passed

| Check | Result |
|---|---|
| TypeScript, server, API and shared code (strict, no unused locals) | No errors |
| Unit tests: `server/oauth.test.ts` | 13 passed |
| Unit tests: `shared/products.test.ts` (eight records, ingredient counts, publication gate, claim screening, update validation, public projection) | 18 passed |
| Unit tests: `shared/commerce.test.ts` (commerce off, no cart/checkout/payment routes, no price or buy control) | 3 passed |
| Unit tests: `shared/content-safety.test.ts` (no PAN/TAN, no forbidden claims, no formulation data in the front end, no legacy product names, company details and Instagram correct) | 6 passed |
| End-to-end, auth API against a mocked Supabase | 19 scenarios passed |
| End-to-end, products API and admin product actions against a mocked database | 16 scenarios passed |
| Page render smoke test (Home, Story, Collection, Development status, Medical Disclaimer, Approach, Quality) | Rendered with no errors; Home section order matches the brief; hero shows the pre-launch button; incorporation sentence present; no forbidden phrases |
| Visual check in Chromium of the new layouts (static render with the real stylesheet): collection grid at 1280 and 390 px wide, product page at 1280, sign-in at 1280 and 390, packaging label | Layouts hold; no overflow seen |

What the product scenarios prove: all eight records exist with the supplied ingredient counts (18, 9, 16, 19, 36 plus 10 Dashmool, 13, 8, 17); an empty public list while nothing is approved;
internal names, notes and ingredients never appear in public responses; preview blocked without a reviewed description; unsupported claims refused; ingredients hidden until verified;
sale approval refused; only self-hosted images accepted; hiding a product always allowed; immutable fields cannot be changed through the API; changes and blocked attempts audited;
no database means an empty list, not an error.

## Could not run

- `npm run lint`, `npm run typecheck` (front end), `npm test` under real Vitest, `npm run build`. Front-end files were checked for syntax only; the remaining compiler complaints came from missing React and Vite typings in the sandbox.
- The SQL itself (`products.sql`, `products_seed.sql`, the `public_products` view and constraints) was not executed against Postgres. Run it in Supabase and confirm that `select * from public_products` returns no rows until a product is approved.
- A real Google or Supabase sign-in round trip.
- Interactive browser testing: keyboard navigation through the new pages, the admin product editor, the newsletter and contact forms after the changes, and the Instagram link in a live page.
- Automated accessibility (axe) and performance (Lighthouse) runs. Done by design instead: semantic headings and landmarks, native `details/summary` for expandable sections, alt text required for any public image, focus-visible styles, and all new animation switched off under `prefers-reduced-motion`. Verify with real tools.
- SEO output of `npm run build` (sitemap, canonical URLs, structured data). The prerender script was edited but not run.
- Home page, footer and header were not rendered visually; the header now has eight links plus the sign-in link and CTA and should be checked at tablet width.

## Known limits

- Product pages (`/collection/:slug`) are rendered in the browser from the API and start as noindex. This is deliberate while there are no approved products; add server-side rendering or a generated sitemap entry per approved product if search visibility of product pages matters later.
- No product images exist yet, so cards show a quiet container illustration labelled "Image to follow".
- No founder details were supplied, so the Founding Team section is hidden.
