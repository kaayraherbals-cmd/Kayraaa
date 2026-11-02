import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/orders/[action].js';
import { signToken } from '../oauth.js';

const SECRET = 'orders-test-session-secret-0123456789-abcdef';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ADMIN_SESSION_SECRET: SECRET };
const M_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const O_A = '11111111-1111-4111-8111-111111111111';
const O_B = '22222222-2222-4222-8222-222222222222';
let ip = 0;
let rpcArgs: Record<string, unknown>[];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const members = [{ id: M_A, email: 'a@example.org', name: 'A', role: 'member', has_password: true }, { id: M_B, email: 'b@example.org', name: 'B', role: 'member', has_password: true }];
const orders = [{ id: O_A, member_id: M_A, order_no: 'KH-2026-000001', status: 'shipped', created_at: '2026-01-01T00:00:00Z', total_paise: 49900, is_test: true }, { id: O_B, member_id: M_B, order_no: 'KH-2026-000002', status: 'paid', created_at: '2026-01-02T00:00:00Z', total_paise: 29900, is_test: false }];

beforeEach(() => {
  rpcArgs = [];
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/rest/v1/', '');
    const eq = (k: string) => (url.searchParams.get(k) ?? '').replace(/^eq\./, '');
    if (path === 'members') return json(200, members.filter((m) => m.email === eq('email')));
    if (path === 'orders') return json(200, orders.filter((o) => o.member_id === eq('member_id') && (!url.searchParams.get('id') || o.id === eq('id'))));
    if (path === 'order_items') return json(200, [{ product_name: 'Tulsi syrup', pack_size: '200 ml', qty: 2, unit_price_paise: 24950, line_total_paise: 49900 }]);
    if (path === 'order_refunds') return json(200, [{ kind: 'refund_only', status: 'requested', amount_paise: 49900, requested_at: '2026-01-05T00:00:00Z', decided_at: null, refunded_at: null }]);
    if (path === 'rpc/shipments_for_member') {
      const b = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      rpcArgs.push(b);
      return json(200, [{ shipment_no: 'SH-1', status: 'in_transit', courier: 'Courier', tracking_no: 'T1', internal: 'x', events: [{ status: 'dispatched', at: '2026-01-03T00:00:00Z' }] }]);
    }
    return json(404, {});
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const cookieFor = (email: string) => signToken('user', { email, name: 'N', role: 'member' }, SECRET, 3600);
function call(action: string, opts: { method?: string; query?: Record<string, string>; email?: string | null } = {}) {
  ip++;
  const req = { method: opts.method ?? 'GET', headers: { host: 'x.test', 'x-forwarded-for': `10.9.${ip >> 8}.${ip & 255}` }, query: { action, ...(opts.query ?? {}) }, cookies: opts.email === null ? {} : { kaayra_user: cookieFor(opts.email ?? 'a@example.org') }, socket: {} } as never;
  const out = { status: 200, body: undefined as any };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; } } as never;
  return handler(req, res).then(() => out);
}

describe('customer orders API', () => {
  it('needs a signed-in customer', async () => {
    expect((await call('list', { email: null })).status).toBe(401);
    expect((await call('track', { email: null, query: { order: O_A } })).status).toBe(401);
  });
  it('lists only the caller\'s own orders', async () => {
    const r = await call('list');
    expect(r.status).toBe(200);
    expect(r.body.items.map((o: { id: string }) => o.id)).toEqual([O_A]);
  });
  it('pages the list: page size 10, clamps bad page numbers, reports total', async () => {
    const r = await call('list', { query: { page: '-3' } });
    expect(r.body.page).toBe(1);
    expect(r.body.pageSize).toBe(10);
    expect(r.body.total).toBe(1);
    expect((await call('list', { query: { page: 'abc' } })).body.page).toBe(1);
  });
  it('tracks an own order and strips unknown fields', async () => {
    const r = await call('track', { query: { order: O_A } });
    expect(r.status).toBe(200);
    expect(r.body.shipments[0].label).toBe('In transit');
    expect(JSON.stringify(r.body)).not.toContain('internal');
    expect(rpcArgs[0]).toEqual({ p_member: M_A, p_order: O_A });
  });
  it('returns 404 for another customer\'s order and never calls the tracking function', async () => {
    const r = await call('track', { query: { order: O_B } });
    expect(r.status).toBe(404);
    expect(rpcArgs).toHaveLength(0);
  });
  it('rejects a malformed order id, wrong method and unknown action', async () => {
    expect((await call('track', { query: { order: "x' or 1=1" } })).status).toBe(400);
    expect((await call('list', { method: 'POST' })).status).toBe(405);
    expect((await call('nope')).status).toBe(404);
  });
  it('returns an own order in detail, with items and refund status', async () => {
    const r = await call('detail', { query: { order: O_A } });
    expect(r.status).toBe(200);
    expect(r.body.items[0].qty).toBe(2);
    expect(r.body.refunds[0].status).toBe('requested');
  });
  it('detail: 404 for another customer\'s order, 401 signed out, 400 for a bad id', async () => {
    expect((await call('detail', { query: { order: O_B } })).status).toBe(404);
    expect((await call('detail', { email: null, query: { order: O_A } })).status).toBe(401);
    expect((await call('detail', { query: { order: 'nope' } })).status).toBe(400);
  });
});
