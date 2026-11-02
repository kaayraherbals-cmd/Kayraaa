/**
 * Production live-sales approval (Phase 7 Step 3).
 *
 * COMMERCE_ENABLED (shared/commerce.ts) switches the commerce FEATURES on: catalogue, bag, checkout, order history,
 * shipment tracking. It does not authorise real money to move. Real (live) purchases in production need this separate,
 * server-enforced approval, which is read only on the server and is never sent to the browser.
 *
 * Approval needs ALL of:
 *  - the deployment is production (VERCEL_ENV=production, or NODE_ENV=production when VERCEL_ENV is unset: fail closed)
 *  - LIVE_SALES_APPROVED is "on" (exactly; "true" / "1" are not accepted)
 *  - LIVE_SALES_APPROVED_BY (who approved) and LIVE_SALES_APPROVAL_REF (ticket / date reference) are non-empty
 * Anything else, including a missing variable, means NOT approved. Staging, preview and local never use live sales:
 * they run test mode only, with Razorpay TEST keys (shared/payments.ts).
 */
export type Env = Record<string, string | undefined>;

export const isProductionEnv = (env: Env): boolean => {
  const v = (env.VERCEL_ENV ?? '').trim().toLowerCase();
  if (v) return v === 'production';
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
};

export function liveSalesApproved(env: Env): boolean {
  if (!isProductionEnv(env)) return false;
  if ((env.LIVE_SALES_APPROVED ?? '').trim().toLowerCase() !== 'on') return false;
  return (env.LIVE_SALES_APPROVED_BY ?? '').trim().length > 0 && (env.LIVE_SALES_APPROVAL_REF ?? '').trim().length > 0;
}
