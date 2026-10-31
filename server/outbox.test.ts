import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MailConfig } from './mail.js';
import { drainOutbox, enqueueOrderMail, queuePaymentConfirmed, sweepMailEvents } from './outbox.js';

const DB = { url: 'https://db.test', serviceKey: 'service-key-secret' };
const CFG: MailConfig = { apiKey: 're_test_key', from: 'Kaayra Herbals <no-reply@kaayra.example>', ownerTo: 'owner@kaayra.example', replyTo: 'help@kaayra.example', autoReply: true };
const O = '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10';
const O2 = '9a9a9a9a-5c79-4b9a-8d1e-3f2a9c1d7e99';
const S = '3f8b2e74-4b3a-4c5d-9e9c-7da05b6c8f43';
const ROW = '5b5b5b5b-4b3a-4c5d-9e9c-7da05b6c8f43';

interface Call { path: string; body: any }
let calls: Call[];
let claimRows: unknown[];
let order: Record<string, unknown> | null;
let payments: { status: string }[];
let shipment: Record<string, unknown> | null;
let refund: Record<string, unknown> | null;
let enqueueFails: boolean;
const real = globalThis.fetch;
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  claimRows = [];
  order = { order_no: 'KH-2026-000042', status: 'paid', customer_name: 'Asha Verma', customer_email: 'asha@example.org', total_paise: 105800, channel: 'online' };
  payments = [{ status: 'captured' }];
  shipment = null;
  refund = null;
  enqueueFails = false;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/rest/v1/', '');
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    if (path === 'rpc/email_claim_due') return json(200, claimRows);
    if (path === 'rpc/email_enqueue') return enqueueFails ? json(500, {}) : json(200, ROW);
    if (path.startsWith('rpc/')) return json(200, path === 'rpc/email_mark_failed' ? (body.p_permanent ? 'dead' : 'queued') : null);
    if (path === 'orders') return json(200, order ? [order] : []);
    if (path === 'order_payments') return json(200, payments);
    if (path === 'shipments') return json(200, shipment ? [shipment] : []);
    if (path === 'order_refunds') return json(200, refund ? [refund] : []);
    if (path === 'order_items') return json(200, [{ product_name: 'Test syrup', pack_size: '200 ml', qty: 2 }]);
    return json(404, {});
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = real;
});

const row = (kind: string, payload: unknown = { orderId: O }, created = new Date().toISOString()) => ({ id: ROW, kind, to_email: 'asha@example.org', attempts: 1, payload, created_at: created });
const rpcs = (name: string) => calls.filter((c) => c.path === `rpc/${name}`);
function resend(status = 200) {
  const sent: { headers: Record<string, string>; body: any }[] = [];
  const fetchImpl = (async (_u: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
    sent.push({ headers: init?.headers ?? {}, body: JSON.parse(init?.body ?? '{}') });
    return json(status, status === 200 ? { id: 'resend_msg_1' } : { message: 'asha@example.org is invalid' });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

describe('drainOutbox: payment confirmation', () => {
  it('does not send until the backend has a captured payment and a paid order', async () => {
    payments = [{ status: 'created' }];
    claimRows = [row('payment_confirmed')];
    const r = resend();
    const out = await drainOutbox(DB, CFG, { fetchImpl: r.fetchImpl });
    expect(r.sent).toHaveLength(0);
    expect(out).toMatchObject({ claimed: 1, sent: 0, deferred: 1 });
    expect(rpcs('email_defer')).toHaveLength(1);
    expect(rpcs('email_mark_failed')).toHaveLength(0);
  });
  it('does not send for a captured payment while the order is still unpaid', async () => {
    order = { ...order!, status: 'placed' };
    claimRows = [row('payment_confirmed')];
    const r = resend();
    await drainOutbox(DB, CFG, { fetchImpl: r.fetchImpl });
    expect(r.sent).toHaveLength(0);
  });
  it('sends once verified, with a stable idempotency key, and records the provider id', async () => {
    claimRows = [row('payment_confirmed')];
    const r = resend();
    const out = await drainOutbox(DB, CFG, { fetchImpl: r.fetchImpl });
    expect(out.sent).toBe(1);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].headers['Idempotency-Key']).toBe(`kaayra-outbox-${ROW}`);
    expect(r.sent[0].body.to).toEqual(['asha@example.org']);
    expect(r.sent[0].body.html).toContain('KH-2026-000042');
    expect(r.sent[0].body.text).toContain('KH-2026-000042');
    expect(rpcs('email_mark_sent')[0].body).toMatchObject({ p_id: ROW, p_provider_id: 'resend_msg_1' });
  });
  it('gives up quietly after 48 hours without verification', async () => {
    payments = [];
    claimRows = [row('payment_confirmed', { orderId: O }, new Date(Date.now() - 49 * 3_600_000).toISOString())];
    const r = resend();
    const out = await drainOutbox(DB, CFG, { fetchImpl: r.fetchImpl });
    expect(out.skipped).toBe(1);
    expect(rpcs('email_mark_skipped')[0].body.p_reason).toBe('gate_not_met');
    expect(r.sent).toHaveLength(0);
  });
});

describe('drainOutbox: failures', () => {
  it('schedules a retry for a provider outage', async () => {
    claimRows = [row('payment_confirmed')];
    const out = await drainOutbox(DB, CFG, { fetchImpl: resend(503).fetchImpl });
    expect(out).toMatchObject({ sent: 0, retried: 1, dead: 0 });
    expect(rpcs('email_mark_failed')[0].body).toMatchObject({ p_error: 'http_503', p_permanent: false });
  });
  it('stops retrying a rejected request, and keeps the recipient out of what is stored', async () => {
    claimRows = [row('payment_confirmed')];
    const out = await drainOutbox(DB, CFG, { fetchImpl: resend(422).fetchImpl });
    expect(out.dead).toBe(1);
    const b = rpcs('email_mark_failed')[0].body;
    expect(b.p_permanent).toBe(true);
    expect(JSON.stringify(b)).not.toContain('asha@example.org');
  });
  it('waits without using an attempt when email is not configured', async () => {
    claimRows = [row('payment_confirmed')];
    const out = await drainOutbox(DB, null);
    expect(out.deferred).toBe(1);
    expect(rpcs('email_defer')[0].body.p_minutes).toBe(60);
  });
  it('skips rows it cannot understand rather than sending them', async () => {
    claimRows = [row('contact_owner'), row('payment_confirmed', { orderId: 'not-a-uuid' })];
    const r = resend();
    const out = await drainOutbox(DB, CFG, { fetchImpl: r.fetchImpl });
    expect(out.skipped).toBe(2);
    expect(r.sent).toHaveLength(0);
  });
  it('skips a mail whose order no longer exists', async () => {
    order = null;
    claimRows = [row('payment_confirmed')];
    expect((await drainOutbox(DB, CFG, { fetchImpl: resend().fetchImpl })).skipped).toBe(1);
  });
  it('does not log or store customer details when the worker itself errors', async () => {
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(' '));
    try {
      claimRows = [row('payment_confirmed')];
      globalThis.fetch = (async (input: unknown) => {
        if (String(input).includes('rpc/email_claim_due')) return json(200, claimRows);
        if (String(input).includes('/rest/v1/orders')) throw new Error('boom for asha@example.org at 12 Lanka Road');
        return json(200, null);
      }) as typeof fetch;
      await drainOutbox(DB, CFG, { fetchImpl: resend().fetchImpl });
    } finally {
      console.error = orig;
    }
    expect(logged.join(' ')).not.toMatch(/asha@example\.org|Lanka/);
  });
});

describe('drainOutbox: shipment mail', () => {
  it('ignores a shipment that belongs to a different order', async () => {
    shipment = { status: 'dispatched', courier: 'Test Courier', tracking_no: 'TRK123', order_id: O2 };
    claimRows = [row('shipment_dispatched', { orderId: O, shipmentId: S })];
    const r = resend();
    const out = await drainOutbox(DB, CFG, { fetchImpl: r.fetchImpl });
    expect(r.sent).toHaveLength(0);
    expect(out.deferred).toBe(1);
  });
  it('sends the dispatch mail with courier and tracking for the right shipment', async () => {
    shipment = { status: 'dispatched', courier: 'Test Courier', tracking_no: 'TRK123', order_id: O };
    claimRows = [row('shipment_dispatched', { orderId: O, shipmentId: S })];
    const r = resend();
    await drainOutbox(DB, CFG, { fetchImpl: r.fetchImpl });
    expect(r.sent[0].body.text).toContain('TRK123');
  });
});

describe('enqueueOrderMail', () => {
  it('stores only ids in the payload and the stable key', async () => {
    expect(await enqueueOrderMail(DB, 'payment_confirmed', 'asha@example.org', `payment_confirmed:${O}`, { orderId: O })).toBe('queued');
    const b = rpcs('email_enqueue')[0].body;
    expect(b).toEqual({ p_kind: 'payment_confirmed', p_to: 'asha@example.org', p_dedupe: `payment_confirmed:${O}`, p_payload: { orderId: O } });
  });
  it('queues nothing without a recipient or with a bad payload, and never throws', async () => {
    expect(await enqueueOrderMail(DB, 'delivered', null, 'delivered:x1234567', { orderId: O })).toBe('no_recipient');
    expect(await enqueueOrderMail(DB, 'delivered', 'a@b.co', 'delivered:x1234567', { orderId: 'bad' })).toBe('no_recipient');
    enqueueFails = true;
    expect(await enqueueOrderMail(DB, 'delivered', 'a@b.co', 'delivered:x1234567', { orderId: O })).toBe('error');
    expect(calls.filter((c) => c.path === 'rpc/email_enqueue')).toHaveLength(1);
  });
  it('queuePaymentConfirmed does nothing for a manual (non-online) order', async () => {
    order = { ...order!, channel: 'manual' };
    await queuePaymentConfirmed(DB, O);
    expect(rpcs('email_enqueue')).toHaveLength(0);
  });
});

describe('sweepMailEvents', () => {
  it('queues the same keys every time, so a second pass cannot duplicate a notification', async () => {
    const orig = globalThis.fetch;
    const rowsFor = (path: string, q: string): unknown[] => {
      if (path === 'order_payments') return [{ order_id: O, orders: { customer_email: 'asha@example.org' } }];
      if (path === 'orders') return [{ id: O2, customer_email: 'b@example.org' }];
      if (path === 'shipments') return [{ id: S, order_id: O, status: 'delivered', orders: { customer_email: 'asha@example.org' } }];
      if (path === 'order_refunds') return [{ id: ROW, order_id: O, status: 'refunded', orders: { customer_email: 'asha@example.org' } }];
      return q ? [] : [];
    };
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
      const u = new URL(String(input));
      const path = u.pathname.replace('/rest/v1/', '');
      calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
      if (path.startsWith('rpc/')) return json(200, ROW);
      return json(200, rowsFor(path, u.search));
    }) as typeof fetch;
    const keys = async () => {
      calls = [];
      await sweepMailEvents(DB);
      return rpcs('email_enqueue').map((c) => c.body.p_dedupe).sort();
    };
    const first = await keys();
    const second = await keys();
    expect(first).toEqual(second);
    expect(first).toEqual([`delivered:${S}`, `order_cancelled:${O2}`, `payment_confirmed:${O}`, `refund_completed:${ROW}`, `refund_initiated:${ROW}`].sort());
    globalThis.fetch = orig;
  });
});
