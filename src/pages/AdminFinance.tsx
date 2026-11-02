import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { EXPENSE_CATEGORIES, COST_SOURCES, KPI_KEYS, bpsText, presetRange, type KpiRow, type ProfitSummary, type Forecast, type KpiKey } from '../../shared/finance';
import { todayIST } from '../../shared/inventory';
import { formatInr } from '../../shared/orders';
import { Pager, api, day, errorText, useMe, when } from '../lib/adminKit';

export type FinanceView = 'overview' | 'products' | 'costs' | 'expenses' | 'inventory' | 'customers';
type Range = { from: string; to: string };
const PRESETS: [string, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['last7', 'Last 7 days'], ['last30', 'Last 30 days'], ['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year']];
const money = (p: number | null | undefined): string => (p === null || p === undefined ? 'Not available' : formatInr(p));
const plusDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const LABEL: Record<string, string> = { packaging: 'Packaging', shipping: 'Shipping', advertising: 'Advertising', marketing: 'Marketing', software: 'Software', payment_processing: 'Payment processing', warehouse: 'Warehouse', utilities: 'Utilities', salaries: 'Salaries', miscellaneous: 'Miscellaneous' };
const KPI_LABEL: Record<KpiKey, string> = { monthly_revenue_paise: 'Monthly revenue (₹)', monthly_orders: 'Monthly orders', gross_margin_bps: 'Gross margin (%)', refund_rate_bps: 'Refund rate ceiling (%)', inventory_turnover_x100: 'Inventory turnover (x)' };
const kpiValue = (k: KpiKey, v: number | null): string => {
  if (v === null) return 'Not available';
  if (k === 'monthly_revenue_paise') return formatInr(v);
  if (k === 'monthly_orders') return String(v);
  if (k === 'inventory_turnover_x100') return `${(v / 100).toFixed(2)}x`;
  return bpsText(v);
};

/** Range picker: presets plus a custom From/To (To is the last day, inclusive, for the person). */
function RangeBar({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(plusDay(range.to, -1));
  return (
    <div>
      <div className="aprod-chips" role="group" aria-label="Period">
        {PRESETS.map(([id, label]) => {
          const r = presetRange(id, todayIST());
          return <button key={id} type="button" className="aprod-chip" aria-pressed={!!r && r.from === range.from && r.to === range.to} onClick={() => { if (r) { onChange(r); setFrom(r.from); setTo(plusDay(r.to, -1)); } }}>{label}</button>;
        })}
      </div>
      <div className="inline-form">
        <label>From<input type="date" value={from} max={todayIST()} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} max={todayIST()} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" className="btn btn--sm" disabled={!from || !to || to < from} onClick={() => onChange({ from, to: plusDay(to, 1) })}>Apply dates</button>
      </div>
      <p className="field-hint">Days are India time. {day(range.from)} to {day(plusDay(range.to, -1))}.</p>
    </div>
  );
}

function useLoad<T>(path: string | null, onExpired: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    void api<T>(path).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.status === 401) return onExpired();
      if (r.ok && r.data) { setData(r.data as T); setError(''); } else setError(errorText(r, 'Could not load this report.'));
    });
    return () => { live = false; };
  }, [path, tick, onExpired]);
  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

const Skeleton = () => <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>;
const qs = (r: Range, extra = '') => `from=${r.from}&to=${r.to}${extra}`;
const ExportLink = ({ report, range }: { report: string; range: Range }) => <a className="btn btn--sm" href={`/api/admin/finance-export?report=${report}&${qs(range)}`}>Export CSV</a>;

interface Overview {
  revenue: { revenue: { grossSalesPaise: number; discountsPaise: number; netMerchandiseInclTaxPaise: number; gstIncludedPaise: number; netSalesExTaxPaise: number; shippingChargedPaise: number; refundsPaise: number; netCollectedPaise: number; orders: number; averageOrderPaise: number | null; refundCount: number; refundRateBps: number | null }; growth: { netCollectedBps: number | null; ordersBps: number | null }; notes: string[] };
  profit: ProfitSummary;
  series: { date: string; orders: number; netPaise: number; shippingPaise: number }[];
  refunds: { byReason: { reason: string; count: number; paise: number }[] };
  forecast: Forecast;
  kpis: { period: Range; rows: KpiRow[]; notes: string[] };
}

function Bars({ series }: { series: Overview['series'] }) {
  if (series.length === 0) return <p className="muted">No paid orders in this period.</p>;
  const W = 720, H = 200, max = Math.max(1, ...series.map((d) => d.netPaise + d.shippingPaise));
  const bw = Math.max(2, Math.min(24, (W - 20) / series.length - 2));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue by day" style={{ width: '100%', height: 'auto', color: 'var(--p-accent, currentColor)' }}>
      {series.map((d, i) => {
        const h = ((d.netPaise + d.shippingPaise) / max) * (H - 24);
        return <rect key={d.date} x={10 + i * ((W - 20) / series.length)} y={H - 16 - h} width={bw} height={Math.max(1, h)} fill="currentColor" opacity="0.85"><title>{`${day(d.date)}: ${formatInr(d.netPaise + d.shippingPaise)}, ${d.orders} order(s)`}</title></rect>;
      })}
      <text x="10" y={H - 2} fontSize="11" fill="currentColor">{day(series[0].date)}</text>
      <text x={W - 10} y={H - 2} fontSize="11" textAnchor="end" fill="currentColor">{day(series[series.length - 1].date)}</text>
    </svg>
  );
}

function Overview({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [range, setRange] = useState<Range>(() => presetRange('this_month', todayIST()) as Range);
  const { data, error, loading, reload } = useLoad<Overview>(`finance-overview?${qs(range)}`, onExpired);
  const [msg, setMsg] = useState('');
  const p = data?.profit;
  const r = data?.revenue.revenue;
  return (
    <section aria-labelledby="bi-title">
      <div className="an-head"><div><h1 id="bi-title">Business overview</h1><p className="muted">Real paid orders, recorded costs and expenses. Nothing here is estimated unless it says so.</p></div><div className="admin-actions"><ExportLink report="sales" range={range} /><ExportLink report="profit" range={range} /></div></div>
      <RangeBar range={range} onChange={setRange} />
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <Skeleton />}
      {data && p && r && (
        <>
          <p className={`form-status ${p.status === 'complete' ? 'form-status--info' : 'form-status--error'}`} role="status"><strong>{p.status === 'complete' ? 'Profit is based on complete cost data.' : p.message}</strong>{p.gaps.length > 0 && <> {p.gaps.join(' ')}</>} {p.status !== 'complete' && 'Add the missing costs under Product costs, or record payment fees and carrier charges, to see profit.'}</p>
          <div className="an-kpis">
            <div className="an-kpi"><span className="an-kpi-label">Net collected</span><strong>{formatInr(r.netCollectedPaise)}</strong><span className="an-kpi-foot">{data.revenue.growth.netCollectedBps === null ? 'no earlier period' : `${bpsText(data.revenue.growth.netCollectedBps)} vs previous`}</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Paid orders</span><strong>{r.orders}</strong><span className="an-kpi-foot">{data.revenue.growth.ordersBps === null ? 'no earlier period' : `${bpsText(data.revenue.growth.ordersBps)} vs previous`}</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Average order</span><strong>{money(r.averageOrderPaise)}</strong></div>
            <div className="an-kpi" data-tone={p.grossProfitPaise === null ? 'warn' : undefined}><span className="an-kpi-label">Gross profit</span><strong>{money(p.grossProfitPaise)}</strong><span className="an-kpi-foot">Margin {bpsText(p.grossMarginBps)}</span></div>
            <div className="an-kpi" data-tone={p.operatingProfitPaise === null ? 'warn' : undefined}><span className="an-kpi-label">Operating profit</span><strong>{money(p.operatingProfitPaise)}</strong></div>
            <div className="an-kpi" data-tone={p.netProfitPaise === null ? 'warn' : undefined}><span className="an-kpi-label">Net profit (before income tax)</span><strong>{p.netProfitPaise === null ? 'Not available' : formatInr(p.netProfitPaise)}</strong><span className="an-kpi-foot">Margin {bpsText(p.netMarginBps)}</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Refunds paid</span><strong>{formatInr(r.refundsPaise)}</strong><span className="an-kpi-foot">{r.refundCount} refund(s), rate {bpsText(r.refundRateBps)}</span></div>
          </div>
          <h2 className="admin-subhead">Revenue by day</h2>
          <Bars series={data.series} />
          <h2 className="admin-subhead">How the figures are built</h2>
          <dl className="admin-dl">
            <div><dt>Gross sales</dt><dd>{formatInr(p.grossSalesPaise)}</dd></div>
            <div><dt>Discounts</dt><dd>{formatInr(p.discountsPaise)}</dd></div>
            <div><dt>GST inside net sales</dt><dd>{formatInr(p.gstIncludedPaise)}</dd></div>
            <div><dt>Net sales (ex GST)</dt><dd>{formatInr(p.netSalesExTaxPaise)}</dd></div>
            <div><dt>Shipping charged</dt><dd>{formatInr(p.shippingChargedPaise)}</dd></div>
            <div><dt>Cost of goods sold</dt><dd>{p.status === 'unavailable' ? 'Not available' : formatInr(p.cogsPaise)}</dd></div>
            <div><dt>Operating expenses</dt><dd>{formatInr(p.operatingExpensesPaise)}</dd></div>
            <div><dt>Shipping contribution</dt><dd>{money(p.shippingContributionPaise)}</dd></div>
            <div><dt>Carrier cost (estimates only)</dt><dd>{formatInr(p.shippingEstimatedCostPaise)}</dd></div>
          </dl>
          {p.excludedExpenses.length > 0 && <p className="field-hint">Left out to avoid counting twice: {p.excludedExpenses.map((e) => `${LABEL[e.category]} ${formatInr(e.paise)}`).join(', ')}. {p.excludedExpenses[0].reason}</p>}
          <p className="field-hint">{data.revenue.notes.join(' ')} Refunds are counted when paid out, so they can belong to earlier sales. GST on refunds is not recovered in these figures.</p>
          <h2 className="admin-subhead">Sales forecast (prediction, not a promise)</h2>
          {data.forecast.status === 'insufficient' ? <p className="muted">{data.forecast.warnings.join(' ')}</p> : (
            <>
              <p>Next {data.forecast.horizonDays} days: about <strong>{formatInr(data.forecast.expectedPaise ?? 0)}</strong> (range {formatInr(data.forecast.lowPaise ?? 0)} to {formatInr(data.forecast.highPaise ?? 0)}).</p>
              <p className="field-hint">Method: average daily revenue of the last 28 days ({data.forecast.basisFrom} to {data.forecast.basisTo}) times {data.forecast.horizonDays}. Trend vs the 28 days before: {bpsText(data.forecast.trendVsPreviousBps)}. {data.forecast.warnings.join(' ')} {data.forecast.label}</p>
            </>
          )}
          <h2 className="admin-subhead">Targets</h2>
          <p className="field-hint">{data.kpis.notes.join(' ')} Period: {day(data.kpis.period.from)} to today.</p>
          {data.kpis.rows.length === 0 ? <p className="muted">No targets set. None are created for you.</p> : (
            <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Targets</caption>
              <thead><tr><th scope="col">Target</th><th scope="col">Actual</th><th scope="col">Goal</th><th scope="col">Variance</th><th scope="col">Progress</th></tr></thead>
              <tbody>{data.kpis.rows.map((k) => <tr key={k.kpi}><td>{KPI_LABEL[k.kpi]}</td><td>{kpiValue(k.kpi, k.actual)}</td><td>{kpiValue(k.kpi, k.target)}</td><td>{k.varianceAbs === null ? 'n/a' : kpiValue(k.kpi, k.varianceAbs)}</td><td>{bpsText(k.progressBps)}</td></tr>)}</tbody></table></div>
          )}
          {me.can('finance.write') && <TargetForm onSaved={() => { setMsg('Target saved.'); reload(); }} onExpired={onExpired} />}
          {msg && <p className="form-status form-status--info" role="status">{msg}</p>}
          <h2 className="admin-subhead">Refunds by reason</h2>
          {data.refunds.byReason.length === 0 ? <p className="muted">No refunds paid in this period.</p> : (
            <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Refunds by reason</caption><thead><tr><th scope="col">Reason</th><th scope="col">Refunds</th><th scope="col">Amount</th></tr></thead>
              <tbody>{data.refunds.byReason.map((x) => <tr key={x.reason}><td>{x.reason.replace(/_/g, ' ')}</td><td>{x.count}</td><td>{formatInr(Number(x.paise))}</td></tr>)}</tbody></table></div>
          )}
        </>
      )}
    </section>
  );
}

function TargetForm({ onSaved, onExpired }: { onSaved: () => void; onExpired: () => void }) {
  const [kpi, setKpi] = useState<KpiKey>('monthly_revenue_paise');
  const [target, setTarget] = useState('');
  const [problem, setProblem] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await api('finance-kpi', { method: 'POST', body: { kpi, target } });
    if (r.status === 401) return onExpired();
    if (!r.ok) return setProblem(errorText(r, 'Could not save the target.'));
    setProblem(''); setTarget(''); onSaved();
  }
  return (
    <form className="inline-form" onSubmit={submit} aria-label="Set a target">
      <label>Target<select value={kpi} onChange={(e) => setKpi(e.target.value as KpiKey)}>{KPI_KEYS.map((k) => <option key={k} value={k}>{KPI_LABEL[k]}</option>)}</select></label>
      <label>Goal<input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" required placeholder="e.g. 250000 or 45" /></label>
      <button className="btn btn--sm" type="submit">Save target</button>
      {problem && <p className="form-status form-status--error" role="alert">{problem}</p>}
    </form>
  );
}

interface ProductRow { variant_id: string; product_name: string; pack_size: string; units: number; gross: number; discount: number; net_incl: number; gst: number; refunds: number; cogs: number | null; gross_profit: number | null; margin_bps: number | null; units_without_cost: number | null; available: number }
function Products({ onExpired }: { onExpired: () => void }) {
  const [range, setRange] = useState<Range>(() => presetRange('last30', todayIST()) as Range);
  const [sort, setSort] = useState('revenue');
  const [page, setPage] = useState(1);
  const { data, error, loading } = useLoad<{ items: ProductRow[]; total: number; pageSize: number }>(`finance-products?${qs(range, `&sort=${sort}&page=${page}`)}`, onExpired);
  const SORTS: [string, string][] = [['revenue', 'Highest revenue'], ['profit', 'Highest profit'], ['margin', 'Highest margin'], ['units', 'Most units'], ['margin_asc', 'Lowest margin'], ['refunds', 'Most refunded']];
  return (
    <section aria-labelledby="bp-title">
      <div className="an-head"><div><h1 id="bp-title">Product profitability</h1><p className="muted">By pack size, from paid orders and the cost on record on the day of each sale. Order discounts are split across lines in proportion to line value.</p></div><ExportLink report="products" range={range} /></div>
      <RangeBar range={range} onChange={(r) => { setRange(r); setPage(1); }} />
      <div className="aprod-chips" role="group" aria-label="Sort by">{SORTS.map(([id, l]) => <button key={id} type="button" className="aprod-chip" aria-pressed={sort === id} onClick={() => { setSort(id); setPage(1); }}>{l}</button>)}</div>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <Skeleton />}
      {data && (data.items.length === 0 ? <p className="muted">No sales in this period.</p> : (
        <>
          <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Product profitability</caption>
            <thead><tr><th scope="col">Product</th><th scope="col">Units</th><th scope="col">Net sales (incl. GST)</th><th scope="col">Discounts</th><th scope="col">Refunds</th><th scope="col">Cost of goods</th><th scope="col">Gross profit</th><th scope="col">Margin</th><th scope="col">Available</th></tr></thead>
            <tbody>{data.items.map((i) => (
              <tr key={i.variant_id}><td><strong>{i.product_name}</strong> <small className="muted">{i.pack_size}</small></td><td>{i.units}</td><td>{formatInr(Number(i.net_incl))}</td><td>{formatInr(Number(i.discount))}</td><td>{formatInr(Number(i.refunds))}</td>
                <td>{i.cogs === null ? 'No cost' : formatInr(Number(i.cogs))}{i.units_without_cost ? <small className="muted"> ({i.units_without_cost} unit(s) uncosted)</small> : null}</td>
                <td>{i.gross_profit === null ? 'Profit unavailable: cost data incomplete' : formatInr(Number(i.gross_profit))}</td><td>{i.margin_bps === null ? 'n/a' : bpsText(Number(i.margin_bps))}</td><td>{i.available}</td></tr>))}</tbody></table></div>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      ))}
    </section>
  );
}

interface CostItem { id: string; sku: string; packSize: string; name: string; pricePaise: number | null; status: string; currentCost: { unit_cost_paise: number; effective_from: string } | null }
interface CostHistory { id: number; purchase_paise: number; manufacturing_paise: number; packaging_paise: number; other_paise: number; unit_cost_paise: number; effective_from: string; source: string; note: string | null; created_by: string }
function Costs({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const canWrite = me.can('finance.write');
  const [variant, setVariant] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad<{ items: CostItem[]; history: CostHistory[] }>(`finance-costs${variant ? `?variant=${variant}` : ''}`, onExpired);
  const [form, setForm] = useState({ variantId: '', purchase: '', manufacturing: '', packaging: '', other: '', effectiveFrom: todayIST(), source: 'supplier_invoice', note: '' });
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(''); setNotice('');
    const r = await api('finance-cost', { method: 'POST', body: form });
    if (r.status === 401) return onExpired();
    if (!r.ok) return setProblem(errorText(r, 'Could not save the cost.'));
    setNotice('Cost recorded. Earlier sales keep the cost that applied when they were paid.');
    setForm({ ...form, purchase: '', manufacturing: '', packaging: '', other: '', note: '' });
    reload();
  }
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <section aria-labelledby="bc-title">
      <div className="an-head"><div><h1 id="bc-title">Product costs</h1><p className="muted">Cost per unit by pack size. A new cost never changes the profit of sales made before its effective date; old costs are kept.</p></div></div>
      {!canWrite && <p className="field-hint">You can look at costs but not change them.</p>}
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {notice && <p className="form-status form-status--info" role="status">{notice}</p>}
      {canWrite && data && (
        <form className="inline-form admin-search-form" onSubmit={submit} aria-label="Record a cost">
          <h2 className="admin-subhead">Record a cost</h2>
          <label>Pack size<select value={form.variantId} onChange={set('variantId')} required><option value="">Choose…</option>{data.items.map((i) => <option key={i.id} value={i.id}>{i.name} {i.packSize} ({i.sku})</option>)}</select></label>
          <label>Purchase (₹ per unit)<input value={form.purchase} onChange={set('purchase')} inputMode="decimal" placeholder="0" /></label>
          <label>Manufacturing (₹)<input value={form.manufacturing} onChange={set('manufacturing')} inputMode="decimal" placeholder="0" /></label>
          <label>Packaging (₹)<input value={form.packaging} onChange={set('packaging')} inputMode="decimal" placeholder="0" /></label>
          <label>Other (₹)<input value={form.other} onChange={set('other')} inputMode="decimal" placeholder="0" /></label>
          <label>Effective from<input type="date" value={form.effectiveFrom} max={todayIST()} onChange={set('effectiveFrom')} required /></label>
          <label>Source<select value={form.source} onChange={set('source')}>{COST_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></label>
          <label>Note<input value={form.note} onChange={set('note')} maxLength={300} /></label>
          <p className="field-hint">An effective date in the past changes the profit shown for sales paid on or after that date. Every entry is logged.</p>
          <button className="btn btn--sm" type="submit">Save cost</button>
          {problem && <p className="form-status form-status--error" role="alert">{problem}</p>}
        </form>
      )}
      {loading && !data && <Skeleton />}
      {data && (
        <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Costs by pack size</caption>
          <thead><tr><th scope="col">Pack size</th><th scope="col">Selling price</th><th scope="col">Current unit cost</th><th scope="col">Since</th><th scope="col"><span className="sr-only">History</span></th></tr></thead>
          <tbody>{data.items.map((i) => (
            <tr key={i.id}><td><strong>{i.name}</strong> <small className="muted">{i.packSize} · {i.sku}</small></td><td>{money(i.pricePaise)}</td><td>{i.currentCost ? formatInr(i.currentCost.unit_cost_paise) : 'No cost recorded'}</td><td>{i.currentCost ? when(i.currentCost.effective_from) : ''}</td>
              <td><button type="button" className="btn btn--sm btn--ghost" onClick={() => setVariant(variant === i.id ? null : i.id)}>{variant === i.id ? 'Hide history' : 'History'}</button></td></tr>))}</tbody></table></div>
      )}
      {data && variant && (data.history.length === 0 ? <p className="muted">No costs recorded for this pack size.</p> : (
        <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Cost history</caption>
          <thead><tr><th scope="col">Effective from</th><th scope="col">Purchase</th><th scope="col">Manufacturing</th><th scope="col">Packaging</th><th scope="col">Other</th><th scope="col">Unit cost</th><th scope="col">Source</th><th scope="col">By</th></tr></thead>
          <tbody>{data.history.map((h) => <tr key={h.id}><td>{when(h.effective_from)}</td><td>{formatInr(h.purchase_paise)}</td><td>{formatInr(h.manufacturing_paise)}</td><td>{formatInr(h.packaging_paise)}</td><td>{formatInr(h.other_paise)}</td><td><strong>{formatInr(h.unit_cost_paise)}</strong></td><td>{h.source.replace(/_/g, ' ')}{h.note ? ` · ${h.note}` : ''}</td><td>{h.created_by}</td></tr>)}</tbody></table></div>
      ))}
    </section>
  );
}

interface Expense { id: string; expense_date: string; category: string; amount_paise: number; description: string; vendor: string | null; reference: string | null; status: string; void_reason: string | null }
function Expenses({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const canWrite = me.can('finance.write');
  const [range, setRange] = useState<Range>(() => presetRange('this_month', todayIST()) as Range);
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState<'active' | 'voided'>('active');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad<{ items: Expense[]; total: number; pageSize: number; breakdown: { byCategory: Record<string, number>; paymentFeesPaise: number; carrierCostConfirmedPaise: number; operatingExpensesPaise: number; excluded: { category: string; paise: number; reason: string }[] } }>(`finance-expenses?${qs(range, `&page=${page}&status=${status}${cat ? `&category=${cat}` : ''}`)}`, onExpired);
  const [edit, setEdit] = useState<Expense | null>(null);
  const blank = { date: todayIST(), category: 'advertising', amount: '', description: '', vendor: '', reference: '' };
  const [form, setForm] = useState(blank);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setForm(edit ? { date: edit.expense_date, category: edit.category, amount: (edit.amount_paise / 100).toFixed(2), description: edit.description, vendor: edit.vendor ?? '', reference: edit.reference ?? '' } : blank); }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(''); setNotice('');
    const r = edit ? await api(`finance-expense?id=${edit.id}`, { method: 'PATCH', body: form }) : await api('finance-expense', { method: 'POST', body: form });
    if (r.status === 401) return onExpired();
    if (!r.ok) return setProblem(errorText(r, 'Could not save the expense.'));
    setNotice(edit ? 'Expense saved.' : 'Expense added.'); setEdit(null); setForm(blank); reload();
  }
  async function voidIt(x: Expense) {
    const reason = window.prompt('Why is this entry being cancelled? (3 to 300 characters)');
    if (!reason) return;
    const r = await api(`finance-expense-void?id=${x.id}`, { method: 'POST', body: { reason } });
    if (r.status === 401) return onExpired();
    if (!r.ok) return setProblem(errorText(r, 'Could not cancel the expense.'));
    setNotice('Expense cancelled. It stays in the history and no longer counts.'); reload();
  }
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <section aria-labelledby="be-title">
      <div className="an-head"><div><h1 id="be-title">Business expenses</h1><p className="muted">Only what you enter. Nothing is guessed. A wrong entry is cancelled, not deleted.</p></div><ExportLink report="expenses" range={range} /></div>
      <RangeBar range={range} onChange={(r) => { setRange(r); setPage(1); }} />
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {notice && <p className="form-status form-status--info" role="status">{notice}</p>}
      {canWrite && (
        <form className="inline-form admin-search-form" onSubmit={submit} aria-label={edit ? 'Edit expense' : 'Add expense'}>
          <h2 className="admin-subhead">{edit ? 'Edit expense' : 'Add an expense'}</h2>
          <label>Date<input type="date" value={form.date} max={todayIST()} onChange={set('date')} required /></label>
          <label>Category<select value={form.category} onChange={set('category')}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{LABEL[c]}</option>)}</select></label>
          <label>Amount (₹)<input value={form.amount} onChange={set('amount')} inputMode="decimal" required placeholder="1250.50" /></label>
          <label>Description<input value={form.description} onChange={set('description')} minLength={3} maxLength={300} required /></label>
          <label>Vendor<input value={form.vendor} onChange={set('vendor')} maxLength={120} /></label>
          <label>Invoice / reference<input value={form.reference} onChange={set('reference')} maxLength={80} /></label>
          <p className="field-hint">Payment fees and carrier charges recorded per order already count; entries in those two categories are left out of profit once per-order records exist, so the same money is never counted twice.</p>
          <button className="btn btn--sm" type="submit">{edit ? 'Save changes' : 'Add expense'}</button>
          {edit && <button className="btn btn--sm btn--ghost" type="button" onClick={() => setEdit(null)}>Cancel edit</button>}
          {problem && <p className="form-status form-status--error" role="alert">{problem}</p>}
        </form>
      )}
      <div className="aprod-chips" role="group" aria-label="Filter">
        <button type="button" className="aprod-chip" aria-pressed={cat === ''} onClick={() => { setCat(''); setPage(1); }}>All categories</button>
        {EXPENSE_CATEGORIES.map((c) => <button key={c} type="button" className="aprod-chip" aria-pressed={cat === c} onClick={() => { setCat(c); setPage(1); }}>{LABEL[c]}</button>)}
        <button type="button" className="aprod-chip" aria-pressed={status === 'voided'} onClick={() => { setStatus(status === 'voided' ? 'active' : 'voided'); setPage(1); }}>Cancelled entries</button>
      </div>
      {loading && !data && <Skeleton />}
      {data && (
        <>
          <dl className="admin-dl">
            {Object.entries(data.breakdown.byCategory).map(([c, v]) => <div key={c}><dt>{LABEL[c] ?? c}</dt><dd>{formatInr(Number(v))}</dd></div>)}
            <div><dt>Payment fees (per order)</dt><dd>{formatInr(data.breakdown.paymentFeesPaise)}</dd></div>
            <div><dt>Carrier cost (confirmed)</dt><dd>{formatInr(data.breakdown.carrierCostConfirmedPaise)}</dd></div>
            <div><dt>Total counted</dt><dd><strong>{formatInr(data.breakdown.operatingExpensesPaise)}</strong></dd></div>
          </dl>
          {data.items.length === 0 ? <p className="muted">No expenses entered for this period.</p> : (
            <>
              <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Expenses</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Description</th><th scope="col">Amount</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{data.items.map((x) => (
                  <tr key={x.id}><td>{day(x.expense_date)}</td><td>{LABEL[x.category]}</td><td>{x.description}<small className="muted">{x.vendor ? ` · ${x.vendor}` : ''}{x.reference ? ` · ${x.reference}` : ''}{x.void_reason ? ` · cancelled: ${x.void_reason}` : ''}</small></td><td>{formatInr(x.amount_paise)}</td>
                    <td>{canWrite && x.status === 'active' && <div className="admin-actions"><button type="button" className="btn btn--sm btn--ghost" onClick={() => setEdit(x)}>Edit</button><button type="button" className="btn btn--sm btn--ghost" onClick={() => void voidIt(x)}>Cancel entry</button></div>}</td></tr>))}</tbody></table></div>
              <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function Inventory({ onExpired }: { onExpired: () => void }) {
  const { data, error, loading } = useLoad<{ valuation: Record<string, number | string | string[]> & { notes: string[] } }>('finance-inventory', onExpired);
  const v = data?.valuation;
  const n = (k: string) => Number(v?.[k] ?? 0);
  return (
    <section aria-labelledby="bi2-title">
      <div className="an-head"><div><h1 id="bi2-title">Inventory valuation</h1><p className="muted">Stock on the shelf today, valued at recorded cost and, separately, at shop price.</p></div><ExportLink report="inventory" range={presetRange('this_month', todayIST()) as Range} /></div>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <Skeleton />}
      {v && (
        <>
          <div className="an-kpis">
            <div className="an-kpi"><span className="an-kpi-label">Value at cost</span><strong>{formatInr(n('cost_value_paise'))}</strong><span className="an-kpi-foot">{n('units_without_cost')} unit(s) have no cost and are not valued</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Value at selling price</span><strong>{formatInr(n('selling_value_paise'))}</strong><span className="an-kpi-foot">Not an accounting value</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Units on hand</span><strong>{n('units_on_hand')}</strong><span className="an-kpi-foot">{n('units_reserved')} reserved, {n('units_available')} available</span></div>
            <div className="an-kpi" data-tone={n('expired_units') > 0 ? 'bad' : undefined}><span className="an-kpi-label">Expired stock (at cost)</span><strong>{formatInr(n('expired_cost_paise'))}</strong><span className="an-kpi-foot">{n('expired_units')} unit(s)</span></div>
            <div className="an-kpi" data-tone={n('expiring_units') > 0 ? 'warn' : undefined}><span className="an-kpi-label">Expiring within {n('expiry_window_days')} days</span><strong>{formatInr(n('expiring_cost_paise'))}</strong><span className="an-kpi-foot">{n('expiring_units')} unit(s)</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Low-stock value</span><strong>{formatInr(n('low_stock_cost_paise'))}</strong><span className="an-kpi-foot">{n('low_stock_variants')} pack size(s) at or under their level</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Slow-moving (no sales in {n('slow_window_days')} days)</span><strong>{formatInr(n('slow_cost_paise'))}</strong><span className="an-kpi-foot">{n('slow_units')} unit(s)</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Blocked (quarantine or recalled)</span><strong>{n('units_blocked')}</strong><span className="an-kpi-foot">units</span></div>
          </div>
          <p className="field-hint">As of {String(v.asOf)}. {v.notes.join(' ')}</p>
        </>
      )}
    </section>
  );
}

interface Customers { metrics: { customers: number; new_customers: number; returning_customers: number; orders: number; revenue_paise: number; lifetime_customers: number; cohorts: { cohort: string; customers: number; orders: number; revenue_paise: number }[] }; stats: { repeatPurchaseRateBps: number | null; averageOrderPaise: number | null; purchaseFrequencyX100: number | null; observedLifetimeValuePaise: number | null } }
function CustomersView({ onExpired }: { onExpired: () => void }) {
  const [range, setRange] = useState<Range>(() => presetRange('this_year', todayIST()) as Range);
  const { data, error, loading } = useLoad<Customers>(`finance-customers?${qs(range)}`, onExpired);
  const m = data?.metrics;
  return (
    <section aria-labelledby="bcu-title">
      <div className="an-head"><div><h1 id="bcu-title">Customer purchasing</h1><p className="muted">Counts and totals only; no names or contact details are shown or exported.</p></div><ExportLink report="customers" range={range} /></div>
      <RangeBar range={range} onChange={setRange} />
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <Skeleton />}
      {data && m && (
        <>
          <div className="an-kpis">
            <div className="an-kpi"><span className="an-kpi-label">Purchasing customers</span><strong>{m.customers}</strong><span className="an-kpi-foot">{m.new_customers} new, {m.returning_customers} returning</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Repeat purchase rate</span><strong>{bpsText(data.stats.repeatPurchaseRateBps)}</strong><span className="an-kpi-foot">Customers with 2+ paid orders, of all who ever paid ({m.lifetime_customers})</span></div>
            <div className="an-kpi"><span className="an-kpi-label">Average order</span><strong>{money(data.stats.averageOrderPaise)}</strong></div>
            <div className="an-kpi"><span className="an-kpi-label">Orders per customer (all time)</span><strong>{data.stats.purchaseFrequencyX100 === null ? 'n/a' : (data.stats.purchaseFrequencyX100 / 100).toFixed(2)}</strong></div>
            <div className="an-kpi"><span className="an-kpi-label">Observed lifetime value</span><strong>{money(data.stats.observedLifetimeValuePaise)}</strong><span className="an-kpi-foot">Spend so far per customer. History, not a prediction.</span></div>
          </div>
          <h2 className="admin-subhead">Revenue by first-purchase month (customers active in this period)</h2>
          {m.cohorts.length === 0 ? <p className="muted">No purchases in this period.</p> : (
            <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Cohorts</caption><thead><tr><th scope="col">First purchase</th><th scope="col">Customers</th><th scope="col">Orders</th><th scope="col">Revenue</th></tr></thead>
              <tbody>{m.cohorts.map((c) => <tr key={c.cohort}><td>{c.cohort}</td><td>{c.customers}</td><td>{c.orders}</td><td>{formatInr(Number(c.revenue_paise))}</td></tr>)}</tbody></table></div>
          )}
        </>
      )}
    </section>
  );
}

export default function AdminFinance({ view, onExpired }: { view: FinanceView; onExpired: () => void }) {
  if (view === 'products') return <Products onExpired={onExpired} />;
  if (view === 'costs') return <Costs onExpired={onExpired} />;
  if (view === 'expenses') return <Expenses onExpired={onExpired} />;
  if (view === 'inventory') return <Inventory onExpired={onExpired} />;
  if (view === 'customers') return <CustomersView onExpired={onExpired} />;
  return <Overview onExpired={onExpired} />;
}
