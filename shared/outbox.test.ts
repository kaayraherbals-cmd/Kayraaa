import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ORDER_MAIL_KINDS } from './orderMail.js';
import { GATE_GIVE_UP_HOURS, MAX_ATTEMPTS, dedupeKey, factHolds, gateDecision, isPermanentMailError, retryDelayMinutes, superseded, type MailContext } from './outbox.js';

const sql = readFileSync(new URL('../supabase/email_outbox_v2.sql', import.meta.url), 'utf8');
const ctx = (o: Partial<MailContext> = {}): MailContext => ({ orderStatus: 'placed', hasCapturedPayment: false, hasFailedPayment: false, shipmentStatus: null, refundStatus: null, refundGatewayRefundId: null, refundGatewayStatus: null, ...o });

describe('retry schedule', () => {
  it('backs off 1 min, 5 min, 30 min, 2 h, 12 h, then stops', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMinutes)).toEqual([1, 5, 30, 120, 720]);
    expect(retryDelayMinutes(MAX_ATTEMPTS)).toBeNull();
  });
  it('matches the database function', () => {
    for (const phrase of ["1 minute", "5 minutes", "30 minutes", "2 hours", "12 hours"]) expect(sql).toContain(`interval '${phrase}'`);
    expect(sql).toContain(`m.attempts >= ${MAX_ATTEMPTS}`);
  });
  it('knows which provider errors are permanent', () => {
    for (const e of ['http_400', 'http_401', 'http_403', 'http_422']) expect(isPermanentMailError(e)).toBe(true);
    for (const e of ['http_408', 'http_429', 'http_500', 'http_503', 'timeout', 'network']) expect(isPermanentMailError(e)).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('are stable for the same event and different for different events', () => {
    expect(dedupeKey.paymentConfirmed('o1')).toBe(dedupeKey.paymentConfirmed('o1'));
    expect(dedupeKey.paymentConfirmed('o1')).not.toBe(dedupeKey.paymentConfirmed('o2'));
    expect(dedupeKey.shipment('delivered', 's1')).not.toBe(dedupeKey.shipment('out_for_delivery', 's1'));
    expect(dedupeKey.refund('refund_initiated', 'r1')).not.toBe(dedupeKey.refund('refund_completed', 'r1'));
  });
  it('the database enforces uniqueness on the key', () => {
    expect(sql).toContain('create unique index if not exists email_outbox_dedupe_uidx');
    expect(sql).toContain('on conflict (dedupe_key)');
  });
});

describe('the facts a mail may state', () => {
  it('payment confirmed needs a captured payment AND a paid order', () => {
    expect(factHolds('payment_confirmed', ctx({ orderStatus: 'placed', hasCapturedPayment: false }))).toBe(false);
    expect(factHolds('payment_confirmed', ctx({ orderStatus: 'placed', hasCapturedPayment: true }))).toBe(false);
    expect(factHolds('payment_confirmed', ctx({ orderStatus: 'paid', hasCapturedPayment: false }))).toBe(false);
    expect(factHolds('payment_confirmed', ctx({ orderStatus: 'paid', hasCapturedPayment: true }))).toBe(true);
  });
  it('payment failed is never sent when a payment was captured', () => {
    expect(factHolds('payment_failed', ctx({ hasFailedPayment: true }))).toBe(true);
    expect(factHolds('payment_failed', ctx({ hasFailedPayment: true, hasCapturedPayment: true }))).toBe(false);
  });
  it('refund completed needs the provider to confirm a gateway refund', () => {
    expect(factHolds('refund_completed', ctx({ refundStatus: 'approved' }))).toBe(false);
    expect(factHolds('refund_completed', ctx({ refundStatus: 'refunded', refundGatewayRefundId: 'rfnd_1', refundGatewayStatus: 'created' }))).toBe(false);
    expect(factHolds('refund_completed', ctx({ refundStatus: 'refunded', refundGatewayRefundId: 'rfnd_1', refundGatewayStatus: 'failed' }))).toBe(false);
    expect(factHolds('refund_completed', ctx({ refundStatus: 'refunded', refundGatewayRefundId: 'rfnd_1', refundGatewayStatus: 'processed' }))).toBe(true);
    expect(factHolds('refund_completed', ctx({ refundStatus: 'refunded' }))).toBe(true); // manual refund recorded by an admin
  });
  it('shipment mails follow the shipment state', () => {
    expect(factHolds('shipment_dispatched', ctx({ shipmentStatus: 'pending' }))).toBe(false);
    expect(factHolds('shipment_dispatched', ctx({ shipmentStatus: 'dispatched' }))).toBe(true);
    expect(factHolds('shipment_dispatched', ctx({ shipmentStatus: 'in_transit' }))).toBe(true);
    expect(factHolds('out_for_delivery', ctx({ shipmentStatus: 'in_transit' }))).toBe(false);
    expect(factHolds('out_for_delivery', ctx({ shipmentStatus: 'out_for_delivery' }))).toBe(true);
    expect(factHolds('delivered', ctx({ shipmentStatus: 'out_for_delivery' }))).toBe(false);
    expect(factHolds('delivered', ctx({ shipmentStatus: 'delivered' }))).toBe(true);
    expect(factHolds('return_received', ctx({ shipmentStatus: 'return_to_origin' }))).toBe(false);
    expect(factHolds('return_received', ctx({ shipmentStatus: 'returned' }))).toBe(true);
  });
  it('covers every mail kind', () => {
    for (const k of ORDER_MAIL_KINDS) expect(typeof factHolds(k, ctx())).toBe('boolean');
  });
});

describe('gate decision', () => {
  it('waits for an unverified payment, then gives up quietly', () => {
    expect(gateDecision('payment_confirmed', ctx(), 0.1)).toEqual({ action: 'defer' });
    expect(gateDecision('payment_confirmed', ctx(), GATE_GIVE_UP_HOURS + 1)).toEqual({ action: 'skip', reason: 'gate_not_met' });
  });
  it('sends when the fact holds', () => {
    expect(gateDecision('payment_confirmed', ctx({ orderStatus: 'paid', hasCapturedPayment: true }), 0)).toEqual({ action: 'send' });
  });
  it('drops a cancelled or failed notice whose fact is not true after an hour', () => {
    expect(gateDecision('order_cancelled', ctx(), 2)).toEqual({ action: 'skip', reason: 'fact_not_true' });
    expect(gateDecision('payment_failed', ctx({ hasCapturedPayment: false, hasFailedPayment: false }), 2)).toEqual({ action: 'skip', reason: 'fact_not_true' });
    expect(gateDecision('payment_failed', ctx({ hasCapturedPayment: true, hasFailedPayment: true }), 2)).toEqual({ action: 'skip', reason: 'superseded' });
  });
});

describe('a retried or delayed mail is never stale', () => {
  it('drops "order received" once the order is paid or cancelled, and "payment failed" once a payment is captured', () => {
    expect(gateDecision('order_created', ctx({ orderStatus: 'placed' }), 0)).toEqual({ action: 'send' });
    expect(gateDecision('order_created', ctx({ orderStatus: 'paid' }), 5)).toEqual({ action: 'skip', reason: 'superseded' });
    expect(gateDecision('order_created', ctx({ orderStatus: 'cancelled' }), 5)).toEqual({ action: 'skip', reason: 'superseded' });
    expect(gateDecision('payment_failed', ctx({ hasFailedPayment: true, hasCapturedPayment: true }), 0)).toEqual({ action: 'skip', reason: 'superseded' });
  });
  it('drops "dispatched" and "out for delivery" once the parcel has moved on', () => {
    expect(gateDecision('shipment_dispatched', ctx({ shipmentStatus: 'dispatched' }), 0)).toEqual({ action: 'send' });
    for (const st of ['out_for_delivery', 'delivered', 'returned']) expect(gateDecision('shipment_dispatched', ctx({ shipmentStatus: st }), 0)).toEqual({ action: 'skip', reason: 'superseded' });
    expect(gateDecision('out_for_delivery', ctx({ shipmentStatus: 'out_for_delivery' }), 0)).toEqual({ action: 'send' });
    for (const st of ['delivered', 'delivery_failed', 'returned']) expect(gateDecision('out_for_delivery', ctx({ shipmentStatus: st }), 0)).toEqual({ action: 'skip', reason: 'superseded' });
  });
  it('drops "refund started" once the refund finished, and still sends "refund completed"', () => {
    expect(gateDecision('refund_initiated', ctx({ refundStatus: 'approved' }), 0)).toEqual({ action: 'send' });
    expect(gateDecision('refund_initiated', ctx({ refundStatus: 'refunded' }), 0)).toEqual({ action: 'skip', reason: 'superseded' });
    expect(gateDecision('refund_initiated', ctx({ refundStatus: 'rejected' }), 0)).toEqual({ action: 'skip', reason: 'superseded' });
    expect(gateDecision('refund_completed', ctx({ refundStatus: 'refunded' }), 0)).toEqual({ action: 'send' });
  });
  it('never marks payment confirmation, delivery or cancellation as superseded', () => {
    for (const k of ['payment_confirmed', 'delivered', 'order_cancelled', 'return_received', 'refund_completed'] as const) expect(superseded(k, ctx({ orderStatus: 'delivered', shipmentStatus: 'delivered' }))).toBe(false);
  });
});

describe('the outbox migration', () => {
  it('is additive and clears the payload once a mail is sent', () => {
    expect(sql).not.toMatch(/drop table|truncate/i);
    expect(sql).toMatch(/email_mark_sent[\s\S]*payload = null/);
  });
  it('allows all ten order kinds and the old ones', () => {
    for (const k of [...ORDER_MAIL_KINDS, 'contact_owner', 'launch_confirm', 'issue_owner']) expect(sql).toContain(`'${k}'`);
  });
  it('keeps the table server-only', () => {
    expect(sql).toContain('revoke all on function public.email_claim_due(integer) from public, anon, authenticated');
  });
});
