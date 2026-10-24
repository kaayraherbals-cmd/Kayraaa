/**
 * Commerce master switch. Phase 7 Step 3: ON by explicit owner decision. It enables the commerce FEATURES (bag, checkout,
 * test payments on staging, order history, shipment tracking). It does NOT authorise live payments: production purchases
 * stay closed until the separate server-enforced approval in shared/liveSales.ts is given (LIVE_SALES_APPROVED etc.).
 * Staging / preview / local run test mode only (Razorpay TEST keys, orders marked as test).
 */
export const COMMERCE_ENABLED = true as const;

/**
 * Ordering requires a signed-in account (Google or email and password). This is a rule for when commerce is approved; it does
 * not enable anything. Server order endpoints must check the session as well as COMMERCE_ENABLED and product status.
 * Research note: forcing sign-in before checkout can lower conversion; one-tap Google sign-in and, later, mobile OTP soften it.
 */
export const ORDER_REQUIRES_SIGN_IN = true as const;
