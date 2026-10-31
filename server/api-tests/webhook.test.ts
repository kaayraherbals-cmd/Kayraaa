import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../api/payments/webhook.js';

const WH = 'whsec_test_value_123456';
const real = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
let rpcCalls: { fn: string; body: any }[];
let rpcOutcome: { status: number; body: unknown };
let audits: any[];

const event = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ event: name, payload: { payment: { entity: { id: 'pay_WEBHOOK01', order_id: 'order_WEBHOOK01', amount: 50000, method: 'upi', ...extra } } } });
const sign = (raw: string, secret = WH) => createHmac('sha256', secret).update(raw).digest('hex');

beforeEach(() => {
  rpcCalls = [];
  audits = [];
  rpcOutcome = { status: 200, body: 'captured' };
  for (const [k, v] of Object.entries({ RAZORPAY_WEBHOOK_SECRET: WH, SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const rpc = /\/rpc\/(\w+)/.exec(url);
    if (rpc) {
      rpcCalls.push({ fn: rpc[1], body: JSON.parse(init!.body!) });
      return new Response(JSON.stringify(rpcOutcome.body), { status: rpcOutcome.status, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/admin_audit')) {
      audits.push(JSON.parse(init!.body!));
      return new Response(null, { status: 201 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function post(raw: string, headers: Record<string, string> = {}, method = 'POST') {
  const reply = { status: 0, body: undefined as any };
  const res = { status(c: number) { reply.status = c; return res; }, json(b: unknown) { reply.body = b; return res; }, setHeader() { return res; } };
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { method, headers });
  await handler(req as never, res as never);
  return reply;
}

describe('razorpay webhook', () => {
  it('rejects a missing or wrong signature without touching the database', async () => {
    const raw = event('payment.captured');
    expect((await post(raw)).status).toBe(401);
    expect((await post(raw, { 'x-razorpay-signature': sign(raw, 'wrong_secret_value_1') })).status).toBe(401);
    expect((await post(raw, { 'x-razorpay-signature': sign(`${raw} `) })).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });
  it('only accepts POST', async () => {
    expect((await post('', {}, 'GET')).status).toBe(405);
  });
  it('applies a signed capture once, with the event id, order, payment and amount from the body', async () => {
    const raw = event('payment.captured');
    const r = await post(raw, { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_ABCDEF123456' });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('captured');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('payment_apply_event');
    expect(rpcCalls[0].body).toMatchObject({ p_event_id: 'evt_ABCDEF123456', p_event: 'payment.captured', p_rp_order: 'order_WEBHOOK01', p_rp_payment: 'pay_WEBHOOK01', p_amount: 50000 });
    expect(audits[0]).toMatchObject({ actor: 'razorpay', action: 'payment_captured' });
  });
  it('falls back to a hash of the body when the event id header is missing', async () => {
    const raw = event('payment.captured');
    await post(raw, { 'x-razorpay-signature': sign(raw) });
    expect(String(rpcCalls[0].body.p_event_id)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('acknowledges events it does not act on without a database call', async () => {
    const raw = event('payment.created');
    const r = await post(raw, { 'x-razorpay-signature': sign(raw) });
    expect(r).toMatchObject({ status: 200, body: { outcome: 'ignored' } });
    expect(rpcCalls).toHaveLength(0);
  });
  it('returns 500 on database trouble so Razorpay retries, and 200 for a duplicate', async () => {
    const raw = event('payment.captured');
    const h = { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_ABCDEF123456' };
    rpcOutcome = { status: 500, body: { message: 'relation "secret_internal" does not exist' } };
    const bad = await post(raw, h);
    expect(bad.status).toBe(500);
    expect(JSON.stringify(bad.body)).not.toContain('secret_internal');
    rpcOutcome = { status: 200, body: 'duplicate' };
    expect((await post(raw, h)).status).toBe(200);
  });
  it('audits a payment that does not match its order, so a person looks at it', async () => {
    rpcOutcome = { status: 200, body: 'amount_mismatch' };
    const raw = event('payment.captured', { amount: 49900 });
    await post(raw, { 'x-razorpay-signature': sign(raw) });
    expect(audits[0].action).toBe('payment_amount_mismatch');
  });
  it('refuses to run without a webhook secret', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const raw = event('payment.captured');
    expect((await post(raw, { 'x-razorpay-signature': sign(raw) })).status).toBe(503);
  });
});
