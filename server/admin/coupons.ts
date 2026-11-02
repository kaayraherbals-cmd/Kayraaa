import { parsePage, sanitiseSearch } from '../../shared/admin.js';
import { validateCouponInput, type CouponWrite } from '../../shared/coupons.js';
import { isUuid } from '../../shared/cart.js';
import type { RpcFailure } from '../../shared/inventory.js';
import { rpc } from '../rpc.js';
import { rest } from '../supabase.js';
import { PAGE_SIZE, bodyOf, need, type AdminCtx } from './ctx.js';

const STATUSES = new Set(['all', 'active', 'scheduled', 'expired', 'inactive']);
const COLUMNS = 'id,code,description,discount_type,percent_bps,fixed_paise,min_order_paise,max_discount_paise,starts_at,expires_at,usage_limit,per_customer_limit,first_order_only,product_ids,product_forms,active,created_by,updated_by,created_at,updated_at';

function failWith(ctx: AdminCtx, f: RpcFailure) {
  if (f.kind === 'unknown') return ctx.json(502, { status: 'error', message: 'The database request failed. Try again.', hint: 'Run supabase/coupons.sql (order in docs/DATABASE_MIGRATIONS.md).' });
  return ctx.json(409, { status: 'conflict', message: f.message });
}

/** Which of these product ids exist. A coupon can only be limited to real products. */
async function missingProducts(ctx: AdminCtx, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const r = await rest(ctx.cfg.db, `products?select=id&id=in.(${ids.join(',')})`);
  if (!r.ok) throw new Error(`coupon products ${r.status}`);
  const found = new Set(((await r.json()) as { id: string }[]).map((p) => p.id.toLowerCase()));
  return ids.filter((i) => !found.has(i));
}

const CHANGEABLE: (keyof CouponWrite)[] = [
  'description', 'discount_type', 'percent_bps', 'fixed_paise', 'min_order_paise', 'max_discount_paise', 'starts_at', 'expires_at', 'usage_limit', 'per_customer_limit', 'first_order_only', 'product_ids', 'product_forms', 'active',
];
/** Field -> [before, after], only where something changed. Dates are compared as instants. */
function diff(before: Record<string, unknown>, after: CouponWrite): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  const norm = (k: string, v: unknown) => (k === 'starts_at' || k === 'expires_at' ? (v ? new Date(String(v)).toISOString() : null) : Array.isArray(v) ? [...v].sort().join(',') : v);
  for (const k of CHANGEABLE) if (norm(k, before[k]) !== norm(k, after[k])) out[k] = [before[k] ?? null, after[k] ?? null];
  return out;
}

/**
 * Coupons admin. Reading needs coupons.read and every change needs coupons.write; only the owner holds either (shared/roles.ts), and
 * no other role gets them unless the code is changed on purpose. There is no delete: a coupon is switched off, because orders and
 * reports refer to it. The code cannot change after creation. Every create, edit and on/off change is written to the audit log with
 * the before and after values. The assistant never touches these endpoints. Returns true when it handled the action.
 */
export async function handleCoupons(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  if (action === 'coupons' && method === 'GET') {
    if (!(await need(ctx, 'coupons.read'))) return true;
    const page = parsePage(req.query.page);
    const st = STATUSES.has(String(req.query.status)) ? String(req.query.status) : 'all';
    const r = await rpc<{ total: number; items: unknown[] }>(db, 'coupon_admin_list', { p_q: sanitiseSearch(req.query.q), p_status: st, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE });
    if (!r.ok) return failWith(ctx, r.failure), true;
    json(200, { status: 'ok', items: r.data.items, total: Number(r.data.total), page, pageSize: PAGE_SIZE });
    return true;
  }

  if (action === 'coupon' && method === 'GET') {
    if (!(await need(ctx, 'coupons.read'))) return true;
    const id = String(req.query.id ?? '');
    if (!isUuid(id)) return json(400, { status: 'invalid', message: 'That coupon id is not valid.' }), true;
    const [c, red] = await Promise.all([
      rest(db, `coupons?select=${COLUMNS}&id=eq.${id}&limit=1`),
      rest(db, `coupon_redemptions?select=id,status,discount_paise,order_subtotal_paise,release_reason,reserved_at,committed_at,released_at,orders(order_no,total_paise,status)&coupon_id=eq.${id}&order=reserved_at.desc&limit=50`),
    ]);
    if (!c.ok || !red.ok) throw new Error(`coupon detail ${c.status}/${red.status}`);
    const item = ((await c.json()) as unknown[])[0];
    if (!item) return json(404, { status: 'error', message: 'That coupon does not exist.' }), true;
    json(200, { status: 'ok', item, redemptions: await red.json() });
    return true;
  }

  if (action === 'coupon-options' && method === 'GET') {
    if (!(await need(ctx, 'coupons.read'))) return true;
    const r = await rest(db, 'products?select=id,form,public_name,internal_name&order=internal_name.asc&limit=500');
    if (!r.ok) throw new Error(`coupon options ${r.status}`);
    const rows = (await r.json()) as { id: string; form: string; public_name: string | null; internal_name: string }[];
    json(200, { status: 'ok', products: rows.map((p) => ({ id: p.id, name: p.public_name?.trim() || p.internal_name, form: p.form })), forms: [...new Set(rows.map((p) => p.form))].sort() });
    return true;
  }

  if (action === 'coupon-analytics' && method === 'GET') {
    if (!(await need(ctx, 'coupons.read'))) return true;
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const from = day(req.query.from);
    const to = day(req.query.to);
    // `to` is inclusive for the person, exclusive for the query.
    const toEnd = to ? new Date(Date.parse(`${to}T00:00:00+05:30`) + 86_400_000).toISOString() : null;
    const r = await rpc<unknown>(db, 'coupon_analytics', { p_from: from ? `${from}T00:00:00+05:30` : null, p_to: toEnd });
    if (!r.ok) return failWith(ctx, r.failure), true;
    json(200, { status: 'ok', analytics: r.data });
    return true;
  }

  if (action === 'coupon' && method === 'POST') {
    if (!(await need(ctx, 'coupons.write'))) return true;
    const v = validateCouponInput(bodyOf(req), 'create');
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const miss = await missingProducts(ctx, v.value.product_ids);
    if (miss.length) return json(400, { status: 'invalid', message: 'One of the chosen products does not exist.' }), true;
    const r = await rest(db, 'coupons', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...v.value, created_by: ctx.email }) });
    if (r.status === 409) return json(409, { status: 'duplicate', message: `The code ${v.value.code} already exists. Codes are permanent: choose another, or edit the existing coupon.` }), true;
    if (!r.ok) throw new Error(`coupon create ${r.status}`);
    const item = ((await r.json()) as { id: string }[])[0];
    await ctx.audit('coupon_create', { id: item?.id, code: v.value.code, type: v.value.discount_type, active: v.value.active });
    json(201, { status: 'ok', item });
    return true;
  }

  if (action === 'coupon' && method === 'PATCH') {
    if (!(await need(ctx, 'coupons.write'))) return true;
    const id = String(req.query.id ?? '');
    if (!isUuid(id)) return json(400, { status: 'invalid', message: 'That coupon id is not valid.' }), true;
    const v = validateCouponInput(bodyOf(req), 'update');
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const cur = await rest(db, `coupons?select=${COLUMNS}&id=eq.${id}&limit=1`);
    if (!cur.ok) throw new Error(`coupon read ${cur.status}`);
    const before = ((await cur.json()) as Record<string, unknown>[])[0];
    if (!before) return json(404, { status: 'error', message: 'That coupon does not exist.' }), true;
    const miss = await missingProducts(ctx, v.value.product_ids);
    if (miss.length) return json(400, { status: 'invalid', message: 'One of the chosen products does not exist.' }), true;
    const changes = diff(before, v.value);
    if (!Object.keys(changes).length) return json(200, { status: 'ok', item: before, unchanged: true }), true;
    const r = await rest(db, `coupons?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...v.value, updated_by: ctx.email }) });
    if (!r.ok) throw new Error(`coupon update ${r.status}`);
    const item = ((await r.json()) as unknown[])[0];
    await ctx.audit(Object.keys(changes).length === 1 && 'active' in changes ? (v.value.active ? 'coupon_activate' : 'coupon_deactivate') : 'coupon_update', { id, code: before.code, changes });
    json(200, { status: 'ok', item });
    return true;
  }

  if (action === 'coupon-toggle' && method === 'POST') {
    if (!(await need(ctx, 'coupons.write'))) return true;
    const id = String(req.query.id ?? '');
    const active = bodyOf(req).active;
    if (!isUuid(id) || typeof active !== 'boolean') return json(400, { status: 'invalid', message: 'Choose active or inactive.' }), true;
    const r = await rest(db, `coupons?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ active, updated_by: ctx.email }) });
    if (!r.ok) throw new Error(`coupon toggle ${r.status}`);
    const item = ((await r.json()) as { code: string }[])[0];
    if (!item) return json(404, { status: 'error', message: 'That coupon does not exist.' }), true;
    await ctx.audit(active ? 'coupon_activate' : 'coupon_deactivate', { id, code: item.code });
    json(200, { status: 'ok', item });
    return true;
  }

  // What the customer actually paid per line after the discount, for working out a partial refund. Read-only.
  if (action === 'refund-basis' && method === 'GET') {
    if (!(await need(ctx, 'refunds.read'))) return true;
    const id = String(req.query.order ?? '');
    if (!isUuid(id)) return json(400, { status: 'invalid', message: 'That order id is not valid.' }), true;
    const r = await rpc<unknown>(db, 'order_refund_basis', { p_order: id });
    if (!r.ok) return r.failure.kind === 'not_found' ? (json(404, { status: 'error', message: 'That order does not exist.' }), true) : (failWith(ctx, r.failure), true);
    json(200, { status: 'ok', basis: r.data });
    return true;
  }

  return false;
}
