/**
 * Email outbox rules (Phase 7, Step 2). Pure functions: the decisions the worker makes, so they can be tested without a
 * database. The SQL in supabase/email_outbox_v2.sql owns the queue itself (claiming, locking, backoff); `retryDelayMinutes`
 * mirrors its backoff table and is tested against the same numbers.
 */
import type { OrderMailKind } from './mailTemplates.js';

export const MAX_ATTEMPTS = 6;
/** Minutes to wait after attempt n (1-based) fails. Mirrors email_mark_failed. */
export const RETRY_DELAY_MINUTES: readonly number[] = [1, 5, 30, 120, 720];
export const retryDelayMinutes = (attempt: number): number | null => (attempt >= MAX_ATTEMPTS ? null : (RETRY_DELAY_MINUTES[Math.min(attempt, RETRY_DELAY_MINUTES.length) - 1] ?? null));

/** A mail that waits for a backend fact (verified payment, shipment state) is given up on after this long. */
export const GATE_GIVE_UP_HOURS = 48;
export const GATE_RETRY_MINUTES = 10;

/** Provider errors. 4xx other than 408/429 mean the request itself is wrong (bad address, bad key): retrying cannot help. */
export function isPermanentMailError(error: string): boolean {
  const m = /^http_(\d{3})$/.exec(error);
  if (!m) return false;
  const s = Number(m[1]);
  return s >= 400 && s < 500 && s !== 408 && s !== 429;
}

/** Stable keys: the same event always produces the same key, so a notification is queued once. */
export const dedupeKey = {
  orderCreated: (orderId: string) => `order_created:${orderId}`,
  paymentConfirmed: (orderId: string) => `payment_confirmed:${orderId}`,
  paymentFailed: (orderId: string, rpPaymentId: string) => `payment_failed:${orderId}:${rpPaymentId}`,
  orderCancelled: (orderId: string) => `order_cancelled:${orderId}`,
  shipment: (kind: 'shipment_dispatched' | 'out_for_delivery' | 'delivered' | 'return_received', shipmentId: string) => `${kind}:${shipmentId}`,
  refund: (kind: 'refund_initiated' | 'refund_completed', refundId: string) => `${kind}:${refundId}`,
};

export interface MailContext {
  orderStatus: string | null;
  hasCapturedPayment: boolean;
  hasFailedPayment: boolean;
  shipmentStatus: string | null;
  refundStatus: string | null;
  refundGatewayRefundId: string | null;
  refundGatewayStatus: string | null;
}

export type Gate = { action: 'send' } | { action: 'defer' } | { action: 'skip'; reason: string };

const PAID_OR_LATER = ['paid', 'packed', 'shipped', 'delivered'];

/** True only when the backend's own records support the statement the mail would make RIGHT NOW. */
export function factHolds(kind: OrderMailKind, c: MailContext): boolean {
  switch (kind) {
    case 'order_created':
      return c.orderStatus === 'placed';
    case 'payment_confirmed':
      // A captured payment row AND an order that has actually reached paid. The browser callback alone never qualifies.
      return c.hasCapturedPayment && c.orderStatus !== null && PAID_OR_LATER.includes(c.orderStatus);
    case 'payment_failed':
      return c.hasFailedPayment && !c.hasCapturedPayment;
    case 'order_cancelled':
      return c.orderStatus === 'cancelled';
    case 'shipment_dispatched':
      return c.shipmentStatus === 'dispatched' || c.shipmentStatus === 'in_transit';
    case 'out_for_delivery':
      return c.shipmentStatus === 'out_for_delivery';
    case 'delivered':
      return c.shipmentStatus === 'delivered';
    case 'return_received':
      return c.shipmentStatus === 'returned';
    case 'refund_initiated':
      return c.refundStatus === 'approved';
    case 'refund_completed':
      // Provider-confirmed: a gateway refund must be 'processed'. A manual (non-gateway) refund counts once an admin recorded it.
      return c.refundStatus === 'refunded' && (c.refundGatewayRefundId === null || c.refundGatewayStatus === 'processed');
  }
}

/**
 * True when the mail's statement was once valid but the facts have moved on, so a delayed or retried copy would now be wrong or stale:
 * "order received, waiting for payment" after payment, "dispatched" or "out for delivery" after the parcel moved on, "refund started"
 * after it finished, "payment failed" after a payment was captured. Such mail is dropped, never sent late.
 */
export function superseded(kind: OrderMailKind, c: MailContext): boolean {
  switch (kind) {
    case 'order_created':
      return c.orderStatus !== null && c.orderStatus !== 'placed';
    case 'payment_failed':
      return c.hasCapturedPayment;
    case 'shipment_dispatched':
      return ['out_for_delivery', 'delivered', 'delivery_failed', 'return_to_origin', 'returned'].includes(c.shipmentStatus ?? '');
    case 'out_for_delivery':
      return ['delivered', 'delivery_failed', 'return_to_origin', 'returned'].includes(c.shipmentStatus ?? '');
    case 'refund_initiated':
      return c.refundStatus === 'refunded' || c.refundStatus === 'rejected';
    default:
      return false;
  }
}

/** Send now, wait, or give up. Waiting never uses an attempt; giving up is recorded as 'skipped', not as a failure. */
export function gateDecision(kind: OrderMailKind, c: MailContext, ageHours: number): Gate {
  if (superseded(kind, c)) return { action: 'skip', reason: 'superseded' };
  if (factHolds(kind, c)) return { action: 'send' };
  if (kind === 'order_cancelled' || kind === 'payment_failed') {
    // Facts that can no longer become true (an order never cancelled, a failure that was not recorded) are dropped, not awaited.
    if (ageHours >= 1) return { action: 'skip', reason: 'fact_not_true' };
  }
  return ageHours >= GATE_GIVE_UP_HOURS ? { action: 'skip', reason: 'gate_not_met' } : { action: 'defer' };
}
