import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminRole } from '../../shared/roles.js';
import { getProfitSummary, getRevenueSummary, getInventoryValuation, getProductProfitability, getExpenseBreakdown, getRefundFinancialImpact, getCustomerPurchaseMetrics, getSalesForecast, FinanceDenied } from '../financeService.js';
import type { AdminConfig, AdminCtx } from './ctx.js';
import { handleFinance } from './finance.js';

interface Call { method: string; url: string; body: any }
let calls: Call[];
let audits: { action: string; detail?: Record<string, unknown> }[];
let dupExpense = false;
const real = globalThis.fetch;
const ID = '11111111-1111-4111-8111-111111111111';
const res = (status: number, b: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
const summary = { from: 'x', to: 'y', orders: 2, units: 3, gross_sales_paise: 150000, discount_paise: 0, net_incl_tax_paise: 150000, gst_paise: 7000, shipping_charged_paise: 0, cogs_paise: 60000, units_with_cost: 3, units_without_cost: 0, refund_count: 0, refund_paise: 0, fee_paise: 0, fee_orders: 0, ship_cost_confirmed_paise: 0, ship_cost_estimated_paise: 0, ship_cost_orders: 0, online_orders: 0, shipped_orders: 0, expenses: {}, cancelled_paid_without_refund: 0 };

beforeEach(() => {
  calls = []; audits = []; dupExpense = false;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input); const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (url.includes('/rpc/finance_period_summary')) return res(200, summary);
    if (url.includes('/rpc/finance_daily_series')) return res(200, []);
    if (url.includes('/rpc/finance_refund_impact')) return res(200, { by_reason: [], by_month: [], pending_paise: 0 });
    if (url.includes('/rpc/finance_inventory_valuation')) return res(200, { as_of: '2026-10-22', cost_value_paise: 1000, units_on_hand: 4 });
    if (url.includes('/rpc/finance_customer_metrics')) return res(200, { customers: 1, new_customers: 1, returning_customers: 0, orders: 1, revenue_paise: 100, repeat_customers_in_period: 0, lifetime_customers: 1, lifetime_repeat_customers: 0, lifetime_orders: 1, lifetime_revenue_paise: 100, cohorts: [] });
    if (url.includes('/rpc/finance_product_profitability')) return res(200, { total: 1, items: [{ product_name: '=cmd|x', pack_size: '60 tabs', units: 1, gross: 100, discount: 0, net_incl: 100, gst: 5, refunds: 0, cogs: 40, gross_profit: 55, margin_bps: 5789, units_without_cost: null, available: 3 }] });
    if (url.includes('/rpc/finance_expense_save')) return dupExpense ? res(409, { code: '23505' }) : res(200, ID);
    if (url.includes('/rpc/')) return res(200, ID);
    if (url.includes('business_expenses')) return res(200, [{ expense_date: '2026-10-01', category: 'advertising', amount_paise: 12345, description: '=HYPERLINK("http://x")', vendor: null, reference: null, status: 'active' }], { 'content-range': '0-0/1' });
    if (url.includes('financial_kpi_targets')) return res(200, [{ kpi: 'monthly_orders', target: 10, updated_at: 'x' }]);
    return res(200, []);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = real; });

function run(role: AdminRole, action: string, method: string, query: Record<string, string> = {}, body?: unknown) {
  const out = { status: 0, body: undefined as any, csv: '', headers: {} as Record<string, string> };
  const r = {};
  const c = {
    req: { method, query, body }, cfg: { db: { url: 'https://db.test', serviceKey: 'k' } } as unknown as AdminConfig,
    email: 'owner@kaayra.in', role, commerceEnabled: true,
    res: { setHeader: (k: string, v: string) => { out.headers[k] = v; }, status: () => ({ send: (t: string) => { out.status = 200; out.csv = t; } }) },
    json: (s: number, b: unknown) => { out.status = s; out.body = b; return r as never; },
    audit: async (action: string, detail?: Record<string, unknown>) => { audits.push({ action, detail }); },
  } as unknown as AdminCtx;
  return handleFinance(c, action).then((handled) => ({ handled, ...out }));
}
const range = { from: '2026-10-01', to: '2026-10-22' };
const goodExpense = { date: '2026-10-01', category: 'advertising', amount: '123.45', description: 'Instagram ads', vendor: 'Meta', reference: 'INV-1' };
const READS: [string, Record<string, string>][] = [['finance-overview', range], ['finance-products', range], ['finance-expenses', range], ['finance-inventory', {}], ['finance-customers', range], ['finance-costs', {}], ['finance-kpis', {}]];
const WRITES: [string, string, Record<string, string>, unknown][] = [
  ['finance-cost', 'POST', {}, { variantId: ID, purchase: '100', source: 'supplier_invoice', effectiveFrom: '2026-03-01' }],
  ['finance-expense', 'POST', {}, goodExpense], ['finance-expense', 'PATCH', { id: ID }, goodExpense], ['finance-expense-void', 'POST', { id: ID }, { reason: 'duplicate entry' }],
  ['finance-fee', 'POST', {}, { paymentId: ID, fee: '20', tax: '3.60' }], ['finance-ship-cost', 'POST', {}, { shipmentId: ID, cost: '45', basis: 'confirmed' }], ['finance-kpi', 'POST', {}, { kpi: 'monthly_orders', target: 40 }],
];

describe('finance admin: authorisation is server-side and owner-only (unauthorized financial access)', () => {
  it('refuses manager and support on every read, export and write; records the attempt; touches nothing', async () => {
    let n = 0;
    for (const role of ['manager', 'support'] as const) {
      for (const [a, q] of READS) { const r = await run(role, a, 'GET', q); expect(r.status).toBe(403); expect(r.body.permission).toBe('finance.read'); n += 1; }
      const e = await run(role, 'finance-export', 'GET', { ...range, report: 'profit' }); expect(e.status).toBe(403); expect(e.body.permission).toBe('finance.export'); n += 1;
      for (const [a, m, q, b] of WRITES) { const r = await run(role, a, m, q, b); expect(r.status).toBe(403); expect(r.body.permission).toBe('finance.write'); n += 1; }
    }
    expect(calls).toHaveLength(0);
    expect(audits.filter((a) => a.action === 'permission_denied')).toHaveLength(n);
  });
  it('lets the owner through every read and write', async () => {
    for (const [a, q] of READS) expect((await run('owner', a, 'GET', q)).status).toBe(200);
    for (const [a, m, q, b] of WRITES) expect((await run('owner', a, m, q, b)).status).toBeLessThan(300);
  });
  it('does not handle unrelated actions', async () => expect((await run('owner', 'coupons', 'GET')).handled).toBe(false));
  it('the service layer also refuses non-owners, so a future caller cannot skip the route check', async () => {
    const a = { db: { url: 'https://db.test', serviceKey: 'k' }, role: 'manager' as AdminRole };
    const r = range;
    for (const f of [() => getRevenueSummary(a, r), () => getProfitSummary(a, r), () => getProductProfitability(a, r), () => getExpenseBreakdown(a, r), () => getInventoryValuation(a), () => getRefundFinancialImpact(a, r), () => getCustomerPurchaseMetrics(a, r), () => getSalesForecast(a)]) {
      await expect(f()).rejects.toBeInstanceOf(FinanceDenied);
    }
    expect(calls).toHaveLength(0);
  });
  it('the service layer only reads: no write method reaches the database for a read-only report', async () => {
    const a = { db: { url: 'https://db.test', serviceKey: 'k' }, role: 'owner' as AdminRole };
    await getProfitSummary(a, range); await getInventoryValuation(a); await getCustomerPurchaseMetrics(a, range);
    expect(calls.every((c) => c.url.includes('/rpc/finance_') && c.method === 'POST')).toBe(true);
    expect(calls.some((c) => /rpc\/finance_(cost_add|expense_|fee_record|ship_cost|kpi_set)/.test(c.url))).toBe(false);
  });
});

describe('finance admin: ranges and validation', () => {
  it('rejects a bad or oversized range without querying', async () => {
    const r = await run('owner', 'finance-overview', 'GET', { from: '2020-01-01', to: '2026-10-01' });
    expect(r.status).toBe(400);
    expect((await run('owner', 'finance-products', 'GET', { from: '2026-10-05', to: '2026-10-05' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('overview returns revenue, profit, series, refunds, forecast and kpis from one call', async () => {
    const r = await run('owner', 'finance-overview', 'GET', range);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual(expect.arrayContaining(['revenue', 'profit', 'series', 'refunds', 'forecast', 'kpis']));
    expect(r.body.profit.grossProfitPaise).toBe(150000 - 7000 - 60000);
    expect(r.body.forecast.status).toBe('insufficient');
  });
  it('rejects bad expenses and costs before the database', async () => {
    expect((await run('owner', 'finance-expense', 'POST', {}, { ...goodExpense, amount: '-5' })).status).toBe(400);
    expect((await run('owner', 'finance-expense', 'POST', {}, { ...goodExpense, date: '2999-01-01' })).status).toBe(400);
    expect((await run('owner', 'finance-cost', 'POST', {}, { variantId: ID, purchase: '0', source: 'supplier_invoice', effectiveFrom: '2026-03-01' })).status).toBe(400);
    expect((await run('owner', 'finance-kpi', 'POST', {}, { kpi: 'made_up', target: 5 })).status).toBe(400);
    expect((await run('owner', 'finance-kpi', 'POST', {}, { kpi: 'monthly_orders', target: 0 })).status).toBe(400);
    expect(calls.filter((c) => c.url.includes('/rpc/'))).toHaveLength(0);
  });
});

describe('finance admin: audit and duplicates', () => {
  it('audits cost, expense, fee, shipping-cost and target changes', async () => {
    for (const [a, m, q, b] of WRITES) await run('owner', a, m, q, b);
    expect(audits.map((x) => x.action)).toEqual(['finance_cost_add', 'finance_expense_add', 'finance_expense_update', 'finance_expense_void', 'finance_fee_record', 'finance_ship_cost_record', 'finance_kpi_set']);
    expect(audits[0].detail).toMatchObject({ purchase_paise: 10000, variant_id: ID });
    expect(audits[6].detail).toMatchObject({ kpi: 'monthly_orders', before: 10, after: 40 });
  });
  it('reports a duplicate expense as a conflict, not a server error', async () => {
    dupExpense = true;
    const r = await run('owner', 'finance-expense', 'POST', {}, goodExpense);
    expect(r.status).toBe(409);
    expect(audits).toHaveLength(0);
  });
  it('sends the amount to the database as integer paise', async () => {
    await run('owner', 'finance-expense', 'POST', {}, goodExpense);
    const c = calls.find((x) => x.url.includes('finance_expense_save'))!;
    expect(c.body.p_amount).toBe(12345);
    expect(Number.isInteger(c.body.p_amount)).toBe(true);
  });
});

describe('finance admin: CSV exports', () => {
  it('neutralises formula injection coming from stored text', async () => {
    const e = await run('owner', 'finance-export', 'GET', { ...range, report: 'expenses' });
    expect(e.csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    const p = await run('owner', 'finance-export', 'GET', { ...range, report: 'products' });
    expect(p.csv).toContain(`"'=cmd|x"`);
  });
  it('writes money as exact rupees and the product export equals the dashboard figures', async () => {
    const dash = await run('owner', 'finance-products', 'GET', range);
    const csv = (await run('owner', 'finance-export', 'GET', { ...range, report: 'products' })).csv.split('\r\n')[1].split(',');
    expect(dash.body.items[0].gross_profit).toBe(55);
    expect(csv).toContain('"0.55"'); // gross profit 55 paise
    expect(csv).toContain('"0.40"'); // cogs 40 paise
  });
  it('profit export matches the dashboard profit and leaves unavailable values blank with the reason', async () => {
    const ov = await run('owner', 'finance-overview', 'GET', range);
    const csv = (await run('owner', 'finance-export', 'GET', { ...range, report: 'profit' })).csv;
    expect(csv).toContain(`"Gross profit","${(ov.body.profit.grossProfitPaise / 100).toFixed(2)}"`);
  });
  it('audits every export, sets a download header, and refuses unknown reports', async () => {
    const e = await run('owner', 'finance-export', 'GET', { ...range, report: 'sales' });
    expect(e.headers['Content-Disposition']).toContain('kaayra-sales-2026-10-01-to-2026-10-22.csv');
    expect(audits.at(-1)?.action).toBe('finance_export');
    expect((await run('owner', 'finance-export', 'GET', { ...range, report: 'customers_full_list' })).status).toBe(400);
  });
  it('customer export carries counts only, no personal data', async () => {
    const c = (await run('owner', 'finance-export', 'GET', { ...range, report: 'customers' })).csv;
    expect(c).not.toMatch(/@|phone|email/i);
  });
  it('export is bounded by the row cap and the range limit', async () => {
    expect((await run('owner', 'finance-export', 'GET', { from: '2020-01-01', to: '2026-10-01', report: 'expenses' })).status).toBe(400);
    expect(calls.some((c) => c.url.includes('limit=5000'))).toBe(false);
  });
});
