/**
 * Development feature flags for the commerce build-out. Every flag is OFF unless its environment variable is set to
 * "on" (or "true" / "1"). They are separate from COMMERCE_ENABLED (shared/commerce.ts), which remains the hard master
 * switch for real sales: no flag here can open a public purchase.
 *
 * Production guard: while production, every FEATURE_* variable is ignored. With COMMERCE_ENABLED on, staging opens test
 * commerce by itself; production opens only through liveSalesApproved() (shared/liveSales.ts). Turning a
 * flag on in production needs a code change and explicit business approval, not just an environment variable.
 */
export const FEATURE_FLAGS = ['cart_preview', 'checkout_testing', 'payment_test_mode', 'shipping_integration', 'customer_order_history', 'live_sales'] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type Flags = Record<FeatureFlag, boolean>;

export const FLAG_ENV: Record<FeatureFlag, string> = {
  cart_preview: 'FEATURE_CART_PREVIEW',
  checkout_testing: 'FEATURE_CHECKOUT_TESTING',
  payment_test_mode: 'FEATURE_PAYMENT_TEST_MODE',
  shipping_integration: 'FEATURE_SHIPPING_INTEGRATION',
  customer_order_history: 'FEATURE_CUSTOMER_ORDER_HISTORY',
  live_sales: 'LIVE_SALES_APPROVED',
};

import { COMMERCE_ENABLED } from './commerce.js';
import { isProductionEnv, liveSalesApproved } from './liveSales.js';

export { isProductionEnv };

const isOn = (v: string | undefined): boolean => ['on', 'true', '1'].includes((v ?? '').trim().toLowerCase());

export function readFlags(env: Record<string, string | undefined>): Flags {
  const prod = isProductionEnv(env);
  const out = {} as Flags;
  for (const f of FEATURE_FLAGS) out[f] = !prod && isOn(env[FLAG_ENV[f]]);
  out.live_sales = false;
  const master: boolean = COMMERCE_ENABLED;
  if (!master) return out;
  // Master switch on: the bag is open everywhere (catalogue, bag).
  out.cart_preview = true;
  if (!prod) {
    // Staging / preview / local: checkout, test payments, order history and shipment tracking, in test mode only.
    out.checkout_testing = true;
    out.payment_test_mode = true;
    out.shipping_integration = true;
    out.customer_order_history = true;
  } else if (liveSalesApproved(env)) {
    // Production only opens for purchase with the separate live-sales approval.
    out.live_sales = true;
    out.checkout_testing = true;
    out.shipping_integration = true;
    out.customer_order_history = true;
  }
  return out;
}

/** What the browser may know: only whether the cart preview is open. Other flags stay server side. */
export const publicFlags = (f: Flags): { cartPreview: boolean } => ({ cartPreview: f.cart_preview });
