# UI/UX Audit (Phase 2)
Method: built site (`npm run build`), served from `dist/` and driven by Playwright + Chromium, using the repo's own API stub (`scripts/ui-check.py`). Widths 320, 360, 390, 768, 1024, 1280, 1440. 17 public/customer pages x 7 widths = 119 page loads, plus targeted probes (reduced motion, 640x450 landscape, product-page controls).
Not tested here: the admin dashboard screens (no admin stub, no database), real authenticated flows, real data, browser zoom beyond a 640x450 landscape check, screen-reader behaviour. Anything in those areas is UNVERIFIED, not "passing".

## Results
| Check | Result |
|---|---|
| Horizontal page overflow (document level) | None at any width (scrollWidth == clientWidth) |
| Images without alt | 0 |
| Reduced motion (1440, `prefers-reduced-motion: reduce`) | 0 running animations on home |
| 640x450 landscape overflow | 0 px |
| Product page controls (with correct API shapes) | h1 present, delivery PIN checker present, add-to-bag buttons present at 320/390/1440 |
| Wishlist page (empty state, with correct shapes) | Renders, h1 present |
| Honeypot field | Hidden off-screen at left -9999px (checked, not a defect) |

## Findings
| ID | Sev | Where | Evidence | Recommendation |
|---|---|---|---|---|
| KH-014 | P2 | src/styles/layout.css:22-27 (.header-tools, .tool) | At 320px the header tools end at x=340 on a 320px viewport; the cart button spans 296-340, so its last ~20px is cut off (screenshot confirmed; it is not reported as overflow because the page clips it). Present on every page. | Reduce `.tool` min-width/padding or logo size below ~360px so the three controls fit; re-measure at 320. |
| KH-015 | P2 | src/components/reviews/ProductReviews.tsx:121,136 (and src/ has no ErrorBoundary: grep for ErrorBoundary/componentDidCatch finds nothing) | If `/api/reviews/list` returns a body without `items`, `items.length` throws and the WHOLE page goes blank (body text empty, h1 count 0). Reproduced on product pages and /wishlist under the stub. With a correctly shaped response the pages render. | Guard `r.data.items ?? []`, and add one app-level ErrorBoundary with a calm fallback so a single widget cannot blank a page. |
| KH-016 | P3 | scripts/ui-check.py (stub, lines 66-94) | Stub has no `reviews/list` or `cart/wishlist` handler, so `npm run ui:check` crashes at the PIN step (it times out waiting for `.pin input` because the product page is blank). The harness is stale, the PIN checker itself is fine. | Add those two stub handlers; keep it in CI. |
| KH-017 | P3 | SignupForm/ContactForm consent checkbox | Native checkbox is 20x20 CSS px; below the 24px WCAG 2.2 target-size minimum unless its label is the click target (not verified). | Confirm label hit area; enlarge if needed. |

## Not yet audited (to do)
Admin screens (tables as cards below 60rem, forms, charts, finance); keyboard-only walkthrough of search dialog, cart drawer and checkout; focus management on dialogs; contrast measurement (docs claim AA); loading/empty/error states with real latency; Kaayra AI widget; Lighthouse/Core Web Vitals (Phase 6).
