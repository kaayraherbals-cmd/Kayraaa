import { ORDER_MAIL_BUILDERS, ORDER_MAIL_KINDS, type OrderMailItem, type OrderMailParams } from '../shared/orderMail.js';
import type { OrderMailKind } from '../shared/mailTemplates.js';
import { GATE_RETRY_MINUTES, dedupeKey, gateDecision, isPermanentMailError, type MailContext } from '../shared/outbox.js';
import { isUuid } from '../shared/cart.js';
import { sendMail, type MailConfig } from './mail.js';
import { rpc } from './rpc.js';
import { rest, type SupabaseConfig } from './supabase.js';

/**
 * Durable email outbox worker (Phase 7, Step 2).
 *
 * enqueueOrderMail() is called from verified backend events only. It stores template PARAMETERS (ids and amounts), never the
 * rendered body, never an address beyond the recipient column, and never a street address. drainOutbox() renders from the
 * database at send time, so the mail always reflects what the backend currently knows, and re-checks the fact the mail states
 * (for example a captured payment) before it sends anything.
 */

export interface MailPayload {
  orderId: string;
  shipmentId?: string;
  refundId?: string;
}

const isOrderKind = (k: string): k is OrderMailKind => (ORDER_MAIL_KINDS as string[]).includes(k);

function validPayload(p: unknown): p is MailPayload {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return isUuid(o.orderId) && (o.shipmentId === undefined || isUuid(o.shipmentId)) && (o.refundId === undefined || isUuid(o.refundId));
}

/** Queues one notification. The same dedupeKey always returns the same row, so repeating an event never mails twice. Never throws. */
export async function enqueueOrderMail(db: SupabaseConfig, kind: OrderMailKind, to: string | null | undefined, dedupe: string, payload: MailPayload): Promise<'queued' | 'no_recipient' | 'error'> {
  if (!to || !validPayload(payload)) return 'no_recipient';
  try {
    const r = await rpc<string>(db, 'email_enqueue', { p_kind: kind, p_to: to, p_dedupe: dedupe, p_payload: payload });
    return r.ok ? 'queued' : 'error';
  } catch {
    console.error('outbox enqueue failed');
    return 'error';
  }
}

interface OutboxRow {
  id: string;
  kind: string;
  to_email: string;
  attempts: number;
  payload: unknown;
  created_at: string;
}

async function getJson<T>(db: SupabaseConfig, path: string): Promise<T[]> {
  const r = await rest(db, path);
  if (!r.ok) throw new Error(`read ${r.status}`);
  return (await r.json()) as T[];
}

interface Loaded {
  ctx: MailContext;
  params: OrderMailParams;
  to: string | null;
}

async function loadContext(db: SupabaseConfig, p: MailPayload, support: string | null): Promise<Loaded | null> {
  const [order] = await getJson<{ order_no: string; status: string; customer_name: string; customer_email: string | null; total_paise: number | string }>(
    db,
    `orders?select=order_no,status,customer_name,customer_email,total_paise&id=eq.${p.orderId}&limit=1`,
  );
  if (!order) return null;
  const pays = await getJson<{ status: string }>(db, `order_payments?select=status&order_id=eq.${p.orderId}&limit=50`);
  const ctx: MailContext = {
    orderStatus: order.status,
    hasCapturedPayment: pays.some((x) => x.status === 'captured'),
    hasFailedPayment: pays.some((x) => x.status === 'failed'),
    shipmentStatus: null,
    refundStatus: null,
    refundGatewayRefundId: null,
    refundGatewayStatus: null,
  };
  const params: OrderMailParams = { name: order.customer_name, orderNo: order.order_no, totalPaise: Number(order.total_paise), supportEmail: support };
  if (p.shipmentId) {
    const [s] = await getJson<{ status: string; courier: string | null; tracking_no: string | null; order_id: string }>(db, `shipments?select=status,courier,tracking_no,order_id&id=eq.${p.shipmentId}&limit=1`);
    // A shipment id that belongs to a different order is ignored, so a bad payload cannot mail the wrong customer about it.
    if (s && s.order_id === p.orderId) {
      ctx.shipmentStatus = s.status;
      params.courier = s.courier;
      params.trackingNo = s.tracking_no;
    }
  }
  if (p.refundId) {
    const [rf] = await getJson<{ status: string; amount_paise: number | string; gateway_refund_id: string | null; gateway_status: string | null }>(
      db,
      `order_refunds?select=status,amount_paise,gateway_refund_id,gateway_status&id=eq.${p.refundId}&order_id=eq.${p.orderId}&limit=1`,
    );
    if (rf) {
      ctx.refundStatus = rf.status;
      ctx.refundGatewayRefundId = rf.gateway_refund_id;
      ctx.refundGatewayStatus = rf.gateway_status;
      params.refundPaise = Number(rf.amount_paise);
    }
  }
  const items = await getJson<{ product_name: string; pack_size: string; qty: number }>(db, `order_items?select=product_name,pack_size,qty&order_id=eq.${p.orderId}&limit=20`);
  params.items = items.map((i): OrderMailItem => ({ name: i.product_name, packSize: i.pack_size, qty: i.qty }));
  return { ctx, params, to: order.customer_email };
}

export interface DrainResult {
  claimed: number;
  sent: number;
  deferred: number;
  skipped: number;
  retried: number;
  dead: number;
}

/** Sends due mail. Safe to run twice at once: rows are claimed with a lock. Counts only, no addresses. */
export async function drainOutbox(db: SupabaseConfig, cfg: MailConfig | null, opts: { limit?: number; now?: () => number; fetchImpl?: typeof fetch } = {}): Promise<DrainResult> {
  const out: DrainResult = { claimed: 0, sent: 0, deferred: 0, skipped: 0, retried: 0, dead: 0 };
  const now = opts.now ?? Date.now;
  const claimed = await rpc<OutboxRow[]>(db, 'email_claim_due', { p_limit: opts.limit ?? 10 });
  if (!claimed.ok) throw new Error('outbox claim failed');
  const rows = Array.isArray(claimed.data) ? claimed.data : [];
  out.claimed = rows.length;

  for (const row of rows) {
    const skip = async (reason: string) => {
      await rpc(db, 'email_mark_skipped', { p_id: row.id, p_reason: reason });
      out.skipped++;
    };
    const fail = async (error: string, permanent: boolean, response: unknown = null) => {
      const r = await rpc<string>(db, 'email_mark_failed', { p_id: row.id, p_error: error, p_response: response, p_permanent: permanent });
      if (r.ok && r.data === 'dead') out.dead++;
      else out.retried++;
    };
    try {
      if (!isOrderKind(row.kind) || !validPayload(row.payload)) {
        await skip('bad_row');
        continue;
      }
      const kind = row.kind;
      const loaded = await loadContext(db, row.payload, cfg?.replyTo ?? cfg?.ownerTo ?? null);
      if (!loaded) {
        await skip('order_missing');
        continue;
      }
      const ageHours = (now() - new Date(row.created_at).getTime()) / 3_600_000;
      const gate = gateDecision(kind, loaded.ctx, ageHours);
      if (gate.action === 'skip') {
        await skip(gate.reason);
        continue;
      }
      if (gate.action === 'defer' || !cfg) {
        // Not verified yet, or email is not configured yet: wait without using an attempt.
        await rpc(db, 'email_defer', { p_id: row.id, p_minutes: gate.action === 'defer' ? GATE_RETRY_MINUTES : 60 });
        out.deferred++;
        continue;
      }
      const mail = ORDER_MAIL_BUILDERS[kind](loaded.params);
      // Recipient comes from the order, not the queue row, so a changed address is honoured; they match in practice.
      const res = await sendMail(null, cfg, loaded.to ?? row.to_email, mail, { idempotencyKey: `kaayra-outbox-${row.id}`, fetchImpl: opts.fetchImpl });
      if (res.status === 'sent') {
        await rpc(db, 'email_mark_sent', { p_id: row.id, p_provider_id: res.id ?? '', p_response: { ok: true } });
        out.sent++;
      } else if (res.status === 'failed') {
        await fail(res.error, isPermanentMailError(res.error), { error: res.error });
      } else {
        await fail(res.reason, res.reason === 'bad_recipient', { skipped: res.reason });
      }
    } catch (e) {
      // Nothing about the customer goes into logs.
      // Error text can echo a customer's address or email, so only the error class is logged.
      console.error('outbox row failed', e instanceof Error ? e.name : 'error');
      await fail('worker_error', false).catch(() => undefined);
    }
  }
  return out;
}

// ---- Queueing from verified backend events ------------------------------------------------------------------------------------


/** The customer email for an order, only for online orders (automatic mail is for customers who ordered on the website). */
async function onlineOrderEmail(db: SupabaseConfig, orderId: string): Promise<string | null> {
  if (!isUuid(orderId)) return null;
  const [o] = await getJson<{ customer_email: string | null; channel: string }>(db, `orders?select=customer_email,channel&id=eq.${orderId}&limit=1`);
  return o && o.channel === 'online' ? o.customer_email : null;
}

/** Called after checkout creates an order. */
export async function queueOrderCreated(db: SupabaseConfig, orderId: string): Promise<void> {
  try {
    await enqueueOrderMail(db, 'order_created', await onlineOrderEmail(db, orderId), dedupeKey.orderCreated(orderId), { orderId });
  } catch {
    /* the sweep does not cover order_created; losing it is acceptable, the order itself is safe */
  }
}

/**
 * Called after the database accepted a captured payment. Queueing alone sends nothing: the worker re-checks that a captured
 * payment row exists and the order is paid before it sends. The key is per order, so webhook, browser callback and
 * reconciliation all converge on one mail.
 */
export async function queuePaymentConfirmed(db: SupabaseConfig, orderId: string): Promise<void> {
  try {
    await enqueueOrderMail(db, 'payment_confirmed', await onlineOrderEmail(db, orderId), dedupeKey.paymentConfirmed(orderId), { orderId });
  } catch {
    /* the scheduled sweep will queue it */
  }
}

export async function queuePaymentConfirmedByRpOrder(db: SupabaseConfig, rpOrderId: string): Promise<void> {
  try {
    const [p] = await getJson<{ order_id: string }>(db, `order_payments?select=order_id&rp_order_id=eq.${encodeURIComponent(rpOrderId)}&limit=1`);
    if (p) await queuePaymentConfirmed(db, p.order_id);
  } catch {
    /* the scheduled sweep will queue it */
  }
}

export interface SweepResult {
  considered: number;
  queued: number;
}

/**
 * Safety net for the scheduler: looks at recent verified facts and queues any mail that is missing. Idempotent: the dedupe key
 * makes a second pass queue nothing new. Covers payment confirmed, cancelled, shipment steps and refunds, for ONLINE orders.
 */
export async function sweepMailEvents(db: SupabaseConfig, opts: { sinceHours?: number; now?: () => number } = {}): Promise<SweepResult> {
  const since = encodeURIComponent(new Date((opts.now ?? Date.now)() - (opts.sinceHours ?? 72) * 3_600_000).toISOString());
  const out: SweepResult = { considered: 0, queued: 0 };
  const add = async (kind: OrderMailKind, to: string | null, key: string, payload: MailPayload) => {
    out.considered++;
    if ((await enqueueOrderMail(db, kind, to, key, payload)) === 'queued') out.queued++;
  };

  type Emb = { customer_email: string | null };
  for (const p of await getJson<{ order_id: string; orders: Emb }>(db, `order_payments?select=order_id,orders!inner(customer_email)&status=eq.captured&captured_at=gte.${since}&orders.channel=eq.online&limit=200`)) {
    await add('payment_confirmed', p.orders.customer_email, dedupeKey.paymentConfirmed(p.order_id), { orderId: p.order_id });
  }
  for (const o of await getJson<{ id: string; customer_email: string | null }>(db, `orders?select=id,customer_email&status=eq.cancelled&channel=eq.online&updated_at=gte.${since}&limit=200`)) {
    await add('order_cancelled', o.customer_email, dedupeKey.orderCancelled(o.id), { orderId: o.id });
  }
  for (const s of await getJson<{ id: string; order_id: string; status: string; orders: Emb }>(
    db,
    `shipments?select=id,order_id,status,orders!inner(customer_email)&status=in.(dispatched,in_transit,out_for_delivery,delivered,returned)&updated_at=gte.${since}&orders.channel=eq.online&limit=200`,
  )) {
    const p = { orderId: s.order_id, shipmentId: s.id };
    const to = s.orders.customer_email;
    if (['dispatched', 'in_transit', 'out_for_delivery'].includes(s.status)) await add('shipment_dispatched', to, dedupeKey.shipment('shipment_dispatched', s.id), p);
    if (s.status === 'out_for_delivery') await add('out_for_delivery', to, dedupeKey.shipment('out_for_delivery', s.id), p);
    if (s.status === 'delivered') await add('delivered', to, dedupeKey.shipment('delivered', s.id), p);
    if (s.status === 'returned') await add('return_received', to, dedupeKey.shipment('return_received', s.id), p);
  }
  for (const r of await getJson<{ id: string; order_id: string; status: string; orders: Emb }>(
    db,
    `order_refunds?select=id,order_id,status,orders!inner(customer_email)&status=in.(approved,refunded)&updated_at=gte.${since}&orders.channel=eq.online&limit=200`,
  )) {
    const p = { orderId: r.order_id, refundId: r.id };
    await add('refund_initiated', r.orders.customer_email, dedupeKey.refund('refund_initiated', r.id), p);
    if (r.status === 'refunded') await add('refund_completed', r.orders.customer_email, dedupeKey.refund('refund_completed', r.id), p);
  }
  return out;
}

/** What the scheduled job does: queue anything missing, send what is due, tidy old rows. Counts only. */
export async function runOutboxJob(db: SupabaseConfig, cfg: MailConfig | null, opts: { fetchImpl?: typeof fetch } = {}): Promise<{ sweep: SweepResult | null; drain: DrainResult; purged: number | null }> {
  let sweep: SweepResult | null = null;
  try {
    sweep = await sweepMailEvents(db);
  } catch {
    console.error('outbox sweep failed');
  }
  const drain = await drainOutbox(db, cfg, { limit: 20, fetchImpl: opts.fetchImpl });
  let purged: number | null = null;
  const pr = await rpc<number>(db, 'email_purge', {});
  if (pr.ok && typeof pr.data === 'number') purged = pr.data;
  return { sweep, drain, purged };
}

/** After an admin moved a shipment: queue the matching customer mail (dispatched, out for delivery, delivered, return received). */
export async function queueShipmentMail(db: SupabaseConfig, orderId: string, shipmentId: string, status: string): Promise<void> {
  const kind: OrderMailKind | null = status === 'dispatched' ? 'shipment_dispatched' : status === 'out_for_delivery' ? 'out_for_delivery' : status === 'delivered' ? 'delivered' : status === 'returned' ? 'return_received' : null;
  if (!kind) return;
  try {
    await enqueueOrderMail(db, kind, await onlineOrderEmail(db, orderId), dedupeKey.shipment(kind, shipmentId), { orderId, shipmentId });
  } catch {
    /* the scheduled sweep will queue it */
  }
}
