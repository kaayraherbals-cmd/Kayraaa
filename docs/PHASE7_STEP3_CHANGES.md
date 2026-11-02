# Phase 7 Step 3 changes

- `shared/commerce.ts`: COMMERCE_ENABLED = true (owner decision). Enables features only.
- `shared/liveSales.ts` (new): `isProductionEnv` (fails closed: NODE_ENV=production with no VERCEL_ENV counts as production) and `liveSalesApproved(env)`: production AND LIVE_SALES_APPROVED=on (exactly) AND LIVE_SALES_APPROVED_BY AND LIVE_SALES_APPROVAL_REF non-empty.
- `shared/flags.ts`: new `live_sales` flag. Non-production: bag, checkout, test payments, shipping, order history on automatically. Production: bag only; checkout/shipping/history open only with live-sales approval. FEATURE_* variables are ignored in production.
- `shared/checkout.ts`: `checkoutOpen` no longer uses the master switch; `isTestOrder(flags)` is false only with live sales.
- `shared/payments.ts`: `paymentsOpen`: TEST key needs payment_test_mode (non-production only); LIVE key needs live_sales.
- `api/admin/[action].ts`: admin order creation follows the same gate.
- `api/checkout/[action].ts`: orders marked test via `isTestOrder(flags)`.
- Webhooks, refunds and reconciliation are not gated (unchanged), so existing payments are still processed.
- Tests rewritten for the matrix: shared/flags.test.ts, commerce.test.ts, checkout.test.ts, payments.test.ts, server/api-tests/{cart,checkout,payments}.test.ts (all UNRUN).
- `.env.example`: LIVE_SALES_* variables.

## Continue session: customer tracking (section 5, partly)
- `shared/tracking.ts` + `tracking.test.ts`: order-id validation and whitelisting of `shipments_for_member()` output; unknown statuses dropped; nothing invented.
- `api/orders/[action].ts` (new, 11th function of 12): `GET list` and `GET track?order=`; signed-in only, ownership by `member_id`, rate limited, not gated by the sales switch (existing customers keep access).
- `src/pages/TrackOrder.tsx`, routes `/track-order` and `/track-order/:id`, noindex header, rewrite for direct loads, private-routes entry. No styling added yet (class names `track*` unstyled).
- Resolves issue S2-008 in code; UNRUN and untested in a browser.

## Third continue session
- `shared/payments.ts` `keyMatchesOrder` + guard in `payAction`: a test order is only paid with a rzp_test_ key, a live order only with rzp_live_.
- `CartSummary.tsx`: wording when checkout is open but the bag is empty.
- `docs/PHASE7_STEP3_ISSUES.md`: issue register (confirmed vs suspected).

- Fourth session: `src/track.css` (tracking page styling, imported in main.tsx) and an "Your orders" button on the Account page for members. Not viewed in a browser.
