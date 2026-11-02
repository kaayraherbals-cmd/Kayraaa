# Phase 7 — UI refresh pass 1

## Implemented
- Reduced the primary navigation to Shop, Our Story, Our Approach and Journal. Existing routes and footer navigation remain.
- Added a separate additive premium storefront stylesheet for typography, hero composition, product cards, mobile layout, cart and checkout presentation.
- Updated collection page heading to “The Kaayra Collection.”
- Preserved commerce master switch (`true`), production live-sales approval logic, Razorpay, shipping, email and backend modules.

## Limitations and next pass
- No product imagery or brand SVG assets were provided; existing illustration fallbacks remain.
- No browser screenshots, mobile visual verification, accessibility audit, npm build or test execution was performed in this environment.
- Next: visual QA at 360/390/768/1024/1440px, add approved photography and logos, then improve product gallery, cart and checkout based on screenshots and usability tests.
- Current prelaunch copy and commerce capability coexist deliberately: selling status must reflect real regulatory and operational approval, not just a code switch.

## Atelier v2 fixes (static review, not browser-tested)
- Contrast: `.eyebrow`, `.assure-k`, `.pcard-kicker` and nav hover used #936d40/#8b633b/#906c43/#946e3d (3.8-4.3:1). Now #7d5b31 (4.7:1 or better on parchment, sand, cream).
- Hero headline: 8.1rem max in a ~600px column forced mid-line wraps; capped at 5.9rem, `max-width: none`, mobile minimum 2.6rem.
- Verify in a browser at 360, 390, 768, 1024 and 1440px, then run `npm ci && npm run lint && npm run typecheck && npm test && npm run build`.
