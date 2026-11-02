import { MIN_DAYS_TO_EXPIRY, summariseStock, todayIST, validateAdjust, validateBatchStatus, validateReceive, type Batch, type RpcFailure } from '../../shared/inventory.js';
import { UUID_RE, parsePage, sanitiseSearch, toCsv } from '../../shared/admin.js';
import { auditFilter, parseAuditQuery, type AuditRow } from '../../shared/audit.js';
import { validateGallery, removedPaths } from '../../shared/gallery.js';
import { ORDER_CSV_HEADERS, ORDER_STATUSES, isOrderStatus, orderCsvRow, validateNewOrder, validateOrderNote, validateStatusChange, type Order, type OrderStatus } from '../../shared/orders.js';
import { ROLE_LABELS } from '../../shared/roles.js';
import { MAX_VARIANTS_PER_PRODUCT, makeSku, touchesPrice, validateVariantCreate, validateVariantUpdate } from '../../shared/variants.js';
import { deleteImage } from '../media.js';
import { listEnrolled, resetMfa } from '../mfa.js';
import { deletePasskeyAsOwner, listPasskeys, passkeyCounts, publicPasskey } from '../passkeys.js';
import { rpc } from '../rpc.js';
import { rest } from '../supabase.js';
import { handleExtras } from './extras.js';
import { handlePayments } from './payments.js';
import { handleRefunds } from './refunds.js';
import { handleAi } from './ai.js';
import { handleReviews } from './reviews.js';
import { handleDelivery } from './delivery.js';
import { handleCoupons } from './coupons.js';
import { handleBundles } from './bundles.js';
import { handleRecovery } from './recovery.js';
import { handleFinance } from './finance.js';
import { handleShipments } from './shipments.js';
import { PAGE_SIZE, bodyOf, need, pageRange, totalOf, type AdminCtx } from './ctx.js';

function failWith(ctx: AdminCtx, f: RpcFailure) {
  if (f.kind === 'not_found') return ctx.json(404, { status: 'error', message: f.message });
  if (f.kind === 'invalid') return ctx.json(400, { status: 'invalid', message: f.message });
  if (f.kind === 'unknown') return ctx.json(502, { status: 'error', message: 'The database request failed. Try again.', hint: 'A database function may be missing or out of date. Run the latest SQL files in supabase/ (order in docs/DATABASE_MIGRATIONS.md).' });
  return ctx.json(409, { status: 'conflict', message: f.message });
}

const idParam = (ctx: AdminCtx, key = 'id'): string | null => {
  const v = String(ctx.req.query[key] ?? '');
  return UUID_RE.test(v) ? v : null;
};
const invalidId = (ctx: AdminCtx) => ctx.json(400, { status: 'invalid', message: 'Invalid id.' });

/**
 * Inventory, orders, audit log, team, pack-size variants and photo galleries.
 * Returns true when it handled the action (a response has been sent), false when the action is not one of these.
 */
export async function handleBackoffice(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  if (await handleExtras(ctx, action)) return true;
  if (await handleRefunds(ctx, action)) return true;
  if (await handlePayments(ctx, action)) return true;
  if (await handleShipments(ctx, action)) return true;
  if (await handleDelivery(ctx, action)) return true;
  if (await handleReviews(ctx, action)) return true;
  if (await handleAi(ctx, action)) return true;
  if (await handleCoupons(ctx, action)) return true;
  if (await handleBundles(ctx, action)) return true;
  if (await handleRecovery(ctx, action)) return true;
  if (await handleFinance(ctx, action)) return true;

  // ---- Inventory ----------------------------------------------------------------------------------------------
  if (action === 'inventory' && method === 'GET') {
    if (!(await need(ctx, 'inventory.read'))) return true;
    const [vr, br] = await Promise.all([
      rest(db, 'product_variants?select=id,product_id,sku,pack_size,price_paise,low_stock_threshold,status,sort_order,products(slug,internal_name,public_name,status)&order=sort_order.asc,created_at.asc&limit=500'),
      rest(db, 'inventory_batches?select=id,variant_id,batch_no,mfg_date,expiry_date,qty_received,qty_on_hand,qty_reserved,status,note,created_by,created_at&order=expiry_date.asc&limit=5000'),
    ]);
    if (!vr.ok || !br.ok) throw new Error(`inventory ${vr.status}/${br.status}`);
    const variants = (await vr.json()) as { id: string; low_stock_threshold: number; products: unknown }[];
    const batches = (await br.json()) as Batch[];
    const today = todayIST();
    const items = variants.map((v) => {
      const mine = batches.filter((b) => b.variant_id === v.id);
      return { ...v, stock: summariseStock(mine, v.low_stock_threshold, today), batches: mine };
    });
    json(200, { status: 'ok', today, minDaysToExpiry: MIN_DAYS_TO_EXPIRY, items });
    return true;
  }

  if (action === 'movements' && method === 'GET') {
    if (!(await need(ctx, 'inventory.read'))) return true;
    const batch = idParam(ctx, 'batch_id');
    const variant = idParam(ctx, 'variant_id');
    if (!batch && !variant) return invalidId(ctx), true;
    const r = await rest(db, `inventory_movements?select=id,batch_id,variant_id,kind,delta_on_hand,delta_reserved,reason,order_id,actor,at&${batch ? `batch_id=eq.${batch}` : `variant_id=eq.${variant}`}&order=id.desc&limit=100`);
    if (!r.ok) throw new Error(`movements ${r.status}`);
    json(200, { status: 'ok', items: await r.json() });
    return true;
  }

  if (action === 'batches' && method === 'POST') {
    if (!(await need(ctx, 'inventory.write'))) return true;
    const v = validateReceive(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const r = await rpc<string>(db, 'inventory_receive', { p_variant: v.value.variant_id, p_batch_no: v.value.batch_no, p_mfg: v.value.mfg_date, p_expiry: v.value.expiry_date, p_qty: v.value.qty, p_note: v.value.note, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('batch_receive', { batch: r.data, variant: v.value.variant_id, batch_no: v.value.batch_no, qty: v.value.qty, expiry: v.value.expiry_date });
    json(201, { status: 'ok', id: r.data });
    return true;
  }

  if (action === 'batch-adjust' && method === 'POST') {
    if (!(await need(ctx, 'inventory.write'))) return true;
    const v = validateAdjust(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const r = await rpc(db, 'inventory_adjust', { p_batch: v.value.batch_id, p_delta: v.value.delta, p_kind: v.value.kind, p_reason: v.value.reason, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('batch_adjust', { batch: v.value.batch_id, kind: v.value.kind, delta: v.value.delta, reason: v.value.reason });
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'batch-status' && method === 'POST') {
    if (!(await need(ctx, 'inventory.write'))) return true;
    const v = validateBatchStatus(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' ') }), true;
    const r = await rpc(db, 'inventory_set_status', { p_batch: v.value.batch_id, p_status: v.value.status, p_actor: ctx.email });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('batch_status', { batch: v.value.batch_id, status: v.value.status });
    json(200, { status: 'ok' });
    return true;
  }

  // ---- Orders -------------------------------------------------------------------------------------------------
  if (action === 'orders') {
    if (method === 'GET') {
      if (!(await need(ctx, 'orders.read'))) return true;
      const page = parsePage(req.query.page);
      const st = String(req.query.status ?? '');
      const filter = isOrderStatus(st) ? `&status=eq.${st}` : '';
      const q = sanitiseSearch(req.query.q);
      const search = q ? `&or=(order_no.ilike.*${q}*,customer_name.ilike.*${q}*,customer_email.ilike.*${q}*,customer_phone.ilike.*${q}*,tracking_no.ilike.*${q}*)` : '';
      const r = await rest(db, `orders?select=*&order=created_at.desc&${pageRange(page)}${filter}${search}`, { headers: { Prefer: 'count=exact' } });
      if (!r.ok) throw new Error(`orders ${r.status}`);
      json(200, { status: 'ok', items: await r.json(), total: totalOf(r), page, pageSize: PAGE_SIZE, statuses: ORDER_STATUSES });
      return true;
    }
    if (method === 'POST') {
      if (!(await need(ctx, 'orders.write'))) return true;
      // Selling is off. Creating orders stays locked until COMMERCE_ENABLED is changed in code on purpose.
      if (!ctx.commerceEnabled) return json(409, { status: 'commerce_off', message: 'Selling is not enabled, so orders cannot be created yet.' }), true;
      const v = validateNewOrder(bodyOf(req));
      if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
      const r = await rpc<string>(db, 'order_create', { p_order: v.value, p_actor: ctx.email, p_min_days: MIN_DAYS_TO_EXPIRY });
      if (!r.ok) return failWith(ctx, r.failure), true;
      await ctx.audit('order_create', { order: r.data, lines: v.value.items.length });
      json(201, { status: 'ok', id: r.data });
      return true;
    }
  }

  if (action === 'order' && method === 'GET') {
    if (!(await need(ctx, 'orders.read'))) return true;
    const id = idParam(ctx);
    if (!id) return invalidId(ctx), true;
    const [o, items, events] = await Promise.all([
      rest(db, `orders?select=*&id=eq.${id}&limit=1`),
      rest(db, `order_items?select=*,order_allocations(id,batch_id,batch_no,expiry_date,qty)&order_id=eq.${id}&order=product_name.asc`),
      rest(db, `order_events?select=*&order_id=eq.${id}&order=id.asc`),
    ]);
    if (!o.ok || !items.ok || !events.ok) throw new Error(`order ${o.status}/${items.status}/${events.status}`);
    const order = ((await o.json()) as Order[])[0];
    if (!order) return json(404, { status: 'error', message: 'Not found.' }), true;
    json(200, { status: 'ok', order, items: await items.json(), events: await events.json() });
    return true;
  }

  if (action === 'order-status' && method === 'POST') {
    if (!(await need(ctx, 'orders.write'))) return true;
    const body = bodyOf(req);
    const id = typeof body.order_id === 'string' && UUID_RE.test(body.order_id) ? body.order_id : null;
    if (!id) return invalidId(ctx), true;
    const cur = await rest(db, `orders?select=status,channel&id=eq.${id}&limit=1`);
    if (!cur.ok) throw new Error(`order status read ${cur.status}`);
    const row = ((await cur.json()) as { status: OrderStatus; channel?: string }[])[0];
    const current = row?.status;
    if (!current) return json(404, { status: 'error', message: 'Not found.' }), true;
    // KH6-013: the database refuses this too; saying so here gives a clear message and keeps the attempt in the audit log.
    if (body.status === 'paid' && row?.channel === 'online') {
      await ctx.audit('order_paid_by_hand_refused', { order: id });
      return json(409, { status: 'conflict', message: 'An online order is marked paid only when Razorpay confirms the payment. It cannot be marked paid by hand.' }), true;
    }
    const v = validateStatusChange(body, current);
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const r = await rpc(db, 'order_set_status', { p_order: id, p_to: v.value.status, p_actor: ctx.email, p_courier: v.value.courier, p_tracking: v.value.tracking_no, p_reason: v.value.reason });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('order_status', { order: id, from: current, to: v.value.status });
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'order-note' && method === 'POST') {
    if (!(await need(ctx, 'orders.note'))) return true;
    const v = validateOrderNote(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' ') }), true;
    const r = await rest(db, 'order_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_id: v.value.order_id, kind: 'note', note: v.value.note, actor: ctx.email }) });
    if (r.status === 409 || r.status === 400) return json(404, { status: 'error', message: 'Not found.' }), true;
    if (!r.ok) throw new Error(`order note ${r.status}`);
    await ctx.audit('order_note', { order: v.value.order_id });
    json(201, { status: 'ok' });
    return true;
  }

  if (action === 'orders-export' && method === 'GET') {
    if (!(await need(ctx, 'orders.export'))) return true;
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const r = await rest(db, `orders?select=*&order=created_at.asc&limit=1000&offset=${offset}`);
      if (!r.ok) throw new Error(`orders export ${r.status}`);
      const batch = (await r.json()) as Order[];
      rows.push(...batch.map(orderCsvRow));
      if (batch.length < 1000) break;
    }
    await ctx.audit('export_orders', { count: rows.length });
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="kaayra-orders-${todayIST()}.csv"`);
    ctx.res.status(200).send('﻿' + toCsv([...ORDER_CSV_HEADERS], rows));
    return true;
  }

  // ---- Audit log (owner) --------------------------------------------------------------------------------------
  if (action === 'audit' && method === 'GET') {
    if (!(await need(ctx, 'audit.read'))) return true;
    const page = parsePage(req.query.page);
    const q = parseAuditQuery(req.query as Record<string, unknown>);
    const r = await rest(db, `admin_audit?select=id,actor,action,detail,at&order=id.desc&${pageRange(page)}${auditFilter(q)}`, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(`audit ${r.status}`);
    json(200, { status: 'ok', items: (await r.json()) as AuditRow[], total: totalOf(r), page, pageSize: PAGE_SIZE });
    return true;
  }

  // ---- Team and security (owner) ------------------------------------------------------------------------------
  if (action === 'team' && method === 'GET') {
    if (!(await need(ctx, 'team.read'))) return true;
    let enrolled = new Set<string>();
    let mfaKnown = true;
    try {
      enrolled = await listEnrolled(db);
    } catch {
      mfaKnown = false;
    }
    let passkeys = new Map<string, number>();
    let passkeysKnown = true;
    try {
      passkeys = await passkeyCounts(db);
    } catch {
      passkeysKnown = false;
    }
    json(200, { status: 'ok', mfaMode: cfg.mfaMode, mfaKnown, passkeysKnown, items: cfg.admins.map((email) => ({ email, role: cfg.roles[email], roleLabel: ROLE_LABELS[cfg.roles[email]], mfaEnrolled: enrolled.has(email), passkeyCount: passkeys.get(email) ?? 0, you: email === ctx.email })) });
    return true;
  }

  if (action === 'team-mfa-reset' && method === 'POST') {
    if (!(await need(ctx, 'team.manage'))) return true;
    const target = typeof bodyOf(req).email === 'string' ? (bodyOf(req).email as string).trim().toLowerCase() : '';
    if (!cfg.admins.includes(target)) return json(404, { status: 'error', message: 'Not found.' }), true;
    if (target === ctx.email) return json(409, { status: 'conflict', message: 'Use a recovery code to sign in if you lost your device. You cannot reset your own two-step verification here.' }), true;
    await resetMfa(db, target);
    await ctx.audit('mfa_reset', { target });
    json(200, { status: 'ok' });
    return true;
  }

  // An owner looks at, and removes, another admin's passkeys (for example after a lost phone). Your own live in Security.
  if (action === 'team-passkeys' && method === 'GET') {
    if (!(await need(ctx, 'team.manage'))) return true;
    const target = String(req.query.email ?? '').trim().toLowerCase();
    if (!cfg.admins.includes(target)) return json(404, { status: 'error', message: 'Not found.' }), true;
    const rows = await listPasskeys(db, target);
    json(200, { status: 'ok', items: rows.map((p) => publicPasskey(p)) });
    return true;
  }
  if (action === 'team-passkey' && method === 'DELETE') {
    if (!(await need(ctx, 'team.manage'))) return true;
    const id = idParam(ctx);
    if (!id) return invalidId(ctx), true;
    const owned = await rest(db, `admin_passkeys?select=email&id=eq.${id}&limit=1`);
    if (!owned.ok) throw new Error(`passkey lookup ${owned.status}`);
    const owner = ((await owned.json()) as { email: string }[])[0]?.email;
    if (!owner) return json(404, { status: 'error', message: 'Not found.' }), true;
    if (owner === ctx.email) return json(409, { status: 'conflict', message: 'Remove your own passkeys in the Passkeys section above.' }), true;
    const gone = await deletePasskeyAsOwner(db, id);
    if (!gone) return json(404, { status: 'error', message: 'Not found.' }), true;
    await ctx.audit('passkey_removed_by_owner', { target: gone.email, name: gone.name });
    json(200, { status: 'ok' });
    return true;
  }

  // ---- Pack-size variants -------------------------------------------------------------------------------------
  if (action === 'variants') {
    if (method === 'GET') {
      if (!(await need(ctx, 'products.read'))) return true;
      const pid = idParam(ctx, 'product_id');
      if (!pid) return invalidId(ctx), true;
      const r = await rest(db, `product_variants?select=*&product_id=eq.${pid}&order=sort_order.asc,created_at.asc`);
      if (!r.ok) throw new Error(`variants ${r.status}`);
      json(200, { status: 'ok', items: await r.json() });
      return true;
    }
    if (method === 'POST') {
      if (!(await need(ctx, 'products.edit'))) return true;
      const pid = idParam(ctx, 'product_id');
      if (!pid) return invalidId(ctx), true;
      const v = validateVariantCreate(req.body);
      if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
      if (touchesPrice(v.value) && !(await need(ctx, 'products.price'))) return true;
      const p = await rest(db, `products?select=slug&id=eq.${pid}&limit=1`);
      const slug = p.ok ? ((await p.json()) as { slug: string }[])[0]?.slug : undefined;
      if (!slug) return json(404, { status: 'error', message: 'Not found.' }), true;
      const count = await rest(db, `product_variants?select=id&product_id=eq.${pid}`);
      if (count.ok && ((await count.json()) as unknown[]).length >= MAX_VARIANTS_PER_PRODUCT) return json(409, { status: 'conflict', message: `A product can have at most ${MAX_VARIANTS_PER_PRODUCT} pack sizes.` }), true;
      const row = { ...v.value, sku: v.value.sku ?? makeSku(slug, v.value.pack_size ?? ''), product_id: pid, sort_order: v.value.sort_order ?? 100 };
      const r = await rest(db, 'product_variants', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (r.status === 409) return json(409, { status: 'conflict', message: 'That pack size or SKU already exists for this product.' }), true;
      if (!r.ok) throw new Error(`variant create ${r.status}`);
      const item = ((await r.json()) as { id: string }[])[0];
      await ctx.audit('variant_create', { id: item.id, product: pid, pack_size: row.pack_size, priced: 'price_paise' in v.value });
      json(201, { status: 'ok', item });
      return true;
    }
    if (method === 'PATCH') {
      if (!(await need(ctx, 'products.edit'))) return true;
      const id = idParam(ctx);
      if (!id) return invalidId(ctx), true;
      const v = validateVariantUpdate(req.body);
      if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
      if (touchesPrice(v.value) && !(await need(ctx, 'products.price'))) return true;
      const r = await rest(db, `product_variants?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(v.value) });
      if (r.status === 409) return json(409, { status: 'conflict', message: 'That pack size or SKU already exists for this product.' }), true;
      if (!r.ok) throw new Error(`variant update ${r.status}`);
      const item = ((await r.json()) as unknown[])[0];
      if (!item) return json(404, { status: 'error', message: 'Not found.' }), true;
      await ctx.audit('variant_update', { id, fields: Object.keys(v.value) });
      json(200, { status: 'ok', item });
      return true;
    }
    if (method === 'DELETE') {
      if (!(await need(ctx, 'products.price'))) return true;
      const id = idParam(ctx);
      if (!id) return invalidId(ctx), true;
      const r = await rest(db, `product_variants?id=eq.${id}`, { method: 'DELETE' });
      if (r.status === 409) return json(409, { status: 'conflict', message: 'This pack size has stock or orders recorded against it. Switch it off instead of deleting it.' }), true;
      if (!r.ok) throw new Error(`variant delete ${r.status}`);
      await ctx.audit('variant_delete', { id });
      json(200, { status: 'ok' });
      return true;
    }
  }

  // ---- Photo gallery ------------------------------------------------------------------------------------------
  if (action === 'product-gallery') {
    const pid = idParam(ctx, 'product_id');
    if (method === 'GET') {
      if (!(await need(ctx, 'products.read'))) return true;
      if (!pid) return invalidId(ctx), true;
      const r = await rest(db, `product_images?select=path,alt,sort_order&product_id=eq.${pid}&order=sort_order.asc`);
      if (!r.ok) throw new Error(`gallery ${r.status}`);
      json(200, { status: 'ok', images: await r.json() });
      return true;
    }
    if (method === 'PUT') {
      if (!(await need(ctx, 'products.edit'))) return true;
      if (!pid) return invalidId(ctx), true;
      const v = validateGallery(req.body);
      if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
      const before = await rest(db, `product_images?select=path&product_id=eq.${pid}`);
      if (!before.ok) throw new Error(`gallery read ${before.status}`);
      const oldPaths = ((await before.json()) as { path: string }[]).map((x) => x.path);
      const r = await rpc(db, 'replace_product_images', { p_product: pid, p_images: v.images });
      if (!r.ok) return failWith(ctx, r.failure), true;
      for (const gone of removedPaths(oldPaths, v.images)) await deleteImage(db, gone);
      await ctx.audit('product_gallery_update', { product: pid, count: v.images.length });
      json(200, { status: 'ok', images: v.images });
      return true;
    }
  }

  return false;
}
