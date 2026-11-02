# UI/UX polish pass (on the GEO Phase 4 tree)

Scope: interaction, motion and loading behaviour. No copy, colour, layout, API, permission or data change. COMMERCE_ENABLED is untouched.

## Bugs found by measuring the built site in Chromium, and fixed

| # | Problem | Evidence | Fix |
|---|---|---|---|
| 1 | Every page change smooth-scrolled up from wherever the reader was (the site sets `scroll-behavior: smooth`, `Layout` called `scrollTo(0, 0)`). Felt like lag on every navigation. | scrollY after a nav click from 2500px: 2475, 2398, 2265 ... 499 over about 500 ms | `Layout.tsx`: new pages open at the top at once (`behavior: 'instant'`); only a hash link inside the same page scrolls smoothly. After: 0 on the first sample. |
| 2 | Bag drawer and mobile menu animated in but vanished instantly on close. | code + screenshots | New `src/lib/usePresence.ts` keeps them mounted for the exit animation; they are `inert` while leaving (no focus, no clicks); reduced motion hides at once. |
| 3 | Back office loading state was a bare "Loading…" line. | `App.tsx` | New `RouteLoading` (brand mark, shimmer placeholders, thin progress line). Seen only on client-side entry to /admin; the prerendered sign-in shell still shows on a direct load. |
| 4 | Three conflicting `.reveal` definitions (base.css, legacy.css twice: 0.55s, 0.8s, 0.9s) and leftover transition delays would have delayed hover effects. | grep | One definition in `polish.css`: an animation with backwards fill, so nothing is left on the element afterwards (computed transition-delay 0s, will-change auto after reveal). Siblings arrive in a short stagger. |
| 5 | Checkout summary header broke as "(3 / items)". | screenshot at 390px | `white-space: nowrap` on the count (`bag.css`). |
| 6 | Stale test: `server/ai/customer.test.ts` expected 900 output tokens; the config default is 1024. | baseline: 1 failing test | Test now expects 1024. |

## Added (all in `src/styles/polish.css`, loaded last)

Buttons lift on hover and press firmly (hover devices only); product cards lift with a soft shadow; form fields get a hover border and a warm gold focus halo; checkboxes and radios are 1.25rem; search panel, account menu and cart badge enter softly; page change is a 0.38s opacity fade (no transform, so fixed bars never jump); tap highlight and 300 ms tap delay removed. Everything is opacity/transform only and sits inside `prefers-reduced-motion: no-preference`.

## Measured (Chromium, stubbed API, built site)

- Cumulative layout shift 0.0043 (header font swap only), LCP 0.3 to 0.5 s, one long task of about 75 ms at start-up.
- `npm run ui:check`: 65 page checks at 360/390/768/1024/1440, 0 with issues (no horizontal overflow); 17 interaction checks, 0 failed.
- Motion probe: menu +90 ms opacity 0.23 and inert, hidden by +490 ms with focus back on the toggle; bag same; reopen works; reveal leaves no delay; card hover lifts 4px at once; reduced motion hides at once and keeps every reveal visible.

## Verified commands

`npm run typecheck`, `npm run lint`, `npm test` (1198 passed, 1 skipped), `npm run build`, `npm run seo:schema` (11/11), `npm run ui:check`.
`npm run seo:check` reports the production-sitemap references because `VITE_SITE_URL` is not set in this sandbox (placeholder domain); not caused by this pass.

## Not done / needs a real device

No physical-device check (iOS Safari, Android Chrome). The Gemini AI, payments and database were not exercised (no keys, no database). Public pages are still one bundle (about 408 KB JS before compression); splitting them would need a hydration plan, so it was left alone.
