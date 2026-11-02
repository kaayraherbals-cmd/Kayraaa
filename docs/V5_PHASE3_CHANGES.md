# V5 Phase 3: premium visual refinement

Scope: typography, homepage, product, cart and checkout presentation, admin shell, responsive rules, design-system consolidation.
**No tests, type checks, lint or builds were run in this phase** (as instructed), and no browser was used. Everything below was checked only by
reading source, plus two scripted sanity checks (balanced CSS braces; every `var(--x)` resolves to a defined token). Nothing is claimed as passing.

## What changed

| File | Change |
|---|---|
| `src/styles/tokens.css` | New unified type scale, weights, line heights, tracking, spacing scale, section rhythm, radius-md, three shadows, `--faint-on-dark`. Brand colours and legacy aliases untouched (the brand test reads them). |
| `src/styles/base.css` | Headings use the scale (h1 max 52px, was 74px); new h4; heading rhythm for `.prose`; sentence-case buttons, links, badges and form labels; softer eyebrow; field transitions; 320px safeguards for buttons and the buy row. |
| `src/styles/layout.css` | Sentence-case announcement bar, navigation, tools and menu toggle (15px, medium); smaller mobile-menu links; footer wordmark reduced from up to 208px to 80px; footer headings and labels simplified; hard-coded greys replaced by tokens. |
| `src/styles/home.css` | Hero: flat midnight (radial gradients and the giant "K" watermark removed), `--fs-hero`; philosophy, Kashi, newsletter and journal headings on the scale; Kashi mark reduced; assurance and story labels in sentence case; calmer hover shifts. |
| `src/styles/shop.css` | Product titles, prices (tabular lining numerals), pack selector, quantity, breadcrumbs, chips, kickers and notices on the scale; editorial stagger offsets removed so the grid is even; flat placeholders instead of gradients; collection and product headings capped at h1. |
| `src/styles/bag.css` | Cart drawer, bag page, checkout, order summary and confirmation on the scale; totals use tabular numerals; 4px radius on summary panels; shared shadow token. |
| `src/styles/account.css`, `pages.css` | Account, order and tracking, inner-page and article headings on the scale; status pills and the order stepper in sentence case at readable size (11px minimum on phones, wraps instead of overflowing); page-hero gradient removed. |
| `src/styles/legacy.css` | Removed `.article h1` and `.prose h2` (duplicated in `pages.css`); remaining oversized fixed sizes moved to tokens. |
| `src/pages/Admin.tsx` | `Dashboard` renders a sidebar (`.admin-layout`, `.admin-side`, `.admin-content`) instead of the two-row top navigation. Same tabs, same `me.can(...)` permission filtering, same `setTab`, same panels, same `region` and ids. Group headings show only for groups with more than one visible page. |
| `src/admin.css` | Removed dead top-tab and top-nav rules; leftover green rgba values moved to Deep Forest; headings in Instrument Sans at working sizes; duplicate heading, subhead, main and font-size rules merged; new sidebar block (sticky column from 64rem, scrolling strip below); common radius, shadows and tabular numerals. |
| `docs/DESIGN_SYSTEM.md` | Rewritten to match the current system (the old text described a superseded palette and fonts). |
| `docs/V5_PHASE3_CHANGES.md` | This file. |
| `.github/workflows/ci.yml`, `docs/V5_PHASE2_CHANGES.md` | From the Phase 2 follow-up (new `ui-check` CI job, never run). They differ from the zip you uploaded because that zip predates the follow-up. |

Not touched: `api/`, `server/`, `shared/`, `supabase/`, payment, inventory, order, auth and admin-authorization code, migrations, tests, `package.json`,
the lockfile, fonts, and every other `.tsx` file. No dependency was added. Live payments were not enabled.

## What was not done (and why)

- **No new markup on the public site.** Homepage, product, cart and checkout improvements are stylesheet-level, so layouts, copy and components are the
  existing ones. Larger editorial changes (new homepage sections, a filter sidebar, new gallery behaviour) would need browser review and were not attempted blind.
- **No new content.** No products, prices, certifications, reviews or photographs were added; placeholders remain labelled.
- **Consolidation is partial.** `legacy.css` and `admin.css` still contain layered override blocks (see `DESIGN_SYSTEM.md`, Known debt).
- **Admin tables, forms, modals and filters** received type, radius, shadow and numeral rules only; their markup is unchanged.
- **Product grid on phones** stays one column below 40rem (two columns at 320px would crowd titles and buttons without a browser check).

## Unverified: please check before relying on this

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npm run ui:check` (see `docs/INDEPENDENT_TESTING.md`) and look at the site at
320, 375, 390, 430, 768, 1024 and 1440px. Specific things to look at:

1. Admin sidebar: sticky behaviour, the horizontal strip under 64rem, and that no role loses a page.
2. Header and mobile menu at 320 and 375px after the sentence-case change; hero heading wrap; footer wordmark and the Devanagari mark overlap.
3. Product page: buy row at 320px (wraps below 22.5rem), pack selector, sticky mobile bar.
4. Checkout and order tracking stepper labels at 320px.
5. Any page that relied on the removed large headings or the removed `.hero::after` for visual balance.
6. `scripts/ui-check.py` may assert on layout details that moved (it was not run; its pass or fail is unknown).
