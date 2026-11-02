import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay server client (no SDK, so no new dependency). Card and UPI details never touch this site: Razorpay's hosted
 * Checkout collects them. Secrets come from environment variables, are never logged and never sent to the browser
 * (only the public key id is).
 */
export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
}

const BASE = 'https://api.razorpay.com/v1';

/** Reads the API keys. Returns the names of missing variables (never values). Test keys start rzp_test_, live keys rzp_live_. */
export function loadRazorpayConfig(env: Record<string, string | undefined> = process.env): { ok: true; cfg: RazorpayConfig; live: boolean } | { ok: false; missing: string[] } {
  const keyId = env.RAZORPAY_KEY_ID?.trim() ?? '';
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim() ?? '';
  const missing: string[] = [];
  if (!/^rzp_(test|live)_[A-Za-z0-9]{6,}$/.test(keyId)) missing.push('RAZORPAY_KEY_ID');
  if (keySecret.length < 12) missing.push('RAZORPAY_KEY_SECRET');
  if (missing.length) return { ok: false, missing };
  return { ok: true, cfg: { keyId, keySecret }, live: keyId.startsWith('rzp_live_') };
}

export function loadWebhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';
  return s.length >= 12 ? s : null;
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Webhooks: HMAC-SHA256 of the RAW request body with the webhook secret, compared in constant time (header X-Razorpay-Signature). */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(signature.trim(), expected);
}

/** Checkout success callback: HMAC-SHA256 of "razorpay_order_id|razorpay_payment_id" with the API key secret. */
export function verifyCheckoutSignature(rpOrderId: string, rpPaymentId: string, signature: string | undefined, keySecret: string): boolean {
  if (!signature || !keySecret || !rpOrderId || !rpPaymentId) return false;
  const expected = createHmac('sha256', keySecret).update(`${rpOrderId}|${rpPaymentId}`).digest('hex');
  return safeEqualHex(signature.trim(), expected);
}

export class RazorpayError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(cfg: RazorpayConfig, path: string, body: Record<string, unknown> | null, extraHeaders: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body === null ? 'GET' : 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json', ...extraHeaders },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new RazorpayError(0, 'NETWORK', 'Razorpay could not be reached.');
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; description?: string } } | null;
  if (!res.ok) {
    // The description is Razorpay's own plain-language reason; the request (with its key) is never echoed.
    throw new RazorpayError(res.status, data?.error?.code ?? 'ERROR', (data?.error?.description ?? 'Razorpay rejected the request.').slice(0, 200));
  }
  return data as T;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

/** Creates a Razorpay order for an exact amount in paise. `receipt` is our order number (max 40 chars). */
export const createRazorpayOrder = (cfg: RazorpayConfig, o: { amountPaise: number; receipt: string; notes: Record<string, string> }) =>
  call<RazorpayOrder>(cfg, '/orders', { amount: o.amountPaise, currency: 'INR', receipt: o.receipt.slice(0, 40), notes: o.notes });

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

/**
 * Refunds a captured payment, fully or partly. The idempotency key (our refund id) makes a retry return the same refund
 * instead of paying twice.
 */
export const createRazorpayRefund = (cfg: RazorpayConfig, paymentId: string, o: { amountPaise: number; receipt: string; idempotencyKey: string; notes: Record<string, string> }) =>
  call<RazorpayRefund>(cfg, `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: o.amountPaise, speed: 'normal', receipt: o.receipt.slice(0, 40), notes: o.notes }, { 'X-Refund-Idempotency': o.idempotencyKey });

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  error_code?: string | null;
  error_description?: string | null;
}

const RP_ID = { order: /^order_[A-Za-z0-9]{6,40}$/, pay: /^pay_[A-Za-z0-9]{6,40}$/ };
const checkId = (kind: 'order' | 'pay', id: string) => {
  // Ids go into a URL path: refuse anything that is not exactly Razorpay's shape for that kind (no slashes, no dots, no query).
  if (!RP_ID[kind].test(id)) throw new RazorpayError(0, 'BAD_ID', 'Invalid Razorpay id.');
  return id;
};

/** Reads one payment from Razorpay: the provider's own record, used to confirm a browser callback before believing it. */
export const fetchRazorpayPayment = (cfg: RazorpayConfig, paymentId: string) => call<RazorpayPayment>(cfg, `/payments/${checkId('pay', paymentId)}`, null);

/** Reads the payments made against one Razorpay order (used by reconciliation when a webhook is late or lost). */
export const fetchRazorpayOrderPayments = async (cfg: RazorpayConfig, rpOrderId: string): Promise<RazorpayPayment[]> => {
  const r = await call<{ items?: RazorpayPayment[] }>(cfg, `/orders/${checkId('order', rpOrderId)}/payments`, null);
  return Array.isArray(r.items) ? r.items : [];
};
