import { timingSafeEqual } from 'node:crypto';
import type { VercelResponse } from '@vercel/node';
import { isUuid } from '../shared/cart.js';
import type { ErrorCode } from '../shared/errors.js';
import { clientPayState, decideVerification, keyMatchesOrder, paymentsOpen, syntheticEventId, type OrderPayment, type PaymentFlag, type PaymentStatus, type ProviderPayment, type VerifyRequest } from '../shared/payments.js';
import type { Flags } from '../shared/flags.js';
import { sendError } from './errors.js';
import { RazorpayError, createRazorpayOrder, fetchRazorpayOrderPayments, fetchRazorpayPayment, loadRazorpayConfig, verifyCheckoutSignature, type RazorpayConfig } from './razorpay.js';
import { queuePaymentConfirmed } from './outbox.js';
import { rpc } from './rpc.js';
import { rest, type SupabaseConfig } from './supabase.js';

/**
 * Customer payment actions (Phase 5, Section 4). Called from api/checkout/[action].ts after sign-in, origin and CSRF checks.
 *
 * Money rules, in one place:
 *  - The amount sent to Razorpay is the order total read from the database. The browser sends only an order id.
 *  - The browser's "payment succeeded" callback is never believed on its own. Its signature is checked, then Razorpay is asked
 *    for the payment, and the order id, amount, currency and status must all match before the database marks the order paid.
 *  - Only the database function payment_apply_event changes an order to paid, for the browser callback, the webhook and
 *    reconciliation alike, so all three behave the same and each is safe to repeat.
 *  - Logs and audit rows carry ids and amounts only: no names, addresses, phone numbers or emails.
 */

export interface PayEnv {
  keyId: string | null;
  open: boolean;
}

/** Whether payment is open here, and the public key id. Never returns the secret. */
export function paymentEnv(flags: Flags, env: Record<string, string | undefined> = process.env): PayEnv & { cfg: RazorpayConfig | null } {
  const gw = loadRazorpayConfig(env);
  const keyId = gw.ok ? gw.cfg.keyId : null;
  return { keyId, open: paymentsOpen(flags, keyId), cfg: gw.ok ? gw.cfg : null };
}

async function audit(db: SupabaseConfig, action: string, detail: Record<string, unknown>): Promise<void> {
  try {
    await rest(db, 'admin_audit', { method: 'POST', body: JSON.stringify({ actor: 'customer-payment', action, detail }) });
  } catch {
    /* best effort, like every audit write */
  }
}

function fail(res: VercelResponse, code: ErrorCode, extra: Record<string, unknown> = {}, status?: number) {
  return sendError(res, 'PAY', code, extra, status);
}

function dbFailure(res: VercelResponse, f: { kind: string; message: string }) {
  if (f.kind === 'not_found') return fail(res, 'KH-PAY-003', {}, 404);
  if (f.kind === 'state') return fail(res, 'KH-PAY-005', { message: f.message });
  if (f.kind === 'invalid') return fail(res, 'KH-PAY-003');
  return fail(res, 'KH-PAY-007');
}

export interface OwnPaymentView {
  orderId: string;
  orderNo: string;
  orderStatus: string;
  totalPaise: number;
  payBy: string | null;
  isTest: boolean;
  payment: { status: PaymentStatus | null; flagged: PaymentFlag | null; rpOrderId: string | null };
}

/** Order and payment state, but only for an order this member owns. Ownership is in the query, not checked afterwards. */
export async function readOwnPayment(db: SupabaseConfig, memberId: string, orderId: string): Promise<OwnPaymentView | null> {
  if (!isUuid(memberId) || !isUuid(orderId)) return null;
  const o = await rest(db, `orders?select=id,order_no,status,total_paise,pay_by,is_test&id=eq.${orderId}&member_id=eq.${memberId}&limit=1`);
  if (!o.ok) throw new Error(`order ${o.status}`);
  const order = ((await o.json()) as { id: string; order_no: string; status: string; total_paise: number | string; pay_by: string | null; is_test: boolean }[])[0];
  if (!order) return null;
  const p = await rest(db, `order_payments?select=status,flagged,rp_order_id,created_at&order_id=eq.${orderId}&order=created_at.desc&limit=10`);
  if (!p.ok) throw new Error(`payments ${p.status}`);
  const rows = (await p.json()) as Pick<OrderPayment, 'status' | 'flagged' | 'rp_order_id'>[];
  // A captured payment, or a flagged one, outranks a newer failed retry: the customer must see the truth about the money.
  const pick = rows.find((r) => r.status === 'captured') ?? rows.find((r) => r.flagged) ?? rows[0] ?? null;
  return {
    orderId: order.id,
    orderNo: order.order_no,
    orderStatus: order.status,
    totalPaise: Number(order.total_paise),
    payBy: order.pay_by,
    isTest: order.is_test,
    payment: { status: pick?.status ?? null, flagged: pick?.flagged ?? null, rpOrderId: pick?.rp_order_id ?? null },
  };
}

export const viewState = (v: OwnPaymentView) => clientPayState({ status: v.orderStatus }, v.payment);

const stateBody = (v: OwnPaymentView) => ({ status: 'ok', state: viewState(v), order: { id: v.orderId, orderNo: v.orderNo, status: v.orderStatus, totalPaise: v.totalPaise, payBy: v.payBy, isTest: v.isTest } });

// ---- status ----------------------------------------------------------------------------------------------------------
export async function statusAction(res: VercelResponse, db: SupabaseConfig, memberId: string, orderId: string) {
  const v = await readOwnPayment(db, memberId, orderId);
  if (!v) return fail(res, 'KH-PAY-003', {}, 404);
  return res.status(200).json(stateBody(v));
}

// ---- pay: create (or reuse) the Razorpay order for one of the member's own unpaid orders ---------------------------------
interface Prepared {
  order_no: string;
  amount_paise: number;
  is_test: boolean;
  pay_by: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  reuse: { payment_id: string; rp_order_id: string; status: string } | null;
}

export async function payAction(res: VercelResponse, db: SupabaseConfig, cfg: RazorpayConfig, memberId: string, orderId: string) {
  const prep = await rpc<Prepared>(db, 'payment_prepare', { p_member: memberId, p_order: orderId });
  if (!prep.ok) return dbFailure(res, prep.failure);
  const p = prep.data;
  if (!keyMatchesOrder(p.is_test, cfg.keyId)) {
    console.error('razorpay key mode does not match the order mode; payment refused');
    return fail(res, 'KH-PAY-007');
  }
  const checkout = (rpOrderId: string) => ({
    status: 'ok',
    keyId: cfg.keyId, // public key id only; the secret never leaves the server
    razorpayOrderId: rpOrderId,
    amountPaise: p.amount_paise,
    currency: 'INR',
    orderNo: p.order_no,
    isTest: p.is_test,
    payBy: p.pay_by,
    prefill: { name: p.customer_name, email: p.customer_email ?? '', contact: p.customer_phone ?? '' },
  });
  // An open attempt is reused, never duplicated: a second Razorpay order beside an authorised payment could be paid twice.
  if (p.reuse) return res.status(200).json(checkout(p.reuse.rp_order_id));

  let rp;
  try {
    rp = await createRazorpayOrder(cfg, { amountPaise: p.amount_paise, receipt: p.order_no, notes: { order_no: p.order_no } });
  } catch (e) {
    console.error('razorpay order create failed', e instanceof RazorpayError ? `${e.httpStatus} ${e.code}` : 'error');
    return fail(res, 'KH-PAY-007');
  }
  if (rp.amount !== p.amount_paise || rp.currency !== 'INR') {
    console.error('razorpay order amount differs from our order total');
    return fail(res, 'KH-PAY-007');
  }
  const att = await rpc<{ payment_id: string; rp_order_id: string; reused: boolean }>(db, 'payment_attach', { p_member: memberId, p_order: orderId, p_rp_order: rp.id, p_amount: p.amount_paise, p_actor: `customer:${memberId}` });
  if (!att.ok) return dbFailure(res, att.failure);
  return res.status(200).json(checkout(att.data.rp_order_id));
}

// ---- verify: the browser says it paid; believe Razorpay, not the browser --------------------------------------------------
export async function verifyAction(res: VercelResponse, db: SupabaseConfig, cfg: RazorpayConfig, memberId: string, v: VerifyRequest) {
  const own = await readOwnPayment(db, memberId, v.orderId);
  if (!own) return fail(res, 'KH-PAY-003', {}, 404);

  // The Razorpay order must be one WE created for THIS order. A signature for some other order proves nothing here.
  const pr = await rest(db, `order_payments?select=id,rp_order_id,amount_paise&order_id=eq.${v.orderId}&rp_order_id=eq.${encodeURIComponent(v.rpOrderId)}&limit=1`);
  if (!pr.ok) throw new Error(`payment lookup ${pr.status}`);
  const mine = ((await pr.json()) as { id: string; rp_order_id: string; amount_paise: number | string }[])[0];
  if (!mine) {
    await audit(db, 'payment_verify_unknown_order', { order: v.orderId, rp_order: v.rpOrderId });
    return fail(res, 'KH-PAY-004');
  }
  if (!verifyCheckoutSignature(v.rpOrderId, v.rpPaymentId, v.signature, cfg.keySecret)) {
    await audit(db, 'payment_verify_bad_signature', { order: v.orderId, rp_order: v.rpOrderId, rp_payment: v.rpPaymentId });
    return fail(res, 'KH-PAY-004');
  }

  let provider: ProviderPayment;
  try {
    const rp = await fetchRazorpayPayment(cfg, v.rpPaymentId);
    provider = { id: rp.id, order_id: rp.order_id, amount: rp.amount, currency: rp.currency, status: rp.status };
  } catch (e) {
    // Razorpay could not be asked. The signature was good, so this is probably a real payment, but we do not mark anything
    // paid on a signature alone. The webhook or reconciliation will settle it; the screen says "processing".
    console.error('razorpay payment fetch failed', e instanceof RazorpayError ? `${e.httpStatus} ${e.code}` : 'error');
    return res.status(200).json({ ...stateBody(own), state: 'processing' });
  }

  const d = decideVerification(provider, { rpOrderId: mine.rp_order_id, rpPaymentId: v.rpPaymentId, amountPaise: Number(mine.amount_paise) });
  if (d.kind === 'processing') return res.status(200).json({ ...stateBody(own), state: 'processing' });

  const event = d.kind === 'failed' ? 'payment.failed' : d.kind === 'captured' ? 'payment.captured' : provider.status === 'captured' && d.reason === 'amount' ? 'payment.captured' : null;
  if (!event) {
    // Wrong order or currency: nothing is applied. A person is told.
    await audit(db, 'payment_verify_mismatch', { order: v.orderId, rp_order: v.rpOrderId, rp_payment: v.rpPaymentId, reason: d.kind === 'mismatch' ? d.reason : 'unknown' });
    return fail(res, 'KH-PAY-004');
  }
  // For an amount mismatch the database flags it (amount_mismatch) and keeps the order unpaid.
  const r = await rpc<string>(db, 'payment_apply_event', {
    p_event_id: syntheticEventId('verify', v.rpPaymentId, event),
    p_event: event,
    p_rp_order: mine.rp_order_id,
    p_rp_payment: v.rpPaymentId,
    p_rp_refund: null,
    p_amount: provider.amount > 0 && Number.isSafeInteger(provider.amount) ? provider.amount : null,
    p_method: null,
    p_error_code: event === 'payment.failed' ? 'verify' : null,
    p_error_note: null,
  });
  if (!r.ok) return fail(res, 'KH-PAY-007');
  if (r.data === 'amount_mismatch' || r.data === 'order_not_open') await audit(db, `payment_${r.data}`, { order: v.orderId, rp_order: v.rpOrderId, rp_payment: v.rpPaymentId, amount_paise: provider.amount });

  // Only a result the database accepted as captured queues the mail; the worker re-checks the captured payment before sending.
  if (r.data === 'captured') await queuePaymentConfirmed(db, v.orderId);
  const after = await readOwnPayment(db, memberId, v.orderId);
  if (!after) return fail(res, 'KH-PAY-007');
  return res.status(200).json(stateBody(after));
}

// ---- cancel: the customer withdraws an unpaid order ---------------------------------------------------------------------
export async function cancelAction(res: VercelResponse, db: SupabaseConfig, memberId: string, orderId: string) {
  const r = await rpc<string>(db, 'order_cancel_own', { p_member: memberId, p_order: orderId });
  if (!r.ok) return dbFailure(res, r.failure);
  const v = await readOwnPayment(db, memberId, orderId);
  if (!v) return fail(res, 'KH-PAY-007');
  return res.status(200).json(stateBody(v));
}

// ---- reconcile: settle late webhooks, then release stock held by orders that were never paid --------------------------------
export interface ReconcileResult {
  checked: number;
  expired: number;
  paidFound: number;
  deferred: number;
}

interface Due {
  order_id: string;
  order_no: string;
  rp_orders: string[];
}

/**
 * For each unpaid order past its payment window: ask Razorpay what happened on its Razorpay orders and apply any capture
 * first; only then release the stock. If Razorpay cannot be asked, the order is left alone (deferred), because holding stock a
 * little longer is safe and cancelling an order that was really paid is not. Safe to run as often as you like.
 */
export async function reconcileExpired(db: SupabaseConfig, cfg: RazorpayConfig | null, limit = 25): Promise<ReconcileResult> {
  const out: ReconcileResult = { checked: 0, expired: 0, paidFound: 0, deferred: 0 };
  const due = await rpc<Due[]>(db, 'orders_due_for_expiry', { p_limit: limit, p_grace_minutes: 2 });
  if (!due.ok) throw new Error('orders_due_for_expiry failed');
  for (const o of Array.isArray(due.data) ? due.data : []) {
    out.checked++;
    let captured = false;
    let askedAll = true;
    for (const rpOrder of o.rp_orders ?? []) {
      if (!cfg) {
        askedAll = false;
        break;
      }
      try {
        for (const p of await fetchRazorpayOrderPayments(cfg, rpOrder)) {
          if (p.status !== 'captured') continue;
          const r = await rpc<string>(db, 'payment_apply_event', {
            p_event_id: syntheticEventId('reconcile', p.id, 'payment.captured'),
            p_event: 'payment.captured',
            p_rp_order: rpOrder,
            p_rp_payment: p.id,
            p_rp_refund: null,
            p_amount: Number.isSafeInteger(p.amount) && p.amount > 0 ? p.amount : null,
            p_method: typeof p.method === 'string' ? p.method.slice(0, 30) : null,
            p_error_code: null,
            p_error_note: null,
          });
          if (r.ok && (r.data === 'captured' || r.data === 'duplicate')) captured = true;
          if (r.ok && (r.data === 'amount_mismatch' || r.data === 'order_not_open')) await audit(db, `payment_${r.data}`, { order: o.order_id, rp_order: rpOrder, rp_payment: p.id, amount_paise: p.amount });
        }
      } catch {
        askedAll = false;
      }
    }
    if (captured) {
      out.paidFound++;
      continue;
    }
    if (!askedAll) {
      out.deferred++;
      continue;
    }
    const e = await rpc<string>(db, 'order_expire', { p_order: o.order_id, p_actor: 'system:expiry', p_grace_minutes: 2 });
    if (e.ok && e.data === 'expired') out.expired++;
    else if (e.ok && e.data === 'paid') out.paidFound++;
    else if (e.ok && e.data === 'held') out.deferred++; // KH6-012: an attempt was authorised in the last 24 hours, so stock stays held
  }
  return out;
}

/** Constant-time check of the scheduler's shared secret (Authorization: Bearer <CRON_SECRET>). Too short or missing secret never matches. */
export function cronAuthorised(header: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.CRON_SECRET?.trim() ?? '';
  if (secret.length < 16 || !header) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === want.length && timingSafeEqual(got, want);
}
