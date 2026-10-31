/**
 * Read-only financial service (Phase 8). The ONLY place that reads financial figures: the owner dashboard, the CSV exports and any
 * future owner-only assistant all call these functions, so every consumer sees the same numbers. Each function checks the caller's
 * role itself (not just the route), returns bounded results, returns no names, e-mails or phone numbers, and writes nothing.
 * Usage notes for a future owner assistant: docs/PHASE8_FINANCE.md, "Future owner AI".
 */
import { can, type AdminRole } from '../shared/roles.js';
import {
  asPaise, buildProfit, customerStats, forecastRevenue, growthBps, kpiRows, parseRange, previousRange, refundRateBps,
  type CustomerMetrics, type DayPoint, type Forecast, type KpiKey, type PeriodSummary, type ProfitSummary,
} from '../shared/finance.js';
import { todayIST } from '../shared/inventory.js';
import { rpc } from './rpc.js';
import { rest, type SupabaseConfig } from './supabase.js';

export interface FinanceActor { db: SupabaseConfig; role: AdminRole }
export class FinanceDenied extends Error {
  constructor() { super('finance.read required'); }
}
export class FinanceInvalid extends Error {}
export class FinanceDbError extends Error {}

const guard = (a: FinanceActor): void => { if (!can(a.role, 'finance.read')) throw new FinanceDenied(); };
const range = (r: { from: string; to: string }) => {
  const ok = parseRange(r.from, r.to);
  if (!ok) throw new FinanceInvalid('Choose a valid date range of at most 800 days.');
  return ok;
};
async function call<T>(a: FinanceActor, fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpc<T>(a.db, fn, args);
  if (!r.ok) throw new FinanceDbError(r.failure.kind === 'unknown' ? 'database' : r.failure.message);
  return r.data;
}
const num = (o: Record<string, unknown>): Record<string, number> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' || typeof v === 'string' ? asPaise(v) : 0]));

async function summary(a: FinanceActor, r: { from: string; to: string }): Promise<PeriodSummary> {
  const raw = await call<Record<string, unknown>>(a, 'finance_period_summary', { p_from: r.from, p_to: r.to });
  const expenses = Object.fromEntries(Object.entries((raw.expenses ?? {}) as Record<string, unknown>).map(([k, v]) => [k, asPaise(v)]));
  const { from: _f, to: _t, expenses: _e, ...rest } = raw;
  void _f; void _t; void _e;
  return { from: r.from, to: r.to, ...(num(rest) as unknown as Omit<PeriodSummary, 'from' | 'to' | 'expenses'>), expenses };
}

/** Revenue figures and growth against the previous period of the same length. */
export async function getRevenueSummary(a: FinanceActor, r: { from: string; to: string }) {
  guard(a);
  const cur = range(r);
  const [now, before] = await Promise.all([summary(a, cur), summary(a, previousRange(cur))]);
  const p = buildProfit(now);
  const pb = buildProfit(before);
  return {
    range: cur,
    revenue: { grossSalesPaise: p.grossSalesPaise, discountsPaise: p.discountsPaise, netMerchandiseInclTaxPaise: p.netMerchandiseInclTaxPaise, gstIncludedPaise: p.gstIncludedPaise, netSalesExTaxPaise: p.netSalesExTaxPaise, shippingChargedPaise: p.shippingChargedPaise, refundsPaise: p.refundsPaise, netCollectedPaise: p.netCollectedPaise, orders: p.orders, averageOrderPaise: p.averageOrderPaise, refundCount: now.refund_count, refundRateBps: refundRateBps(now) },
    previous: { range: previousRange(cur), netCollectedPaise: pb.netCollectedPaise, orders: pb.orders },
    growth: { netCollectedBps: growthBps(p.netCollectedPaise, pb.netCollectedPaise), ordersBps: growthBps(p.orders, pb.orders) },
    notes: ['Revenue is recognised when an order first reaches "paid" (India time). Unpaid, cancelled-before-payment and test orders are excluded.', 'Amounts include GST where the shop price includes it; the GST part is shown separately.'],
  };
}

export async function getProfitSummary(a: FinanceActor, r: { from: string; to: string }): Promise<{ range: { from: string; to: string }; profit: ProfitSummary; summary: PeriodSummary }> {
  guard(a);
  const cur = range(r);
  const s = await summary(a, cur);
  return { range: cur, profit: buildProfit(s), summary: s };
}

export const PRODUCT_SORTS = ['revenue', 'profit', 'margin', 'units', 'margin_asc', 'refunds'] as const;
export async function getProductProfitability(a: FinanceActor, r: { from: string; to: string }, sort = 'revenue', page = 1) {
  guard(a);
  const cur = range(r);
  const s = (PRODUCT_SORTS as readonly string[]).includes(sort) ? sort : 'revenue';
  const pg = Math.min(Math.max(1, Math.floor(page) || 1), 1000);
  const data = await call<{ total: number; items: Record<string, unknown>[] }>(a, 'finance_product_profitability', { p_from: cur.from, p_to: cur.to, p_sort: s, p_limit: 50, p_offset: (pg - 1) * 50 });
  return { range: cur, sort: s, page: pg, pageSize: 50, total: Number(data.total), items: data.items };
}

export async function getExpenseBreakdown(a: FinanceActor, r: { from: string; to: string }) {
  guard(a);
  const cur = range(r);
  const s = await summary(a, cur);
  const p = buildProfit(s);
  return { range: cur, byCategory: p.expenseByCategory, paymentFeesPaise: s.fee_paise, carrierCostConfirmedPaise: s.ship_cost_confirmed_paise, carrierCostEstimatedPaise: s.ship_cost_estimated_paise, operatingExpensesPaise: p.operatingExpensesPaise, excluded: p.excludedExpenses };
}

export async function getInventoryValuation(a: FinanceActor, expiryDays = 90, slowDays = 90): Promise<{ asOf: string; cost_value_paise: number; notes: string[]; [k: string]: number | string | string[] }> {
  guard(a);
  const raw = await call<Record<string, unknown>>(a, 'finance_inventory_valuation', { p_expiry_days: expiryDays, p_slow_days: slowDays });
  const { as_of, ...rest } = raw;
  const n = num(rest);
  return { ...n, cost_value_paise: n.cost_value_paise ?? 0, asOf: String(as_of), notes: ['Cost value uses the latest recorded unit cost; units with no cost on record are counted separately and not valued.', 'Selling value is shop price x units and is not an accounting value.', 'Inventory is valued as of today; past inventory values are not stored.'] };
}

export async function getRefundFinancialImpact(a: FinanceActor, r: { from: string; to: string }) {
  guard(a);
  const cur = range(r);
  const [s, detail] = await Promise.all([summary(a, cur), call<Record<string, unknown>>(a, 'finance_refund_impact', { p_from: cur.from, p_to: cur.to })]);
  return { range: cur, refundCount: s.refund_count, refundedPaise: s.refund_paise, refundRateBps: refundRateBps(s), pendingPaise: asPaise(detail.pending_paise), byReason: detail.by_reason, byMonth: detail.by_month };
}

export async function getCustomerPurchaseMetrics(a: FinanceActor, r: { from: string; to: string }) {
  guard(a);
  const cur = range(r);
  const m = await call<CustomerMetrics>(a, 'finance_customer_metrics', { p_from: cur.from, p_to: cur.to });
  return { range: cur, metrics: m, stats: customerStats(m) };
}

export async function getSalesForecast(a: FinanceActor, horizonDays = 30): Promise<Forecast> {
  guard(a);
  const today = todayIST();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 400 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const series = await call<DayPoint[]>(a, 'finance_daily_series', { p_from: from, p_to: to });
  return forecastRevenue(series.map((d) => ({ date: d.date, orders: Number(d.orders), net_paise: asPaise(d.net_paise), shipping_paise: asPaise(d.shipping_paise) })), today, Math.min(Math.max(7, horizonDays), 90));
}

export async function getDailySeries(a: FinanceActor, r: { from: string; to: string }) {
  guard(a);
  const cur = range(r);
  const s = await call<DayPoint[]>(a, 'finance_daily_series', { p_from: cur.from, p_to: cur.to });
  return s.map((d) => ({ date: d.date, orders: Number(d.orders), netPaise: asPaise(d.net_paise), shippingPaise: asPaise(d.shipping_paise) }));
}

export async function getKpiProgress(a: FinanceActor) {
  guard(a);
  const today = todayIST();
  const mr = { from: `${today.slice(0, 7)}-01`, to: new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) };
  const tr = await rest(a.db, 'financial_kpi_targets?select=kpi,target,updated_by,updated_at&limit=20');
  if (!tr.ok) throw new FinanceDbError('kpi targets');
  const rows = (await tr.json()) as { kpi: KpiKey; target: number | string; updated_at: string }[];
  const targets: Partial<Record<KpiKey, number>> = {};
  for (const t of rows) targets[t.kpi] = asPaise(t.target);
  const s = await summary(a, mr);
  const p = buildProfit(s);
  let turnover: number | null = null;
  if (targets.inventory_turnover_x100 !== undefined) {
    const inv = await getInventoryValuation(a);
    if (inv.cost_value_paise > 0 && p.status === 'complete') turnover = Math.round((s.cogs_paise * 100) / inv.cost_value_paise);
  }
  return {
    period: mr,
    rows: kpiRows(targets, { monthly_revenue_paise: p.netCollectedPaise, monthly_orders: p.orders, gross_margin_bps: p.grossMarginBps, refund_rate_bps: refundRateBps(s), inventory_turnover_x100: turnover }),
    notes: ['Targets are the ones you set; none are suggested or changed automatically.', 'Inventory turnover = cost of goods sold this month / current inventory cost value (history of inventory value is not stored).'],
  };
}
