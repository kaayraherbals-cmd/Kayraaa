# Home page flash and late "Ask Kaayra AI" button (fix, 2026-10-29)

## What the screen recording showed
On every reload of the home page:
1. The hero first painted the old pre-launch wording ("Join the launch list", "How we work", "Our products are in development. Nothing is for sale yet..."), then swapped to "Shop the collection" / "Our approach" and the note disappeared.
2. The "Ask Kaayra AI" button appeared well after the rest of the page.
3. The announcement bar above the header had the same problem (pre-launch text, then "Formulated in Kashi...").

## Root causes
- `Home.tsx`: `hasCollection` was `false` while `/api/products` was still loading, so the "closed" wording was the first thing drawn, and it is also what the prerendered HTML contains.
- `Layout.tsx`: `bagOpen` came from `CartProvider`, which starts at `false` and is only set after `/api/cart/config` answers.
- `KaayraAI.tsx`: waited a fixed 1.5 s (`setTimeout`) and then made a request before showing the button.

## What changed
- `src/lib/siteHints.ts` (new): remembers three yes/no answers in localStorage (collection has products / something for sale, bag open, Kaayra AI on). 14-day limit, no personal data. `useSiteHints()` uses `useSyncExternalStore` with an empty server snapshot, so prerendered HTML and first client render always match (no hydration warning).
- Written by: `products.ts` (`loadProducts`), `cart.tsx` (via new `cartApi.enabledKnown()`, which returns `null` on network/5xx so a blip is never remembered as "closed"), `aiApi.ts` (`aiEnabled`, now shared for 20 s).
- `Home.tsx`: three states. Live answer wins; otherwise the remembered answer; otherwise (very first visit) a reserved, invisible placeholder the same size as the button and note. The secondary link now reads "Our approach" in every state (it goes to the same page), so only the primary button can differ.
- `Layout.tsx` + `layout.css`: the announcement bar uses the remembered state; unknown keeps its height and stays empty, then fades in.
- `KaayraAI.tsx`: the 1.5 s delay is gone; the button shows from the remembered state on the first frame and the live answer confirms or corrects it.
- `src/lib/warmSiteState.ts` + `main.tsx`: starts the AI-config and collection requests before React finishes starting (skipped on /admin, /checkout, /pay).
- `src/lib/siteHints.test.ts` (new).

## Checked
- siteHints logic: 5 checks run in Node against the transpiled file (store, no rewrite when unchanged, blocked storage, server, merge/stale/junk). PASS.
- Hero markup with the real CSS in Chromium (phone 390 px and desktop 1280 px): the hero buttons do not move between the first-visit placeholder and the final state on desktop (top 531.8 px both). On a phone the announcement bar placeholder reserves three lines, so on a first-ever visit it can shift by about 19 px; the status note collapsing when something is for sale moves the section below it. Both only happen on a first visit with no memory.
- NOT RUN: `npm ci`, `tsc`, ESLint, Vitest (including the new test), the real build, the real app in a browser, a real phone. No network in this session.

## Run first
`npm ci && npm run typecheck && npm run lint && npm test && VITE_SITE_URL=https://kaayraherbals.com npm run build`

## Not touched (founders decide)
The `<meta name="description">` / Open Graph text in `index.html` and the prerendered HTML still say "nothing is for sale yet". That is SEO wording and is on the open founder list in the SEO handoff.
