# Premium UI V3 (Kaayra Herbals)

## Design system (src/styles/)
- `tokens.css`: the only place brand colours are defined. Midnight Forest #09231C, Deep Forest #102F25, Warm Parchment #F6F1E7, Antique Gold #C49C62, Cream #FFFCF5. Derived text colours (`--gold-text`, `--muted`) meet WCAG AA on parchment/cream. Old variable names (`--ivory`, `--forest`, `--brass`, `--paper`) are aliases.
- `base.css` (reset, type, buttons, forms, utilities, reduced-motion), `layout.css` (header, mobile menu, search, footer), `home.css`, `shop.css` (cards, collection, product page, buy bar), `bag.css` (drawer, bag, checkout), `account.css`, `pages.css` (inner pages), `legacy.css` (remaining auth/ingredient/article/notice rules). `admin.css` loads only with the admin.
- Fonts: Cormorant Garamond, Manrope, Tiro Devanagari Hindi (self-hosted, unchanged).
- `shared/brand.test.ts` guards: five colours defined only in tokens.css.

## Components
Layout (nav, mobile menu, footer), SearchOverlay, AccountMenu, CartBadge, Home, Collection (search/filter/sort in URL), ProductCard, ProductDetail, ProductGallery, AddToBag (purchase panel + sticky mobile bar), PinChecker, CheckoutSummary, Bag, Checkout (two-column), Account, TrackOrder (list + order detail).
Prices, availability, totals, delivery charge and payment validation stay server-side; the browser only displays them (`src/lib/variants.ts` caches `/api/cart/variants`).

## API additions (no new serverless function; Hobby limit is 12)
- `GET /api/checkout/pincode?pin=` public, rate limited, returns serviceable / rate / free-delivery threshold.
- `GET /api/orders/detail?order=` own order only: items, totals, address, refund status.
- `orders/list` now also returns address fields and refund status per order.
- Tests: `server/api-tests/pincode.test.ts`, additions to `orders.test.ts`.

## Known limits
- "Saved addresses" are the distinct addresses from past orders (no address-book table).
- Screenshots/checks use stubbed API data (`scripts/ui-check.py`); no live Supabase/Razorpay run.
- Run `npm run ui:check` after `npm run build && npx vite preview --port 4173`; Chromium via Playwright required.

## Fixes found while verifying
- `/checkout` added to `shared/private-routes.json` (it had no prerendered shell, so cleanUrls would not serve it).
- `src/pages/AdminProducts.tsx` (from the admin-products-simplified zip) did not compile; Advanced section moved to the end of the editor.
- `scripts/ui-check.py` serves `dist/` with vercel.json's cleanUrls and rewrites; `vite preview` does not, and gives false hydration errors.
