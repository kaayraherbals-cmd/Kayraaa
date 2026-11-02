import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, publicFlags, readFlags } from './flags.js';
import { COMMERCE_ENABLED } from './commerce.js';
import { liveSalesApproved } from './liveSales.js';
import { checkoutOpen, isTestOrder } from './checkout.js';
import { paymentsOpen } from './payments.js';

const APPROVAL = { LIVE_SALES_APPROVED: 'on', LIVE_SALES_APPROVED_BY: 'owner', LIVE_SALES_APPROVAL_REF: 'REF-1' };
const TEST_KEY = 'rzp_test_ABCDEF123456';
const LIVE_KEY = 'rzp_live_ABCDEF123456';

describe('commerce master switch', () => {
  it('is on (explicit owner decision, Phase 7 Step 3)', () => expect(COMMERCE_ENABLED).toBe(true));
});

describe('environment matrix', () => {
  const staging = ['preview', 'development', ''].map((v) => (v ? { VERCEL_ENV: v } : {}));
  it.each(staging.map((e, i) => [i, e]))('non-production env #%s: bag, checkout, test payments, order history, shipping open; live sales never', (_i, env) => {
    const f = readFlags(env as Record<string, string>);
    expect(f.cart_preview && f.checkout_testing && f.payment_test_mode && f.shipping_integration && f.customer_order_history).toBe(true);
    expect(f.live_sales).toBe(false);
    expect(checkoutOpen(f)).toBe(true);
    expect(paymentsOpen(f, TEST_KEY)).toBe(true);
    expect(paymentsOpen(f, LIVE_KEY)).toBe(false);
    expect(isTestOrder(f)).toBe(true);
  });
  it('non-production ignores the live-sales approval variables', () => {
    const f = readFlags({ VERCEL_ENV: 'preview', ...APPROVAL });
    expect(f.live_sales).toBe(false);
    expect(paymentsOpen(f, LIVE_KEY)).toBe(false);
  });
  it('production before approval: bag only; no checkout, no payment, no live key, no test key', () => {
    const f = readFlags({ VERCEL_ENV: 'production' });
    expect(f.cart_preview).toBe(true);
    expect(checkoutOpen(f)).toBe(false);
    expect(paymentsOpen(f, LIVE_KEY)).toBe(false);
    expect(paymentsOpen(f, TEST_KEY)).toBe(false);
  });
  it('production ignores FEATURE_* variables', () => {
    const f = readFlags({ VERCEL_ENV: 'production', FEATURE_CHECKOUT_TESTING: 'on', FEATURE_PAYMENT_TEST_MODE: 'on', FEATURE_CART_PREVIEW: 'on' });
    expect(checkoutOpen(f)).toBe(false);
    expect(paymentsOpen(f, TEST_KEY)).toBe(false);
  });
  it('production with full approval: checkout and live payments open, orders are live, test key refused', () => {
    const f = readFlags({ VERCEL_ENV: 'production', ...APPROVAL });
    expect(f.live_sales).toBe(true);
    expect(checkoutOpen(f)).toBe(true);
    expect(paymentsOpen(f, LIVE_KEY)).toBe(true);
    expect(paymentsOpen(f, TEST_KEY)).toBe(false);
    expect(isTestOrder(f)).toBe(false);
  });
  it('production approval is all-or-nothing', () => {
    for (const drop of Object.keys(APPROVAL)) {
      const env: Record<string, string> = { VERCEL_ENV: 'production', ...APPROVAL };
      delete env[drop];
      expect(liveSalesApproved(env)).toBe(false);
      expect(checkoutOpen(readFlags(env))).toBe(false);
    }
    expect(liveSalesApproved({ VERCEL_ENV: 'production', ...APPROVAL, LIVE_SALES_APPROVED: 'true' })).toBe(false);
    expect(liveSalesApproved({ VERCEL_ENV: 'production', ...APPROVAL, LIVE_SALES_APPROVAL_REF: '  ' })).toBe(false);
  });
  it('fails closed: NODE_ENV=production with no VERCEL_ENV counts as production', () => {
    const f = readFlags({ NODE_ENV: 'production' });
    expect(checkoutOpen(f)).toBe(false);
    expect(readFlags({ NODE_ENV: 'production', ...APPROVAL }).live_sales).toBe(true);
  });
  it('a live key never opens payments without live_sales, whatever else is set', () => {
    expect(paymentsOpen(readFlags({ VERCEL_ENV: 'production', FEATURE_PAYMENT_TEST_MODE: 'on' }), LIVE_KEY)).toBe(false);
  });
  it('lists live_sales among the flags and tells the browser only about the bag', () => {
    expect(FEATURE_FLAGS).toContain('live_sales');
    expect(publicFlags(readFlags({ VERCEL_ENV: 'production', ...APPROVAL }))).toEqual({ cartPreview: true });
  });
});
