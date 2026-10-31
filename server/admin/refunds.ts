import { UUID_RE, parsePage } from '../../shared/admin.js';
import type { RpcFailure } from '../../shared/inventory.js';
import { isRefundStatus, refundableLeft, validateRefundCreate, validateRefundStatus, type Refund, type RefundStatus } from '../../shared/refunds.js';
import { rpc } from '../rpc.js';
import { rest } from '../supabase.js';
import { PAGE_SIZE, bodyOf, need, pageRange, totalOf, type AdminCtx } from './ctx.js';

function failWith(ctx: AdminCtx, f: RpcFailure) {
  if (f.kind === 'not_found') return ctx.json(404, { status: 'error', message: f.message });
  if (f.kind === 'invalid') return ctx.json(400, { status: 'invalid', message: f.message });
  if (f.kind === 'unknown') return ctx.json(502, { status: 'error', message: 'The database request failed. Try again.' });
  return ctx.json(409, { status: 'conflict', message: f.message });
}

/** Refunds and returns. Returns true when it handled the action (a response has been sent). */
export async function handleRefunds(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  if (action === 'refunds' && method === 'GET') {
    if (!(await need(ctx, 'refunds.read'))) return true;
    const page = parsePage(req.query.page);
    const st = String(req.query.status ?? '');
    const orderId = String(req.query.order_id ?? '');
    if (orderId && !UUID_RE.test(orderId)) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const filter = `${isRefundStatus(st) ? `&status=eq.${st}` : ''}${orderId ? `&order_id=eq.${orderId}` : ''}`;
    const r = await rest(db, `order_refunds?select=*,orders(order_no,customer_name,total_paise)&order=requested_at.desc&${pageRange(page)}${filter}`, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(`refunds ${r.status}`);
    const items = (await r.json()) as Refund[];
    const body: Record<string, unknown> = { status: 'ok', items, total: totalOf(r), page, pageSize: PAGE_SIZE };
    if (orderId) {
      // What is still refundable on this order, from every refund on it (not just this page).
      const [o, all] = await Promise.all([rest(db, `orders?select=total_paise&id=eq.${orderId}&limit=1`), rest(db, `order_refunds?select=amount_paise,status&order_id=eq.${orderId}&limit=1000`)]);
      if (!o.ok || !all.ok) throw new Error(`refundable ${o.status}/${all.status}`);
      const total = ((await o.json()) as { total_paise: number }[])[0]?.total_paise ?? 0;
      body.orderTotalPaise = total;
      body.refundablePaise = refundableLeft(total, (await all.json()) as Pick<Refund, 'amount_paise' | 'status'>[]);
    }
    json(200, body);
    return true;
  }

  if (action === 'refunds' && method === 'POST') {
    if (!(await need(ctx, 'refunds.write'))) return true;
    const v = validateRefundCreate(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const r = await rpc<string>(db, 'refund_create', { p_order: v.value.order_id, p_kind: v.value.kind, p_reason: v.value.reason_code, p_note: v.value.reason_note, p_amount: v.value.amount_paise, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('refund_create', { refund: r.data, order: v.value.order_id, amount_paise: v.value.amount_paise, reason: v.value.reason_code, kind: v.value.kind });
    json(201, { status: 'ok', id: r.data });
    return true;
  }

  if (action === 'refund-status' && method === 'POST') {
    // Deciding and paying are owner actions; the manager who asked for a refund cannot approve their own request.
    if (!(await need(ctx, 'refunds.approve'))) return true;
    const body = bodyOf(req);
    const id = typeof body.refund_id === 'string' && UUID_RE.test(body.refund_id) ? body.refund_id : null;
    if (!id) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const cur = await rest(db, `order_refunds?select=status,order_id&id=eq.${id}&limit=1`);
    if (!cur.ok) throw new Error(`refund read ${cur.status}`);
    const row = ((await cur.json()) as { status: RefundStatus; order_id: string }[])[0];
    if (!row) return json(404, { status: 'error', message: 'Not found.' }), true;
    const v = validateRefundStatus(body, row.status);
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const r = await rpc(db, 'refund_set_status', { p_refund: id, p_to: v.value.status, p_actor: ctx.email, p_note: v.value.note, p_payment_ref: v.value.payment_ref, p_goods: v.value.goods_received });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('refund_status', { refund: id, order: row.order_id, from: row.status, to: v.value.status });
    json(200, { status: 'ok' });
    return true;
  }

  return false;
}
