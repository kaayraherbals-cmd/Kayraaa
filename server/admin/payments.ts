import { UUID_RE } from '../../shared/admin.js';
import type { RpcFailure } from '../../shared/inventory.js';
import { gatewayRefundableLeft, isCollectable, type OrderPayment } from '../../shared/payments.js';
import { type Refund } from '../../shared/refunds.js';
import { RazorpayError, createRazorpayOrder, createRazorpayRefund, loadRazorpayConfig } from '../razorpay.js';
import { rpc } from '../rpc.js';
import { rest } from '../supabase.js';
import { bodyOf, need, type AdminCtx } from './ctx.js';

function failWith(ctx: AdminCtx, f: RpcFailure) {
  if (f.kind === 'not_found') return ctx.json(404, { status: 'error', message: f.message });
  if (f.kind === 'invalid') return ctx.json(400, { status: 'invalid', message: f.message });
  if (f.kind === 'unknown') return ctx.json(502, { status: 'error', message: 'The database request failed. Try again.' });
  return ctx.json(409, { status: 'conflict', message: f.message });
}

const unavailable = (ctx: AdminCtx) => ctx.json(503, { status: 'payments_unavailable', message: 'Razorpay is not set up on the server (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET).' });
const gatewayDown = (ctx: AdminCtx, e: unknown) => {
  // Razorpay's own reason is safe to show; anything else is a plain failure. Keys and request bodies are never echoed.
  if (e instanceof RazorpayError) return ctx.json(e.httpStatus >= 400 && e.httpStatus < 500 ? 409 : 502, { status: e.httpStatus >= 400 && e.httpStatus < 500 ? 'conflict' : 'error', message: `Razorpay: ${e.message}` });
  throw e;
};

const PAYMENT_COLUMNS = 'id,order_id,rp_order_id,rp_payment_id,amount_paise,status,method,error_code,error_note,flagged,created_by,created_at,captured_at';

/** Razorpay payments and gateway refunds. Returns true when it handled the action (a response has been sent). */
export async function handlePayments(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  // Payments on one order (or the most recent ones), and whether the gateway is configured here.
  if (action === 'payments' && method === 'GET') {
    if (!(await need(ctx, 'payments.read'))) return true;
    const orderId = String(req.query.order_id ?? '');
    if (orderId && !UUID_RE.test(orderId)) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const r = await rest(db, `order_payments?select=${PAYMENT_COLUMNS}&order=created_at.desc&limit=50${orderId ? `&order_id=eq.${orderId}` : ''}`);
    if (!r.ok) throw new Error(`payments ${r.status}`);
    const gw = loadRazorpayConfig();
    json(200, { status: 'ok', items: (await r.json()) as OrderPayment[], gateway: { configured: gw.ok, live: gw.ok ? gw.live : false } });
    return true;
  }

  // Ask Razorpay to collect an order's full total. The amount is read from the order here, never taken from the request.
  if (action === 'payment-create' && method === 'POST') {
    if (!(await need(ctx, 'payments.write'))) return true;
    if (!ctx.commerceEnabled) return json(409, { status: 'commerce_off', message: 'Selling is not enabled, so orders cannot be created yet.' }), true;
    const gw = loadRazorpayConfig();
    if (!gw.ok) return unavailable(ctx), true;
    const body = bodyOf(req);
    const orderId = typeof body.order_id === 'string' && UUID_RE.test(body.order_id) ? body.order_id : null;
    if (!orderId) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const o = await rest(db, `orders?select=id,order_no,status,total_paise&id=eq.${orderId}&limit=1`);
    if (!o.ok) throw new Error(`order read ${o.status}`);
    const order = ((await o.json()) as { id: string; order_no: string; status: string; total_paise: number }[])[0];
    if (!order) return json(404, { status: 'error', message: 'Not found.' }), true;
    if (order.status !== 'placed') return json(409, { status: 'conflict', message: `This order is already ${order.status}, so it cannot be charged.` }), true;
    if (!isCollectable(order.total_paise)) return json(400, { status: 'invalid', message: 'This order total cannot be collected online.' }), true;
    let rp;
    try {
      rp = await createRazorpayOrder(gw.cfg, { amountPaise: order.total_paise, receipt: order.order_no, notes: { order_no: order.order_no } });
    } catch (e) {
      return gatewayDown(ctx, e), true;
    }
    if (rp.amount !== order.total_paise) throw new Error('razorpay amount differs from the order total');
    const r = await rpc<string>(db, 'payment_create', { p_order: orderId, p_rp_order: rp.id, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('payment_create', { order: orderId, payment: r.data, rp_order: rp.id, amount_paise: order.total_paise });
    // Only the public key id goes to the browser. The secret never does.
    json(201, { status: 'ok', id: r.data, razorpayOrderId: rp.id, keyId: gw.cfg.keyId, amountPaise: order.total_paise });
    return true;
  }

  // Pay an APPROVED refund back through Razorpay, then mark it refunded with Razorpay's reference. Owner only.
  if (action === 'refund-gateway' && method === 'POST') {
    if (!(await need(ctx, 'refunds.approve'))) return true;
    const gw = loadRazorpayConfig();
    if (!gw.ok) return unavailable(ctx), true;
    const body = bodyOf(req);
    const id = typeof body.refund_id === 'string' && UUID_RE.test(body.refund_id) ? body.refund_id : null;
    if (!id) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const rr = await rest(db, `order_refunds?select=*&id=eq.${id}&limit=1`);
    if (!rr.ok) throw new Error(`refund read ${rr.status}`);
    const refund = ((await rr.json()) as (Refund & { gateway_refund_id: string | null })[])[0];
    if (!refund) return json(404, { status: 'error', message: 'Not found.' }), true;
    if (refund.status !== 'approved') return json(409, { status: 'conflict', message: 'Only an approved refund can be paid through Razorpay.' }), true;

    const [pr, others] = await Promise.all([
      rest(db, `order_payments?select=rp_payment_id,amount_paise&order_id=eq.${refund.order_id}&status=eq.captured&limit=1`),
      rest(db, `order_refunds?select=amount_paise&order_id=eq.${refund.order_id}&gateway_refund_id=not.is.null&id=neq.${id}&limit=1000`),
    ]);
    if (!pr.ok || !others.ok) throw new Error(`refund lookups ${pr.status}/${others.status}`);
    const paid = ((await pr.json()) as { rp_payment_id: string | null; amount_paise: number }[])[0];
    if (!paid?.rp_payment_id) return json(409, { status: 'conflict', message: 'No captured Razorpay payment is recorded for this order. Pay the customer through your bank and record the reference instead.' }), true;
    const done = ((await others.json()) as { amount_paise: number }[]).reduce((n, x) => n + x.amount_paise, 0);
    if (refund.amount_paise > gatewayRefundableLeft(paid.amount_paise, done)) return json(409, { status: 'conflict', message: 'That is more than is left to refund on the Razorpay payment.' }), true;

    let rpRefundId = refund.gateway_refund_id;
    if (!rpRefundId) {
      let created;
      try {
        created = await createRazorpayRefund(gw.cfg, paid.rp_payment_id, { amountPaise: refund.amount_paise, receipt: id, idempotencyKey: id, notes: { refund_id: id, order_id: refund.order_id } });
      } catch (e) {
        return gatewayDown(ctx, e), true;
      }
      rpRefundId = created.id;
      // Save Razorpay's id BEFORE marking the refund done: if anything below fails, a retry reuses it and never pays twice.
      const patch = await rest(db, `order_refunds?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ gateway_refund_id: rpRefundId, gateway_status: 'created' }) });
      if (!patch.ok) throw new Error(`refund gateway id save ${patch.status}`);
    }
    const r = await rpc(db, 'refund_set_status', { p_refund: id, p_to: 'refunded', p_actor: ctx.email, p_note: null, p_payment_ref: rpRefundId, p_goods: body.goods_received === true });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('refund_gateway', { refund: id, order: refund.order_id, rp_refund: rpRefundId, amount_paise: refund.amount_paise });
    json(200, { status: 'ok', gatewayRefundId: rpRefundId });
    return true;
  }

  return false;
}
