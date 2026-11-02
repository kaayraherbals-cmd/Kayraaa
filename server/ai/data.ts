import { pctChange, parseDays, type AnalyticsDays } from '../../shared/analytics.js';
import { delayedShipments, refundQueue } from '../../shared/aiAnalytics.js';
import { bpsText, rupees } from '../../shared/finance.js';
import { todayIST } from '../../shared/inventory.js';
import { can, type AdminRole } from '../../shared/roles.js';
import { loadAnalytics } from '../analyticsService.js';
import { FinanceDbError, FinanceDenied, getInventoryValuation, getProfitSummary, getRefundFinancialImpact, getRevenueSummary, getSalesForecast } from '../financeService.js';
import { rest, type SupabaseConfig } from '../supabase.js';

/**
 * Read-only business figures for Kaayra Intelligence. Nothing here is calculated a second way: money comes from the finance service
 * (server/financeService.ts, owner only, the same numbers as the Business Intelligence screens), sales and stock health from the same
 * analytics code as the Analytics screens, and the model only ever sees the formatted result. The model has no SQL, no tools and no key.
 * A section the caller's role may not read is left out, a section that fails says so, and nothing is filled with a guess.
 * No customer name, email, phone or address is selected anywhere in this file.
 */
const inr = (paise: number): string => `₹${rupees(paise)}`;
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface Snapshot {
  today: string;
  /** Owner only (finance.read). Same definitions as Business Intelligence: revenue is recognised when an order is paid, refunds when paid out. */
  finance?: {
    today: { netCollected: string; orders: number };
    last7Days: { netCollected: string; orders: number; averageOrder: string | null; growthVsPrevious7Days: string | null };
    last30Days: { netCollected: string; orders: number; averageOrder: string | null; refundsPaid: string; profitStatus: string; profitMessage: string; gaps: string[]; grossProfit: string | null; grossMargin: string | null; netProfit: string | null };
    refundsLast30Days?: { count: number; paid: string; ratePercent: string | null; pending: string };
    inventoryValue?: { costValue: string; unitsWithoutCost: number; expiredUnits: number; expiringUnits: number; expiringWithinDays: number; lowStockPackSizes: number; slowMovingUnits: number; slowWindowDays: number };
    salesForecast?: { status: string; label: string; expected: string | null; low: string | null; high: string | null; warnings: string[] };
    notes: string[];
  };
  /** Orders placed and not cancelled (the Analytics screens' definition), before refunds. */
  sales?: {
    windowDays: number;
    orders: number;
    revenue: string;
    averageOrder: string | null;
    cancelled: number;
    revenueChangeVsPreviousPeriod: string | null;
    topProducts: { name: string; units: number; revenue: string }[];
    awaitingPayment: number;
    paidToFulfil: number;
    note: string;
  };
  inventory?: {
    packSizes: number;
    sellableUnitsOnHand: number;
    outOfStock: { product: string; pack: string }[];
    lowStock: { product: string; pack: string; units: number }[];
    expiredUnits: number;
    expiringUnits: number;
    roughDaysOfCover: { product: string; pack: string; units: number; days: number }[];
    note: string;
  };
  operations?: {
    shipments?: { delayed: { shipment_no: string; status: string; daysLate: number }[]; inMotion: number };
    refundQueue?: { awaitingDecision: number; approvedNotYetPaid: number };
    paymentsNeedingReview?: number;
  };
  /** Sections left out because the role may not read them, or the data could not be read. Never filled with guesses. */
  unavailableSections: string[];
  /** Sections cut off at a row cap: their figures may be understated. */
  incompleteSections: string[];
}

async function count(db: SupabaseConfig, path: string): Promise<number | null> {
  try {
    const r = await rest(db, path, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) return null;
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
async function list<T>(db: SupabaseConfig, path: string): Promise<T[] | null> {
  try {
    const r = await rest(db, path);
    return r.ok ? ((await r.json()) as T[]) : null;
  } catch {
    return null;
  }
}

/** Runs one section. Only the error kind is logged, never a value. */
async function section<T>(label: string, unavailable: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof FinanceDenied)) console.error(`ai snapshot ${label} failed`, e instanceof FinanceDbError ? 'database' : e instanceof Error ? e.name : 'error');
    unavailable.push(label);
    return null;
  }
}

export async function loadSnapshot(db: SupabaseConfig, role: AdminRole, nowMs = Date.now(), windowDays: AnalyticsDays = parseDays(30)): Promise<Snapshot> {
  const today = todayIST(nowMs);
  const unavailable: string[] = [];
  const incomplete: string[] = [];
  const snap: Snapshot = { today, unavailableSections: unavailable, incompleteSections: incomplete };
  const tomorrow = addDays(today, 1);

  // ---- finance (owner) -------------------------------------------------------------------------------------------
  if (can(role, 'finance.read')) {
    const actor = { db, role };
    const [d1, d7, p30, refunds, valuation, forecast] = await Promise.all([
      section('finance: today', unavailable, () => getRevenueSummary(actor, { from: today, to: tomorrow })),
      section('finance: last 7 days', unavailable, () => getRevenueSummary(actor, { from: addDays(today, -6), to: tomorrow })),
      section('finance: last 30 days and profit', unavailable, () => getProfitSummary(actor, { from: addDays(today, -29), to: tomorrow })),
      section('finance: refunds', unavailable, () => getRefundFinancialImpact(actor, { from: addDays(today, -29), to: tomorrow })),
      section('finance: inventory value', unavailable, () => getInventoryValuation(actor)),
      section('finance: sales forecast', unavailable, () => getSalesForecast(actor, 30)),
    ]);
    if (d1 && d7 && p30) {
      const p = p30.profit;
      snap.finance = {
        today: { netCollected: inr(d1.revenue.netCollectedPaise), orders: d1.revenue.orders },
        last7Days: { netCollected: inr(d7.revenue.netCollectedPaise), orders: d7.revenue.orders, averageOrder: d7.revenue.averageOrderPaise === null ? null : inr(d7.revenue.averageOrderPaise), growthVsPrevious7Days: d7.growth.netCollectedBps === null ? null : bpsText(d7.growth.netCollectedBps) },
        last30Days: {
          netCollected: inr(p.netCollectedPaise), orders: p.orders, averageOrder: p.averageOrderPaise === null ? null : inr(p.averageOrderPaise), refundsPaid: inr(p.refundsPaise),
          // Profit is passed through exactly as the Business Intelligence screen states it: figures only when the cost data is complete.
          profitStatus: p.status, profitMessage: p.message, gaps: p.gaps,
          grossProfit: p.grossProfitPaise === null ? null : inr(p.grossProfitPaise), grossMargin: p.grossMarginBps === null ? null : bpsText(p.grossMarginBps), netProfit: p.netProfitPaise === null ? null : inr(p.netProfitPaise),
        },
        notes: ['Net collected = sales including GST and shipping, minus refunds paid out. Revenue counts an order when it is first paid.'],
      };
      if (refunds) snap.finance.refundsLast30Days = { count: refunds.refundCount, paid: inr(refunds.refundedPaise), ratePercent: refunds.refundRateBps === null ? null : bpsText(refunds.refundRateBps), pending: inr(refunds.pendingPaise) };
      if (valuation) {
        const v = valuation as Record<string, number>;
        snap.finance.inventoryValue = { costValue: inr(v.cost_value_paise ?? 0), unitsWithoutCost: v.units_without_cost ?? 0, expiredUnits: v.expired_units ?? 0, expiringUnits: v.expiring_units ?? 0, expiringWithinDays: v.expiry_window_days ?? 0, lowStockPackSizes: v.low_stock_variants ?? 0, slowMovingUnits: v.slow_units ?? 0, slowWindowDays: v.slow_window_days ?? 0 };
      }
      if (forecast) snap.finance.salesForecast = { status: forecast.status, label: forecast.label, expected: forecast.expectedPaise === null ? null : inr(forecast.expectedPaise), low: forecast.lowPaise === null ? null : inr(forecast.lowPaise), high: forecast.highPaise === null ? null : inr(forecast.highPaise), warnings: forecast.warnings };
    } else if (!unavailable.some((u) => u.startsWith('finance'))) unavailable.push('finance');
  } else unavailable.push('finance and profit (owner only)');

  // ---- sales and stock health (same code as the Analytics screens) ----------------------------------------------------
  const a = await loadAnalytics(db, role, windowDays, nowMs);
  for (const f of a.failed) unavailable.push(f.area.toLowerCase());
  if (a.sales) {
    const [awaiting, toFulfil] = await Promise.all([count(db, 'orders?select=id&is_test=eq.false&status=eq.placed&limit=1'), count(db, 'orders?select=id&is_test=eq.false&status=in.(paid,packed)&limit=1')]);
    if (a.sales.truncated) incomplete.push('sales');
    const c = a.sales.current;
    snap.sales = {
      windowDays,
      orders: c.orders,
      revenue: inr(c.revenue),
      averageOrder: c.orders > 0 ? inr(c.aov) : null,
      cancelled: c.cancelled,
      revenueChangeVsPreviousPeriod: pctChange(c.revenue, a.sales.previous.revenue) === null ? null : `${pctChange(c.revenue, a.sales.previous.revenue)}%`,
      topProducts: a.sales.topProducts.slice(0, 5).map((t) => ({ name: t.name, units: t.units, revenue: inr(t.revenue) })),
      awaitingPayment: awaiting ?? 0,
      paidToFulfil: toFulfil ?? 0,
      note: 'Orders placed in the period that were not cancelled, before refunds (the Analytics screens\' definition). The Finance section is the cash view.',
    };
    if (awaiting === null || toFulfil === null) unavailable.push('order queue counts');
  } else if (!can(role, 'orders.read')) unavailable.push('sales (your role cannot read orders)');
  if (a.stock) {
    const s = a.stock;
    snap.inventory = {
      packSizes: s.skus,
      sellableUnitsOnHand: s.units,
      outOfStock: s.lines.filter((l) => l.state === 'out').map((l) => ({ product: l.product, pack: l.pack_size })).slice(0, 15),
      lowStock: s.lines.filter((l) => l.state === 'low').map((l) => ({ product: l.product, pack: l.pack_size, units: l.units })).slice(0, 15),
      expiredUnits: s.expired,
      expiringUnits: s.expiring,
      roughDaysOfCover: s.lines.filter((l) => l.daysCover !== null && l.units > 0).sort((x, y) => (x.daysCover ?? 0) - (y.daysCover ?? 0)).slice(0, 8).map((l) => ({ product: l.product, pack: l.pack_size, units: l.units, days: l.daysCover ?? 0 })),
      note: 'Days of cover is a rough guide from the sales of the last period, not a forecast. Nothing here changes stock, prices or purchase orders.',
    };
  } else if (!can(role, 'inventory.read')) unavailable.push('inventory (your role cannot read stock)');

  // ---- operations ----------------------------------------------------------------------------------------------
  const ops: NonNullable<Snapshot['operations']> = {};
  if (can(role, 'shipments.read')) {
    const s = await list<{ shipment_no: string; status: string; estimated_delivery: string | null; dispatched_at: string | null }>(db, 'shipments?select=shipment_no,status,estimated_delivery,dispatched_at&status=in.(dispatched,in_transit,out_for_delivery,delivery_failed)&limit=500');
    if (s) ops.shipments = { delayed: delayedShipments(s, today).slice(0, 10), inMotion: s.filter((x) => x.status !== 'delivery_failed').length };
    else unavailable.push('shipments');
  } else unavailable.push('shipments (your role cannot read shipments)');
  if (can(role, 'refunds.read')) {
    const r = await list<{ status: string }>(db, 'order_refunds?select=status&status=in.(requested,approved)&limit=1000');
    if (r) ops.refundQueue = refundQueue(r); else unavailable.push('refund queue');
  } else unavailable.push('refund queue (your role cannot read refunds)');
  if (can(role, 'payments.read')) {
    const n = await count(db, 'order_payments?select=id&flagged=not.is.null&limit=1');
    if (n === null) unavailable.push('payment reviews'); else ops.paymentsNeedingReview = n;
  } else unavailable.push('payment reviews (your role cannot read payments)');
  if (Object.keys(ops).length > 0) snap.operations = ops;
  return snap;
}

/** True when there is nothing to report yet: the dashboard then says "Not enough data available yet." */
export const snapshotIsEmpty = (s: Snapshot): boolean =>
  (!s.finance || (s.finance.last30Days.orders === 0 && s.finance.last7Days.orders === 0)) &&
  (!s.sales || (s.sales.orders === 0 && s.sales.awaitingPayment === 0 && s.sales.paidToFulfil === 0)) &&
  (!s.inventory || s.inventory.packSizes === 0);
