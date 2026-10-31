import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/cart/[action].js';
import { signToken } from '../oauth.js';

/**
 * Wishlist actions inside api/cart/[action].ts: wishlist (GET), wishlist-add and wishlist-remove (POST).
 * Database calls are mocked in memory (PostgREST + RPC shapes copied from server/wishlist.ts). The real SQL functions and RLS are NOT
 * exercised here; they need PostgreSQL (supabase/bundles_wishlists_selftest.sql).
 */

const SECRET = 'wishlist-test-session-secret-0123456789-abcdef';
const SITE = 'https://site.kaayra-test.in';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ADMIN_SESSION_SECRET: SECRET, FEATURE_CART_PREVIEW: 'on' };

const M_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P_LIVE = '11111111-1111-4111-8111-111111111111';
const P_OTHER = '22222222-2222-4222-8222-222222222222';
const P_DRAFT = '33333333-3333-4333-8333-333333333333';

type Product = { id: string; slug: string; name: string; status: string };
let products: Product[];
let lists: Map<string, Set<string>>; // member id -> product ids
let members: { id: string; email: string; name: string | null; role: string; has_password: boolean }[];
let rpcFails: boolean;
let rpcCalls: { name: string; body: Record<string, unknown> }[];
let ipCounter = 0;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function install() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/rest/v1/', '');
    const body = init?.body ? JSON.parse(init.body) : null;
    if (path === 'members') {
      const email = (url.searchParams.get('email') ?? '').replace(/^eq\./, '');
      return json(200, members.filter((m) => m.email === email));
    }
    if (path === 'products') {
      const slug = (url.searchParams.get('slug') ?? '').replace(/^eq\./, '');
      const status = (url.searchParams.get('status') ?? '').replace(/^eq\./, '');
      return json(200, products.filter((p) => p.slug === slug && (!status || p.status === status)).map((p) => ({ id: p.id })));
    }
    if (path.startsWith('rpc/wishlist_')) {
      const name = path.replace('rpc/', '');
      rpcCalls.push({ name, body });
      if (rpcFails) return json(500, { message: 'boom' });
      const set = lists.get(body.p_member) ?? new Set<string>();
      if (name === 'wishlist_add') {
        set.add(body.p_product);
        lists.set(body.p_member, set);
        return json(200, true);
      }
      if (name === 'wishlist_remove') {
        const had = set.delete(body.p_product);
        lists.set(body.p_member, set);
        return json(200, had);
      }
      if (name === 'wishlist_list') {
        const rows = [...set].map((id) => products.find((p) => p.id === id)!).map((p) => ({ product_id: p.id, slug: p.slug, name: p.name, added_at: '2026-10-01T00:00:00Z', state: p.status === 'APPROVED_FOR_SALE' ? 'in_stock' : 'unavailable', from_price_paise: 49900 }));
        return json(200, rows);
      }
    }
    return json(404, {});
  }) as typeof fetch;
}

const cookieFor = (email: string) => `${signToken('user', { email, name: 'Asha', role: 'member' }, SECRET, 3600)}`;

function call(action: string, opts: { method?: string; body?: unknown; cookie?: string | null; csrf?: boolean } = {}) {
  ipCounter++;
  const method = opts.method ?? (action === 'wishlist' ? 'GET' : 'POST');
  const headers: Record<string, string> = { host: 'site.kaayra-test.in', origin: SITE, 'x-forwarded-for': `10.9.${ipCounter >> 8}.${ipCounter & 255}` };
  if (opts.csrf !== false) headers['x-kaayra-csrf'] = '1';
  const req = { method, headers, body: opts.body, query: { action }, cookies: opts.cookie ? { kaayra_user: opts.cookie } : {}, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return handler(req, res).then(() => out);
}

beforeEach(() => {
  products = [
    { id: P_LIVE, slug: 'tulsi-syrup', name: 'Tulsi Syrup', status: 'APPROVED_FOR_SALE' },
    { id: P_OTHER, slug: 'amla-capsules', name: 'Amla Capsules', status: 'APPROVED_FOR_SALE' },
    { id: P_DRAFT, slug: 'draft-product', name: 'Draft', status: 'DRAFT' },
  ];
  members = [
    { id: M_A, email: 'a@example.org', name: 'A', role: 'member', has_password: true },
    { id: M_B, email: 'b@example.org', name: 'B', role: 'member', has_password: true },
  ];
  lists = new Map();
  rpcFails = false;
  rpcCalls = [];
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

describe('wishlist: access control', () => {
  it('rejects a list request with no session', async () => {
    const r = await call('wishlist', { cookie: null });
    expect(r.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });
  it('rejects add and remove with no session', async () => {
    expect((await call('wishlist-add', { cookie: null, body: { slug: 'tulsi-syrup' } })).status).toBe(401);
    expect((await call('wishlist-remove', { cookie: null, body: { slug: 'tulsi-syrup' } })).status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });
  it('rejects a state-changing call without the CSRF header', async () => {
    const r = await call('wishlist-add', { cookie: cookieFor('a@example.org'), csrf: false, body: { slug: 'tulsi-syrup' } });
    expect(r.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });
});

describe('wishlist: add, list, remove', () => {
  it('starts empty', async () => {
    const r = await call('wishlist', { cookie: cookieFor('a@example.org') });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', items: [], count: 0 });
  });
  it('adds a product for sale and lists it with the public shape only', async () => {
    const a = cookieFor('a@example.org');
    const add = await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup' } });
    expect(add.status).toBe(200);
    expect(add.body.count).toBe(1);
    expect(add.body.items[0]).toEqual({ slug: 'tulsi-syrup', name: 'Tulsi Syrup', addedAt: '2026-10-01T00:00:00Z', state: 'in_stock', fromPaise: 49900 });
    expect(JSON.stringify(add.body)).not.toContain(P_LIVE);
    expect(JSON.stringify(add.body)).not.toContain(M_A);
  });
  it('adding the same product twice keeps one entry', async () => {
    const a = cookieFor('a@example.org');
    await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup' } });
    const again = await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup' } });
    expect(again.body.count).toBe(1);
  });
  it('removes a product', async () => {
    const a = cookieFor('a@example.org');
    await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup' } });
    await call('wishlist-add', { cookie: a, body: { slug: 'amla-capsules' } });
    const r = await call('wishlist-remove', { cookie: a, body: { slug: 'tulsi-syrup' } });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { slug: string }) => i.slug)).toEqual(['amla-capsules']);
  });
  it('removing something not on the list is harmless', async () => {
    const r = await call('wishlist-remove', { cookie: cookieFor('a@example.org'), body: { slug: 'tulsi-syrup' } });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(0);
  });
  it('can remove a product that was withdrawn after it was saved, but cannot add one that is not for sale', async () => {
    const a = cookieFor('a@example.org');
    await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup' } });
    products[0].status = 'DRAFT';
    const add = await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup' } });
    expect(add.status).toBe(400);
    const rem = await call('wishlist-remove', { cookie: a, body: { slug: 'tulsi-syrup' } });
    expect(rem.status).toBe(200);
    expect(rem.body.count).toBe(0);
  });
});

describe('wishlist: member isolation', () => {
  it('one member never sees another member\'s list', async () => {
    const a = cookieFor('a@example.org');
    const b = cookieFor('b@example.org');
    await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup' } });
    const listB = await call('wishlist', { cookie: b });
    expect(listB.body.items).toEqual([]);
    const listA = await call('wishlist', { cookie: a });
    expect(listA.body.count).toBe(1);
  });
  it('ignores a member id sent in the request body (the session decides)', async () => {
    const a = cookieFor('a@example.org');
    await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup', member: M_B, memberId: M_B, p_member: M_B } });
    expect(rpcCalls.filter((c) => c.name === 'wishlist_add').every((c) => c.body.p_member === M_A)).toBe(true);
    expect([...(lists.get(M_B) ?? [])]).toEqual([]);
    expect([...(lists.get(M_A) ?? [])]).toEqual([P_LIVE]);
  });
  it('removing for one member does not touch another member\'s entry', async () => {
    const a = cookieFor('a@example.org');
    const b = cookieFor('b@example.org');
    await call('wishlist-add', { cookie: a, body: { slug: 'tulsi-syrup' } });
    await call('wishlist-add', { cookie: b, body: { slug: 'tulsi-syrup' } });
    await call('wishlist-remove', { cookie: a, body: { slug: 'tulsi-syrup' } });
    expect((await call('wishlist', { cookie: b })).body.count).toBe(1);
  });
});

describe('wishlist: validation and failures', () => {
  it('rejects a missing, non-string, malformed or oversized slug', async () => {
    const a = cookieFor('a@example.org');
    for (const slug of [undefined, 42, '', 'Has Spaces', '../etc/passwd', 'x'.repeat(91), { $ne: '' }]) {
      const r = await call('wishlist-add', { cookie: a, body: { slug } });
      expect(r.status, JSON.stringify(slug)).toBe(400);
    }
    expect(rpcCalls).toEqual([]);
  });
  it('rejects an unknown product', async () => {
    const r = await call('wishlist-add', { cookie: cookieFor('a@example.org'), body: { slug: 'does-not-exist' } });
    expect(r.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });
  it('reports a database failure as a retryable error and does not claim success', async () => {
    rpcFails = true;
    const list = await call('wishlist', { cookie: cookieFor('a@example.org') });
    expect(list.status).toBe(502);
    const add = await call('wishlist-add', { cookie: cookieFor('a@example.org'), body: { slug: 'tulsi-syrup' } });
    expect(add.status).toBe(502);
  });
});
