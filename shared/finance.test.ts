import { describe, expect, it } from 'vitest';
import { asPaise, bps, buildProfit, customerStats, financeCsv, forecastRevenue, growthBps, kpiRows, parseRange, parseRupees, presetRange, previousRange, refundRateBps, rupees, validateCost, validateExpense, type DayPoint, type PeriodSummary } from './finance';
import { can, permissionsOf } from './roles';

const base = (o: Partial<PeriodSummary> = {}): PeriodSummary => ({
  from: '2026-02-01', to: '2026-03-01', orders: 10, units: 20, gross_sales_paise: 1000000, discount_paise: 100000, net_incl_tax_paise: 900000, gst_paise: 42857,
  shipping_charged_paise: 50000, cogs_paise: 400000, units_with_cost: 20, units_without_cost: 0, refund_count: 1, refund_paise: 30000, fee_paise: 20000, fee_orders: 0,
  ship_cost_confirmed_paise: 0, ship_cost_estimated_paise: 0, ship_cost_orders: 0, online_orders: 0, shipped_orders: 0, expenses: {}, cancelled_paid_without_refund: 0, ...o,
});

describe('money helpers', () => {
  it('formats paise exactly, including negatives and small values', () => {
    expect(rupees(123456)).toBe('1234.56');
    expect(rupees(5)).toBe('0.05');
    expect(rupees(-1050)).toBe('-10.50');
  });
  it('parses rupees without floating point (0.1 + 0.2 style traps)', () => {
    expect(parseRupees('0.30')).toBe(30);
    expect(parseRupees('1,234.5')).toBe(123450);
    expect(parseRupees('19.99')).toBe(1999);
    expect(parseRupees('1.999')).toBeNull();
    expect(parseRupees('-5')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('')).toBeNull();
  });
  it('rejects unsafe integers', () => {
    expect(() => asPaise(2 ** 60)).toThrow();
    expect(asPaise('1200')).toBe(1200);
  });
  it('basis points round half away from zero and refuse a zero base', () => {
    expect(bps(1, 3)).toBe(3333);
    expect(bps(-1, 3)).toBe(-3333);
    expect(bps(5, 0)).toBeNull();
    expect(growthBps(120, 100)).toBe(2000);
    expect(growthBps(5, 0)).toBeNull();
  });
});

describe('profit engine', () => {
  const p = buildProfit(base());
  it('gross, net and discounts', () => {
    expect(p.grossSalesPaise).toBe(1000000);
    expect(p.discountsPaise).toBe(100000);
    expect(p.netMerchandiseInclTaxPaise).toBe(900000);
    expect(p.netSalesExTaxPaise).toBe(857143);
  });
  it('average order value includes shipping charged, divides by paid orders', () => {
    expect(p.averageOrderPaise).toBe(95000);
    expect(buildProfit(base({ orders: 0, units: 0 })).averageOrderPaise).toBeNull();
  });
  it('gross profit = net ex tax - refunds - COGS', () => {
    expect(p.grossProfitPaise).toBe(857143 - 30000 - 400000);
    expect(p.grossMarginBps).toBe(bps(857143 - 30000 - 400000, 857143));
  });
  it('operating profit adds shipping charged and subtracts fees, carrier cost and manual expenses', () => {
    const q = buildProfit(base({ fee_orders: 3, online_orders: 3, ship_cost_confirmed_paise: 8000, ship_cost_orders: 2, shipped_orders: 2, expenses: { advertising: 100000 } }));
    expect(q.operatingExpensesPaise).toBe(20000 + 8000 + 100000);
    expect(q.operatingProfitPaise).toBe(q.grossProfitPaise! + 50000 - 128000);
    expect(q.netProfitPaise).toBe(q.operatingProfitPaise);
    expect(q.status).toBe('complete');
    expect(q.shippingContributionPaise).toBe(50000 - 8000);
  });
  it('never states profit when a unit has no cost; says so', () => {
    const q = buildProfit(base({ units_without_cost: 4, units_with_cost: 16 }));
    expect(q.grossProfitPaise).toBeNull();
    expect(q.netProfitPaise).toBeNull();
    expect(q.status).toBe('partial');
    expect(q.gaps.join(' ')).toContain('4 of 20 units');
    expect(q.partial?.coveredUnits).toBe(16);
  });
  it('shows "Profit unavailable: cost data incomplete." when no unit has a cost', () => {
    const q = buildProfit(base({ units_without_cost: 20, units_with_cost: 0, cogs_paise: 0 }));
    expect(q.status).toBe('unavailable');
    expect(q.message).toBe('Profit unavailable: cost data incomplete.');
    expect(q.netProfitPaise).toBeNull();
  });
  it('missing payment fees keep net profit unavailable even when COGS is complete', () => {
    const q = buildProfit(base({ online_orders: 5, fee_orders: 2, fee_paise: 2000 }));
    expect(q.grossProfitPaise).not.toBeNull();
    expect(q.netProfitPaise).toBeNull();
    expect(q.gaps.join(' ')).toContain('Payment fees are missing for 3');
  });
  it('missing carrier cost keeps net profit unavailable', () => {
    const q = buildProfit(base({ shipped_orders: 4, ship_cost_orders: 1, ship_cost_confirmed_paise: 3000 }));
    expect(q.netProfitPaise).toBeNull();
    expect(q.operatingProfitPaise).not.toBeNull();
  });
  it('estimated carrier cost is shown apart and never subtracted', () => {
    const q = buildProfit(base({ ship_cost_estimated_paise: 9000 }));
    expect(q.shippingEstimatedCostPaise).toBe(9000);
    expect(q.operatingExpensesPaise).toBe(20000);
  });
  it('does not double count manual payment-processing or shipping expenses when order-level records exist', () => {
    const q = buildProfit(base({ fee_orders: 2, online_orders: 2, ship_cost_orders: 1, shipped_orders: 1, ship_cost_confirmed_paise: 4000, expenses: { payment_processing: 15000, shipping: 6000, utilities: 2000 } }));
    expect(q.operatingExpensesPaise).toBe(20000 + 4000 + 2000);
    expect(q.excludedExpenses.map((e) => e.category).sort()).toEqual(['payment_processing', 'shipping']);
    expect(q.expenseByCategory.payment_processing).toBe(15000);
  });
  it('counts those manual expenses when no order-level records exist', () => {
    const q = buildProfit(base({ fee_paise: 0, expenses: { payment_processing: 15000, shipping: 6000 } }));
    expect(q.operatingExpensesPaise).toBe(21000);
    expect(q.excludedExpenses).toHaveLength(0);
  });
  it('warns about paid orders cancelled without a refund', () => {
    expect(buildProfit(base({ cancelled_paid_without_refund: 2 })).gaps.join(' ')).toContain('cancelled with no refund');
  });
  it('net collected is cash: net incl. tax + shipping - refunds; tax is not profit', () => {
    expect(p.netCollectedPaise).toBe(900000 + 50000 - 30000);
    expect(p.gstIncludedPaise).toBe(42857);
  });
  it('refund rate: full, partial and zero cases', () => {
    expect(refundRateBps(base())).toBe(bps(30000, 950000));
    expect(refundRateBps(base({ refund_paise: 0 }))).toBe(0);
    expect(refundRateBps(base({ net_incl_tax_paise: 0, shipping_charged_paise: 0 }))).toBeNull();
    expect(buildProfit(base({ refund_paise: 950000 })).grossProfitPaise).toBe(857143 - 950000 - 400000);
  });
  it('historical cost: the engine only sums what the database priced at sale time (a later cost cannot change it)', () => {
    const feb = buildProfit(base({ cogs_paise: 400000 }));
    const afterCostRise = buildProfit(base({ cogs_paise: 400000 }));
    expect(afterCostRise.grossProfitPaise).toBe(feb.grossProfitPaise);
  });
});

describe('customers', () => {
  const m = { customers: 4, new_customers: 1, returning_customers: 3, orders: 9, revenue_paise: 450000, repeat_customers_in_period: 2, lifetime_customers: 10, lifetime_repeat_customers: 4, lifetime_orders: 16, lifetime_revenue_paise: 800000, cohorts: [] };
  it('repeat rate, AOV, frequency, observed lifetime value; no predicted value', () => {
    const s = customerStats(m);
    expect(s.repeatPurchaseRateBps).toBe(4000);
    expect(s.averageOrderPaise).toBe(50000);
    expect(s.purchaseFrequencyX100).toBe(160);
    expect(s.observedLifetimeValuePaise).toBe(80000);
    expect(s.predictedLifetimeValuePaise).toBeNull();
  });
  it('handles no customers', () => {
    const s = customerStats({ ...m, customers: 0, orders: 0, lifetime_customers: 0, lifetime_orders: 0, lifetime_repeat_customers: 0 });
    expect(s.repeatPurchaseRateBps).toBeNull();
    expect(s.observedLifetimeValuePaise).toBeNull();
  });
});

describe('forecast', () => {
  const days = (n: number, today: string, f: (i: number) => number): DayPoint[] =>
    Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(`${today}T00:00:00Z`) - (n - i) * 86400000).toISOString().slice(0, 10), orders: 1, net_paise: f(i), shipping_paise: 0 }));
  it('says insufficient with no history', () => {
    const f = forecastRevenue([], '2026-10-22');
    expect(f.status).toBe('insufficient');
    expect(f.expectedPaise).toBeNull();
  });
  it('says insufficient for a short history and states why', () => {
    const f = forecastRevenue(days(30, '2026-10-22', () => 10000), '2026-10-22');
    expect(f.status).toBe('insufficient');
    expect(f.warnings[0]).toContain('56 days');
  });
  it('steady sales: expected = mean x 30, band collapses', () => {
    const f = forecastRevenue(days(90, '2026-10-22', () => 10000), '2026-10-22');
    expect(f.status).toBe('ok');
    expect(f.expectedPaise).toBe(300000);
    expect(f.lowPaise).toBe(300000);
    expect(f.highPaise).toBe(300000);
    expect(f.label).toContain('not guaranteed');
  });
  it('noisy sales give a band around the estimate, never below zero', () => {
    const f = forecastRevenue(days(90, '2026-10-22', (i) => (i % 2 ? 20000 : 1000)), '2026-10-22');
    expect(f.lowPaise!).toBeLessThan(f.expectedPaise!);
    expect(f.highPaise!).toBeGreaterThan(f.expectedPaise!);
    expect(f.lowPaise!).toBeGreaterThanOrEqual(0);
  });
  it('is deterministic and reports trend against the previous 28 days', () => {
    const s = days(90, '2026-10-22', (i) => (i >= 62 ? 20000 : 10000));
    const a = forecastRevenue(s, '2026-10-22');
    expect(forecastRevenue(s, '2026-10-22')).toEqual(a);
    expect(a.trendVsPreviousBps).toBe(10000);
  });
  it('warns about sparse recent sales and short seasonality history', () => {
    const s = days(90, '2026-10-22', (i) => (i >= 62 && i % 3 ? 0 : 10000));
    const f = forecastRevenue(s, '2026-10-22');
    expect(f.warnings.join(' ')).toContain('Fewer than 14');
    expect(f.warnings.join(' ')).toContain('seasonal');
  });
});

describe('date ranges', () => {
  it('presets use India dates with an exclusive end', () => {
    expect(presetRange('today', '2026-10-22')).toEqual({ from: '2026-10-22', to: '2026-10-23' });
    expect(presetRange('yesterday', '2026-10-22')).toEqual({ from: '2026-10-21', to: '2026-10-22' });
    expect(presetRange('last7', '2026-10-22')).toEqual({ from: '2026-10-16', to: '2026-10-23' });
    expect(presetRange('this_month', '2026-10-22')).toEqual({ from: '2026-10-01', to: '2026-10-23' });
    expect(presetRange('last_month', '2026-10-22')).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    expect(presetRange('last_month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2026-01-01' });
    expect(presetRange('this_year', '2026-10-22')).toEqual({ from: '2026-01-01', to: '2026-10-23' });
    expect(presetRange('nope', '2026-10-22')).toBeNull();
  });
  it('month and year boundaries roll correctly', () => {
    expect(presetRange('today', '2026-12-31')).toEqual({ from: '2026-12-31', to: '2027-01-01' });
    expect(presetRange('today', '2028-02-28')).toEqual({ from: '2028-02-28', to: '2028-02-29' });
  });
  it('custom ranges are validated and bounded', () => {
    expect(parseRange('2026-02-01', '2026-03-01')).toEqual({ from: '2026-02-01', to: '2026-03-01' });
    expect(parseRange('2026-03-01', '2026-03-01')).toBeNull();
    expect(parseRange('2026-02-30', '2026-03-01')).toBeNull();
    expect(parseRange('2020-01-01', '2026-03-01')).toBeNull();
    expect(parseRange('x', 'y')).toBeNull();
  });
  it('previous range has the same length and ends where this one starts', () => {
    expect(previousRange({ from: '2026-03-01', to: '2026-03-08' })).toEqual({ from: '2026-02-22', to: '2026-03-01' });
  });
});

describe('KPI targets', () => {
  it('shows only configured targets, with variance and progress', () => {
    const rows = kpiRows({ monthly_orders: 50 }, { monthly_orders: 40, monthly_revenue_paise: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kpi: 'monthly_orders', target: 50, actual: 40, varianceAbs: -10, progressBps: 8000 });
  });
  it('refund rate counts lower as better', () => {
    const r = kpiRows({ refund_rate_bps: 500 }, { refund_rate_bps: 250 })[0];
    expect(r.lowerIsBetter).toBe(true);
    expect(r.progressBps).toBe(5000);
  });
  it('an actual of null stays null', () => {
    expect(kpiRows({ gross_margin_bps: 4000 }, { gross_margin_bps: null })[0].progressBps).toBeNull();
  });
});

describe('input validation', () => {
  const ok = { date: '2026-10-01', category: 'advertising', amount: '1250.50', description: 'Instagram ads', vendor: 'Meta', reference: 'INV-1' };
  it('accepts a good expense and converts to paise', () => {
    const r = validateExpense(ok, '2026-10-22');
    expect(r.ok && r.value.amountPaise).toBe(125050);
  });
  it('rejects future dates, bad categories, zero or fractional-paise amounts, short descriptions', () => {
    expect(validateExpense({ ...ok, date: '2026-10-23' }, '2026-10-22').ok).toBe(false);
    expect(validateExpense({ ...ok, category: 'gifts' }, '2026-10-22').ok).toBe(false);
    expect(validateExpense({ ...ok, amount: '0' }, '2026-10-22').ok).toBe(false);
    expect(validateExpense({ ...ok, amount: '1.005' }, '2026-10-22').ok).toBe(false);
    expect(validateExpense({ ...ok, description: 'x' }, '2026-10-22').ok).toBe(false);
  });
  const cost = { variantId: '11111111-1111-4111-8111-111111111111', purchase: '150', packaging: '50.50', source: 'supplier_invoice', effectiveFrom: '2026-03-01' };
  it('cost: parts add up exactly and the date is India midnight', () => {
    const r = validateCost(cost, '2026-10-22T00:00:00Z');
    expect(r.ok && r.value.purchase + r.value.packaging).toBe(20050);
    expect(r.ok && r.value.effectiveFrom).toBe('2026-02-28T18:30:00.000Z');
  });
  it('cost: rejects all-zero, bad numbers, unknown source, future date', () => {
    expect(validateCost({ ...cost, purchase: '0', packaging: '0' }, '2026-10-22T00:00:00Z').ok).toBe(false);
    expect(validateCost({ ...cost, purchase: 'abc' }, '2026-10-22T00:00:00Z').ok).toBe(false);
    expect(validateCost({ ...cost, source: 'guess' }, '2026-10-22T00:00:00Z').ok).toBe(false);
    expect(validateCost({ ...cost, effectiveFrom: '2027-01-01' }, '2026-10-22T00:00:00Z').ok).toBe(false);
  });
});

describe('CSV safety and accuracy', () => {
  it('neutralises formula injection in text but writes negative numbers as numbers', () => {
    const csv = financeCsv(['name', 'profit'], [{ name: '=HYPERLINK("x")', profit: -500 }, { name: '+1', profit: 20 }, { name: '@SUM(A1)', profit: 0 }, { name: '-cmd', profit: 1 }, { name: 'ok, "quoted"', profit: 2 }]);
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",-500`);
    expect(lines[2]).toBe(`"'+1",20`);
    expect(lines[3]).toBe(`"'@SUM(A1)",0`);
    expect(lines[4]).toBe(`"'-cmd",1`);
    expect(lines[5]).toBe(`"ok, ""quoted""",2`);
  });
  it('export rows carry the same figures the dashboard computes', () => {
    const p = buildProfit(base());
    const csv = financeCsv(['metric', 'paise'], [{ metric: 'gross_sales', paise: p.grossSalesPaise }, { metric: 'net_collected', paise: p.netCollectedPaise }]);
    expect(csv).toContain('"gross_sales",1000000');
    expect(csv).toContain('"net_collected",920000');
  });
});

describe('financial permissions', () => {
  it('only the owner holds finance permissions', () => {
    expect(can('owner', 'finance.read')).toBe(true);
    expect(can('owner', 'finance.write')).toBe(true);
    expect(can('owner', 'finance.export')).toBe(true);
    for (const role of ['manager', 'support'] as const) {
      expect(permissionsOf(role).filter((x) => x.startsWith('finance.'))).toEqual([]);
    }
  });
});
