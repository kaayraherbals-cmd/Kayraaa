# Phase 4 changes (in progress, section by section)

## Section 1: audit
`docs/PHASE4_AUDIT.md`.

## Section 4 (first part): three code fixes from the audit

1. **No default owner.** `parseAdminRoles` returns `ok: false` with no roles when `ADMIN_ROLES` is unset or blank, so `loadAdminConfig` reports `ADMIN_ROLES` as missing and the admin API answers 503 to everyone. Tests: `shared/roles.test.ts`, `server/admin/admin-api.test.ts`.
2. **Launch list is double opt-in** (`api/subscribe.ts`, `server/subscribeToken.ts`, `supabase/launch_optin.sql`, `src/pages/Subscription.tsx`).
   - Sign-up saves a pending row and sends one confirmation email; the same answer is returned for every address, so the form cannot reveal who is on the list. A repeat within 15 minutes sends nothing; the resend timer is cleared if the provider fails, so the visitor can retry.
   - The email link opens `/subscription`, where a button press confirms or unsubscribes (mail scanners that open links cannot confirm anyone). The welcome mail is sent only on the pending to confirmed change.
   - Links are signed (HMAC) and single-purpose. Confirm links expire after 7 days; unsubscribe links never expire. One-click `List-Unsubscribe` and `List-Unsubscribe-Post` headers are sent.
   - Consent text version is now `2026-10-v2`. `launch_consent_log` stores requested, confirmed and unsubscribed events with a SHA-256 of the address only.
   - Admin: list shows status; export contains confirmed addresses only; the overview counts confirmed and awaiting confirmation.
   - Existing rows become `single_legacy` and unconfirmed. Nobody is treated as confirmed without a click.
3. **Production build refuses a placeholder domain** (`scripts/site-url-check.mjs`, used by `scripts/prerender.mjs`). Vercel production builds (`VERCEL_ENV=production`) or `REQUIRE_SITE_URL=1` fail when `VITE_SITE_URL` is missing, not https, or a placeholder/local host. Preview builds warn only.

Also: `vite.config.ts` now includes `api/**` and `scripts/**` tests. Before this change `api/payments/webhook.test.ts` existed but `npm test` never ran it.

## Session continuation: brand, images, packaging, migrations

- **Palette fixed.** `theme.css` overrode ivory, sand and ink with off-brand values; removed so the six master colours apply everywhere. `shared/brand.test.ts` guards it.
- **Logo slots.** `src/content/brand.ts`, `src/components/Logo.tsx`, `public/brand/README.md`; header and footer use `Logo`. Wordmark remains until artwork is supplied.
- **Responsive images.** `ResponsiveImage.tsx` (AVIF/WebP, srcSet, sizes, mobile crop); `Figure`, the macro band and the Instagram grid use it. New `development` photo slot.
- **Instagram.** Section centres itself while no photos exist. No embed, no scraping.
- **Packaging.** Women's wellness label variants via `scripts/packaging-variants.mjs` (proposed hex values).
- **Migrations.** `docs/DATABASE_MIGRATIONS.md`: found that `refunds.sql` must precede `payments.sql`.
- **Handoff.** `docs/PHASE4_HANDOFF.md`.

## Not yet verified
See "Verification status" in `docs/PHASE4_AUDIT.md`.

## Premium voice pass (s4i follow-up)

Copy and structure only; no logic changes. Files: `src/pages/Home.tsx`, `Story.tsx`, `Approach.tsx`, CTA label in `Layout.tsx`, `CollectionGrid.tsx`, `ProductDevelopment.tsx`, `ProductDetail.tsx`, `JournalArticle.tsx`, `Quality.tsx`, `shared/routes.json`. `package-lock.json` regenerated because `npm ci` failed: `@fontsource/tiro-devanagari-hindi` was in package.json but missing from the lockfile.
Verified: typecheck, lint, `npm run build` (prerender: 15 routes) pass. Tests: 298 of 299 pass. The failure is `server/password.test.ts` (`cleanName`), present before these edits and not investigated.

## Women's line theme

`src/content/themes.ts` maps product slugs to a theme (currently `pcos-syrup`, `pcos-cap`, `leucorrhoea-syp` -> `womens`; edit the list to change). `.theme-womens` in `src/theme.css` remaps accent tokens only (burgundy #5E2233, rose #D9A9B2, gold #B39454, the palette proposed in `design/packaging/README.md`) on the product page and listing card, and gives the "image to follow" placeholder a light rose wash with a burgundy outline. Headings and buttons stay master green; the theme is intentionally light. Master colours are not redefined; brand tests pass.
The supplied packaging render (WhatsApp IMG-20261017-WA0014) is NOT in the project: its label carries benefit and safety claims, a regulatory-style mark and an unapproved logo. Use it as art direction only. Not checked in a browser: contrast and layout of the themed pages.

## Products rename and index

"Collection" is now "Products" in the menu, page title, breadcrumbs, home section and page meta. The URL stays `/collection` (renaming it needs redirects; not done). The Products page uses a new editorial index (`ProductRow`, `.plist-*` in `theme.css`): one product per row, alternating image side on wide screens, hairline dividers, name, form, pack sizes and status only. No descriptions, claims or prices. The Home preview keeps the 3-up card grid. Not checked in a browser: spacing, alternation and women's-theme tint on the index.

## Concept renders on product pages (temporary)

Four supplied renders (`public/images/concept/*.webp`, resized to 960x1200) show on products with no approved photograph: women's-theme syrups get three, other syrups one, capsules none (no render yet). Each carries a "Concept render" tag and alt text saying it is not a final photograph. Approved photos from the admin always take priority. One switch removes all of them: `SHOW_CONCEPT_RENDERS` in `src/content/concept-renders.ts`. Which render goes with which product is a placeholder choice.
Risk, decided by the owner: the renders' labels carry benefit, safety and "100% Ayurvedic" wording, and a regulatory-style mark, none of it reviewed. Remove before any launch email or public promotion unless a claims reviewer has cleared them.
