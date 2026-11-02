import { UUID_RE, parsePage, sanitiseSearch, toCsv } from '../../shared/admin.js';
import { AUDIT_CSV_HEADERS, auditCsvRow, auditFilter, parseAuditQuery, type AuditRow } from '../../shared/audit.js';
import { todayIST, summariseStock, type Batch } from '../../shared/inventory.js';
import { parseDays } from '../../shared/analytics.js';
import { loadAnalytics } from '../analyticsService.js';
import { MEMBER_CSV_HEADERS, memberCsvRow, type MemberRow } from '../../shared/members.js';
import { can } from '../../shared/roles.js';
import { deleteMember } from '../members.js';
import { rest } from '../supabase.js';
import { dbHint } from './dbHint.js';
import { PAGE_SIZE, need, pageRange, totalOf, type AdminCtx } from './ctx.js';

const EXPORT_CAP = 20000;

async function count(ctx: AdminCtx, table: string, filter = ''): Promise<number> {
  const r = await rest(ctx.cfg.db, `${table}?select=id&limit=1${filter}`, { headers: { Prefer: 'count=exact' } });
  if (!r.ok) throw new Error(`count ${table} ${r.status}`);
  return totalOf(r);
}

const tally = (rows: { status: string }[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
};

export interface StockAttention {
  variant_id: string;
  product: string;
  pack_size: string;
  kind: 'out' | 'low' | 'expiring' | 'expired';
  detail: string;
}

/**
 * Dashboard home, members, and the audit-log export. Returns true when it handled the action.
 * The dashboard is available to every signed-in admin, but each block is included only when the role may read that area.
 */
export async function handleExtras(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json, role } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  // ---- Dashboard ----------------------------------------------------------------------------------------------
  if (action === 'dashboard' && method === 'GET') {
    const out: Record<string, unknown> = { status: 'ok', today: todayIST() };
    const weekAgo = encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString());
    const jobs: Promise<void>[] = [];
    const unavailable: { area: string; hint: string }[] = [];
    // One missing table must not blank the whole overview: each block loads on its own and a failed one is reported by name.
    const run = (area: string, fn: () => Promise<void>) => {
      jobs.push(fn().catch((e: unknown) => {
        console.error(`dashboard ${area} failed`, e instanceof Error ? e.message : e);
        unavailable.push({ area, hint: dbHint(e) });
      }));
    };
    if (can(role, 'subscribers.read')) run('Launch list', async () => { out.subscribers = { total: await count(ctx, 'launch_subscribers', '&status=eq.confirmed'), pending: await count(ctx, 'launch_subscribers', '&status=eq.pending'), last7: await count(ctx, 'launch_subscribers', `&status=eq.confirmed&confirmed_at=gte.${weekAgo}`) }; });
    if (can(role, 'messages.read')) run('Messages', async () => { out.messages = { new: await count(ctx, 'contact_messages', '&status=eq.new') }; });
    if (can(role, 'issues.read')) run('Problem reports', async () => { out.issues = { open: await count(ctx, 'issues', '&status=in.(open,investigating)'), high: await count(ctx, 'issues', '&status=in.(open,investigating)&severity=eq.high') }; });
    if (can(role, 'refunds.read')) run('Refunds', async () => { out.refunds = { awaiting: await count(ctx, 'order_refunds', '&status=eq.requested'), toPay: await count(ctx, 'order_refunds', '&status=eq.approved') }; });
    if (can(role, 'members.read')) run('Members', async () => { out.members = { total: await count(ctx, 'members'), last7: await count(ctx, 'members', `&created_at=gte.${weekAgo}`) }; });
    if (can(role, 'products.read')) run('Products', async () => {
      const r = await rest(db, 'products?select=status&limit=1000');
      if (!r.ok) throw new Error(`dash products ${r.status}`);
      out.products = { byStatus: tally((await r.json()) as { status: string }[]) };
    });
    if (can(role, 'orders.read')) run('Orders', async () => {
      const r = await rest(db, 'orders?select=status&limit=5000');
      if (!r.ok) throw new Error(`dash orders ${r.status}`);
      const by = tally((await r.json()) as { status: string }[]);
      out.orders = { byStatus: by, toHandle: (by.placed ?? 0) + (by.paid ?? 0) + (by.packed ?? 0) };
    });
    if (can(role, 'inventory.read')) run('Stock', async () => {
      const [vr, br] = await Promise.all([
        rest(db, 'product_variants?select=id,pack_size,low_stock_threshold,status,products(internal_name,public_name)&status=eq.active&limit=500'),
        rest(db, 'inventory_batches?select=variant_id,status,expiry_date,qty_on_hand,qty_reserved&qty_on_hand=gt.0&limit=5000'),
      ]);
      if (!vr.ok || !br.ok) throw new Error(`dash inventory ${vr.status}/${br.status}`);
      const variants = (await vr.json()) as { id: string; pack_size: string; low_stock_threshold: number; products: { internal_name?: string; public_name?: string | null } | null }[];
      const batches = (await br.json()) as Pick<Batch, 'variant_id' | 'status' | 'expiry_date' | 'qty_on_hand' | 'qty_reserved'>[];
      const today = todayIST();
      const counts = { out: 0, low: 0, expiring: 0, expired: 0 };
      const attention: StockAttention[] = [];
      for (const v of variants) {
        const s = summariseStock(batches.filter((b) => b.variant_id === v.id), v.low_stock_threshold, today);
        const product = v.products?.internal_name ?? v.products?.public_name ?? 'Product';
        const add = (kind: StockAttention['kind'], detail: string) => { counts[kind]++; attention.push({ variant_id: v.id, product, pack_size: v.pack_size, kind, detail }); };
        if (s.expiredUnits > 0) add('expired', `${s.expiredUnits} units past expiry`);
        if (s.out) add('out', 'No sellable stock');
        else if (s.low) add('low', `${s.available} sellable (threshold ${v.low_stock_threshold})`);
        if (s.expiringUnits > 0) add('expiring', `${s.expiringUnits} units expire within 90 days`);
      }
      const order = { expired: 0, out: 1, low: 2, expiring: 3 } as const;
      attention.sort((a, b) => order[a.kind] - order[b.kind]);
      out.inventory = { variants: variants.length, ...counts, attention: attention.slice(0, 8) };
    });
    await Promise.all(jobs);
    if (unavailable.length) out.unavailable = unavailable;
    json(200, out);
    return true;
  }

  // ---- Reports, Sales, Stock health ---------------------------------------------------------------------------
  if (action === 'analytics' && method === 'GET') {
    const days = parseDays(req.query.days);
    const r = await loadAnalytics(db, role, days, Date.now());
    const out: Record<string, unknown> = { status: 'ok', days };
    if (r.sales) out.sales = r.sales;
    if (r.stock) out.stock = r.stock;
    if (r.failed.length) out.unavailable = r.failed.map((f) => ({ area: f.area, hint: dbHint(f.error) }));
    json(200, out);
    return true;
  }

  // ---- Members ------------------------------------------------------------------------------------------------
  if (action === 'members') {
    if (method === 'GET') {
      if (!(await need(ctx, 'members.read'))) return true;
      const page = parsePage(req.query.page);
      const q = sanitiseSearch(req.query.q);
      const filter = q ? `&or=(email.ilike.*${q}*,name.ilike.*${q}*)` : '';
      const r = await rest(db, `members?select=id,email,name,role,provider,has_password,created_at,last_login_at&order=last_login_at.desc&${pageRange(page)}${filter}`, { headers: { Prefer: 'count=exact' } });
      if (!r.ok) throw new Error(`members ${r.status}`);
      json(200, { status: 'ok', items: (await r.json()) as MemberRow[], total: totalOf(r), page, pageSize: PAGE_SIZE });
      return true;
    }
    if (method === 'DELETE') {
      if (!(await need(ctx, 'members.delete'))) return true;
      const id = String(req.query.id ?? '');
      if (!UUID_RE.test(id)) return json(400, { status: 'invalid', message: 'Invalid id.' }), true;
      const found = await rest(db, `members?select=id,email,role&id=eq.${id}&limit=1`);
      if (!found.ok) throw new Error(`member lookup ${found.status}`);
      const m = ((await found.json()) as { id: string; email: string; role: string }[])[0];
      if (!m) return json(404, { status: 'error', message: 'Not found.' }), true;
      // Deleting an admin's own sign-in identity would lock them out. Admin rights come from ADMIN_EMAILS, so that is where they are removed.
      if (m.role === 'admin' || cfg.admins.includes(m.email.toLowerCase())) {
        return json(409, { status: 'conflict', message: 'This account belongs to an administrator. Remove the address from ADMIN_EMAILS first if you really mean to delete it.' }), true;
      }
      await deleteMember(db, m.id);
      await ctx.audit('delete_member', { id: m.id });
      json(200, { status: 'ok' });
      return true;
    }
  }

  if (action === 'members-export' && method === 'GET') {
    if (!(await need(ctx, 'members.export'))) return true;
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < EXPORT_CAP; offset += 1000) {
      const r = await rest(db, `members?select=id,email,name,role,provider,has_password,created_at,last_login_at&order=created_at.asc&limit=1000&offset=${offset}`);
      if (!r.ok) throw new Error(`members export ${r.status}`);
      const batch = (await r.json()) as MemberRow[];
      rows.push(...batch.map(memberCsvRow));
      if (batch.length < 1000) break;
    }
    await ctx.audit('export_members', { count: rows.length });
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="kaayra-members-${todayIST()}.csv"`);
    ctx.res.status(200).send('\ufeff' + toCsv([...MEMBER_CSV_HEADERS], rows));
    return true;
  }

  // ---- Audit-log export (owner) -------------------------------------------------------------------------------
  if (action === 'audit-export' && method === 'GET') {
    if (!(await need(ctx, 'audit.export'))) return true;
    const q = parseAuditQuery(req.query as Record<string, unknown>);
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < EXPORT_CAP; offset += 1000) {
      const r = await rest(db, `admin_audit?select=id,actor,action,detail,at&order=id.desc&limit=1000&offset=${offset}${auditFilter(q)}`);
      if (!r.ok) throw new Error(`audit export ${r.status}`);
      const batch = (await r.json()) as AuditRow[];
      rows.push(...batch.map(auditCsvRow));
      if (batch.length < 1000) break;
    }
    await ctx.audit('export_audit', { count: rows.length, actor: q.actor, action: q.action, from: q.from, to: q.to });
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="kaayra-audit-${todayIST()}.csv"`);
    ctx.res.status(200).send('\ufeff' + toCsv([...AUDIT_CSV_HEADERS], rows));
    return true;
  }

  return false;
}
