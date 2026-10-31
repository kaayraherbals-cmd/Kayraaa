import { UUID_RE, parsePage } from '../../shared/admin.js';
import type { RpcFailure } from '../../shared/inventory.js';
import { isShipmentStatus, validateCreate, validateStatusChange, type ShipmentStatus } from '../../shared/shipments.js';
import { queueShipmentMail } from '../outbox.js';
import { rpc } from '../rpc.js';
import { rest } from '../supabase.js';
import { PAGE_SIZE, bodyOf, need, pageRange, totalOf, type AdminCtx } from './ctx.js';

function failWith(ctx: AdminCtx, f: RpcFailure) {
  if (f.kind === 'not_found') return ctx.json(404, { status: 'error', message: f.message });
  if (f.kind === 'invalid') return ctx.json(400, { status: 'invalid', message: f.message });
  if (f.kind === 'unknown') return ctx.json(502, { status: 'error', message: 'The database request failed. Try again.', hint: 'Run supabase/shipments.sql (order in docs/DATABASE_MIGRATIONS.md).' });
  return ctx.json(409, { status: 'conflict', message: f.message });
}

/**
 * Shipments (manual fulfilment). Returns true when it handled the action. Read needs shipments.read (owner, manager, support);
 * every change needs shipments.write (owner, manager). The database enforces the legal status moves, so a stale screen or a
 * hand-made request cannot skip a step. No courier API is called.
 */
export async function handleShipments(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  if (action === 'shipments' && method === 'GET') {
    if (!(await need(ctx, 'shipments.read'))) return true;
    const page = parsePage(req.query.page);
    const st = String(req.query.status ?? '');
    const orderId = String(req.query.order_id ?? '');
    if (orderId && !UUID_RE.test(orderId)) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const filter = `${isShipmentStatus(st) ? `&status=eq.${st}` : ''}${orderId ? `&order_id=eq.${orderId}` : ''}`;
    const r = await rest(db, `shipments?select=*,orders(order_no,customer_name,ship_pincode),shipment_items(order_item_id,qty)&order=created_at.desc&${pageRange(page)}${filter}`, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(`shipments ${r.status}`);
    json(200, { status: 'ok', items: await r.json(), total: totalOf(r), page, pageSize: PAGE_SIZE });
    return true;
  }

  if (action === 'shipment' && method === 'GET') {
    if (!(await need(ctx, 'shipments.read'))) return true;
    const id = String(req.query.id ?? '');
    if (!UUID_RE.test(id)) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const [s, ev, ex] = await Promise.all([
      rest(db, `shipments?select=*,orders(order_no,customer_name,ship_pincode),shipment_items(order_item_id,qty)&id=eq.${id}&limit=1`),
      rest(db, `shipment_events?select=*&shipment_id=eq.${id}&order=occurred_at.asc,id.asc`),
      rest(db, `delivery_exceptions?select=*&shipment_id=eq.${id}&order=opened_at.desc`),
    ]);
    if (!s.ok || !ev.ok || !ex.ok) throw new Error(`shipment ${s.status}/${ev.status}/${ex.status}`);
    const shipment = ((await s.json()) as unknown[])[0];
    if (!shipment) return json(404, { status: 'error', message: 'Not found.' }), true;
    json(200, { status: 'ok', shipment, events: await ev.json(), exceptions: await ex.json() });
    return true;
  }

  if (action === 'delivery-exceptions' && method === 'GET') {
    if (!(await need(ctx, 'shipments.read'))) return true;
    const r = await rest(db, 'delivery_exceptions?select=*,shipments(shipment_no,status,order_id)&resolved_at=is.null&order=opened_at.desc&limit=100');
    if (!r.ok) throw new Error(`exceptions ${r.status}`);
    json(200, { status: 'ok', items: await r.json() });
    return true;
  }

  if (action === 'shipment-create' && method === 'POST') {
    if (!(await need(ctx, 'shipments.write'))) return true;
    const v = validateCreate(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const r = await rpc<string>(db, 'shipment_create', { p_order: v.value.order_id, p_items: v.value.items, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('shipment_create', { shipment: r.data, order: v.value.order_id });
    json(201, { status: 'ok', id: r.data });
    return true;
  }

  if (action === 'shipment-status' && method === 'POST') {
    if (!(await need(ctx, 'shipments.write'))) return true;
    const body = bodyOf(req);
    const id = typeof body.shipment_id === 'string' && UUID_RE.test(body.shipment_id) ? body.shipment_id : null;
    if (!id) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const cur = await rest(db, `shipments?select=status,order_id&id=eq.${id}&limit=1`);
    if (!cur.ok) throw new Error(`shipment read ${cur.status}`);
    const row = ((await cur.json()) as { status: ShipmentStatus; order_id: string }[])[0];
    if (!row) return json(404, { status: 'error', message: 'Not found.' }), true;
    const v = validateStatusChange(body, row.status);
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const c = v.value;
    const r = await rpc(db, 'shipment_set_status', {
      p_shipment: id, p_to: c.status, p_actor: ctx.email, p_courier: c.courier, p_tracking: c.tracking_no, p_note: c.note, p_location: c.location,
      p_estimated: c.estimated_delivery, p_exception: c.exception, p_visible: c.visible,
    });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('shipment_status', { shipment: id, order: row.order_id, from: row.status, to: c.status });
    // Customer mail is queued only now that the database has accepted the move. The worker re-checks the shipment state first.
    await queueShipmentMail(db, row.order_id, id, c.status);
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'shipment-note' && method === 'POST') {
    if (!(await need(ctx, 'shipments.write'))) return true;
    const body = bodyOf(req);
    const id = typeof body.shipment_id === 'string' && UUID_RE.test(body.shipment_id) ? body.shipment_id : null;
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!id || note.length < 1 || note.length > 500) return json(400, { status: 'invalid', message: 'Enter a note of up to 500 characters.' }), true;
    const r = await rpc(db, 'shipment_add_note', { p_shipment: id, p_note: note, p_actor: ctx.email, p_location: null, p_visible: body.visible === true });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('shipment_note', { shipment: id });
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'delivery-exception-resolve' && method === 'POST') {
    if (!(await need(ctx, 'shipments.write'))) return true;
    const body = bodyOf(req);
    const id = typeof body.exception_id === 'string' && UUID_RE.test(body.exception_id) ? body.exception_id : null;
    if (!id) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
    const r = await rpc(db, 'delivery_exception_resolve', { p_exception: id, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('delivery_exception_resolve', { exception: id });
    json(200, { status: 'ok' });
    return true;
  }

  return false;
}
