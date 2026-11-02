import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/cart/[action].js';
import { signToken } from '../oauth.js';

const SECRET = 'cart-test-session-secret-0123456789-abcdef';
const SITE = 'https://site.kaayra-test.in';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ADMIN_SESSION_SECRET: SECRET, FEATURE_CART_PREVIEW: 'on' };

const V_OK = '11111111-1111-4111-8111-111111111111';
const V_LOW = '22222222-2222-4222-8222-222222222222';
const V_DRAFT = '33333333-3333-4333-8333-333333333333';
const V_NOPRICE = '44444444-4444-4444-8444-444444444444';
const V_GONE = '55555555-5555-4555-8555-555555555555';
const V_EMPTY = '66666666-6666-4666-8666-666666666666';
const M_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type V = { id: string; slug: string; pack_size: string; price_paise: number | null; gst_rate: number | null; hsn_code: string | null; status: string; products: { status: string; public_name: string | null; internal_name: string } };
let variants: V[];
let batches: { variant_id: string; qty_on_hand: number; qty_reserved: number; status: string; expiry_date: string }[];
let members: { id: string; email: string; name: string | null; role: string; has_password: boolean }[];
let carts: Map<string, Map<string, number>>; // member id -> variant id -> qty
let batchQueries: string[];
let ipCounter = 0;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const inIds = (q: string | null) => (q ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean);

function mkVariant(id: string, slug: string, over: Partial<V> = {}, pstatus = 'APPROVED_FOR_SALE'): V {
  return { id, slug, pack_size: '200 ml', price_paise: 49900, gst_rate: 12, hsn_code: '3004', status: 'active', products: { status: pstatus, public_name: 'Test syrup', internal_name: 'internal-secret-name' }, ...over };
}

function install() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/rest/v1/', '');
    const body = init?.body ? JSON.parse(init.body) : null;
    if (path === 'members') {
      const email = (url.searchParams.get('email') ?? '').replace(/^eq\./, '');
      return json(200, members.filter((m) => m.email === email));
    }
    if (path === 'product_variants') {
      const slug = url.searchParams.get('products.slug');
      if (slug) return json(200, variants.filter((v) => v.slug === slug.replace(/^eq\./, '')).map((v) => ({ id: v.id })));
      const ids = inIds(url.searchParams.get('id'));
      return json(200, variants.filter((v) => ids.includes(v.id)));
    }
    if (path === 'inventory_batches') {
      batchQueries.push(url.search);
      const ids = inIds(url.searchParams.get('variant_id'));
      const from = (url.searchParams.get('expiry_date') ?? '').replace(/^gte\./, '');
      return json(200, batches.filter((b) => ids.includes(b.variant_id) && b.status === 'active' && b.expiry_date >= from));
    }
    if (path === 'carts') {
      const member = (url.searchParams.get('member_id') ?? '').replace(/^eq\./, '');
      const c = carts.get(member);
      return json(200, c ? [{ cart_items: [...c].map(([variant_id, qty]) => ({ variant_id, qty })) }] : []);
    }
    if (path === 'rpc/cart_set_item') {
      const c = carts.get(body.p_member) ?? new Map<string, number>();
      if (body.p_qty === 0) c.delete(body.p_variant);
      else {
        if (!c.has(body.p_variant) && c.size >= 20) return json(400, { message: 'KH:CART_FULL' });
        c.set(body.p_variant, body.p_qty);
      }
      carts.set(body.p_member, c);
      return json(200, null);
    }
    if (path === 'rpc/cart_merge') {
      const c = carts.get(body.p_member) ?? new Map<string, number>();
      for (const l of body.p_lines as { variant_id: string; qty: number }[]) c.set(l.variant_id, Math.min(10, (c.get(l.variant_id) ?? 0) + l.qty));
      carts.set(body.p_member, c);
      return json(200, null);
    }
    if (path === 'rpc/cart_clear') {
      carts.delete(body.p_member);
      return json(200, null);
    }
    return json(404, {});
  }) as typeof fetch;
}

const cookieFor = (email: string, role = 'member') => `${signToken('user', { email, name: 'Asha', role }, SECRET, 3600)}`;

function call(action: string, opts: { method?: string; body?: unknown; query?: Record<string, string>; cookie?: string | null; origin?: string | null; csrf?: boolean; ip?: string } = {}) {
  ipCounter++;
  const method = opts.method ?? (action === 'config' || action === 'view' || action === 'variants' ? 'GET' : 'POST');
  const headers: Record<string, string> = { host: 'site.kaayra-test.in', 'x-forwarded-for': opts.ip ?? `10.2.${ipCounter >> 8}.${ipCounter & 255}` };
  if (opts.origin !== null) headers.origin = opts.origin ?? SITE;
  if (opts.csrf !== false) headers['x-kaayra-csrf'] = '1';
  const req = { method, headers, body: opts.body, query: { action, ...(opts.query ?? {}) }, cookies: opts.cookie ? { kaayra_user: opts.cookie } : {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return handler(req, res).then(() => out);
}

beforeEach(() => {
  variants = [
    mkVariant(V_OK, 'tulsi-syrup'),
    mkVariant(V_LOW, 'tulsi-syrup', { pack_size: '100 ml', price_paise: 29900, gst_rate: 5 }),
    mkVariant(V_DRAFT, 'draft-product', {}, 'DRAFT'),
    mkVariant(V_NOPRICE, 'tulsi-syrup', { pack_size: '500 ml', price_paise: null }),
    mkVariant(V_EMPTY, 'tulsi-syrup', { pack_size: '1 l' }),
  ];
  batches = [
    { variant_id: V_OK, qty_on_hand: 50, qty_reserved: 5, status: 'active', expiry_date: '2099-01-01' },
    { variant_id: V_LOW, qty_on_hand: 4, qty_reserved: 1, status: 'active', expiry_date: '2099-01-01' },
    { variant_id: V_DRAFT, qty_on_hand: 10, qty_reserved: 0, status: 'active', expiry_date: '2099-01-01' },
    { variant_id: V_NOPRICE, qty_on_hand: 10, qty_reserved: 0, status: 'active', expiry_date: '2099-01-01' },
    { variant_id: V_EMPTY, qty_on_hand: 10, qty_reserved: 0, status: 'active', expiry_date: '2000-01-01' }, // expired
  ];
  members = [
    { id: M_A, email: 'a@example.org', name: 'A', role: 'member', has_password: true },
    { id: M_B, email: 'b@example.org', name: 'B', role: 'member', has_password: true },
  ];
  carts = new Map();
  batchQueries = [];
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  saved.VERCEL_ENV = process.env.VERCEL_ENV;
  delete process.env.VERCEL_ENV;
  install();
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('cart is closed unless the preview flag is on', () => {
  it('is open with the preview flag outside production', async () => {
    expect((await call('config')).body.cartPreview).toBe(true);
    const r = await call('validate', { body: { lines: [{ variantId: V_OK, qty: 1 }] } });
    expect(r.status).toBe(200);
  });
  it('stays open without the preview variable (master switch on)', async () => {
    delete process.env.FEATURE_CART_PREVIEW;
    expect((await call('config')).body.cartPreview).toBe(true);
  });
  it('production before live-sales approval: bag open, checkout reported closed', async () => {
    process.env.VERCEL_ENV = 'production';
    expect((await call('config')).body.cartPreview).toBe(true);
    const r = await call('validate', { body: { lines: [{ variantId: V_OK, qty: 1 }] } });
    expect(r.status).toBe(200);
    expect(r.body.checkoutOpen).toBe(false);
  });
  it('outside production the bag reports checkout as open (test mode)', async () => {
    const r = await call('validate', { body: { lines: [{ variantId: V_OK, qty: 1 }] } });
    expect(r.body.checkoutOpen).toBe(true);
  });
});

describe('validate (guest or signed in)', () => {
  it('prices from the database and ignores any price the browser sends', async () => {
    const r = await call('validate', { body: { lines: [{ variantId: V_OK, qty: 2, price_paise: 1, unitPaise: 1, total: 1 }], total: 1 } });
    expect(r.status).toBe(200);
    expect(r.body.lines[0].unitPaise).toBe(49900);
    expect(r.body.totals.subtotalPaise).toBe(99800);
  });
  it('rejects bad quantities, bad ids and non-lists', async () => {
    for (const lines of [[{ variantId: V_OK, qty: 0 }], [{ variantId: V_OK, qty: 11 }], [{ variantId: V_OK, qty: 1.5 }], [{ variantId: "x' or 1=1", qty: 1 }], 'nope', null]) {
      const r = await call('validate', { body: { lines } });
      expect(r.status).toBe(400);
      expect(r.body.errorCode).toBe('KH-CART-003');
    }
  });
  it('marks products that are not approved for sale, unpriced variants and unknown ids as unavailable', async () => {
    const r = await call('validate', { body: { lines: [{ variantId: V_DRAFT, qty: 1 }, { variantId: V_NOPRICE, qty: 1 }, { variantId: V_GONE, qty: 1 }] } });
    expect(r.body.lines.map((l: { state: string }) => l.state)).toEqual(['unavailable', 'unavailable', 'unavailable']);
    expect(r.body.totals.subtotalPaise).toBe(0);
  });
  it('does not leak internal product names or stock figures of unavailable items', async () => {
    const r = await call('validate', { body: { lines: [{ variantId: V_DRAFT, qty: 1 }] } });
    const text = JSON.stringify(r.body);
    expect(text.includes('internal-secret-name')).toBe(false);
    expect(text.includes('qty_on_hand')).toBe(false);
  });
  it('clamps to free stock (on hand minus reserved) and says so', async () => {
    const r = await call('validate', { body: { lines: [{ variantId: V_LOW, qty: 9 }] } });
    expect(r.body.lines[0].qty).toBe(3);
    expect(r.body.lines[0].state).toBe('adjusted');
  });
  it('treats stock that is expired or within the no-sell window as unavailable, and asks the database only for in-date batches', async () => {
    const r = await call('validate', { body: { lines: [{ variantId: V_EMPTY, qty: 1 }] } });
    expect(r.body.lines[0].state).toBe('unavailable');
    expect(r.body.lines[0].reason).toBe('out_of_stock');
    expect(/expiry_date=gte\.\d{4}-\d{2}-\d{2}/.test(batchQueries[0])).toBe(true);
  });
  it('requires same-origin and the CSRF header for writes', async () => {
    const body = { lines: [{ variantId: V_OK, qty: 1 }] };
    expect((await call('validate', { body, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('validate', { body, origin: null })).status).toBe(403);
    expect((await call('validate', { body, csrf: false })).status).toBe(403);
  });
  it('answers a database outage with a safe error, no internals', async () => {
    globalThis.fetch = (async () => json(500, { message: 'boom secret detail' })) as typeof fetch;
    const r = await call('validate', { body: { lines: [{ variantId: V_OK, qty: 1 }] } });
    expect(r.status).toBe(502);
    expect(r.body.errorCode).toBe('KH-CART-006');
    expect(JSON.stringify(r.body).includes('secret detail')).toBe(false);
  });
  it('is rate limited per address', async () => {
    let last = 0;
    for (let i = 0; i < 62; i++) last = (await call('validate', { body: { lines: [{ variantId: V_OK, qty: 1 }] }, ip: '203.0.113.9' })).status;
    expect(last).toBe(429);
  });
});

describe('pack-size options', () => {
  it('lists options with server prices and availability for one product', async () => {
    const r = await call('variants', { query: { slug: 'tulsi-syrup' } });
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.options.map((o: { variantId: string }) => [o.variantId, o]));
    expect(byId[V_OK].available).toBe(true);
    expect(byId[V_OK].unitPaise).toBe(49900);
    expect(byId[V_NOPRICE].available).toBe(false);
    expect(byId[V_NOPRICE].unitPaise).toBeNull();
  });
  it('rejects a malformed slug', async () => {
    expect((await call('variants', { query: { slug: "x'; drop table" } })).status).toBe(400);
  });
});

describe('saved bag (signed-in customers)', () => {
  it('requires a signed-in customer', async () => {
    for (const [a, m] of [['view', 'GET'], ['set', 'POST'], ['merge', 'POST'], ['clear', 'POST']] as const) {
      const r = await call(a, { method: m, body: { variantId: V_OK, qty: 1, lines: [] } });
      expect(r.status).toBe(401);
      expect(r.body.errorCode).toBe('KH-CART-002');
    }
  });
  it('rejects forged, expired-secret and unknown-member cookies', async () => {
    expect((await call('view', { cookie: 'garbage.value' })).status).toBe(401);
    const stranger = cookieFor('nobody@example.org');
    expect((await call('view', { cookie: stranger })).status).toBe(401);
    // Change a character in the middle of the signature: the very last base64 character carries unused bits, so altering it can leave the decoded bytes (and the signature) unchanged.
    const tampered = cookieFor('a@example.org').replace(/.(?=.{12}$)/, (c) => (c === 'a' ? 'b' : 'a'));
    expect((await call('view', { cookie: tampered })).status).toBe(401);
  });
  it('adds, changes and removes a line, priced by the server', async () => {
    const c = cookieFor('a@example.org');
    let r = await call('set', { cookie: c, body: { variantId: V_OK, qty: 2 } });
    expect(r.status).toBe(200);
    expect(r.body.totals.subtotalPaise).toBe(99800);
    r = await call('set', { cookie: c, body: { variantId: V_OK, qty: 3 } });
    expect(r.body.lines[0].qty).toBe(3);
    r = await call('view', { cookie: c });
    expect(r.body.lines).toHaveLength(1);
    r = await call('set', { cookie: c, body: { variantId: V_OK, qty: 0 } });
    expect(r.body.lines).toHaveLength(0);
  });
  it('refuses to add anything that cannot be bought', async () => {
    const c = cookieFor('a@example.org');
    for (const id of [V_DRAFT, V_NOPRICE, V_GONE, V_EMPTY]) {
      const r = await call('set', { cookie: c, body: { variantId: id, qty: 1 } });
      expect(r.status).toBe(400);
    }
    expect(carts.get(M_A)).toBeUndefined();
  });
  it('rejects invalid quantities', async () => {
    const c = cookieFor('a@example.org');
    for (const qty of [-1, 11, 1.2, '3', null]) expect((await call('set', { cookie: c, body: { variantId: V_OK, qty } })).status).toBe(400);
  });
  it('keeps each customer\u2019s bag private', async () => {
    await call('set', { cookie: cookieFor('a@example.org'), body: { variantId: V_OK, qty: 4 } });
    const b = await call('view', { cookie: cookieFor('b@example.org') });
    expect(b.body.lines).toHaveLength(0);
    const a = await call('view', { cookie: cookieFor('a@example.org') });
    expect(a.body.lines[0].qty).toBe(4);
  });
  it('ignores a member id supplied by the browser', async () => {
    await call('set', { cookie: cookieFor('b@example.org'), body: { variantId: V_OK, qty: 1, memberId: M_A, member_id: M_A, p_member: M_A } });
    expect(carts.get(M_A)).toBeUndefined();
    expect(carts.get(M_B)?.get(V_OK)).toBe(1);
  });
  it('stops at 20 different items', async () => {
    const c = cookieFor('a@example.org');
    const ids = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`);
    for (const id of ids) variants.push(mkVariant(id, 'bulk'));
    for (const id of ids) batches.push({ variant_id: id, qty_on_hand: 5, qty_reserved: 0, status: 'active', expiry_date: '2099-01-01' });
    for (let i = 0; i < 20; i++) expect((await call('set', { cookie: c, body: { variantId: ids[i], qty: 1 } })).status).toBe(200);
    const r = await call('set', { cookie: c, body: { variantId: ids[20], qty: 1 } });
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('KH-CART-004');
  });
  it('merges a guest bag after sign-in, capping quantity and skipping unavailable items', async () => {
    const c = cookieFor('a@example.org');
    await call('set', { cookie: c, body: { variantId: V_OK, qty: 8 } });
    const r = await call('merge', { cookie: c, body: { lines: [{ variantId: V_OK, qty: 5 }, { variantId: V_LOW, qty: 1 }, { variantId: V_DRAFT, qty: 1 }] } });
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.lines.map((l: { variantId: string }) => [l.variantId, l]));
    expect(byId[V_OK].qty).toBe(10);
    expect(byId[V_LOW].qty).toBe(1);
    expect(byId[V_DRAFT]).toBeUndefined();
  });
  it('reflects price and stock changes on the next view', async () => {
    const c = cookieFor('a@example.org');
    await call('set', { cookie: c, body: { variantId: V_OK, qty: 2 } });
    variants[0].price_paise = 59900;
    batches[0].qty_reserved = 50; // everything reserved by someone else
    const r = await call('view', { cookie: c });
    expect(r.body.lines[0].state).toBe('unavailable');
    batches[0].qty_reserved = 0;
    const r2 = await call('view', { cookie: c });
    expect(r2.body.lines[0].unitPaise).toBe(59900);
  });
  it('lets a customer clear only their own bag', async () => {
    await call('set', { cookie: cookieFor('a@example.org'), body: { variantId: V_OK, qty: 1 } });
    await call('set', { cookie: cookieFor('b@example.org'), body: { variantId: V_OK, qty: 1 } });
    await call('clear', { cookie: cookieFor('a@example.org') });
    expect(carts.get(M_A)).toBeUndefined();
    expect(carts.get(M_B)?.size).toBe(1);
  });
});
