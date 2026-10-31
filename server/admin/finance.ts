import { isUuid } from '../../shared/cart.js';
import { parsePage } from '../../shared/admin.js';
import {
  EXPENSE_CATEGORIES, EXPORT_ROW_CAP, KPI_KEYS, bpsText, financeCsv, parseRange, parseRupees, presetRange, rupees, validateCost, validateExpense, type KpiKey,
} from '../../shared/finance.js';
import { todayIST } from '../../shared/inventory.js';
import { rpc } from '../rpc.js';
import { rest } from '../supabase.js';
import {
  FinanceDbError, FinanceDenied, FinanceInvalid, getCustomerPurchaseMetrics, getDailySeries, getExpenseBreakdown, getInventoryValuation, getKpiProgress, getProductProfitability,
  getProfitSummary, getRefundFinancialImpact, getRevenueSummary, getSalesForecast, type FinanceActor,
} from '../financeService.js';
import { bodyOf, need, type AdminCtx } from './ctx.js';

const ACTIONS = new Set([
  'finance-overview', 'finance-products', 'finance-expenses', 'finance-inventory', 'finance-customers', 'finance-costs', 'finance-kpis', 'finance-export',
  'finance-cost', 'finance-expense', 'finance-expense-void', 'finance-fee', 'finance-ship-cost', 'finance-kpi',
]);

/** Range from ?preset= or ?from=&to= (to is exclusive, India dates). Defaults to the current month so far. */
function rangeOf(q: Record<string, unknown>): { from: string; to: string } | null {
  const today = todayIST();
  if (typeof q.from === 'string' || typeof q.to === 'string') return parseRange(q.from, q.to);
  return presetRange(typeof q.preset === 'string' ? q.preset : 'this_month', today);
}

/**
 * Business intelligence admin API. Reading needs finance.read, changing costs, expenses, fees and targets needs finance.write and
 * exports need finance.export; only the owner holds any of them (shared/roles.ts). The browser's role flag is never trusted: the role
 * comes from the signed session. Every write is audited with before/after values. Nothing here touches orders, stock, payments or
 * refunds: it only reads them, and writes its own finance tables. Returns true when it handled the action.
 */
export async function handleFinance(ctx: AdminCtx, action: string): Promise<boolean> {
  if (!ACTIONS.has(action)) return false;
  const { req, cfg, json } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;
  const actor: FinanceActor = { db, role: ctx.role };
  const q = req.query as Record<string, unknown>;

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      json(200, { status: 'ok', ...((await fn()) as object) });
    } catch (e) {
      if (e instanceof FinanceDenied) json(403, { status: 'forbidden', message: 'Your role does not have permission for this action.' });
      else if (e instanceof FinanceInvalid) json(400, { status: 'invalid', message: e.message });
      else if (e instanceof FinanceDbError) json(502, { status: 'error', message: 'The finance database request failed. Try again.', hint: 'Run supabase/finance.sql (order in docs/DATABASE_MIGRATIONS.md).' });
      else throw e;
    }
    return true;
  };
  const rangeOrFail = (): { from: string; to: string } | null => {
    const r = rangeOf(q);
    if (!r) json(400, { status: 'invalid', message: 'Choose a valid date range (at most 800 days).' });
    return r;
  };
  const failWrite = (f: { kind: string; message?: string }) =>
    f.kind === 'unknown' ? json(502, { status: 'error', message: 'The database request failed. Try again.', hint: 'Run supabase/finance.sql (order in docs/DATABASE_MIGRATIONS.md).' }) : json(409, { status: 'conflict', message: f.message ?? 'That conflicts with an existing record.' });

  // ---- Reads ----------------------------------------------------------------------------------------------------------
  if (method === 'GET' && action !== 'finance-export') {
    if (!(await need(ctx, 'finance.read'))) return true;
    if (action === 'finance-overview') {
      const r = rangeOrFail();
      if (!r) return true;
      return run(async () => {
        const [revenue, profit, series, refunds, forecast, kpis] = await Promise.all([
          getRevenueSummary(actor, r), getProfitSummary(actor, r), getDailySeries(actor, r), getRefundFinancialImpact(actor, r), getSalesForecast(actor), getKpiProgress(actor),
        ]);
        return { range: r, revenue, profit: profit.profit, series, refunds, forecast, kpis };
      });
    }
    if (action === 'finance-products') {
      const r = rangeOrFail();
      if (!r) return true;
      return run(() => getProductProfitability(actor, r, String(q.sort ?? 'revenue'), Number(parsePage(q.page))));
    }
    if (action === 'finance-expenses') {
      const r = rangeOrFail();
      if (!r) return true;
      const page = parsePage(q.page);
      const cat = EXPENSE_CATEGORIES.includes(q.category as never) ? `&category=eq.${String(q.category)}` : '';
      const st = q.status === 'voided' ? 'voided' : 'active';
      return run(async () => {
        const [breakdown, list] = await Promise.all([
          getExpenseBreakdown(actor, r),
          rest(db, `business_expenses?select=id,expense_date,category,amount_paise,description,vendor,reference,status,void_reason,created_by,updated_by,created_at,updated_at&status=eq.${st}&expense_date=gte.${r.from}&expense_date=lt.${r.to}${cat}&order=expense_date.desc,created_at.desc&limit=25&offset=${(page - 1) * 25}`, { headers: { Prefer: 'count=exact' } }),
        ]);
        if (!list.ok) throw new FinanceDbError('expenses');
        const total = Number(/\/(\d+)$/.exec(list.headers.get('content-range') ?? '')?.[1] ?? 0);
        return { range: r, breakdown, items: await list.json(), total, page, pageSize: 25 };
      });
    }
    if (action === 'finance-inventory') return run(async () => ({ valuation: await getInventoryValuation(actor, Number(q.expiryDays) || 90, Number(q.slowDays) || 90) }));
    if (action === 'finance-customers') {
      const r = rangeOrFail();
      if (!r) return true;
      return run(() => getCustomerPurchaseMetrics(actor, r));
    }
    if (action === 'finance-kpis') return run(async () => ({ kpis: await getKpiProgress(actor) }));
    if (action === 'finance-costs') {
      // Pack sizes with their current cost; ?variant=<id> adds that pack size's full cost history.
      return run(async () => {
        const [vr, cr] = await Promise.all([
          rest(db, 'product_variants?select=id,sku,pack_size,price_paise,status,products(internal_name,public_name)&order=sku.asc&limit=500'),
          rest(db, 'product_cost_history?select=variant_id,unit_cost_paise,effective_from&order=effective_from.desc&limit=5000'),
        ]);
        if (!vr.ok || !cr.ok) throw new FinanceDbError('costs');
        const variants = (await vr.json()) as { id: string; sku: string; pack_size: string; price_paise: number | null; status: string; products: { internal_name: string; public_name: string | null } | null }[];
        const costs = (await cr.json()) as { variant_id: string; unit_cost_paise: number; effective_from: string }[];
        const latest = new Map<string, { unit_cost_paise: number; effective_from: string }>();
        for (const c of costs) if (!latest.has(c.variant_id)) latest.set(c.variant_id, c);
        let history: unknown[] = [];
        if (typeof q.variant === 'string' && isUuid(q.variant)) {
          const hr = await rest(db, `product_cost_history?select=id,purchase_paise,manufacturing_paise,packaging_paise,other_paise,unit_cost_paise,effective_from,source,note,created_by,created_at&variant_id=eq.${q.variant}&order=effective_from.desc&limit=100`);
          if (!hr.ok) throw new FinanceDbError('cost history');
          history = (await hr.json()) as unknown[];
        }
        return {
          items: variants.map((v) => ({ id: v.id, sku: v.sku, packSize: v.pack_size, name: v.products?.public_name?.trim() || v.products?.internal_name || '', pricePaise: v.price_paise, status: v.status, currentCost: latest.get(v.id) ?? null })),
          history,
        };
      });
    }
    return false;
  }

  // ---- Export ---------------------------------------------------------------------------------------------------------
  if (action === 'finance-export' && method === 'GET') {
    if (!(await need(ctx, 'finance.export'))) return true;
    const r = rangeOrFail();
    if (!r) return true;
    const report = String(q.report ?? '');
    let headers: string[] = [];
    let rows: Record<string, unknown>[] = [];
    try {
      if (report === 'sales') {
        const [rev, prof, series] = await Promise.all([getRevenueSummary(actor, r), getProfitSummary(actor, r), getDailySeries(actor, r)]);
        void rev;
        headers = ['date', 'orders', 'net_merchandise_incl_tax_rupees', 'shipping_charged_rupees'];
        rows = series.map((d) => ({ date: d.date, orders: d.orders, net_merchandise_incl_tax_rupees: rupees(d.netPaise), shipping_charged_rupees: rupees(d.shippingPaise) }));
        const p = prof.profit;
        rows.push({ date: 'TOTAL', orders: p.orders, net_merchandise_incl_tax_rupees: rupees(p.netMerchandiseInclTaxPaise), shipping_charged_rupees: rupees(p.shippingChargedPaise) });
      } else if (report === 'profit') {
        const { profit: p } = await getProfitSummary(actor, r);
        headers = ['metric', 'rupees', 'note'];
        const val = (v: number | null) => (v === null ? '' : rupees(v));
        rows = [
          { metric: 'Gross sales', rupees: val(p.grossSalesPaise) }, { metric: 'Discounts', rupees: val(p.discountsPaise) }, { metric: 'Net merchandise (incl. GST)', rupees: val(p.netMerchandiseInclTaxPaise) },
          { metric: 'GST included', rupees: val(p.gstIncludedPaise) }, { metric: 'Net sales (ex GST)', rupees: val(p.netSalesExTaxPaise) }, { metric: 'Shipping charged', rupees: val(p.shippingChargedPaise) },
          { metric: 'Refunds paid', rupees: val(p.refundsPaise) }, { metric: 'Cost of goods sold', rupees: val(p.cogsPaise), note: p.status === 'unavailable' ? 'No cost data' : '' },
          { metric: 'Gross profit', rupees: val(p.grossProfitPaise), note: p.grossProfitPaise === null ? p.message : '' },
          { metric: 'Operating expenses', rupees: val(p.operatingExpensesPaise) }, { metric: 'Operating profit', rupees: val(p.operatingProfitPaise), note: p.operatingProfitPaise === null ? p.message : '' },
          { metric: 'Net profit', rupees: val(p.netProfitPaise), note: p.netProfitPaise === null ? p.message : '' }, { metric: 'Gross margin', rupees: bpsText(p.grossMarginBps) },
          ...p.gaps.map((g) => ({ metric: 'Data gap', rupees: '', note: g })),
        ];
      } else if (report === 'products') {
        headers = ['product', 'pack_size', 'units', 'gross_rupees', 'discount_rupees', 'net_incl_tax_rupees', 'gst_rupees', 'refunds_rupees', 'cogs_rupees', 'gross_profit_rupees', 'margin', 'units_without_cost', 'available_units'];
        for (let page = 1; rows.length < EXPORT_ROW_CAP; page += 1) {
          const d = await getProductProfitability(actor, r, String(q.sort ?? 'revenue'), page);
          rows.push(...d.items.map((i) => ({
            product: i.product_name, pack_size: i.pack_size, units: i.units, gross_rupees: rupees(Number(i.gross)), discount_rupees: rupees(Number(i.discount)), net_incl_tax_rupees: rupees(Number(i.net_incl)), gst_rupees: rupees(Number(i.gst)),
            refunds_rupees: rupees(Number(i.refunds)), cogs_rupees: i.cogs === null ? '' : rupees(Number(i.cogs)), gross_profit_rupees: i.gross_profit === null ? '' : rupees(Number(i.gross_profit)),
            margin: i.margin_bps === null ? '' : bpsText(Number(i.margin_bps)), units_without_cost: i.units_without_cost ?? 0, available_units: i.available,
          })));
          if (d.items.length < d.pageSize) break;
        }
        rows = rows.slice(0, EXPORT_ROW_CAP);
      } else if (report === 'expenses') {
        headers = ['date', 'category', 'amount_rupees', 'description', 'vendor', 'reference', 'status'];
        const er = await rest(db, `business_expenses?select=expense_date,category,amount_paise,description,vendor,reference,status&expense_date=gte.${r.from}&expense_date=lt.${r.to}&order=expense_date.asc,created_at.asc&limit=${EXPORT_ROW_CAP}`);
        if (!er.ok) throw new FinanceDbError('expenses');
        rows = ((await er.json()) as Record<string, unknown>[]).map((e) => ({ date: e.expense_date, category: e.category, amount_rupees: rupees(Number(e.amount_paise)), description: e.description, vendor: e.vendor, reference: e.reference, status: e.status }));
      } else if (report === 'refunds') {
        headers = ['month_or_reason', 'refunds', 'rupees'];
        const d = await getRefundFinancialImpact(actor, r);
        rows = [
          ...(d.byReason as { reason: string; count: number; paise: number }[]).map((x) => ({ month_or_reason: `reason: ${x.reason}`, refunds: x.count, rupees: rupees(Number(x.paise)) })),
          ...(d.byMonth as { month: string; count: number; paise: number }[]).map((x) => ({ month_or_reason: `month: ${x.month}`, refunds: x.count, rupees: rupees(Number(x.paise)) })),
          { month_or_reason: 'TOTAL', refunds: d.refundCount, rupees: rupees(d.refundedPaise) },
        ];
      } else if (report === 'inventory') {
        headers = ['metric', 'value'];
        const v = await getInventoryValuation(actor);
        rows = Object.entries(v).filter(([k]) => k !== 'notes').map(([k, x]) => ({ metric: k, value: k.endsWith('_paise') ? rupees(Number(x)) : x }));
      } else if (report === 'customers') {
        headers = ['metric', 'value'];
        const d = await getCustomerPurchaseMetrics(actor, r);
        const m = d.metrics;
        rows = [
          { metric: 'customers', value: m.customers }, { metric: 'new_customers', value: m.new_customers }, { metric: 'returning_customers', value: m.returning_customers }, { metric: 'orders', value: m.orders },
          { metric: 'revenue_rupees', value: rupees(Number(m.revenue_paise)) }, { metric: 'repeat_purchase_rate', value: bpsText(d.stats.repeatPurchaseRateBps) },
          { metric: 'observed_lifetime_value_rupees', value: d.stats.observedLifetimeValuePaise === null ? '' : rupees(d.stats.observedLifetimeValuePaise) },
          ...m.cohorts.map((c) => ({ metric: `cohort ${c.cohort}`, value: `${c.customers} customers, ${c.orders} orders, Rs ${rupees(Number(c.revenue_paise))}` })),
        ];
      } else {
        return json(400, { status: 'invalid', message: 'Choose a report: sales, profit, products, expenses, refunds, inventory or customers.' }), true;
      }
    } catch (e) {
      if (e instanceof FinanceDenied) return json(403, { status: 'forbidden', message: 'Your role does not have permission for this action.' }), true;
      if (e instanceof FinanceInvalid) return json(400, { status: 'invalid', message: e.message }), true;
      if (e instanceof FinanceDbError) return json(502, { status: 'error', message: 'The finance database request failed. Try again.' }), true;
      throw e;
    }
    await ctx.audit('finance_export', { report, from: r.from, to: r.to, rows: rows.length });
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="kaayra-${report}-${r.from}-to-${r.to}.csv"`);
    ctx.res.status(200).send(financeCsv(headers, rows));
    return true;
  }

  // ---- Writes ---------------------------------------------------------------------------------------------------------
  if (method !== 'POST' && method !== 'PATCH') return false;
  if (!(await need(ctx, 'finance.write'))) return true;
  const body = bodyOf(req);

  if (action === 'finance-cost' && method === 'POST') {
    const v = validateCost(body, new Date().toISOString());
    if (!v.ok) return json(400, { status: 'invalid', message: v.message }), true;
    const r = await rpc<number>(db, 'finance_cost_add', { p_variant: v.value.variantId, p_purchase: v.value.purchase, p_manufacturing: v.value.manufacturing, p_packaging: v.value.packaging, p_other: v.value.other, p_from: v.value.effectiveFrom, p_source: v.value.source, p_note: v.value.note, p_actor: ctx.email });
    if (!r.ok) return failWrite(r.failure), true;
    await ctx.audit('finance_cost_add', { id: r.data, variant_id: v.value.variantId, purchase_paise: v.value.purchase, manufacturing_paise: v.value.manufacturing, packaging_paise: v.value.packaging, other_paise: v.value.other, effective_from: v.value.effectiveFrom, source: v.value.source });
    json(201, { status: 'ok', id: r.data });
    return true;
  }

  if (action === 'finance-expense' && (method === 'POST' || method === 'PATCH')) {
    const v = validateExpense({ ...body, id: method === 'PATCH' ? String(req.query.id ?? '') : null }, todayIST());
    if (!v.ok) return json(400, { status: 'invalid', message: v.message }), true;
    if (v.value.id && !isUuid(v.value.id)) return json(400, { status: 'invalid', message: 'That expense id is not valid.' }), true;
    let before: unknown = null;
    if (v.value.id) {
      const cur = await rest(db, `business_expenses?select=expense_date,category,amount_paise,description,vendor,reference&id=eq.${v.value.id}&limit=1`);
      if (!cur.ok) throw new Error(`expense read ${cur.status}`);
      before = ((await cur.json()) as unknown[])[0] ?? null;
      if (!before) return json(404, { status: 'error', message: 'That expense does not exist.' }), true;
    }
    const e = v.value;
    const r = await rpc<string>(db, 'finance_expense_save', { p_id: e.id, p_date: e.date, p_category: e.category, p_amount: e.amountPaise, p_description: e.description, p_vendor: e.vendor, p_reference: e.reference, p_actor: ctx.email });
    if (!r.ok) return json(r.failure.kind === 'unknown' ? 502 : 409, { status: r.failure.kind === 'unknown' ? 'error' : 'conflict', message: r.failure.kind === 'unknown' ? 'The database request failed. Try again.' : 'An active expense with the same date, category, amount, vendor and reference already exists.' }), true;
    await ctx.audit(e.id ? 'finance_expense_update' : 'finance_expense_add', { id: r.data, before, after: { date: e.date, category: e.category, amount_paise: e.amountPaise, description: e.description, vendor: e.vendor, reference: e.reference } });
    json(e.id ? 200 : 201, { status: 'ok', id: r.data });
    return true;
  }

  if (action === 'finance-expense-void' && method === 'POST') {
    const id = String(req.query.id ?? '');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!isUuid(id) || reason.length < 3 || reason.length > 300) return json(400, { status: 'invalid', message: 'Give a reason of 3 to 300 characters.' }), true;
    const r = await rpc(db, 'finance_expense_void', { p_id: id, p_reason: reason, p_actor: ctx.email });
    if (!r.ok) return failWrite(r.failure), true;
    await ctx.audit('finance_expense_void', { id, reason });
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'finance-fee' && method === 'POST') {
    const pay = String(body.paymentId ?? '');
    const fee = parseRupees(body.fee);
    const tax = parseRupees(body.tax ?? '0');
    const rev = parseRupees(body.reversal ?? '0');
    const src = body.source === 'razorpay_settlement' ? 'razorpay_settlement' : 'owner_entry';
    if (!isUuid(pay) || fee === null || tax === null || rev === null || rev > fee + tax) return json(400, { status: 'invalid', message: 'Enter the payment, the fee and tax in rupees; a fee reversal cannot exceed the fee and tax.' }), true;
    const r = await rpc<string>(db, 'finance_fee_record', { p_payment: pay, p_fee: fee, p_tax: tax, p_reversal: rev, p_ref: typeof body.ref === 'string' ? body.ref.slice(0, 80) : null, p_source: src, p_actor: ctx.email });
    if (!r.ok) return failWrite(r.failure), true;
    await ctx.audit('finance_fee_record', { payment_id: pay, fee_paise: fee, fee_tax_paise: tax, refund_fee_reversal_paise: rev, source: src });
    json(200, { status: 'ok', id: r.data });
    return true;
  }

  if (action === 'finance-ship-cost' && method === 'POST') {
    const ship = String(body.shipmentId ?? '');
    const cost = parseRupees(body.cost);
    const basis = body.basis === 'estimated' ? 'estimated' : body.basis === 'confirmed' ? 'confirmed' : null;
    if (!isUuid(ship) || cost === null || basis === null) return json(400, { status: 'invalid', message: 'Enter the shipment, the cost in rupees, and whether it is confirmed or estimated.' }), true;
    const r = await rpc<string>(db, 'finance_ship_cost_record', { p_shipment: ship, p_cost: cost, p_basis: basis, p_note: typeof body.note === 'string' ? body.note.slice(0, 200) : null, p_actor: ctx.email });
    if (!r.ok) return failWrite(r.failure), true;
    await ctx.audit('finance_ship_cost_record', { shipment_id: ship, cost_paise: cost, basis });
    json(200, { status: 'ok', id: r.data });
    return true;
  }

  if (action === 'finance-kpi' && method === 'POST') {
    const kpi = body.kpi as KpiKey;
    if (!KPI_KEYS.includes(kpi)) return json(400, { status: 'invalid', message: 'Choose one of the listed targets.' }), true;
    // Rupee targets arrive in rupees; counts and ratios arrive as whole numbers (margin and refund rate in percent, turnover as a ratio like 2.5).
    const raw = body.target;
    let target: number | null = null;
    if (kpi === 'monthly_revenue_paise') target = parseRupees(raw);
    else if (kpi === 'monthly_orders') target = typeof raw === 'number' || typeof raw === 'string' ? (/^\d{1,7}$/.test(String(raw)) ? Number(raw) : null) : null;
    else { const p = parseRupees(raw); target = p; } // percent or ratio with up to 2 decimals, stored x100
    if (target === null || target <= 0) return json(400, { status: 'invalid', message: 'Enter a target above zero.' }), true;
    const cur = await rest(db, `financial_kpi_targets?select=target&kpi=eq.${kpi}&limit=1`);
    const before = cur.ok ? (((await cur.json()) as { target: number }[])[0]?.target ?? null) : null;
    const r = await rpc(db, 'finance_kpi_set', { p_kpi: kpi, p_target: target, p_actor: ctx.email });
    if (!r.ok) return failWrite(r.failure), true;
    await ctx.audit('finance_kpi_set', { kpi, before, after: target });
    json(200, { status: 'ok' });
    return true;
  }
  return false;
}

