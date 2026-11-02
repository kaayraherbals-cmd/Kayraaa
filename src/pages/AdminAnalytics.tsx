import { useEffect, useMemo, useRef, useState } from 'react';
import { ANALYTICS_WINDOWS, pctChange, type AnalyticsDays, type SalesReport, type StockHealth } from '../../shared/analytics';
import { Icon } from '../lib/adminIcons';
import { api, errorText } from '../lib/adminKit';

export type AnalyticsView = 'reports' | 'sales' | 'stock';
interface Payload {
  days: AnalyticsDays;
  sales?: SalesReport;
  stock?: StockHealth;
  unavailable?: { area: string; hint: string }[];
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');
const money = (paise: number): string => inr.format(Math.round(paise / 100));
const compact = (paise: number): string => {
  const r = paise / 100;
  return r >= 1e7 ? `₹${(r / 1e7).toFixed(1)}Cr` : r >= 1e5 ? `₹${(r / 1e5).toFixed(1)}L` : r >= 1e3 ? `₹${(r / 1e3).toFixed(1)}k` : `₹${Math.round(r)}`;
};
const shortDay = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const CHANNEL_LABEL: Record<string, string> = { online: 'Online store', manual: 'Entered by team' };
const WINDOW_LABEL: Record<number, string> = { 30: '30 days', 90: '90 days', 365: 'This year' };

function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  const c = pctChange(now, before);
  if (c === null) return <span className="an-delta an-delta--none">no earlier data</span>;
  const good = invert ? c <= 0 : c >= 0;
  return (
    <span className={good ? 'an-delta an-delta--up' : 'an-delta an-delta--down'}>
      <Icon name={c >= 0 ? 'up' : 'down'} size={13} />
      {Math.abs(c).toFixed(1)}%
    </span>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * 100).toFixed(2)},${(26 - (v / max) * 24).toFixed(2)}`).join(' ');
  return (
    <svg className="an-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ label, value, now, before, values, invert, active, onClick }: { label: string; value: string; now: number; before: number; values: number[]; invert?: boolean; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="an-kpi" aria-pressed={active} data-active={active ? 'true' : undefined} onClick={onClick}>
      <span className="an-kpi-label">{label}</span>
      <strong>{value}</strong>
      <span className="an-kpi-foot"><Delta now={now} before={before} invert={invert} /><Spark values={values} /></span>
    </button>
  );
}

/** Revenue line with the previous period dashed behind it. Hover or focus a day for its numbers. */
function RevenueChart({ r, compare, split }: { r: SalesReport; compare: boolean; split: boolean }) {
  const W = 720, H = 260, L = 46, B = 26, T = 12, R = 8;
  const n = r.series.length;
  const [hover, setHover] = useState<number | null>(null);
  const all = [...r.series.map((p) => p.revenue), ...(compare ? r.previousSeries : [])];
  const rawMax = Math.max(1, ...all);
  const p10 = 10 ** Math.floor(Math.log10(rawMax / 4));
  const step = Math.ceil(rawMax / 4 / p10) * p10;
  const max = step * 4;
  const x = (i: number) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const cur = r.series.map((p) => p.revenue);
  const area = `${line(cur)} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, 1, 2, 3, 4];
  const labelAt = [0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1];
  const hp = hover === null ? null : r.series[hover];
  return (
    <div className="an-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Revenue per day, ${shortDay(r.from)} to ${shortDay(r.to)}`} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="an-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(step * t)} y2={y(step * t)} className="an-grid" />
            <text x={L - 8} y={y(step * t) + 4} textAnchor="end" className="an-axis">{compact(step * t)}</text>
          </g>
        ))}
        {labelAt.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="an-axis">{shortDay(r.series[i]?.date ?? r.to)}</text>
        ))}
        {compare && <path d={line(r.previousSeries)} className="an-prev" fill="none" />}
        <path d={area} fill="url(#an-fill)" className="an-area" />
        <path d={line(cur)} className="an-line" fill="none" />
        {split && <path d={line(r.series.map((p) => p.online))} className="an-line an-line--b" fill="none" />}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="an-cursor" />}
        {r.series.map((p, i) => (
          <rect key={p.date} x={x(i) - (W - L - R) / (2 * n)} y={T} width={(W - L - R) / n} height={H - T - B} fill="transparent" tabIndex={0} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${shortDay(p.date)}: ${money(p.revenue)}, ${p.orders} orders`} />
        ))}
      </svg>
      {hp && hover !== null && (
        <div className="an-tip" style={{ left: `${Math.min(78, Math.max(2, (x(hover) / W) * 100))}%` }} role="status">
          <strong>{shortDay(hp.date)}</strong>
          <span>Revenue {money(hp.revenue)}</span>
          <span>{hp.orders} {hp.orders === 1 ? 'order' : 'orders'}</span>
          {compare && <span className="an-tip-prev">Before: {money(r.previousSeries[hover] ?? 0)}</span>}
        </div>
      )}
    </div>
  );
}

function Bars({ rows, fmt }: { rows: { label: string; value: number; note: string }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((x) => x.value));
  if (rows.length === 0) return <p className="muted an-empty">Nothing in this period yet.</p>;
  return (
    <ol className="an-rank">
      {rows.map((x, i) => (
        <li key={x.label}>
          <span className="an-rank-n">{i + 1}</span>
          <span className="an-rank-body">
            <span className="an-rank-top"><strong>{x.label}</strong><span>{fmt(x.value)}</span></span>
            <span className="an-rank-note">{x.note}</span>
            <span className="an-rank-track" aria-hidden="true"><span style={{ width: `${Math.max(3, Math.round((x.value / max) * 100))}%` }} /></span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function AdminAnalytics({ view, onExpired, go }: { view: AnalyticsView; onExpired: () => void; go: (tab: string) => void }) {
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState(true);
  const [split, setSplit] = useState(false);
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');

  const expired = useRef(onExpired);
  useEffect(() => {
    expired.current = onExpired;
  });
  useEffect(() => {
    let live = true;
    setData(null);
    void api<Payload>(`analytics?days=${days}`).then((r) => {
      if (!live) return;
      if (r.status === 401) return expired.current();
      if (!r.ok || !r.data) return setError(errorText(r, 'Could not load the numbers.'));
      setError('');
      setData(r.data);
    });
    return () => {
      live = false;
    };
  }, [days]);

  const s = data?.sales;
  const series = useMemo(() => (s ? s.series : []), [s]);
  const title = view === 'reports' ? 'Reports' : view === 'sales' ? 'Sales' : 'Stock health';
  const sub = view === 'reports' ? 'Build a report from your own numbers' : view === 'sales' ? 'Who buys, what sells, and when' : 'What is on the shelf, what is running out and what is about to expire';
  const missing = data?.unavailable?.find((u) => u.area === (view === 'stock' ? 'Stock' : 'Sales'));

  const exportCsv = () => {
    if (!s) return;
    const rows = [['Date', 'Revenue (INR)', 'Orders', 'Online (INR)', 'Entered by team (INR)'], ...s.series.map((p) => [p.date, (p.revenue / 100).toFixed(2), String(p.orders), (p.online / 100).toFixed(2), (p.manual / 100).toFixed(2)])];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `kaayra-sales-${s.from}-to-${s.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="an" aria-labelledby="an-title">
      <header className="an-head">
        <div>
          <h1 id="an-title">{title}</h1>
          <p className="muted">{sub}</p>
        </div>
        <div className="an-tools">
          <div className="an-seg" role="group" aria-label="Period">
            {ANALYTICS_WINDOWS.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{WINDOW_LABEL[d]}</button>
            ))}
          </div>
          {view !== 'stock' && <button type="button" className="ov-btn ov-btn--primary" onClick={exportCsv} disabled={!s}>Export CSV</button>}
        </div>
      </header>

      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {!data && !error && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {missing && <div className="form-status form-status--info" role="status"><strong>{missing.area} could not be loaded.</strong> {missing.hint}</div>}
      {data && !data.sales && view !== 'stock' && !missing && <p className="notice">Your role cannot read orders, so there are no sales numbers to show.</p>}
      {data && !data.stock && view === 'stock' && !missing && <p className="notice">Your role cannot read stock.</p>}

      {s && view !== 'stock' && (
        <>
          {s.truncated && <p className="notice">There are more than 10,000 orders in this period. Only the newest 10,000 are counted.</p>}
          <div className="an-kpis" role="group" aria-label="Key numbers">
            <Kpi label="Revenue" value={money(s.current.revenue)} now={s.current.revenue} before={s.previous.revenue} values={series.map((p) => p.revenue)} active={metric === 'revenue'} onClick={() => setMetric('revenue')} />
            <Kpi label="Orders" value={num.format(s.current.orders)} now={s.current.orders} before={s.previous.orders} values={series.map((p) => p.orders)} active={metric === 'orders'} onClick={() => setMetric('orders')} />
            <Kpi label="Units sold" value={num.format(s.current.units)} now={s.current.units} before={s.previous.units} values={series.map((p) => p.orders)} />
            <Kpi label="Average order" value={money(s.current.aov)} now={s.current.aov} before={s.previous.aov} values={series.map((p) => (p.orders === 0 ? 0 : p.revenue / p.orders))} />
            <Kpi label="Cancelled" value={num.format(s.current.cancelled)} now={s.current.cancelled} before={s.previous.cancelled} values={[]} invert />
          </div>

          <article className="ov-card an-main">
            <div className="ov-card-head">
              <h2 className="ov-card-title">{metric === 'revenue' ? 'Revenue' : 'Orders'} <span className="muted an-sub">{shortDay(s.from)} – {shortDay(s.to)}</span></h2>
              <label className="an-switch"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /><span aria-hidden="true" />Compare with previous {days === 365 ? 'year' : `${days} days`}</label>
              <label className="an-switch"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /><span aria-hidden="true" />Show online store</label>
            </div>
            {metric === 'revenue' ? (
              <RevenueChart r={s} compare={compare} split={split} />
            ) : (
              <RevenueChart r={{ ...s, series: s.series.map((p) => ({ ...p, revenue: p.orders, online: 0 })), previousSeries: s.previousSeries.map(() => 0) }} compare={false} split={false} />
            )}
            <p className="ov-note">Revenue is the order total (goods plus shipping) of every order that is not cancelled, by the day it was placed (India time). Refunds, GST and discounts are not taken off.</p>
          </article>

          <div className="an-two">
            <article className="ov-card">
              <h2 className="ov-card-title">Revenue by channel</h2>
              <Bars rows={s.byChannel.map((c) => ({ label: CHANNEL_LABEL[c.channel] ?? c.channel, value: c.revenue, note: `${num.format(c.orders)} orders` }))} fmt={money} />
            </article>
            <article className="ov-card">
              <h2 className="ov-card-title">Sales by state</h2>
              <Bars rows={s.byState.map((c) => ({ label: c.state, value: c.revenue, note: `${num.format(c.orders)} orders` }))} fmt={money} />
              {s.byState.some((c) => c.state === 'Not labelled') && <p className="ov-note">“Not labelled” means that PIN code has no state in Delivery areas. <button type="button" className="an-link" onClick={() => go('delivery')}>Open Delivery areas</button></p>}
            </article>
          </div>
          {view === 'sales' && (
            <article className="ov-card">
              <h2 className="ov-card-title">Best sellers</h2>
              <Bars rows={s.topProducts.map((p) => ({ label: p.name, value: p.revenue, note: `${num.format(p.units)} units` }))} fmt={money} />
            </article>
          )}
        </>
      )}

      {data?.stock && view === 'stock' && <StockPanel h={data.stock} days={days} go={go} />}
    </section>
  );
}

const STATE_BADGE = { out: 'badge badge--bad', low: 'badge badge--warn', ok: 'badge' } as const;
const STATE_LABEL = { out: 'Out of stock', low: 'Running low', ok: 'Healthy' } as const;

function StockPanel({ h, days, go }: { h: StockHealth; days: number; go: (tab: string) => void }) {
  const total = Math.max(1, h.skus);
  const maxB = Math.max(1, ...h.expiryBuckets.map((b) => b.units));
  return (
    <>
      <div className="an-kpis" role="group" aria-label="Stock numbers">
        <div className="an-kpi an-kpi--static"><span className="an-kpi-label">Pack sizes</span><strong>{num.format(h.skus)}</strong></div>
        <div className="an-kpi an-kpi--static"><span className="an-kpi-label">Units on hand</span><strong>{num.format(h.units)}</strong></div>
        <div className="an-kpi an-kpi--static"><span className="an-kpi-label">Stock value at selling price</span><strong>{money(h.value)}</strong>{h.valueUnpriced > 0 && <span className="an-kpi-foot">{num.format(h.valueUnpriced)} units have no price</span>}</div>
        <div className="an-kpi an-kpi--static" data-tone={h.out + h.low > 0 ? 'warn' : undefined}><span className="an-kpi-label">Out or low</span><strong>{h.out + h.low}</strong><span className="an-kpi-foot">{h.out} out · {h.low} low</span></div>
        <div className="an-kpi an-kpi--static" data-tone={h.expired > 0 ? 'bad' : undefined}><span className="an-kpi-label">Expired units</span><strong>{num.format(h.expired)}</strong><span className="an-kpi-foot">{num.format(h.expiring)} expire within 90 days</span></div>
      </div>
      <div className="an-two">
        <article className="ov-card">
          <h2 className="ov-card-title">Shelf health</h2>
          <div className="an-stack" role="img" aria-label={`${h.healthy} healthy, ${h.low} low, ${h.out} out of stock`}>
            <span className="an-seg-ok" style={{ width: `${(h.healthy / total) * 100}%` }} />
            <span className="an-seg-low" style={{ width: `${(h.low / total) * 100}%` }} />
            <span className="an-seg-out" style={{ width: `${(h.out / total) * 100}%` }} />
          </div>
          <ul className="ov-legend an-legend">
            <li><i className="an-dot-ok" aria-hidden="true" />Healthy {h.healthy}</li>
            <li><i className="an-dot-low" aria-hidden="true" />Running low {h.low}</li>
            <li><i className="an-dot-out" aria-hidden="true" />Out of stock {h.out}</li>
          </ul>
        </article>
        <article className="ov-card">
          <h2 className="ov-card-title">Units by expiry</h2>
          <ul className="an-exp">
            {h.expiryBuckets.map((b, i) => (
              <li key={b.label} data-tone={i === 0 && b.units > 0 ? 'bad' : i === 1 && b.units > 0 ? 'warn' : undefined}>
                <span>{b.label}</span>
                <span className="an-rank-track" aria-hidden="true"><span style={{ width: `${b.units === 0 ? 0 : Math.max(3, Math.round((b.units / maxB) * 100))}%` }} /></span>
                <strong>{num.format(b.units)}</strong>
              </li>
            ))}
          </ul>
        </article>
      </div>
      <article className="ov-card">
        <div className="ov-card-head">
          <h2 className="ov-card-title">Every pack size</h2>
          <button type="button" className="ov-btn" onClick={() => go('inventory')}>Open Stock</button>
        </div>
        {h.lines.length === 0 ? <p className="muted an-empty">No active pack sizes yet.</p> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Stock health by pack size</caption>
              <thead><tr><th scope="col">Product</th><th scope="col">Pack</th><th scope="col">Status</th><th scope="col">On hand</th><th scope="col">Value</th><th scope="col">Sold ({days === 365 ? 'year' : `${days}d`})</th><th scope="col">Cover</th><th scope="col">Next expiry</th></tr></thead>
              <tbody>
                {h.lines.map((l) => (
                  <tr key={l.variant_id}>
                    <td><strong>{l.product}</strong></td>
                    <td>{l.pack_size}</td>
                    <td><span className={STATE_BADGE[l.state]}>{STATE_LABEL[l.state]}</span></td>
                    <td>{num.format(l.units)}</td>
                    <td>{l.value === null ? 'No price' : money(l.value)}</td>
                    <td>{num.format(l.soldInWindow)}</td>
                    <td>{l.daysCover === null ? '–' : `${num.format(l.daysCover)} days`}</td>
                    <td>{l.nextExpiry ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ov-note">Cover = sellable units divided by units sold in this period, scaled to that period. It is a rough guide, not a forecast. Value uses each pack’s selling price, not cost.</p>
      </article>
    </>
  );
}
