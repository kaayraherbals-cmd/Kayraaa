import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMERCE_ENABLED } from './commerce.js';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('commerce is enabled, production purchases stay gated', () => {
  it('current-state docs do not claim commerce is off', () => {
    for (const f of ['../HANDOFF.md', '../docs/COMMERCE_STATE.md', '../docs/PHASE7_STEP3_HANDOFF.md']) {
      expect(/COMMERCE_ENABLED\s*=\s*false(?! as)/.test(read(f).replace(/Do not set[^\n]*/g, '')), f).toBe(false);
    }
  });
  it('has the master switch on (explicit owner decision)', () => {
    expect(COMMERCE_ENABLED).toBe(true);
  });
  it('has no payment or order routes in the app, and no payment provider in the deployment config', () => {
    const app = read('../src/App.tsx');
    expect(/path="(payment|orders?)/i.test(app)).toBe(false);
  });
  it('lets only the checkout page talk to Razorpay, and no other page or provider', () => {
    const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const csp = cfg.headers.filter((r) => r.headers.some((h) => h.key === 'Content-Security-Policy'));
    const val = (r: (typeof csp)[number]) => r.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    const pay = csp.filter((r) => /razorpay/i.test(val(r)));
    expect(pay.map((r) => r.source)).toEqual(['/checkout']);
    // Every page other than /checkout still has the strict default, and the two rules do not overlap.
    const def = csp.filter((r) => r.source !== '/checkout');
    expect(def).toHaveLength(1);
    expect(def[0].source).toBe('/((?!checkout$).*)');
    // 'self' plus exactly one SHA-256 hash (the inlined boot script, checked by scripts/prerender.mjs); never unsafe-inline.
    expect(val(def[0])).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+';/);
    expect(val(def[0])).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(val(def[0])).toContain("connect-src 'self';");
    expect(val(def[0])).not.toMatch(/razorpay|stripe|paypal|payu|cashfree/i);
    // The checkout rule allows exactly Razorpay's hosts, no wildcard for scripts, and keeps the other protections.
    const p = val(pay[0]);
    expect(p).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+' https:\/\/checkout\.razorpay\.com;/);
    expect(/script-src[^;]*\*/.test(p)).toBe(false);
    expect(p).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|default-src \*/);
    for (const must of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'"]) expect(p).toContain(must);
    // No competing payment provider anywhere in the deployment config, and the other security headers apply to every page.
    expect(JSON.stringify(cfg)).not.toMatch(/stripe|paypal|payu|cashfree|phonepe/i);
    const all = cfg.headers.find((r) => r.source === '/(.*)')!;
    for (const k of ['X-Content-Type-Options', 'X-Frame-Options', 'Strict-Transport-Security', 'Referrer-Policy', 'Permissions-Policy']) expect(all.headers.some((h) => h.key === k)).toBe(true);
  });
  it('keeps the checkout page and API behind the checkout gate, never open by default', () => {
    const app = read('../src/App.tsx');
    expect(/path="checkout"/.test(app)).toBe(true);
    const page = read('../src/pages/Checkout.tsx');
    expect(page).toContain('checkoutApi.config()');
    const api = read('../api/checkout/[action].ts');
    expect(api).toContain('checkoutOpen(flags)');
    expect(api).toContain("sendError(res, 'CHECKOUT', 'KH-CHK-001')");
  });
  it('cards show only server-supplied prices, and buying goes only through the server-checked bag', () => {
    for (const f of ['../src/components/ProductCard.tsx', '../src/components/CollectionGrid.tsx']) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      // No price is written into the page source or computed here, and nothing talks to order or payment endpoints directly.
      expect(/₹|unit_price|\d{3,}\s*\*|fetch\(|\/api\/(checkout|payments|orders)/.test(src), f).toBe(false);
    }
    const card = read('../src/components/ProductCard.tsx');
    expect(card).toContain('useVariants');
    expect(card).toContain('useCart');
    expect(card).toContain('add(');
  });
});
