import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminRole } from '../../shared/roles.js';
import { handleCoupons } from './coupons.js';
import type { AdminConfig, AdminCtx } from './ctx.js';

interface Call { method: string; url: string; body: any }
let calls: Call[];
let audits: { action: string; detail?: Record<string, unknown> }[];
let dupCode: boolean;
const real = globalThis.fetch;
const ID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const row = { id: ID, code: 'KAAYRA10', description: null, discount_type: 'percent', percent_bps: 1000, fixed_paise: null, min_order_paise: 99900, max_discount_paise: 30000, starts_at: null, expires_at: null, usage_limit: 500, per_customer_limit: 1, first_order_only: false, product_ids: [], product_forms: [], active: false };
const res = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = []; audits = []; dupCode = false;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input); const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (url.includes('/rpc/coupon_admin_list')) return res(200, { total: 1, items: [row] });
    if (url.includes('/rpc/coupon_analytics')) return res(200, { totals: { redemptions: 0 } });
    if (url.includes('/rpc/order_refund_basis')) return res(200, { paid_paise: 100 });
    if (url.includes('/products?select=id,form')) return res(200, [{ id: PID, form: 'Syrup', public_name: 'Tulsi', internal_name: 'x' }]);
    if (url.includes('/products?select=id&')) return res(200, url.includes(PID) ? [{ id: PID }] : []);
    if (method === 'POST' && url.endsWith('/coupons')) return dupCode ? res(409, { code: '23505' }) : res(201, [{ ...row, ...body }]);
    if (method === 'PATCH') return res(200, [{ ...row, ...body }]);
    return res(200, [row]);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = real; });

function run(role: AdminRole, action: string, method: string, query: Record<string, string> = {}, body?: unknown) {
  const out = { status: 0, body: undefined as any };
  const r = {};
  const c = {
    req: { method, query, body }, cfg: { db: { url: 'https://db.test', serviceKey: 'k' } } as unknown as AdminConfig,
    email: 'owner@kaayra.in', role, commerceEnabled: true,
    json: (s: number, b: unknown) => { out.status = s; out.body = b; return r as never; },
    audit: async (action: string, detail?: Record<string, unknown>) => { audits.push({ action, detail }); },
  } as unknown as AdminCtx;
  return handleCoupons(c, action).then((handled) => ({ handled, ...out }));
}
const good = { code: 'kaayra10', type: 'percent', percentBps: 1000, minOrderPaise: 99900, maxDiscountPaise: 30000, active: false };

describe('coupons admin: authorisation is server-side and owner-only', () => {
  const ops: [string, string, Record<string, string>, unknown][] = [
    ['coupons', 'GET', {}, undefined], ['coupon', 'GET', { id: ID }, undefined], ['coupon-options', 'GET', {}, undefined], ['coupon-analytics', 'GET', {}, undefined],
    ['coupon', 'POST', {}, good], ['coupon', 'PATCH', { id: ID }, good], ['coupon-toggle', 'POST', { id: ID }, { active: true }],
  ];
  it('refuses manager and support for every read and write, records the attempt, touches nothing', async () => {
    for (const role of ['manager', 'support'] as const) for (const [a, m, q, b] of ops) {
      const r = await run(role, a, m, q, b);
      expect(r.status).toBe(403);
      expect(r.body.permission).toMatch(/^coupons\.(read|write)$/);
    }
    expect(calls).toHaveLength(0);
    expect(audits.filter((a) => a.action === 'permission_denied')).toHaveLength(ops.length * 2);
  });
  it('lets the owner through every one', async () => {
    for (const [a, m, q, b] of ops) expect((await run('owner', a, m, q, b)).status).toBeLessThan(300);
  });
  it('does not handle unrelated actions', async () => expect((await run('owner', 'inventory', 'GET')).handled).toBe(false));
});

describe('coupons admin: create, edit, switch', () => {
  it('creates with a capitalised code, records who made it, and audits', async () => {
    const r = await run('owner', 'coupon', 'POST', {}, good);
    expect(r.status).toBe(201);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ code: 'KAAYRA10', created_by: 'owner@kaayra.in', active: false, percent_bps: 1000 });
    expect(audits[0]).toMatchObject({ action: 'coupon_create', detail: { code: 'KAAYRA10' } });
  });
  it('refuses invalid input and unknown products without writing', async () => {
    expect((await run('owner', 'coupon', 'POST', {}, { ...good, percentBps: 0 })).status).toBe(400);
    expect((await run('owner', 'coupon', 'POST', {}, { ...good, productIds: [PID.replace('2', '3')] })).status).toBe(400);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
  it('explains a duplicate code', async () => {
    dupCode = true;
    const r = await run('owner', 'coupon', 'POST', {}, good);
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('KAAYRA10');
    expect(audits).toHaveLength(0);
  });
  it('edits, never sends a new code, and audits the before and after values', async () => {
    const r = await run('owner', 'coupon', 'PATCH', { id: ID }, { ...good, code: 'HACKED', maxDiscountPaise: 40000 });
    expect(r.status).toBe(200);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect('code' in patch.body).toBe(false);
    expect(audits[0]).toMatchObject({ action: 'coupon_update', detail: { code: 'KAAYRA10', changes: { max_discount_paise: [30000, 40000] } } });
  });
  it('writes nothing when nothing changed', async () => {
    const r = await run('owner', 'coupon', 'PATCH', { id: ID }, { ...good, usageLimit: 500, perCustomerLimit: 1 });
    expect(r.body.unchanged).toBe(true);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
  it('audits activate and deactivate separately, and rejects a non-boolean', async () => {
    await run('owner', 'coupon-toggle', 'POST', { id: ID }, { active: true });
    await run('owner', 'coupon-toggle', 'POST', { id: ID }, { active: false });
    expect(audits.map((a) => a.action)).toEqual(['coupon_activate', 'coupon_deactivate']);
    expect((await run('owner', 'coupon-toggle', 'POST', { id: ID }, { active: 'yes' })).status).toBe(400);
    expect((await run('owner', 'coupon-toggle', 'POST', { id: 'x' }, { active: true })).status).toBe(400);
  });
  it('has no delete', async () => expect((await run('owner', 'coupon', 'DELETE', { id: ID })).handled).toBe(false));
  it('passes only a sanitised search and a known status filter to the database', async () => {
    await run('owner', 'coupons', 'GET', { q: "a');drop table coupons;--", status: 'bogus' });
    expect(calls[0].body.p_status).toBe('all');
    expect(calls[0].body.p_q).not.toMatch(/[';]/);
  });
});

describe('refund basis', () => {
  it('is readable by manager (refunds.read), needs a valid order id', async () => {
    expect((await run('manager', 'refund-basis', 'GET', { order: ID })).status).toBe(200);
    expect((await run('manager', 'refund-basis', 'GET', { order: 'nope' })).status).toBe(400);
  });
});
