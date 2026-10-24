import { checkoutOpen } from './checkout.js';
import type { Flags } from './flags.js';

/**
 * Razorpay payments: pure, browser-safe helpers (no secrets, no network). Amounts are always whole paise; the amount to
 * collect is read from the order in the database, never from the browser. Signature checks live in server/razorpay.ts.
 */
export const PAYMENT_STATUSES = ['created', 'authorized', 'captured', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { created: 'Waiting for payment', authorized: 'Authorised, not captured', captured: 'Paid', failed: 'Failed' };

export type PaymentFlag = 'amount_mismatch' | 'order_not_open';
export const PAYMENT_FLAG_LABELS: Record<PaymentFlag, string> = {
  amount_mismatch: 'Amount received does not match the order. Do not ship; check in Razorpay.',
  order_not_open: 'Paid after the order was cancelled or closed. Needs a refund or a decision.',
};

export interface OrderPayment {
  id: string;
  order_id: string;
  rp_order_id: string;
  rp_payment_id: string | null;
  amount_paise: number;
  status: PaymentStatus;
  method: string | null;
  error_code: string | null;
  error_note: string | null;
  flagged: PaymentFlag | null;
  created_by: string;
  created_at: string;
  captured_at: string | null;
}

/** Webhook events this site acts on. Anything else is stored and ignored. */
export const HANDLED_EVENTS = ['payment.authorized', 'payment.captured', 'payment.failed', 'order.paid', 'refund.processed', 'refund.failed'] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];
export const isHandledEvent = (v: unknown): v is HandledEvent => typeof v === 'string' && (HANDLED_EVENTS as readonly string[]).includes(v);

export interface ParsedWebhook {
  event: string;
  rp_order_id: string | null;
  rp_payment_id: string | null;
  rp_refund_id: string | null;
  amount_paise: number | null;
  method: string | null;
  error_code: string | null;
  error_note: string | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

/**
 * Picks only the fields we use out of a Razorpay webhook body. Returns null when it is not shaped like a Razorpay event.
 * Amounts must be whole positive paise (Razorpay sends integers); anything else becomes null and so can never match an order.
 */
export function parseWebhook(body: unknown): ParsedWebhook | null {
  const root = obj(body);
  const event = root && typeof root.event === 'string' ? root.event.slice(0, 60) : null;
  const payload = root ? obj(root.payload) : null;
  if (!event || !payload) return null;
  const payment = obj(obj(payload.payment)?.entity);
  const order = obj(obj(payload.order)?.entity);
  const refund = obj(obj(payload.refund)?.entity);
  const amount = payment?.amount;
  return {
    event,
    rp_order_id: str(payment?.order_id, 64) ?? str(order?.id, 64),
    rp_payment_id: str(payment?.id, 64) ?? str(refund?.payment_id, 64),
    rp_refund_id: str(refund?.id, 64),
    amount_paise: typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 ? amount : null,
    method: str(payment?.method, 30),
    error_code: str(payment?.error_code, 80),
    error_note: str(payment?.error_description, 200),
  };
}

/** The order total must be collected in full: whole paise, above zero, and within Razorpay's per-order ceiling (Rs 5,00,000 by default). */
export const MAX_ORDER_PAISE = 50_000_000;
export const isCollectable = (paise: unknown): paise is number => typeof paise === 'number' && Number.isSafeInteger(paise) && paise > 0 && paise <= MAX_ORDER_PAISE;

/** What is still payable back to the customer through the gateway for one payment (never below zero). */
export const gatewayRefundableLeft = (paidPaise: number, alreadyRefundedPaise: number): number => Math.max(0, paidPaise - alreadyRefundedPaise);

// ---- Customer payment (Phase 5, Section 4) -------------------------------------------------------------------------

/** Key mode from the key id prefix. Anything else is treated as unusable. */
export const keyMode = (keyId: string): 'test' | 'live' | null => (keyId.startsWith('rzp_test_') ? 'test' : keyId.startsWith('rzp_live_') ? 'live' : null);

/**
 * Whether a customer may be sent to Razorpay. Needs checkout open, then:
 *  - a TEST key and the payment-test flag (staging / preview / local only), or
 *  - a LIVE key and the production live-sales approval (flags.live_sales).
 * A live key is never accepted outside approved production; a test key is never accepted in production.
 */
export function paymentsOpen(flags: Flags, keyId: string | null): boolean {
  if (!checkoutOpen(flags)) return false;
  const mode = keyId ? keyMode(keyId) : null;
  if (mode === 'live') return flags.live_sales;
  if (mode === 'test') return flags.payment_test_mode;
  return false;
}

/**
 * Test and live must never mix: a test order (is_test) may only be paid with a rzp_test_ key, and a live order only with a rzp_live_ key.
 * Checked on the server before any Razorpay order is created or reused.
 */
export const keyMatchesOrder = (isTest: boolean, keyId: string): boolean => {
  const m = keyMode(keyId);
  return m !== null && (isTest ? m === 'test' : m === 'live');
};

const RP_ORDER_RE = /^order_[A-Za-z0-9]{6,40}$/;
const RP_PAYMENT_RE = /^pay_[A-Za-z0-9]{6,40}$/;
const SIG_RE = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The only things the browser sends about a payment: which of its own orders, and what Razorpay Checkout handed back. */
export interface VerifyRequest {
  orderId: string;
  rpOrderId: string;
  rpPaymentId: string;
  signature: string;
}

export function validateOrderRef(raw: unknown): { ok: true; orderId: string } | { ok: false } {
  return isRec(raw) && typeof raw.orderId === 'string' && UUID.test(raw.orderId) ? { ok: true, orderId: raw.orderId.toLowerCase() } : { ok: false };
}

export function validateVerifyRequest(raw: unknown): { ok: true; value: VerifyRequest } | { ok: false } {
  const ref = validateOrderRef(raw);
  if (!ref.ok || !isRec(raw)) return { ok: false };
  const { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: g } = raw;
  if (typeof o !== 'string' || !RP_ORDER_RE.test(o) || typeof p !== 'string' || !RP_PAYMENT_RE.test(p) || typeof g !== 'string' || !SIG_RE.test(g)) return { ok: false };
  return { ok: true, value: { orderId: ref.orderId, rpOrderId: o, rpPaymentId: p, signature: g.toLowerCase() } };
}

/** What Razorpay reports about one payment, reduced to the fields we compare. */
export interface ProviderPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
}

export type VerifyDecision =
  | { kind: 'captured'; event: 'payment.captured' }
  | { kind: 'failed'; event: 'payment.failed' }
  | { kind: 'processing' }
  | { kind: 'mismatch'; reason: 'order' | 'amount' | 'currency' };

/**
 * Decides what a provider-reported payment means for OUR order. Order id, amount and currency must all match what we
 * created; only then is a "captured" status believed. Anything else never marks the order paid.
 */
export function decideVerification(p: ProviderPayment, expect: { rpOrderId: string; rpPaymentId: string; amountPaise: number }): VerifyDecision {
  if (p.id !== expect.rpPaymentId || p.order_id !== expect.rpOrderId) return { kind: 'mismatch', reason: 'order' };
  if (p.currency !== 'INR') return { kind: 'mismatch', reason: 'currency' };
  if (p.amount !== expect.amountPaise) return { kind: 'mismatch', reason: 'amount' };
  if (p.status === 'captured') return { kind: 'captured', event: 'payment.captured' };
  if (p.status === 'failed') return { kind: 'failed', event: 'payment.failed' };
  return { kind: 'processing' };
}

/** What the customer's screen shows. 'review' means money and order disagree and a person will look; never "paid". */
export type ClientPayState = 'paid' | 'processing' | 'failed' | 'review' | 'unpaid' | 'cancelled';

export function clientPayState(order: { status: string }, payment: { status: PaymentStatus | null; flagged: PaymentFlag | null }): ClientPayState {
  if (payment.flagged) return 'review';
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status !== 'placed') return 'paid'; // paid, packed, shipped, delivered: only reachable through a verified capture
  if (payment.status === 'captured') return 'paid';
  if (payment.status === 'authorized') return 'processing';
  if (payment.status === 'failed') return 'failed';
  return 'unpaid';
}

/** Event id for a capture we confirmed ourselves (client callback or reconciliation). Same payment, same id: harmless to repeat. */
export const syntheticEventId = (source: 'verify' | 'reconcile', rpPaymentId: string, event: string): string => `${source}:${rpPaymentId}:${event}`;
