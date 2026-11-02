# Design system (public site and back office)

Current as of V5 Phase 3. Earlier documents (`UI_V3_REDESIGN.md`, `UI_V4_CHANGELOG.md`, `PREMIUM_STRATEGY.md`) describe older palettes and fonts and are
kept as history only. **Source of truth: `src/styles/tokens.css`.** Every other stylesheet reads its variables.

## Stylesheets and load order (`src/main.tsx`)

`tokens.css` (variables) then `legacy.css` (auth, article, ingredient and form leftovers), `base.css` (reset, type, buttons, forms), `layout.css` (header, menu,
search, footer), `home.css`, `shop.css`, `bag.css` (cart and checkout), `account.css`, `pages.css`. The back office adds `src/admin.css`, scoped to
`.admin-shell` and loaded only with the code-split admin.

## Colour

Five master colours, defined once in `tokens.css` (a test enforces this): Midnight `#09231C`, Deep Forest `#102F25`, Warm Parchment `#F6F1E7`,
Antique Gold `#C49C62`, Cream `#FFFCF5`. Derived tokens: `--gold-text` (gold for small text on light, 5.6:1 on parchment), `--gold-light`,
`--ink`, `--muted`, `--muted-on-dark`, `--faint-on-dark` (7.6:1 on midnight), `--sand`, `--line*`, and status colours `--ok`, `--warn`, `--bad`.
Contrast numbers are arithmetic (WCAG formula), not an accessibility audit. Gradients are limited to the loading shimmer.

## Typography (three voices, no others)

| Voice | Font | Used for |
|---|---|---|
| Display serif | Fraunces Variable | Headings, wordmark, product and list titles, prices |
| Interface and reading | Instrument Sans Variable | Body, navigation, buttons, forms, tables, the whole back office |
| Devanagari accent | Noto Serif Devanagari | Sanskrit and Hindi words only |

One scale (tokens): `--fs-label` 12px, `--fs-small` 14px, `--fs-body` 16px, `--fs-md` 18px, `--fs-lede`, `--fs-h4` 18px, `--fs-title` 20 to 24px,
`--fs-h3` 22 to 28px, `--fs-h2` 28 to 40px, `--fs-h1` 34 to 52px, `--fs-hero` 36 to 62px (homepage hero only), `--fs-price` 22px, `--fs-price-lg` 28 to 36px.
Weights 400, 500, 600, 700 (`--fw-*`). Line heights `--lh-tight` 1.12, `--lh-snug` 1.3, `--lh-body` 1.65. Headings use `-0.015em` tracking.

Rules: sentence case for buttons, navigation, form labels, chips, badges, breadcrumbs and table headings. Small uppercase with `--ls-label` (0.1em)
is reserved for eyebrows, product kickers and a few quiet labels. Prices and quantities use lining, tabular numerals.
Page headings no longer go above `--fs-h1`; decorative watermark type (hero "K", oversized footer and Kashi marks) was reduced or removed.

## Space, shape, elevation, motion

Spacing tokens `--sp-1` to `--sp-8` (4px base) and `--section-y` for section rhythm. Radius: `--radius` 2px for controls, `--radius-md` 4px for cards,
panels, dialogs and the cart and checkout summaries. Shadows: `--shadow-sm`, `--shadow-md`, `--shadow-overlay` (overlays only). Motion: opacity and
transform only, short durations (`--dur-*`), switched off under `prefers-reduced-motion`.

## Components

- Buttons `.btn` (primary forest, `--ghost`, `--gold` on dark, `--sm`, `--danger`), `.link-arrow`, `.pchip` filter chips, `.badge`, `.pill`.
- Forms `.field` (label, input, hint, error). Inputs are 48px tall and 16px type (no iOS zoom). Focus is a visible outline plus border change.
- Product: `.pvisual` (4:5), `.pcard`, `.pgrid` (1, 2, 3 columns at 40rem and 64rem), gallery, `.sizes` pack selector, `.cart-stepper`, `.buy-bar`.
- Cart and checkout: `.cart-*` drawer and page, `.co-*` checkout, collapsible order summary on phones, sticky beside the form on desktop.
- Back office: `.admin-layout` with a sticky sidebar (`.admin-side`) from 64rem and a scrolling strip below; `.admin-table` (rows become labelled cards under 60rem),
  `.aprod` product cards, `.admin-dialog`, `.stat-row` overview cards. Headings use Instrument Sans at working sizes.

## Known debt (not changed in Phase 3)

`legacy.css` and `admin.css` still hold layered override blocks from earlier phases; `.grid-2` and `.grid-3` exist in both `legacy.css` and `base.css`
(`legacy.css` adds a top margin that pages rely on). Consolidating them safely needs a browser to compare before and after.
`shared/mailTemplates.ts` names fonts that email clients cannot load anyway. No logo artwork or photography exists yet (placeholders stay labelled).
