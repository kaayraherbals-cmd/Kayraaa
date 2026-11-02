# UI premium pass (v11, on kaayra-herbals-v11-fast-language)

CSS only. No copy, claims, prices, markup, API or SQL changed.

## What changed
- `src/styles/tokens.css`: radii 2/4px -> 12/18/26px (`--radius`, `--radius-md`, new `--radius-lg`); two-layer forest-tinted shadows (`--shadow-sm/md/lg`, new `--shadow-gold`); hairline `--line` softened (.16 -> .12; `--line-strong` unchanged so form borders keep their contrast); motion tokens faster (`--dur-1` .12s press, `--dur-2` .16s hover, `--dur-3` .22s panels, `--dur` .35s). The five master colours are untouched.
- `src/styles/premium.css` (new, loaded after `polish.css`, before `womens.css`): soft gradient buttons with inner highlight, gold buttons on dark, flat disabled state, 1px hover lift and a 60ms press; rounded fields with a warm focus halo; one radius/shadow language for cards, product pictures, size options, steppers, drawer, search panel, account menu; hero depth from a radial mix of existing tokens; shorter, lighter reveal (14px, .55s, tighter stagger); faster page fade; thin scrollbars on inner scrollers; footer `content-visibility: auto`.
- `src/styles/base.css`: removed `border-radius: 2px` from the global `:focus-visible` rule (it squared off rounded buttons while focused).
- `src/main.tsx`: imports `premium.css`.

## Checked
- Chromium render of a static mock built from the real stylesheets (all files in main.tsx order) at 1440px and 390px: no horizontal overflow, computed radii, gradients, shadows and durations as intended.
- Brand-colour rules from `shared/brand.test.ts` re-run by hand: pass.

## NOT run
`npm ci` failed (registry host not resolvable from this sandbox), so typecheck, lint, vitest, the real build, `ui:check` and the real app in a browser were NOT run. Run first:
`npm ci && npm run typecheck && npm run lint && npm test && VITE_SITE_URL=https://kaayraherbals.com npm run build && npm run ui:check`
Then look at the header at 320 to 390px, the cart drawer, checkout, account and the women's (pink) product page: the larger radii apply everywhere through the tokens. Admin shares the tokens; its own literal radii are unchanged.

## Database
Supabase project `kaayra-herbals` (ref mbmkeiihfeysxqnvzcda): files 1 to 22 are tracked; tables for files 23 to 30 (reviews, coupons, cart recovery, loyalty, bundles/wishlists, finance, ai) already exist. Only `supabase/stage7_commerce.sql` (file 31) is missing: `orders.bundle_discount_paise` / `loyalty_discount_paise`, `loyalty_order_snapshots` and `checkout_place_full` were not found. The apply was attempted through the connector and the confirmation was cancelled, so NOTHING was applied. `orders` has 0 rows, so it is safe to apply now (SQL editor, then `supabase/stage7_selftest.sql`). Until it is applied, code that calls `checkout_place_full` will fail at checkout.

## Menu pass (same session)
CSS only, end of `src/styles/premium.css`; `Layout.tsx` unchanged.
- Mobile sheet: deeper forest-to-midnight ground with a gold glow, gold hairline under the head, rounded bottom edge, "Explore" label with a trailing rule. Rows are soft rounded targets with a divider, hover/press wash, round arrow chips, and a gold bar plus gold chip on the current page. Account buttons use the site gold button style. The sheet settles down 12px (0.3s) and rows rise in a 45ms stagger (was 0.5s each); account and footer follow.
- Menu toggle: now a bordered pill with a surface fill (fills forest when expanded) and a 60ms press.
- Desktop nav (68rem and up): pill hover wash and a short centred gold bar for the current page.
- Checked: Chromium mock with the real CSS (390px sheet, 1440px nav hover, 390px toggle). NOT run: the real app, keyboard/focus trap behaviour (unchanged JSX), npm checks.
