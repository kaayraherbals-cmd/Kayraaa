# Implementation Changelog (2026-10-24)
Only small, reversible, non-financial changes were made.
- src/styles/layout.css: narrow-phone header (below 360px) uses content-sized columns, smaller brand, tighter tool padding (KH-014).
- src/components/reviews/ProductReviews.tsx, src/lib/wishlist.ts: tolerate a response without `items`/`stats` (KH-015).
- src/components/ErrorBoundary.tsx (new) wrapped around the routes in src/App.tsx, resets on route change; fallback screen not yet browser-verified (KH-015).
- public/llms-full.txt: FAQ heading reworded so the forbidden-claims test stays strict and passes (KH-001). Sale-status wording NOT changed (KH-020).
- scripts/ui-check.py: stub handlers for reviews/list and cart/wishlist (KH-016).
- server/api-tests/wishlist.test.ts (new): 15 mocked API tests for access control, add/list/remove, member isolation, validation, failure (KH-005).
Not changed on purpose: money/GST/refund logic, stock logic, crons, AI token cap, dependencies, SQL.
