import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAdminRoles, type AdminRole } from '../../shared/roles.js';
import { makeJson, type AdminConfig, type AdminCtx } from './ctx.js';
import { handlePayments } from './payments.js';

const ADMINS = ['boss@kaayra.in', 'ops@kaayra.in', 'help@kaayra.in'];
const ROLES = 'boss@kaayra.in:owner,ops@kaayra.in:manager,help@kaayra.in:support';
const O = '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10';
const R = '3f8b2e74-4b3a-4c5d-9e9c-7da05b6c8f43';
const KEY_SECRET = 'k'.repeat(24);
const cfg: AdminConfig = { db: { url: 'https://db.test', serviceKey: 'service-key' }, anonKey: 'a', secret: 's'.repeat(48), admins: ADMINS, roles: parseAdminRoles(ROLES, ADMINS).roles, mfaMode: 'required', mfaKey: 'm'.repeat(48) };

interface Call { method: string; url: string; body: any; headers: Record<string, string> }
let calls: Call[];
let audits: string[];
let order: { id: string; order_no: string; status: string; total_paise: number } | null;
let captured: { rp_payment_id: string | null; amount_paise: number } | null;
let refundRow: Record<string, unknown> | null;
let otherGatewayRefunds: { amount_paise: number }[];
let razorpay: { status: number; body: unknown };
let rpcReply: { status: number; body: unknown };
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  calls = [];
  audits = [];
  order = { id: O, order_no: 'KH-2026-000007', status: 'placed', total_paise: 50000 };
  captured = { rp_payment_id: 'pay_CAPTURED01', amount_paise: 50000 };
  refundRow = { id: R, order_id: O, status: 'approved', amount_paise: 20000, kind: 'refund_only', gateway_refund_id: null };
  otherGatewayRefunds = [];
  razorpay = { status: 200, body: { id: 'order_RP0000001', amount: 50000, currency: 'INR', status: 'created' } };
  rpcReply = { status: 200, body: null };
  for (const [k, v] of Object.entries({ RAZORPAY_KEY_ID: 'rzp_test_AbCdEf123456', RAZORPAY_KEY_SECRET: KEY_SECRET })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers ?? {} });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://api.razorpay.com/')) return json(razorpay.status, razorpay.body);
    if (url.includes('/rpc/')) return json(rpcReply.status, rpcReply.body);
    if (url.includes('/rest/v1/orders?')) return json(200, order ? [order] : []);
    if (url.includes('/rest/v1/order_payments?') && url.includes('status=eq.captured')) return json(200, captured ? [captured] : []);
    if (url.includes('/rest/v1/order_payments?')) return json(200, []);
    if (url.includes('/rest/v1/order_refunds?') && method === 'PATCH') return new Response(null, { status: 204 });
    if (url.includes('/rest/v1/order_refunds?') && url.includes('gateway_refund_id=not.is.null')) return json(200, otherGatewayRefunds);
    if (url.includes('/rest/v1/order_refunds?')) return json(200, refundRow ? [refundRow] : []);
    return json(404, {});
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function run(action: string, as: { email: string; role: AdminRole }, o: { method?: string; body?: unknown; query?: Record<string, string>; commerce?: boolean } = {}) {
  const reply = { status: 0, body: undefined as any };
  const res = { status(c: number) { reply.status = c; return res; }, json(b: unknown) { reply.body = b; return res; } };
  const req = { method: o.method ?? 'GET', query: { action, ...(o.query ?? {}) }, body: o.body, headers: {} };
  const ctx: AdminCtx = { req: req as never, res: res as never, cfg, email: as.email, role: as.role, commerceEnabled: o.commerce ?? false, json: makeJson(res as never), audit: async (a) => void audits.push(a) };
  const handled = await handlePayments(ctx, action);
  return { handled, ...reply };
}
const owner = { email: 'boss@kaayra.in', role: 'owner' as const };
const manager = { email: 'ops@kaayra.in', role: 'manager' as const };
const support = { email: 'help@kaayra.in', role: 'support' as const };
const razorpayCalls = () => calls.filter((c) => c.url.startsWith('https://api.razorpay.com/'));

describe('payments view', () => {
  it('lets every role look, and says whether the gateway is set up', async () => {
    const r = await run('payments', support, { query: { order_id: O } });
    expect(r.status).toBe(200);
    expect(r.body.gateway).toEqual({ configured: true, live: false });
    delete process.env.RAZORPAY_KEY_ID;
    expect((await run('payments', support)).body.gateway.configured).toBe(false);
  });
  it('ignores actions that are not its own', async () => {
    expect((await run('orders', owner)).handled).toBe(false);
  });
});

describe('payment-create', () => {
  const post = { method: 'POST', body: { order_id: O } };
  it('stays locked while selling is off, and never calls Razorpay', async () => {
    const r = await run('payment-create', manager, post);
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('KH-ADMIN-010');
    expect(razorpayCalls()).toHaveLength(0);
  });
  it('is not for support', async () => {
    expect((await run('payment-create', support, { ...post, commerce: true })).status).toBe(403);
  });
  it('charges the order total from the database, never an amount sent by the browser', async () => {
    rpcReply = { status: 200, body: 'b4d1c0aa-6a5e-4b8f-9d2e-1c3f5a7b9d11' };
    const r = await run('payment-create', manager, { method: 'POST', body: { order_id: O, amount_paise: 1, amount: 1 }, commerce: true });
    expect(r.status).toBe(201);
    expect(razorpayCalls()[0].body).toMatchObject({ amount: 50000, currency: 'INR', receipt: 'KH-2026-000007' });
    expect(r.body).toMatchObject({ razorpayOrderId: 'order_RP0000001', keyId: 'rzp_test_AbCdEf123456', amountPaise: 50000 });
    expect(JSON.stringify(r.body)).not.toContain(KEY_SECRET);
    expect(audits).toContain('payment_create');
  });
  it('refuses an order that is not waiting for payment', async () => {
    order!.status = 'paid';
    const r = await run('payment-create', manager, { ...post, commerce: true });
    expect(r.status).toBe(409);
    expect(razorpayCalls()).toHaveLength(0);
  });
  it('says plainly when Razorpay is not set up, with its own error code', async () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    const r = await run('payment-create', manager, { ...post, commerce: true });
    expect(r.status).toBe(503);
    expect(r.body.errorCode).toBe('KH-ADMIN-013');
  });
  it('shows Razorpay\'s reason when it refuses', async () => {
    razorpay = { status: 400, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'Order amount less than minimum amount allowed' } } };
    const r = await run('payment-create', manager, { ...post, commerce: true });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('minimum amount');
  });
});

describe('refund-gateway', () => {
  const post = { method: 'POST', body: { refund_id: R } };
  it('is owner only', async () => {
    expect((await run('refund-gateway', manager, post)).status).toBe(403);
    expect(razorpayCalls()).toHaveLength(0);
  });
  it('refunds the captured payment with an idempotency key, saves the Razorpay id first, then marks it refunded', async () => {
    razorpay = { status: 200, body: { id: 'rfnd_GW0000001', payment_id: 'pay_CAPTURED01', amount: 20000, status: 'processed' } };
    const r = await run('refund-gateway', owner, { ...post, body: { refund_id: R, goods_received: true } });
    expect(r.status).toBe(200);
    const [rp] = razorpayCalls();
    expect(rp.url).toBe('https://api.razorpay.com/v1/payments/pay_CAPTURED01/refund');
    expect(rp.body.amount).toBe(20000);
    expect(rp.headers['X-Refund-Idempotency']).toBe(R);
    const order = calls.map((c) => (c.method === 'PATCH' ? 'patch' : c.url.includes('/rpc/refund_set_status') ? 'status' : c.url.startsWith('https://api.razorpay.com/') ? 'razorpay' : '')).filter(Boolean);
    expect(order).toEqual(['razorpay', 'patch', 'status']);
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ gateway_refund_id: 'rfnd_GW0000001' });
    expect(calls.find((c) => c.url.includes('/rpc/refund_set_status'))!.body).toMatchObject({ p_to: 'refunded', p_payment_ref: 'rfnd_GW0000001', p_goods: true });
    expect(audits).toContain('refund_gateway');
  });
  it('a retry after a half-finished attempt reuses the saved Razorpay id and does not pay twice', async () => {
    refundRow!.gateway_refund_id = 'rfnd_GW0000001';
    const r = await run('refund-gateway', owner, post);
    expect(r.status).toBe(200);
    expect(razorpayCalls()).toHaveLength(0);
    expect(calls.find((c) => c.url.includes('/rpc/refund_set_status'))!.body.p_payment_ref).toBe('rfnd_GW0000001');
  });
  it('only pays an approved refund', async () => {
    for (const s of ['requested', 'rejected', 'refunded']) {
      refundRow!.status = s;
      expect((await run('refund-gateway', owner, post)).status).toBe(409);
    }
    expect(razorpayCalls()).toHaveLength(0);
  });
  it('explains when there is no captured Razorpay payment (paid by bank or UPI outside the gateway)', async () => {
    captured = null;
    const r = await run('refund-gateway', owner, post);
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('bank');
    expect(razorpayCalls()).toHaveLength(0);
  });
  it('never refunds more than is left on the payment, counting other gateway refunds', async () => {
    otherGatewayRefunds = [{ amount_paise: 35000 }];
    const r = await run('refund-gateway', owner, post);
    expect(r.status).toBe(409);
    expect(razorpayCalls()).toHaveLength(0);
  });
  it('leaves the refund unmarked when Razorpay refuses', async () => {
    razorpay = { status: 400, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'The payment has not been captured' } } };
    const r = await run('refund-gateway', owner, post);
    expect(r.status).toBe(409);
    expect(calls.some((c) => c.url.includes('/rpc/refund_set_status'))).toBe(false);
  });
});
