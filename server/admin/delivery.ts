import { parsePage, sanitiseSearch, toCsv } from '../../shared/admin.js';
import { isValidPin } from '../../shared/checkout.js';
import { DELIVERY_CSV_HEADERS, deliveryCsvRow, validateAreaCreate, validateAreaUpdate, validateBulk, type DeliveryAreaRow } from '../../shared/deliveryAreas.js';
import type { RpcFailure } from '../../shared/inventory.js';
import { rpc } from '../rpc.js';
import { rest } from '../supabase.js';
import { PAGE_SIZE, bodyOf, need, pageRange, totalOf, type AdminCtx } from './ctx.js';

const EXPORT_CAP = 20000;
const COLUMNS = 'pincode,active,rate_paise,free_above_paise,city,state,updated_at';

async function countWhere(ctx: AdminCtx, filter: string): Promise<number> {
  const r = await rest(ctx.cfg.db, `shipping_pincodes?select=pincode&limit=1${filter}`, { headers: { Prefer: 'count=exact' } });
  if (!r.ok) throw new Error(`delivery areas count ${r.status}`);
  return totalOf(r);
}

function failWith(ctx: AdminCtx, f: RpcFailure) {
  if (f.kind === 'invalid') return ctx.json(400, { status: 'invalid', message: 'The PIN code list or settings were refused. Check them and try again.' });
  if (f.kind === 'unknown') return ctx.json(502, { status: 'error', message: 'The database request failed. Try again.', hint: 'Run supabase/delivery_areas.sql (order in docs/DATABASE_MIGRATIONS.md).' });
  return ctx.json(409, { status: 'conflict', message: f.message });
}

/**
 * Delivery areas: which PIN codes we deliver to, the charge, and the order amount above which delivery is free (the
 * shipping_pincodes table that checkout reads). Reading needs delivery.read (every role); every change needs delivery.write
 * (owner only, because the charge is part of what a customer pays). There is no delete: switching a PIN code off stops
 * deliveries there and keeps its settings. Returns true when it handled the action.
 */
export async function handleDelivery(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  if (action === 'delivery-areas' && method === 'GET') {
    if (!(await need(ctx, 'delivery.read'))) return true;
    const page = parsePage(req.query.page);
    const st = String(req.query.status ?? '');
    const q = sanitiseSearch(req.query.q);
    let filter = st === 'on' ? '&active=eq.true' : st === 'off' ? '&active=eq.false' : '';
    if (/^\d{1,6}$/.test(q)) filter += `&pincode=like.${q}*`;
    else if (q) filter += `&or=(city.ilike.*${q}*,state.ilike.*${q}*)`;
    const [list, on, off] = await Promise.all([
      rest(db, `shipping_pincodes?select=${COLUMNS}&order=pincode.asc&${pageRange(page)}${filter}`, { headers: { Prefer: 'count=exact' } }),
      countWhere(ctx, '&active=eq.true'),
      countWhere(ctx, '&active=eq.false'),
    ]);
    if (!list.ok) throw new Error(`delivery areas ${list.status}`);
    json(200, { status: 'ok', items: await list.json(), total: totalOf(list), page, pageSize: PAGE_SIZE, counts: { on, off } });
    return true;
  }

  if (action === 'delivery-areas-export' && method === 'GET') {
    if (!(await need(ctx, 'delivery.read'))) return true;
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < EXPORT_CAP; offset += 1000) {
      const r = await rest(db, `shipping_pincodes?select=${COLUMNS}&order=pincode.asc&limit=1000&offset=${offset}`);
      if (!r.ok) throw new Error(`delivery areas export ${r.status}`);
      const batch = (await r.json()) as DeliveryAreaRow[];
      rows.push(...batch.map(deliveryCsvRow));
      if (batch.length < 1000) break;
    }
    await ctx.audit('export_delivery_areas', { count: rows.length });
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="kaayra-delivery-areas-${new Date().toISOString().slice(0, 10)}.csv"`);
    ctx.res.status(200).send('\ufeff' + toCsv([...DELIVERY_CSV_HEADERS], rows));
    return true;
  }

  if (action === 'delivery-area' && method === 'POST') {
    if (!(await need(ctx, 'delivery.write'))) return true;
    const v = validateAreaCreate(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const a = v.value;
    const r = await rest(db, 'shipping_pincodes', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ pincode: a.pincode, active: a.active, rate_paise: a.ratePaise, free_above_paise: a.freeAbovePaise, city: a.city, state: a.state }),
    });
    if (r.status === 409) return json(409, { status: 'duplicate', message: `${a.pincode} is already in the list. Edit it instead.` }), true;
    if (!r.ok) throw new Error(`delivery area create ${r.status}`);
    await ctx.audit('delivery_area_add', { pincode: a.pincode, active: a.active, ratePaise: a.ratePaise, freeAbovePaise: a.freeAbovePaise });
    json(201, { status: 'ok', item: ((await r.json()) as unknown[])[0] });
    return true;
  }

  if (action === 'delivery-area' && method === 'PATCH') {
    if (!(await need(ctx, 'delivery.write'))) return true;
    const pin = String(req.query.pincode ?? '').trim();
    if (!isValidPin(pin)) return json(400, { status: 'invalid', message: 'Enter a valid 6-digit PIN code.' }), true;
    const v = validateAreaUpdate(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const r = await rest(db, `shipping_pincodes?pincode=eq.${pin}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...v.value, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`delivery area update ${r.status}`);
    const item = ((await r.json()) as unknown[])[0];
    if (!item) return json(404, { status: 'error', message: 'That PIN code is not in the list.' }), true;
    const fields = Object.keys(v.value);
    if (fields.length === 1 && fields[0] === 'active') await ctx.audit('delivery_area_toggle', { pincode: pin, active: v.value.active });
    else await ctx.audit('delivery_area_update', { pincode: pin, fields, ...v.value });
    json(200, { status: 'ok', item });
    return true;
  }

  if (action === 'delivery-areas-bulk' && method === 'POST') {
    if (!(await need(ctx, 'delivery.write'))) return true;
    const v = validateBulk(bodyOf(req));
    if (!v.ok) return json(400, { status: 'invalid', message: v.errors.join(' '), problems: v.errors }), true;
    const { req: b, parsed } = v.value;
    if (b.dryRun) {
      // Read-only: how many of these PIN codes are already listed. Nothing is written or audited.
      const pins = parsed.entries.map((e) => e.pincode);
      let existing = 0;
      for (let i = 0; i < pins.length; i += 200) {
        const r = await rest(db, `shipping_pincodes?select=pincode&pincode=in.(${pins.slice(i, i + 200).join(',')})`);
        if (!r.ok) throw new Error(`delivery areas check ${r.status}`);
        existing += ((await r.json()) as unknown[]).length;
      }
      json(200, { status: 'ok', dryRun: true, total: pins.length, existing, added: pins.length - existing, duplicatesIgnored: parsed.duplicates });
      return true;
    }
    const rows = parsed.entries.map((e) => ({ pincode: e.pincode, city: e.city ?? b.city, state: e.state ?? b.state }));
    const r = await rpc<{ added: number; updated: number; skipped: number }>(db, 'delivery_areas_upsert', {
      p_rows: rows, p_rate: b.ratePaise, p_free: b.freeAbovePaise, p_active: b.active, p_update: b.onExisting === 'update',
    });
    if (!r.ok) return failWith(ctx, r.failure), true;
    await ctx.audit('delivery_areas_bulk', { count: rows.length, ...r.data, duplicatesIgnored: parsed.duplicates, ratePaise: b.ratePaise, freeAbovePaise: b.freeAbovePaise, active: b.active, onExisting: b.onExisting });
    json(200, { status: 'ok', ...r.data, duplicatesIgnored: parsed.duplicates });
    return true;
  }

  return false;
}
