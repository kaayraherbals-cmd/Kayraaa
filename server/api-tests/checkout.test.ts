import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/checkout/[action].js';
import { signToken } from '../oauth.js';

const SECRET = 'checkout-test-session-secret-0123456789-abcdef';
const SITE = 'https://site.kaayra-test.in';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key-secret', ADMIN_SESSION_SECRET: SECRET, FEATURE_CART_PREVIEW: 'on', FEATURE_CHECKOUT_TESTING: 'on' };

const V_OK = '11111111-1111-4111-8111-111111111111';
const V_LOW = '22222222-2222-4222-8222-222222222222';
const V_DRAFT = '33333333-3333-4333-8333-333333333333';
const M_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // used only by the rate-limit test, whose limiter state is per process
const KEY1 = '123e4567-e89b-42d3-a456-426614174001';
const KEY2 = '123e4567-e89b-42d3-a456-426614174002';

type V = { id: string; slug: string; pack_size: string; price_paise: number | null; gst_rate: number | null; hsn_code: string | null; status: string; products: { status: string; public_name: string | null; internal_name: string } };
type Order = { id: string; order_no: string; member_id: string; status: string; subtotal_paise: number; shipping_paise: number; total_paise: number; pay_by: string; is_test: boolean };
let variants: V[];
let batches: { variant_id: string; qty_on_hand: number; qty_reserved: number; status: string; expiry_date: string }[];
let members: { id: string; email: string; name: string | null; role: string; has_password: boolean }[];
let carts: Map<string, Map<string, number>>;
let pins: { pincode: string; active: boolean; rate_paise: number; free_above_paise: number | null }[];
let orders: Order[];
let attempts: Map<string, { hash: string; order_id: string }>; // "member|key"
let rpcCalls: { fn: string; args: any }[];
let dbDown: boolean;
let ipCounter = 0;
// The limiters live for the life of the process, so each test runs in its own 11-minute-later window.
const realNow = Date.now;
let clock = realNow();

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const inIds = (q: string | null) => (q ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean);
const eq = (q: string | null) => (q ?? '').replace(/^eq\./, '');

function mkVariant(id: string, slug: string, over: Partial<V> = {}, pstatus = 'APPROVED_FOR_SALE'): V {
  return { id, slug, pack_size: '200 ml', price_paise: 49900, gst_rate: 12, hsn_code: '3004', status: 'active', products: { status: pstatus, public_name: 'Test syrup', internal_name: 'internal-secret-name' }, ...over };
}
const freeOf = (id: string) => batches.filter((b) => b.variant_id === id).reduce((s, b) => s + b.qty_on_hand - b.qty_reserved, 0);

function install() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    if (dbDown) return json(500, { message: 'connection to server at "10.0.0.5" failed: password authentication failed' });
    const url = new URL(String(input));
    const path = url.pathname.replace('/rest/v1/', '');
    const body = init?.body ? JSON.parse(init.body) : null;
    if (path === 'members') return json(200, members.filter((m) => m.email === eq(url.searchParams.get('email'))));
    if (path === 'product_variants') {
      const ids = inIds(url.searchParams.get('id'));
      return json(200, variants.filter((v) => ids.includes(v.id)));
    }
    if (path === 'inventory_batches') {
      const ids = inIds(url.searchParams.get('variant_id'));
      const from = (url.searchParams.get('expiry_date') ?? '').replace(/^gte\./, '');
      return json(200, batches.filter((b) => ids.includes(b.variant_id) && b.status === 'active' && b.expiry_date >= from));
    }
    if (path === 'carts') {
      const c = carts.get(eq(url.searchParams.get('member_id')));
      return json(200, c ? [{ cart_items: [...c].map(([variant_id, qty]) => ({ variant_id, qty })) }] : []);
    }
    if (path === 'shipping_pincodes') return json(200, pins.filter((p) => p.pincode === eq(url.searchParams.get('pincode'))));
    if (path === 'orders') {
      // ownership is part of the query: both id and member_id must match
      const id = eq(url.searchParams.get('id'));
      const member = eq(url.searchParams.get('member_id'));
      return json(200, orders.filter((o) => o.id === id && o.member_id === member));
    }
    if (path === 'rpc/checkout_place') {
      rpcCalls.push({ fn: 'checkout_place', args: body });
      const k = `${body.p_member}|${body.p_key}`;
      const a = attempts.get(k);
      if (a) return a.hash !== body.p_hash ? json(400, { message: 'KH:IDEMPOTENCY_MISMATCH' }) : json(200, { order_id: a.order_id, replay: true });
      const open = [...attempts].find(([key, v]) => key.startsWith(body.p_member) && v.hash === body.p_hash);
      if (open) { attempts.set(k, open[1]); return json(200, { order_id: open[1].order_id, replay: true }); }
      if (!pins.some((p) => p.pincode === body.p_order.ship_pincode && p.active)) return json(400, { message: 'KH:NOT_SERVICEABLE' });
      let subtotal = 0;
      for (const it of body.p_order.items as { variant_id: string; qty: number }[]) {
        const v = variants.find((x) => x.id === it.variant_id);
        if (!v || freeOf(v.id) < it.qty) return json(400, { message: `KH:INSUFFICIENT_STOCK:${v?.products.public_name ?? 'item'}|${v ? freeOf(v.id) : 0}` });
        subtotal += (v.price_paise as number) * it.qty;
      }
      const total = subtotal + body.p_order.shipping_paise;
      if (total !== body.p_expected_total) return json(400, { message: 'KH:PRICE_CHANGED' });
      const o: Order = { id: `00000000-0000-4000-8000-${String(orders.length + 1).padStart(12, '0')}`, order_no: `KH-2026-${String(900 + orders.length).padStart(6, '0')}`, member_id: body.p_member, status: 'placed', subtotal_paise: subtotal, shipping_paise: body.p_order.shipping_paise, total_paise: total, pay_by: new Date(Date.now() + 30 * 60000).toISOString(), is_test: body.p_test };
      orders.push(o);
      attempts.set(k, { hash: body.p_hash, order_id: o.id });
      return json(200, { order_id: o.id, replay: false });
    }
    return json(404, {});
  }) as typeof fetch;
}

const cookieFor = (email: string) => signToken('user', { email, name: 'Asha', role: 'member' }, SECRET, 3600);
const ADDR = { name: 'Asha Verma', phone: '9876543210', line1: '12 Lanka Road', line2: '', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221005' };

function call(action: string, opts: { method?: string; body?: unknown; cookie?: string | null; origin?: string | null; csrf?: boolean; ip?: string } = {}) {
  ipCounter++;
  const method = opts.method ?? (action === 'config' ? 'GET' : 'POST');
  const headers: Record<string, string> = { host: 'site.kaayra-test.in', 'x-forwarded-for': opts.ip ?? `10.3.${ipCounter >> 8}.${ipCounter & 255}` };
  if (opts.origin !== null) headers.origin = opts.origin ?? SITE;
  if (opts.csrf !== false) headers['x-kaayra-csrf'] = '1';
  const req = { method, headers, body: opts.body, query: { action }, cookies: opts.cookie ? { kaayra_user: opts.cookie } : {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return handler(req, res).then(() => out);
}
const asA = () => cookieFor('a@example.org');
const asB = () => cookieFor('b@example.org');
const quote = (over: Record<string, unknown> = {}, cookie: string | null = asA()) => call('quote', { cookie, body: { address: ADDR, ...over } });
const place = (over: Record<string, unknown> = {}, cookie: string | null = asA()) => call('place', { cookie, body: { address: ADDR, idempotencyKey: KEY1, expectedTotalPaise: 49900 * 2 + 6000, ...over } });

beforeEach(() => {
  clock += 11 * 60 * 1000;
  Date.now = () => clock;
  variants = [mkVariant(V_OK, 'tulsi-syrup'), mkVariant(V_LOW, 'tulsi-syrup', { pack_size: '100 ml', price_paise: 29900, gst_rate: 5 }), mkVariant(V_DRAFT, 'draft-product', {}, 'DRAFT')];
  batches = [
    { variant_id: V_OK, qty_on_hand: 50, qty_reserved: 5, status: 'active', expiry_date: '2099-01-01' },
    { variant_id: V_LOW, qty_on_hand: 4, qty_reserved: 1, status: 'active', expiry_date: '2099-01-01' },
    { variant_id: V_DRAFT, qty_on_hand: 10, qty_reserved: 0, status: 'active', expiry_date: '2099-01-01' },
  ];
  members = [
    { id: M_A, email: 'a@example.org', name: 'A', role: 'member', has_password: true },
    { id: M_B, email: 'b@example.org', name: 'B', role: 'member', has_password: true },
    { id: M_C, email: 'c@example.org', name: 'C', role: 'member', has_password: true },
  ];
  carts = new Map([[M_A, new Map([[V_OK, 2]])], [M_B, new Map([[V_LOW, 1]])], [M_C, new Map([[V_OK, 2]])]]);
  pins = [{ pincode: '221005', active: true, rate_paise: 6000, free_above_paise: 150000 }, { pincode: '221001', active: false, rate_paise: 6000, free_above_paise: null }];
  orders = [];
  attempts = new Map();
  rpcCalls = [];
  dbDown = false;
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  saved.VERCEL_ENV = process.env.VERCEL_ENV;
  delete process.env.VERCEL_ENV;
  install();
});
afterEach(() => {
  Date.now = realNow;
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('checkout gate', () => {
  it('is open outside production in test mode, without any flag variable', async () => {
    delete process.env.FEATURE_CHECKOUT_TESTING;
    delete process.env.FEATURE_CART_PREVIEW;
    expect((await call('config')).body.checkoutOpen).toBe(true);
  });
  it('is closed in production before live-sales approval, whatever the variables say', async () => {
    process.env.VERCEL_ENV = 'production';
    expect((await call('config')).body.checkoutOpen).toBe(false);
  });
  it('production with only part of the approval stays closed', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.LIVE_SALES_APPROVED = 'on';
    expect((await call('config')).body.checkoutOpen).toBe(false);
    delete process.env.LIVE_SALES_APPROVED;
  });
  it('production place / pay / verify are 404 before approval (no hidden purchase API)', async () => {
    process.env.VERCEL_ENV = 'production';
    for (const a of ['quote', 'place', 'pay', 'verify']) expect((await call(a)).status).toBe(404);
  });
  it('unknown actions are 404 and the wrong method is 405', async () => {
    expect((await call('refund')).status).toBe(404);
    expect((await call('place', { method: 'GET', cookie: asA() })).status).toBe(405);
  });
});

describe('who may call it', () => {
  it('needs a signed-in customer', async () => {
    expect((await quote({}, null)).status).toBe(401);
    expect((await place({}, null)).status).toBe(401);
    expect((await place({}, 'not-a-real-token')).body.errorCode).toBe('KH-CHK-002');
    expect(orders).toHaveLength(0);
  });
  it('refuses a session for someone no longer a member', async () => {
    members = [];
    expect((await place()).status).toBe(401);
  });
  it('refuses cross-site and token-less requests (CSRF)', async () => {
    expect((await call('place', { cookie: asA(), origin: 'https://evil.example', body: { address: ADDR, idempotencyKey: KEY1, expectedTotalPaise: 1 } })).status).toBe(403);
    expect((await call('place', { cookie: asA(), origin: null, body: {} })).status).toBe(403);
    expect((await call('place', { cookie: asA(), csrf: false, body: {} })).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });
  it('rate limits by address', async () => {
    const ip = '10.99.0.1';
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await call('quote', { cookie: asA(), ip, body: { address: ADDR } })).status;
    expect(last).toBe(429);
  });
});

describe('quote: everything is calculated on the server', () => {
  it('prices the signed-in bag with shipping and GST included', async () => {
    const r = await quote();
    expect(r.status).toBe(200);
    expect(r.body.totals).toEqual({ subtotalPaise: 99800, discountPaise: 0, shippingPaise: 6000, totalPaise: 105800, gstIncludedPaise: 10693 });
    expect(r.body.shipping).toEqual({ label: 'Standard delivery', paise: 6000 });
    expect(r.body.test).toBe(true);
  });
  it('ignores prices, items and totals sent by the browser', async () => {
    const r = await quote({ items: [{ variantId: V_LOW, qty: 9 }], pricePaise: 1, totals: { totalPaise: 1 }, shippingPaise: 0 });
    expect(r.body.totals.subtotalPaise).toBe(99800);
    expect(r.body.lines).toHaveLength(1);
  });
  it('uses the customer\'s own bag, never another customer\'s', async () => {
    const r = await quote({}, asB());
    expect(r.body.lines[0].variantId).toBe(V_LOW);
    expect(r.body.totals.subtotalPaise).toBe(29900);
  });
  it('makes shipping free at the threshold', async () => {
    carts.set(M_A, new Map([[V_OK, 4]]));
    expect((await quote()).body.totals.shippingPaise).toBe(0);
  });
  it('rejects bad delivery details with field messages', async () => {
    const r = await quote({ address: { ...ADDR, pincode: '12', phone: '123', state: 'Atlantis' } });
    expect(r.status).toBe(400);
    expect(r.body.errorCode).toBe('KH-CHK-003');
    expect(Object.keys(r.body.fields).sort()).toEqual(['phone', 'pincode', 'state']);
  });
  it('stops at a PIN code we do not serve, or have switched off', async () => {
    for (const pincode of ['560001', '221001']) {
      const r = await quote({ address: { ...ADDR, pincode } });
      expect(r.status).toBe(422);
      expect(r.body.errorCode).toBe('KH-CHK-005');
    }
  });
  it('stops on an empty bag', async () => {
    carts.delete(M_A);
    const r = await quote();
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Your bag is empty.');
  });
  it('stops, and shows what changed, when an item is unavailable or reduced', async () => {
    batches[0]!.qty_reserved = 49; // only 1 free
    let r = await quote();
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('KH-CHK-004');
    expect(r.body.lines[0].state).toBe('adjusted');
    batches[0]!.qty_reserved = 50; // none free
    r = await quote();
    expect(r.body.lines[0].state).toBe('unavailable');
    variants[0]!.products.status = 'DRAFT';
    expect((await quote()).body.lines[0].reason).toBe('not_approved');
  });
  it('never exposes internal names or secrets', async () => {
    const text = JSON.stringify((await quote()).body);
    expect(text).not.toContain('internal-secret-name');
    expect(text).not.toContain('service-key-secret');
  });
});

describe('place: one unpaid order, stock held, no payment', () => {
  it('creates the order from the saved bag with server prices only', async () => {
    const r = await place();
    expect(r.status).toBe(200);
    expect(r.body.paymentOpen).toBe(false);
    expect(r.body.replay).toBe(false);
    expect(r.body.order).toMatchObject({ status: 'placed', subtotalPaise: 99800, shippingPaise: 6000, totalPaise: 105800, isTest: true });
    const a = rpcCalls[0]!.args;
    expect(a.p_member).toBe(M_A);
    expect(a.p_test).toBe(true);
    expect(a.p_hold_minutes).toBe(30);
    expect(a.p_order.items).toEqual([{ variant_id: V_OK, qty: 2 }]);
    expect(a.p_order.shipping_paise).toBe(6000);
    expect(a.p_order.customer_email).toBe('a@example.org');
    expect(a.p_order.customer_phone).toBe('+919876543210');
    // no price, tax or total field is ever sent for the database to trust
    expect(JSON.stringify(a.p_order)).not.toMatch(/price|total|gst|tax/i);
  });
  it('uses the session\'s member and bag, whatever the body claims', async () => {
    const r = await place({ memberId: M_B, member_id: M_B, items: [{ variantId: V_LOW, qty: 9 }] });
    expect(r.status).toBe(200);
    expect(rpcCalls[0]!.args.p_member).toBe(M_A);
    expect(rpcCalls[0]!.args.p_order.items).toEqual([{ variant_id: V_OK, qty: 2 }]);
  });
  it('refuses if the price moved since the customer saw the total', async () => {
    const r = await place({ expectedTotalPaise: 100 });
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('KH-CHK-004');
    expect(orders).toHaveLength(0);
  });
  it('refuses if stock ran out between quote and place', async () => {
    batches[0]!.qty_reserved = 49;
    const r = await place();
    expect(r.status).toBe(409);
    expect(orders).toHaveLength(0);
  });
  it('is idempotent: the same key twice gives one order', async () => {
    const a = await place();
    const b = await place();
    expect(b.status).toBe(200);
    expect(b.body.replay).toBe(true);
    expect(b.body.order.id).toBe(a.body.order.id);
    expect(orders).toHaveLength(1);
  });
  it('returns the open order for the same contents under a new key (refresh, second tab)', async () => {
    const a = await place();
    const b = await place({ idempotencyKey: KEY2 });
    expect(b.body.replay).toBe(true);
    expect(b.body.order.id).toBe(a.body.order.id);
    expect(orders).toHaveLength(1);
  });
  it('refuses a reused key for different contents', async () => {
    await place();
    carts.set(M_A, new Map([[V_OK, 3]]));
    const r = await place({ expectedTotalPaise: 49900 * 3 + 6000 });
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('KH-CHK-008');
    expect(orders).toHaveLength(1);
  });
  it('refuses a PIN that is not served, with nothing created', async () => {
    const r = await place({ address: { ...ADDR, pincode: '221001' } });
    expect(r.status).toBe(422);
    expect(rpcCalls).toHaveLength(0);
  });
  it('rejects a malformed key or total before any database work', async () => {
    for (const bad of [{ idempotencyKey: 'abc' }, { expectedTotalPaise: -1 }, { expectedTotalPaise: '1' }]) {
      expect((await place(bad)).status).toBe(400);
    }
    expect(rpcCalls).toHaveLength(0);
  });
  it('limits how often one customer can place', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await place({ idempotencyKey: `123e4567-e89b-42d3-a456-4266141741${String(i).padStart(2, '0')}` }, cookieFor('c@example.org'))).status;
    expect(last).toBe(429);
  });
  it('fails cleanly, leaking nothing, when the database is down', async () => {
    const ok = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => (String(input).includes('rpc/checkout_place') ? json(500, { message: 'connection to server at "10.0.0.5" failed: password authentication failed' }) : ok(input as never, init as never))) as typeof fetch;
    const r = await place();
    expect(r.status).toBe(502);
    expect(r.body.errorCode).toBe('KH-CHK-007');
    expect(JSON.stringify(r.body)).not.toMatch(/10\.0\.0\.5|password|authentication/);
  });
  it('never lets one customer read another customer\'s order', async () => {
    const a = await place();
    orders[0]!.member_id = M_B; // simulate the order belonging to someone else
    const b = await place({ idempotencyKey: KEY1 });
    expect(b.status).toBe(502); // the read-back is scoped to the member, so it finds nothing
    expect(JSON.stringify(b.body)).not.toContain(a.body.order.orderNo);
  });
});
