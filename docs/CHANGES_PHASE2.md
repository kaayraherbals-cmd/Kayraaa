# Summary of changes: Phase 2

## New files
- `shared/products.ts` (statuses, publication gate, claim screening, public projection), `shared/commerce.ts` (commerce off)
- `server/products.ts`, `api/products.ts` (public approved previews), admin product actions in `api/admin/[action].ts`
- `supabase/products.sql` (table, constraints, `public_products` view), `supabase/products_seed.sql` and `products.seed.json` (the eight records, all DRAFT)
- `src/pages/Collection.tsx`, `ProductDetail.tsx` (reusable template), `AdminProducts.tsx`, `MedicalDisclaimer.tsx`
- `src/components/CollectionGrid.tsx`, `ProductCard.tsx`, `ProductVisual.tsx`; `src/lib/products.ts`, `src/lib/meta.ts`
- `design/packaging/` (three label layouts, three container silhouettes, README)
- `docs/` (publication checklist, e-commerce architecture, testing report, this file)
- Tests: `shared/products.test.ts`, `shared/commerce.test.ts`, `shared/content-safety.test.ts`
- Earlier in this engagement (OAuth): `api/auth/`, `server/oauth.ts`, `server/members.ts`, `supabase/auth_members.sql`, sign-in and account pages

## Modified
- `src/pages/Home.tsx` reordered to the requested sequence; collection section; incorporation milestone; founding team now its own conditional section; Instagram heading "Follow the Kaayra Journey."
- `src/pages/Story.tsx` incorporation story; `ProductDevelopment.tsx` now "Development status"; `Ledger.tsx` wording
- `src/components/Layout.tsx` Collection link, footer company details and legal links
- `src/config/site.ts` verified company facts (no PAN/TAN)
- `src/App.tsx`, `shared/routes.json`, `vercel.json` (product page rewrite), `public/robots.txt`, `scripts/prerender.mjs` (Organization data, product shell), `src/styles.css`, `src/pages/Admin.tsx` (Products tab), `src/pages/Privacy.tsx`, `src/components/Botanical.tsx`, `README.md`, `.env.example`

## Removed
- `src/content/products.ts`: the old two-product list (I-Care Syrup, Liv Mitra) that shipped product names in the public bundle. Replaced by the server-side product records.

## Preserved
Design tokens, hero layout and animation, newsletter signup, contact form, journal, ingredient library, Instagram integration, existing routes, admin login.

## Auth update (email + password, Google name and password step)

Added: email and password sign-up and sign-in with email verification, forgot and reset password, and a `/set-password` step for first-time Google users (name, password, confirm). Removed: the "admin must sign in first" gate. New: `server/password.ts`, `server/gotrue.ts`, `src/pages/ForgotPassword.tsx`, `src/pages/SetPassword.tsx`, `src/components/{SignInForm,SignUpForm,PasswordField}.tsx`. Changed: `api/auth/[action].ts`, `server/{oauth,members}.ts`, `supabase/auth_members.sql` (adds `has_password`), Login, AuthShell, Privacy text, vercel.json, private routes.

## Front-page sign-in and order gate

Added: announcement bar, header account menu (`AccountMenu`), front-page account block (`AccountBand`), shared session context (`src/lib/session.tsx`), product-page ordering gate (`OrderGate`), `ORDER_REQUIRES_SIGN_IN`, and `docs/MARKETPLACE_RESEARCH.md`. Google button now always shows. Commerce remains OFF.

## UI polish (layout and spacing)

Header is now three zones (brand left, navigation centred, account right) with the account control moved out of the nav list; below 68rem it becomes one tidy sheet (navigation, then account). Added consistent section rhythm, aligned account band, unified radii and borders on cards, a cleaner footer grid, and larger comfortable targets. Changes: `src/components/Layout.tsx`, `src/styles.css` (header rewritten, "Phase 3" block appended). No logic, routes or content changed. Not built in this environment (no network for npm install): run `npm install && npm run build` and check at 390px, 820px and 1280px.

## Google on sign-in and sign-up

Google is now always shown on `/login`, `/signup`, the home account block and the order gate. Before, an empty `OAUTH_PROVIDERS` value or a slow or failed status call left the panel blank. `server/oauth.ts` always includes Google; `OAuthPanel.tsx` renders it immediately. Google must still be enabled in Supabase. Test updated.

## Error code system and problem reports

Added: `shared/errors.ts` (catalogue of 34 codes, references, automatic code selection), `server/errors.ts` (adds `errorCode` and `ref` to every error response and logs server faults with the reference), `docs/ERROR_CODES.md`. Sign-in, sign-up, admin, contact and launch-list APIs now return codes. New `ErrorNotice` shows the message, code, reference and a Report link in the sign-in, create-account, contact and Google panels.

Added: `/report-a-problem` page and form, `api/issues.ts`, `supabase/issues.sql`, admin Issues tab (status, severity, notes, search by code or reference), `shared/issues.ts`. Tests: `shared/errors.test.ts`, `shared/issues.test.ts`. Privacy policy mentions problem reports. Run `supabase/issues.sql` once in Supabase.
