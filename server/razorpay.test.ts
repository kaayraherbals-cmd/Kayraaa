import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RazorpayError, createRazorpayOrder, createRazorpayRefund, loadRazorpayConfig, loadWebhookSecret, verifyCheckoutSignature, verifyWebhookSignature } from './razorpay.js';

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('hex');

describe('webhook signature', () => {
  const secret = 'whsec_test_secret_123';
  const body = '{"event":"payment.captured"}';
  it('accepts the right signature, as a string or a buffer', () => {
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(body), sign(body, secret), secret)).toBe(true);
  });
  it('rejects a changed body, a wrong secret, and missing or malformed signatures', () => {
    expect(verifyWebhookSignature(`${body} `, sign(body, secret), secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, 'other_secret_value'), secret)).toBe(false);
    for (const s of [undefined, '', 'zz', sign(body, secret).slice(2), `${sign(body, secret)}00`]) expect(verifyWebhookSignature(body, s, secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, ''), '')).toBe(false);
  });
});

describe('checkout signature', () => {
  const key = 'key_secret_value_123';
  it('signs order_id|payment_id with the key secret', () => {
    const sig = sign('order_A1|pay_B2', key);
    expect(verifyCheckoutSignature('order_A1', 'pay_B2', sig, key)).toBe(true);
    expect(verifyCheckoutSignature('order_A1', 'pay_B3', sig, key)).toBe(false);
    expect(verifyCheckoutSignature('order_A1', 'pay_B2', undefined, key)).toBe(false);
  });
});

describe('configuration', () => {
  it('names what is missing, never values', () => {
    const r = loadRazorpayConfig({ RAZORPAY_KEY_ID: 'bad', RAZORPAY_KEY_SECRET: 'short' });
    expect(r).toEqual({ ok: false, missing: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] });
  });
  it('recognises test and live keys', () => {
    const t = loadRazorpayConfig({ RAZORPAY_KEY_ID: 'rzp_test_AbCdEf123456', RAZORPAY_KEY_SECRET: 'x'.repeat(20) });
    expect(t.ok && t.live).toBe(false);
    const l = loadRazorpayConfig({ RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456', RAZORPAY_KEY_SECRET: 'x'.repeat(20) });
    expect(l.ok && l.live).toBe(true);
  });
  it('needs a long enough webhook secret', () => {
    expect(loadWebhookSecret({ RAZORPAY_WEBHOOK_SECRET: 'short' })).toBeNull();
    expect(loadWebhookSecret({ RAZORPAY_WEBHOOK_SECRET: 'long_enough_secret' })).toBe('long_enough_secret');
  });
});

describe('API calls', () => {
  const cfg = { keyId: 'rzp_test_AbCdEf123456', keySecret: 'k'.repeat(20) };
  const real = globalThis.fetch;
  let seen: { url: string; init: RequestInit & { headers: Record<string, string> } } | undefined;
  let reply: { status: number; body: unknown };
  beforeEach(() => {
    seen = undefined;
    reply = { status: 200, body: { id: 'order_NEW000001', amount: 50000, currency: 'INR', status: 'created' } };
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      seen = { url: String(url), init: init as never };
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = real;
  });
  it('creates an order in paise with basic auth', async () => {
    const o = await createRazorpayOrder(cfg, { amountPaise: 50000, receipt: 'KH-2026-000001', notes: { order_no: 'KH-2026-000001' } });
    expect(o.id).toBe('order_NEW000001');
    expect(seen!.url).toBe('https://api.razorpay.com/v1/orders');
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ amount: 50000, currency: 'INR', receipt: 'KH-2026-000001' });
    expect(seen!.init.headers.Authorization).toBe(`Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`);
  });
  it('sends an idempotency key with a refund', async () => {
    reply = { status: 200, body: { id: 'rfnd_NEW000001', payment_id: 'pay_P00000001', amount: 20000, status: 'processed' } };
    await createRazorpayRefund(cfg, 'pay_P00000001', { amountPaise: 20000, receipt: 'r1', idempotencyKey: 'refund-uuid', notes: {} });
    expect(seen!.url).toBe('https://api.razorpay.com/v1/payments/pay_P00000001/refund');
    expect(seen!.init.headers['X-Refund-Idempotency']).toBe('refund-uuid');
  });
  it('turns a rejection into a plain error that never contains the key', async () => {
    reply = { status: 400, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'The refund amount provided is greater than the amount captured' } } };
    const e = await createRazorpayRefund(cfg, 'pay_P00000001', { amountPaise: 1, receipt: 'r', idempotencyKey: 'k', notes: {} }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RazorpayError);
    expect((e as RazorpayError).message).toContain('greater than the amount captured');
    expect(JSON.stringify(e)).not.toContain(cfg.keySecret);
  });
  it('reports an unreachable gateway', async () => {
    globalThis.fetch = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    const e = await createRazorpayOrder(cfg, { amountPaise: 100, receipt: 'r', notes: {} }).catch((x: unknown) => x);
    expect((e as RazorpayError).code).toBe('NETWORK');
  });
});

// ---- Section 4: reading payments back from Razorpay ----
import { fetchRazorpayOrderPayments, fetchRazorpayPayment } from './razorpay.js';

describe('reading payments from Razorpay', () => {
  const cfg = { keyId: 'rzp_test_ABCDEF123456', keySecret: 'secret-secret-secret' };
  const real = globalThis.fetch;
  let seen: { url: string; method?: string; auth?: string; body?: unknown }[];
  beforeEach(() => {
    seen = [];
    globalThis.fetch = (async (u: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      seen.push({ url: String(u), method: init?.method, auth: init?.headers?.Authorization, body: init?.body });
      const url = String(u);
      if (url.endsWith('/payments')) return new Response(JSON.stringify({ items: [{ id: 'pay_ABC12345', status: 'captured', amount: 500, currency: 'INR', order_id: 'order_ABC12345' }] }), { status: 200 });
      return new Response(JSON.stringify({ id: 'pay_ABC12345', status: 'captured', amount: 500, currency: 'INR', order_id: 'order_ABC12345' }), { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = real;
  });
  it('uses GET with no body, and basic auth built from the key pair', async () => {
    const p = await fetchRazorpayPayment(cfg, 'pay_ABC12345');
    expect(p.status).toBe('captured');
    expect(seen[0].method).toBe('GET');
    expect(seen[0].body).toBeUndefined();
    expect(seen[0].url).toBe('https://api.razorpay.com/v1/payments/pay_ABC12345');
    expect(seen[0].auth).toBe(`Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`);
  });
  it('lists the payments of one order', async () => {
    const list = await fetchRazorpayOrderPayments(cfg, 'order_ABC12345');
    expect(list).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.razorpay.com/v1/orders/order_ABC12345/payments');
  });
  it('refuses ids that are not exactly Razorpay-shaped, before any request is made', async () => {
    for (const id of ['', '../orders', 'pay_a/b', 'pay_ABC12345?x=1', 'order_ABC12345', 'pay_ab', 'pay_ABC12345\n']) {
      let err: unknown;
      try {
        await fetchRazorpayPayment(cfg, id);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RazorpayError);
    }
    expect(seen).toHaveLength(0);
  });
  it('turns a Razorpay refusal into a RazorpayError without echoing the key', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } }), { status: 400 })) as typeof fetch;
    let err: RazorpayError | undefined;
    try {
      await fetchRazorpayPayment(cfg, 'pay_ABC12345');
    } catch (e) {
      err = e as RazorpayError;
    }
    expect(err?.httpStatus).toBe(400);
    expect(err?.message).not.toContain(cfg.keySecret);
  });
});
