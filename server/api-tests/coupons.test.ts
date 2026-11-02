import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import cart from '../../api/cart/[action].js';
import checkout from '../../api/checkout/[action].js';
import { signToken } from '../oauth.js';

const SECRET = 'coupon-test-session-secret-0123456789-abcdef';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key-secret', ADMIN_SESSION_SECRET: SECRET, FEATURE_CART_PREVIEW: 'on', FEATURE_CHECKOUT_TESTING: 'on' };
const V = '11111111-1111-4111-8111-111111111111';
const M = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY = '123e4567-e89b-42d3-a456-426614174001';
const ADDR = { name: 'Asha Verma', phone: '9876543210', line1: '12 Lanka Road', line2: '', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221005' };
let cartCoupon: string | null;
let quoteResult: any;
let applyResult: any;
let placeFailure: string | null;
let rpc: { fn: string; args: any }[];
let ip = 0;
const realNow = Date.now;
let clock = realNow();

const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const order = (o: any) => ({ id: '00000000-0000-4000-8000-000000000001', order_no: 'KH-2026-000901', member_id: M, status: 'placed', subtotal_paise: 99800, discount_paise: 9980, coupon_code: 'KAAYRA10', shipping_paise: 6000, total_paise: 95820, pay_by: new Date(clock + 1.8e6).toISOString(), is_test: true, ...o });

beforeEach(() => {
  clock += 11 * 60 * 1000; Date.now = () => clock;
  cartCoupon = 'KAAYRA10'; placeFailure = null; rpc = [];
  quoteResult = { ok: true, code: 'KAAYRA10', description: 'Welcome', discount_paise: 9980, eligible_paise: 99800, subtotal_paise: 99800, allocations: [{ ref: V, discount_paise: 9980 }] };
  applyResult = quoteResult;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  saved.VERCEL_ENV = process.env.VERCEL_ENV; delete process.env.VERCEL_ENV;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input)); const path = url.pathname.replace('/rest/v1/', '');
    const body = init?.body ? JSON.parse(init.body) : null;
    if (path === 'members') return json(200, [{ id: M, email: 'a@example.org', name: 'A', role: 'member', has_password: true }]);
    if (path === 'product_variants') return json(200, [{ id: V, pack_size: '200 ml', price_paise: 49900, gst_rate: 12, hsn_code: '3004', status: 'active', products: { status: 'APPROVED_FOR_SALE', public_name: 'Tulsi', internal_name: 'x' } }]);
    if (path === 'inventory_batches') return json(200, [{ variant_id: V, qty_on_hand: 50, qty_reserved: 0, status: 'active', expiry_date: '2099-01-01' }]);
    if (path === 'carts') return url.searchParams.get('select') === 'coupon_code' ? json(200, [{ coupon_code: cartCoupon }]) : json(200, [{ cart_items: [{ variant_id: V, qty: 2 }] }]);
    if (path === 'shipping_pincodes') return json(200, [{ pincode: '221005', active: true, rate_paise: 6000, free_above_paise: 150000 }]);
    if (path === 'orders') return json(200, [order({})]);
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4); rpc.push({ fn, args: body });
      if (fn === 'orders_due_for_expiry') return json(200, []);
      if (fn === 'coupon_quote') return json(200, quoteResult);
      if (fn === 'coupon_cart_apply') return json(200, applyResult);
      if (fn === 'coupon_cart_clear') { cartCoupon = null; return json(200, null); }
      if (fn === 'checkout_place') return placeFailure ? json(400, { message: placeFailure }) : json(200, { order_id: '00000000-0000-4000-8000-000000000001', replay: false });
    }
    return json(404, {});
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = real; Date.now = realNow; for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

function call(h: typeof cart, action: string, opts: { method?: string; body?: unknown; csrf?: boolean; cookie?: boolean } = {}) {
  ip++;
  const headers: Record<string, string> = { host: 'site.kaayra-test.in', origin: 'https://site.kaayra-test.in', 'x-forwarded-for': `10.9.${ip >> 8}.${ip & 255}` };
  if (opts.csrf !== false) headers['x-kaayra-csrf'] = '1';
  const cookie = signToken('user', { email: 'a@example.org', name: 'A', role: 'member' }, SECRET, 3600);
  const req = { method: opts.method ?? 'POST', headers, body: opts.body, query: { action }, cookies: opts.cookie === false ? {} : { kaayra_user: cookie }, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return h(req, res).then(() => out);
}

describe('cart: applying a coupon', () => {
  it('shows the discount from the database and a total that matches, with GST taken after the discount', async () => {
    const r = await call(cart, 'view', { method: 'GET' });
    expect(r.body.coupon).toEqual({ code: 'KAAYRA10', description: 'Welcome', valid: true, discountPaise: 9980, message: null });
    expect(r.body.totals).toMatchObject({ subtotalPaise: 99800, discountPaise: 9980, afterDiscountPaise: 89820 });
    expect(r.body.totals.gstIncludedPaise).toBe(Math.round((89820 * 12) / 112));
  });
  it('sends the database the server-priced lines, never anything the browser claims', async () => {
    const r = await call(cart, 'coupon-apply', { body: { code: ' kaayra10 ', lines: [{ variantId: V, qty: 1, linePaise: 1 }], discountPaise: 99999, totals: { subtotalPaise: 1 } } });
    expect(r.status).toBe(200);
    const a = rpc.find((c) => c.fn === 'coupon_cart_apply')!.args;
    expect(a.p_code).toBe('KAAYRA10');
    expect(a.p_lines).toEqual([{ ref: V, variant_id: V, line_total_paise: 99800 }]);
    expect(JSON.stringify(a)).not.toContain('99999');
  });
  it('turns every refusal into a plain 422 message', async () => {
    applyResult = { ok: false, reason: 'MIN_ORDER', min_order_paise: 99900 };
    const r = await call(cart, 'coupon-apply', { body: { code: 'KAAYRA10' } });
    expect(r.status).toBe(422);
    expect(r.body.errorCode).toBe('KH-CART-007');
    expect(r.body.message).toContain('₹999');
    applyResult = { ok: false, reason: 'NOT_FOUND' };
    expect((await call(cart, 'coupon-apply', { body: { code: 'NOPE123' } })).body.message).toContain('not valid');
  });
  it('requires sign-in, the CSRF header, and a string code', async () => {
    expect((await call(cart, 'coupon-apply', { body: { code: 'X' }, cookie: false })).status).toBe(401);
    expect((await call(cart, 'coupon-apply', { body: { code: 'KAAYRA10' }, csrf: false })).status).toBe(403);
    expect((await call(cart, 'coupon-apply', { body: { code: { $ne: 1 } } })).status).toBe(422);
    expect((await call(cart, 'coupon-apply', { body: { code: 'A'.repeat(65) } })).status).toBe(422);
    expect(rpc.filter((c) => c.fn === 'coupon_cart_apply')).toHaveLength(0);
  });
  it('removes the coupon', async () => {
    quoteResult = { ok: true };
    const r = await call(cart, 'coupon-remove', {});
    expect(r.status).toBe(200);
    expect(rpc.some((c) => c.fn === 'coupon_cart_clear')).toBe(true);
    expect(r.body.coupon).toBeNull();
  });
  it('throttles repeated attempts from one address', async () => {
    const fixedIp = '10.77.0.1'; let last = 0;
    for (let i = 0; i < 14; i++) {
      const headers = { host: 'site.kaayra-test.in', origin: 'https://site.kaayra-test.in', 'x-forwarded-for': fixedIp, 'x-kaayra-csrf': '1' };
      const cookie = signToken('user', { email: 'a@example.org', name: 'A', role: 'member' }, SECRET, 3600);
      const out = { status: 200 };
      await cart({ method: 'POST', headers, body: { code: 'NOPE123' }, query: { action: 'coupon-apply' }, cookies: { kaayra_user: cookie }, socket: {} } as never, { setHeader() {}, status(s: number) { out.status = s; return this; }, json() { return this; } } as never);
      last = out.status;
    }
    expect(last).toBe(429);
  });
  it('shows why a coupon that stopped qualifying gives no discount', async () => {
    quoteResult = { ok: false, reason: 'EXPIRED' };
    const r = await call(cart, 'view', { method: 'GET' });
    expect(r.body.coupon).toMatchObject({ valid: false, discountPaise: 0, message: 'This coupon has expired.' });
    expect(r.body.totals.discountPaise).toBe(0);
    expect(r.body.totals.afterDiscountPaise).toBe(99800);
  });
});

describe('checkout: the discount is the server\'s, and the order carries it', () => {
  it('quotes subtotal - discount + shipping from the saved coupon only', async () => {
    const r = await call(checkout, 'quote', { body: { address: ADDR, couponCode: 'FREEALL', discountPaise: 99800, totals: { totalPaise: 1 } } });
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({ subtotalPaise: 99800, discountPaise: 9980, shippingPaise: 6000, totalPaise: 95820 });
    const q = rpc.find((c) => c.fn === 'coupon_quote')!.args;
    expect(q.p_code).toBe('KAAYRA10');
    expect(q.p_shipping).toBe(6000);
  });
  it('places the order with the bag\'s coupon, ignoring any coupon in the request', async () => {
    const r = await call(checkout, 'place', { body: { address: ADDR, idempotencyKey: KEY, expectedTotalPaise: 95820, couponCode: 'FREEALL', discountPaise: 99000 } });
    expect(r.status).toBe(200);
    const p = rpc.find((c) => c.fn === 'checkout_place')!.args;
    expect(p.p_coupon).toBe('KAAYRA10');
    expect(p.p_expected_total).toBe(95820);
    expect(JSON.stringify(p)).not.toContain('FREEALL');
    expect(r.body.order).toMatchObject({ discountPaise: 9980, couponCode: 'KAAYRA10', totalPaise: 95820 });
  });
  it('sends no coupon when the bag has none', async () => {
    cartCoupon = null;
    await call(checkout, 'place', { body: { address: ADDR, idempotencyKey: KEY, expectedTotalPaise: 105800 } });
    expect(rpc.find((c) => c.fn === 'checkout_place')!.args.p_coupon).toBeNull();
    expect(rpc.some((c) => c.fn === 'coupon_quote')).toBe(false);
  });
  it('refuses to place when the saved coupon no longer qualifies, and creates nothing', async () => {
    quoteResult = { ok: false, reason: 'USAGE_LIMIT' };
    const r = await call(checkout, 'place', { body: { address: ADDR, idempotencyKey: KEY, expectedTotalPaise: 105800 } });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('fully claimed');
    expect(rpc.some((c) => c.fn === 'checkout_place')).toBe(false);
  });
  it('shows the customer the coupon reason when the database refuses at the last moment (a race)', async () => {
    placeFailure = 'KH:COUPON:USAGE_LIMIT';
    const r = await call(checkout, 'place', { body: { address: ADDR, idempotencyKey: KEY, expectedTotalPaise: 95820 } });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('fully claimed');
  });
  it('refuses when the total the customer saw is not the discounted total', async () => {
    placeFailure = 'KH:PRICE_CHANGED';
    const r = await call(checkout, 'place', { body: { address: ADDR, idempotencyKey: KEY, expectedTotalPaise: 105800 } });
    expect(r.status).toBe(409);
  });
  it('puts the coupon in the idempotency fingerprint', async () => {
    await call(checkout, 'place', { body: { address: ADDR, idempotencyKey: KEY, expectedTotalPaise: 95820 } });
    cartCoupon = null;
    await call(checkout, 'place', { body: { address: ADDR, idempotencyKey: KEY, expectedTotalPaise: 105800 } });
    const [a, b] = rpc.filter((c) => c.fn === 'checkout_place').map((c) => c.args.p_hash);
    expect(a).not.toBe(b);
  });
});
