/**
 * Phase 8 financial maths. Pure and deterministic: the database (supabase/finance.sql) returns integer building blocks in paise,
 * and everything here is composed from them with integer arithmetic only. Dashboard and CSV exports both call these functions,
 * so they cannot disagree. See docs/PHASE8_FINANCE.md for every definition.
 */

export const EXPENSE_CATEGORIES = ['packaging', 'shipping', 'advertising', 'marketing', 'software', 'payment_processing', 'warehouse', 'utilities', 'salaries', 'miscellaneous'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const COST_SOURCES = ['supplier_invoice', 'production_batch', 'owner_estimate', 'other'] as const;
export const KPI_KEYS = ['monthly_revenue_paise', 'monthly_orders', 'gross_margin_bps', 'refund_rate_bps', 'inventory_turnover_x100'] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

/** Categories that the order-level records (payment fees, carrier costs) already represent. */
const LEDGER_CATEGORIES: Record<string, 'fees' | 'shipping'> = { payment_processing: 'fees', shipping: 'shipping' };

export interface PeriodSummary {
  from: string;
  to: string;
  orders: number;
  units: number;
  gross_sales_paise: number;
  discount_paise: number;
  net_incl_tax_paise: number;
  gst_paise: number;
  shipping_charged_paise: number;
  cogs_paise: number;
  units_with_cost: number;
  units_without_cost: number;
  refund_count: number;
  refund_paise: number;
  fee_paise: number;
  fee_orders: number;
  ship_cost_confirmed_paise: number;
  ship_cost_estimated_paise: number;
  ship_cost_orders: number;
  online_orders: number;
  shipped_orders: number;
  expenses: Record<string, number>;
  cancelled_paid_without_refund: number;
}

/** bigint values come back from PostgREST as numbers; money in this shop stays far below 2^53 paise, and we check it. */
export const asPaise = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
  if (!Number.isSafeInteger(n)) throw new Error('money value is not a safe integer');
  return n;
};

/** Exact rupee text from integer paise: 123456 -> "1234.56". No floating point. */
export const rupees = (paise: number): string => {
  const neg = paise < 0;
  const a = Math.abs(paise);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

/** Integer basis points of part/whole, rounded half away from zero; null when the whole is not positive. */
export const bps = (part: number, whole: number): number | null => {
  if (whole <= 0) return null;
  const x = (Math.abs(part) * 10000) / whole;
  return Math.sign(part) * Math.round(x);
};
export const bpsText = (b: number | null): string => (b === null ? 'n/a' : `${(b / 100).toFixed(2)}%`);

/** Percent change in tenths of a percent, or null when there is no earlier figure to compare with. */
export const growthBps = (now: number, before: number): number | null => (before <= 0 ? null : bps(now - before, before));

export type ProfitStatus = 'complete' | 'partial' | 'unavailable';
export interface ProfitSummary {
  /** Revenue block */
  grossSalesPaise: number;
  discountsPaise: number;
  netMerchandiseInclTaxPaise: number;
  gstIncludedPaise: number;
  netSalesExTaxPaise: number;
  shippingChargedPaise: number;
  refundsPaise: number;
  /** Net collected = net merchandise (incl. GST) + shipping charged - refunds paid out in the period. Cash view, includes GST. */
  netCollectedPaise: number;
  orders: number;
  averageOrderPaise: number | null;
  /** Profit block (null when it cannot be stated) */
  cogsPaise: number;
  grossProfitPaise: number | null;
  grossMarginBps: number | null;
  operatingExpensesPaise: number;
  operatingProfitPaise: number | null;
  netProfitPaise: number | null;
  netMarginBps: number | null;
  status: ProfitStatus;
  message: string;
  /** What is missing, in words the owner can act on. */
  gaps: string[];
  /** Partial figures, labelled as such, for when status is not complete. */
  partial: { grossProfitPaise: number | null; operatingProfitPaise: number | null; coveredUnits: number; totalUnits: number } | null;
  excludedExpenses: { category: string; paise: number; reason: string }[];
  expenseByCategory: Record<string, number>;
  shippingContributionPaise: number | null;
  shippingEstimatedCostPaise: number;
}

/**
 * Definitions (all paise):
 *  net sales ex tax   = gross sales - discounts - GST included in the net amount
 *  gross profit       = net sales ex tax - refunds paid in the period - cost of goods sold
 *  operating expenses = payment fees + confirmed carrier costs + manual expenses (see below)
 *  operating profit   = gross profit + shipping charged - operating expenses
 *  net profit         = operating profit (no income tax or interest is modelled), only when cost data is complete
 * A manual expense in the category "payment_processing" or "shipping" is left out when order-level fee or carrier-cost records exist
 * for the period, because they describe the same money. It is listed in excludedExpenses so nothing disappears silently.
 */
export function buildProfit(s: PeriodSummary): ProfitSummary {
  const netSalesExTax = s.net_incl_tax_paise - s.gst_paise;
  const gaps: string[] = [];
  const excluded: ProfitSummary['excludedExpenses'] = [];
  let manual = 0;
  const byCat: Record<string, number> = {};
  for (const [cat, amt] of Object.entries(s.expenses)) {
    const amount = asPaise(amt);
    byCat[cat] = amount;
    const ledger = LEDGER_CATEGORIES[cat];
    if (ledger === 'fees' && s.fee_orders > 0) excluded.push({ category: cat, paise: amount, reason: 'Order-level payment fee records exist for this period; counting this entry too would count the fees twice.' });
    else if (ledger === 'shipping' && s.ship_cost_orders > 0) excluded.push({ category: cat, paise: amount, reason: 'Confirmed carrier costs exist for this period; counting this entry too would count shipping twice.' });
    else manual += amount;
  }
  const opex = s.fee_paise + s.ship_cost_confirmed_paise + manual;

  const unitsKnown = s.units > 0;
  const cogsComplete = unitsKnown && s.units_without_cost === 0;
  if (s.units_without_cost > 0) gaps.push(`${s.units_without_cost} of ${s.units} units sold have no cost on record.`);
  if (s.fee_orders < s.online_orders) gaps.push(`Payment fees are missing for ${s.online_orders - s.fee_orders} online order(s).`);
  if (s.ship_cost_orders < s.shipped_orders) gaps.push(`Confirmed carrier cost is missing for ${s.shipped_orders - s.ship_cost_orders} shipped order(s).`);
  if (s.cancelled_paid_without_refund > 0) gaps.push(`${s.cancelled_paid_without_refund} paid order(s) were cancelled with no refund on record; revenue still counts them.`);

  const grossProfit = cogsComplete ? netSalesExTax - s.refund_paise - s.cogs_paise : null;
  const operating = grossProfit === null ? null : grossProfit + s.shipping_charged_paise - opex;
  const allCosts = cogsComplete && s.fee_orders >= s.online_orders && s.ship_cost_orders >= s.shipped_orders;
  const net = allCosts ? operating : null;

  let status: ProfitStatus;
  let message: string;
  if (!unitsKnown) {
    status = 'unavailable';
    message = 'No sales in this period.';
  } else if (s.units_with_cost === 0) {
    status = 'unavailable';
    message = 'Profit unavailable: cost data incomplete.';
  } else if (allCosts) {
    status = 'complete';
    message = 'All recorded cost data is complete for this period.';
  } else {
    status = 'partial';
    message = 'Partial estimate: cost data incomplete. Do not treat these figures as final profit.';
  }

  let partial: ProfitSummary['partial'] = null;
  if (status === 'partial') {
    const coveredShare = s.units_with_cost; // cost covers these units only; the profit on the rest is unknown
    partial = {
      // Gross profit over the costed units only would need per-line sales; the product table shows that. Here we only offer
      // what is exact: revenue and recorded costs, never a made-up profit.
      grossProfitPaise: null,
      operatingProfitPaise: null,
      coveredUnits: coveredShare,
      totalUnits: s.units,
    };
  }

  return {
    grossSalesPaise: s.gross_sales_paise,
    discountsPaise: s.discount_paise,
    netMerchandiseInclTaxPaise: s.net_incl_tax_paise,
    gstIncludedPaise: s.gst_paise,
    netSalesExTaxPaise: netSalesExTax,
    shippingChargedPaise: s.shipping_charged_paise,
    refundsPaise: s.refund_paise,
    netCollectedPaise: s.net_incl_tax_paise + s.shipping_charged_paise - s.refund_paise,
    orders: s.orders,
    averageOrderPaise: s.orders > 0 ? Math.round((s.net_incl_tax_paise + s.shipping_charged_paise) / s.orders) : null,
    cogsPaise: s.cogs_paise,
    grossProfitPaise: grossProfit,
    grossMarginBps: grossProfit === null ? null : bps(grossProfit, netSalesExTax),
    operatingExpensesPaise: opex,
    operatingProfitPaise: operating,
    netProfitPaise: net,
    netMarginBps: net === null ? null : bps(net, netSalesExTax + s.shipping_charged_paise),
    status,
    message,
    gaps,
    partial,
    excludedExpenses: excluded,
    expenseByCategory: byCat,
    shippingContributionPaise: s.ship_cost_orders >= s.shipped_orders && s.shipped_orders > 0 ? s.shipping_charged_paise - s.ship_cost_confirmed_paise : null,
    shippingEstimatedCostPaise: s.ship_cost_estimated_paise,
  };
}

/** Refund rate = refund amount / (net merchandise + shipping) of the same period, in basis points. Refunds are dated by payout. */
export const refundRateBps = (s: PeriodSummary): number | null => bps(s.refund_paise, s.net_incl_tax_paise + s.shipping_charged_paise);

// ---- Customers ------------------------------------------------------------------------------------------------------------
export interface CustomerMetrics {
  customers: number; new_customers: number; returning_customers: number; orders: number; revenue_paise: number;
  repeat_customers_in_period: number; lifetime_customers: number; lifetime_repeat_customers: number; lifetime_orders: number; lifetime_revenue_paise: number;
  cohorts: { cohort: string; customers: number; orders: number; revenue_paise: number }[];
}
export function customerStats(m: CustomerMetrics) {
  return {
    repeatPurchaseRateBps: bps(m.lifetime_repeat_customers, m.lifetime_customers),
    averageOrderPaise: m.orders > 0 ? Math.round(m.revenue_paise / m.orders) : null,
    purchaseFrequencyX100: m.lifetime_customers > 0 ? Math.round((m.lifetime_orders * 100) / m.lifetime_customers) : null,
    /** Observed lifetime value so far: all paid, non-test spend / customers. It is history, not a prediction. */
    observedLifetimeValuePaise: m.lifetime_customers > 0 ? Math.round(m.lifetime_revenue_paise / m.lifetime_customers) : null,
    predictedLifetimeValuePaise: null as null,
  };
}

// ---- Forecast -------------------------------------------------------------------------------------------------------------
export interface DayPoint { date: string; orders: number; net_paise: number; shipping_paise: number }
export interface Forecast {
  status: 'ok' | 'insufficient';
  method: 'trailing_28_day_mean';
  horizonDays: number;
  basisFrom: string | null;
  basisTo: string | null;
  basisDays: number;
  expectedPaise: number | null;
  lowPaise: number | null;
  highPaise: number | null;
  trendVsPreviousBps: number | null;
  warnings: string[];
  label: string;
}
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const MIN_FORECAST_DAYS = 56;
export const MIN_ACTIVE_DAYS = 20;

/**
 * A transparent estimate, not a promise: the mean daily revenue of the last 28 days times the horizon. The band is +/- one standard
 * deviation of that total (daily standard deviation x sqrt(horizon)), floored at zero. It needs at least 56 calendar days of history
 * with at least 20 days that had a sale; otherwise it says so and gives no number. Days with no sales inside the history count as zero.
 */
export function forecastRevenue(series: DayPoint[], today: string, horizonDays = 30): Forecast {
  const warnings: string[] = [];
  const base = { method: 'trailing_28_day_mean' as const, horizonDays, label: 'Estimate from past sales, not guaranteed. Prediction only.' };
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return { ...base, status: 'insufficient', basisFrom: null, basisTo: null, basisDays: 0, expectedPaise: null, lowPaise: null, highPaise: null, trendVsPreviousBps: null, warnings: ['No sales history yet.'] };
  const first = sorted[0].date;
  const spanDays = Math.round((Date.parse(`${addDays(today, 0)}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000);
  const active = sorted.filter((d) => d.net_paise > 0).length;
  if (spanDays < MIN_FORECAST_DAYS || active < MIN_ACTIVE_DAYS) {
    return { ...base, status: 'insufficient', basisFrom: first, basisTo: sorted[sorted.length - 1].date, basisDays: spanDays, expectedPaise: null, lowPaise: null, highPaise: null, trendVsPreviousBps: null,
      warnings: [`Needs at least ${MIN_FORECAST_DAYS} days of history with sales on at least ${MIN_ACTIVE_DAYS} days; there are ${spanDays} days and ${active} days with sales.`] };
  }
  const byDate = new Map(sorted.map((d) => [d.date, d.net_paise + d.shipping_paise]));
  const daily = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => byDate.get(addDays(today, -(from + i))) ?? 0);
  const last = daily(1, 28); // yesterday back 28 days; today is incomplete and left out
  const prev = daily(29, 28);
  const mean = last.reduce((a, b) => a + b, 0) / 28;
  const variance = last.reduce((a, b) => a + (b - mean) ** 2, 0) / 27;
  const sd = Math.sqrt(variance);
  const expected = Math.round(mean * horizonDays);
  const spread = Math.round(sd * Math.sqrt(horizonDays));
  const prevMean = prev.reduce((a, b) => a + b, 0) / 28;
  if (spanDays < 120) warnings.push('Less than four months of history: seasonal patterns cannot be seen.');
  if (last.filter((d) => d > 0).length < 14) warnings.push('Fewer than 14 of the last 28 days had sales; the estimate is very uncertain.');
  return { ...base, status: 'ok', basisFrom: addDays(today, -28), basisTo: addDays(today, -1), basisDays: 28, expectedPaise: expected, lowPaise: Math.max(0, expected - spread), highPaise: expected + spread,
    trendVsPreviousBps: prevMean > 0 ? bps(Math.round(mean - prevMean), Math.round(prevMean)) : null, warnings };
}

// ---- KPI targets ----------------------------------------------------------------------------------------------------------
export interface KpiRow { kpi: KpiKey; target: number; actual: number | null; varianceAbs: number | null; progressBps: number | null; lowerIsBetter: boolean }
export function kpiRows(targets: Partial<Record<KpiKey, number>>, actual: Partial<Record<KpiKey, number | null>>): KpiRow[] {
  const out: KpiRow[] = [];
  for (const k of KPI_KEYS) {
    const t = targets[k];
    if (t === undefined) continue; // never invent a target
    const a = actual[k] ?? null;
    const lowerIsBetter = k === 'refund_rate_bps';
    out.push({ kpi: k, target: t, actual: a, varianceAbs: a === null ? null : a - t, progressBps: a === null ? null : lowerIsBetter ? bps(Math.max(0, t - a), t) : bps(a, t), lowerIsBetter });
  }
  return out;
}

// ---- Validation -----------------------------------------------------------------------------------------------------------
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
/** Parses a rupee amount typed by a person ("1234", "1234.5", "1,234.50") to integer paise, or null. No floating point. */
export function parseRupees(v: unknown): number | null {
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v.replace(/,/g, '').trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}
export const MAX_RANGE_DAYS = 800;
export function parseRange(from: unknown, to: unknown): { from: string; to: string } | null {
  if (!isDate(from) || !isDate(to) || to <= from) return null;
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > MAX_RANGE_DAYS) return null;
  return { from, to };
}
/** Preset ranges as India dates; `to` is exclusive. */
export function presetRange(preset: string, todayIst: string): { from: string; to: string } | null {
  const tomorrow = addDays(todayIst, 1);
  const [y, m] = todayIst.split('-').map(Number);
  const monthStart = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  switch (preset) {
    case 'today': return { from: todayIst, to: tomorrow };
    case 'yesterday': return { from: addDays(todayIst, -1), to: todayIst };
    case 'last7': return { from: addDays(todayIst, -6), to: tomorrow };
    case 'last30': return { from: addDays(todayIst, -29), to: tomorrow };
    case 'this_month': return { from: monthStart(y, m), to: tomorrow };
    case 'last_month': return m === 1 ? { from: monthStart(y - 1, 12), to: monthStart(y, 1) } : { from: monthStart(y, m - 1), to: monthStart(y, m) };
    case 'this_year': return { from: `${y}-01-01`, to: tomorrow };
    default: return null;
  }
}
export const previousRange = (r: { from: string; to: string }): { from: string; to: string } => {
  const days = Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86400000);
  return { from: addDays(r.from, -days), to: r.from };
};

export interface ExpenseInput { id: string | null; date: string; category: ExpenseCategory; amountPaise: number; description: string; vendor: string; reference: string }
export function validateExpense(b: Record<string, unknown>, todayIst: string): { ok: true; value: ExpenseInput } | { ok: false; message: string } {
  const date = b.date;
  if (!isDate(date) || date > todayIst) return { ok: false, message: 'Enter a valid expense date that is not in the future.' };
  if (!EXPENSE_CATEGORIES.includes(b.category as ExpenseCategory)) return { ok: false, message: 'Choose an expense category.' };
  const amount = parseRupees(b.amount);
  if (amount === null || amount <= 0) return { ok: false, message: 'Enter the amount in rupees, for example 1250.50.' };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length < 3 || description.length > 300) return { ok: false, message: 'Describe the expense in 3 to 300 characters.' };
  const vendor = typeof b.vendor === 'string' ? b.vendor.trim() : '';
  const reference = typeof b.reference === 'string' ? b.reference.trim() : '';
  if (vendor.length > 120 || reference.length > 80) return { ok: false, message: 'Vendor or reference is too long.' };
  const id = typeof b.id === 'string' && b.id ? b.id : null;
  return { ok: true, value: { id, date, category: b.category as ExpenseCategory, amountPaise: amount, description, vendor, reference } };
}

export interface CostInput { variantId: string; purchase: number; manufacturing: number; packaging: number; other: number; effectiveFrom: string; source: (typeof COST_SOURCES)[number]; note: string }
export function validateCost(b: Record<string, unknown>, nowIso: string): { ok: true; value: CostInput } | { ok: false; message: string } {
  const pr = [parseRupees(b.purchase ?? '0'), parseRupees(b.manufacturing ?? '0'), parseRupees(b.packaging ?? '0'), parseRupees(b.other ?? '0')];
  if (pr.some((v) => v === null)) return { ok: false, message: 'Costs must be rupee amounts such as 120 or 120.50.' };
  const [purchase, manufacturing, packaging, other] = pr as [number, number, number, number];
  if (purchase + manufacturing + packaging + other <= 0) return { ok: false, message: 'Enter at least one cost above zero.' };
  if ([purchase, manufacturing, packaging, other].some((v) => v > 100000000)) return { ok: false, message: 'A cost is too large.' };
  if (typeof b.variantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.variantId)) return { ok: false, message: 'Choose a pack size.' };
  if (!COST_SOURCES.includes(b.source as never)) return { ok: false, message: 'Choose where this cost came from.' };
  const eff = typeof b.effectiveFrom === 'string' ? Date.parse(b.effectiveFrom.length === 10 ? `${b.effectiveFrom}T00:00:00+05:30` : b.effectiveFrom) : NaN;
  if (Number.isNaN(eff) || eff > Date.parse(nowIso) + 86400000) return { ok: false, message: 'Enter the date this cost took effect (not in the future).' };
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > 300) return { ok: false, message: 'The note is too long.' };
  return { ok: true, value: { variantId: b.variantId, purchase, manufacturing, packaging, other, effectiveFrom: new Date(eff).toISOString(), source: b.source as CostInput['source'], note } };
}

// ---- CSV ------------------------------------------------------------------------------------------------------------------
/** Quote a cell. Text that a spreadsheet could run as a formula gets a leading apostrophe; numbers are written as they are. */
export function financeCell(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function financeCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return [headers.map(financeCell).join(','), ...rows.map((r) => headers.map((h) => financeCell(r[h])).join(','))].join('\r\n') + '\r\n';
}
export const EXPORT_ROW_CAP = 5000;
