import { useEffect, useRef, useState } from 'react';
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../../shared/orders';
import { Icon } from '../lib/adminIcons';
import { api, errorText, peek, useMe } from '../lib/adminKit';

interface Attention {
  variant_id: string;
  product: string;
  pack_size: string;
  kind: 'out' | 'low' | 'expiring' | 'expired';
  detail: string;
}
export interface Home {
  today: string;
  subscribers?: { total: number; pending?: number; last7: number };
  messages?: { new: number };
  issues?: { open: number; high: number };
  refunds?: { awaiting: number; toPay: number };
  members?: { total: number; last7: number };
  products?: { byStatus: Record<string, number> };
  orders?: { byStatus: Record<string, number>; toHandle: number };
  unavailable?: { area: string; hint: string }[];
  inventory?: { variants: number; out: number; low: number; expiring: number; expired: number; attention: Attention[] };
}
const KIND_LABEL: Record<Attention['kind'], string> = { expired: 'Expired', out: 'Out of stock', low: 'Low', expiring: 'Expiring' };
const KIND_BADGE: Record<Attention['kind'], string> = { expired: 'badge badge--bad', out: 'badge badge--bad', low: 'badge badge--warn', expiring: 'badge badge--warn' };
const PRODUCT_STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  IN_DEVELOPMENT: 'In development',
  UNDER_REVIEW: 'Under review',
  APPROVED_FOR_PREVIEW: 'Approved for preview',
  APPROVED_FOR_SALE: 'Approved for sale',
};

export const greeting = (): string => {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date())) % 24;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
export const firstName = (email: string): string => {
  const w = (email.split('@')[0] ?? '').split(/[._+-]+/)[0] ?? '';
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : 'there';
};
const dateTime = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
/** "Thursday, 22 Oct · 3:25 pm" */
const stamp = (d: Date): string => {
  const p = Object.fromEntries(dateTime.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month} · ${p.hour}:${p.minute} ${String(p.dayPeriod ?? '').toLowerCase()}`;
};
const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export interface AttentionItem {
  label: string;
  count: number;
  to: string;
}
/** Everything that is waiting for a person, grouped the way the side rail groups sections. Real counts only. */
export function attention(d: Home | null): { items: AttentionItem[]; shop: number; inbox: number; total: number } {
  if (!d) return { items: [], shop: 0, inbox: 0, total: 0 };
  const items: AttentionItem[] = [];
  const add = (label: string, count: number | undefined, to: string) => {
    if (count && count > 0) items.push({ label, count, to });
  };
  add('Orders to handle', d.orders?.toHandle, 'orders');
  add('Refunds to decide', d.refunds?.awaiting, 'refunds');
  add('Refunds to pay', d.refunds?.toPay, 'refunds');
  add('Stock out or expired', d.inventory ? d.inventory.out + d.inventory.expired : 0, 'inventory');
  add('New messages', d.messages?.new, 'messages');
  add('Open problem reports', d.issues?.open, 'issues');
  const sum = (tos: string[]) => items.filter((i) => tos.includes(i.to)).reduce((a, i) => a + i.count, 0);
  return { items, shop: sum(['orders', 'refunds', 'inventory']), inbox: sum(['messages', 'issues']), total: items.reduce((a, i) => a + i.count, 0) };
}

/** Loads the overview numbers once for the whole back office (the overview, the bell and the rail badges all read it). */
export function useHome(onExpired: () => void, refreshKey: unknown) {
  const [data, setData] = useState<Home | null>(() => peek<Home>('dashboard'));
  const [error, setError] = useState('');
  const expired = useRef(onExpired);
  useEffect(() => {
    expired.current = onExpired;
  });
  const loaded = useRef(false);
  useEffect(() => {
    // Load once, then again each time the overview is opened; leaving it does not trigger another request.
    if (loaded.current && refreshKey === false) return;
    loaded.current = true;
    let live = true;
    void api<Home>('dashboard').then((r) => {
      if (!live) return;
      if (r.status === 401) return expired.current();
      if (!r.ok || !r.data) return setError(errorText(r, 'Could not load the overview.'));
      setError('');
      setData(r.data);
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);
  return { data, error };
}

/** Axis step that gives four tidy gridlines. */
const niceStep = (n: number): number => {
  if (n <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  const m = n / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};

const GAUGE_TICKS = 72;
function Gauge({ pct }: { pct: number }) {
  const filled = Math.round((pct / 100) * GAUGE_TICKS);
  const ticks = Array.from({ length: GAUGE_TICKS }, (_, i) => {
    const a = ((150 + (240 * i) / (GAUGE_TICKS - 1)) * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const on = i < filled;
    const inner = on ? 66 : 70;
    return <line key={i} x1={120 + inner * c} y1={118 + inner * s} x2={120 + 100 * c} y2={118 + 100 * s} className={on ? 'ov-tick ov-tick--on' : 'ov-tick'} style={on ? { opacity: 0.35 + 0.65 * (i / Math.max(1, filled)) } : undefined} />;
  });
  return (
    <svg className="ov-gauge" viewBox="0 0 240 180" role="img" aria-label={`${pct.toFixed(1)} percent of products approved for sale`}>
      {ticks}
    </svg>
  );
}

const STATUS_COLOR: Record<string, string> = { placed: '#c49c62', paid: '#3f7d5c', packed: '#6f9fb8', shipped: '#1f7a55', delivered: '#45b88c', cancelled: '#d28b84' };


/** Overview shown first: what needs attention today. Each block appears only when the role may read that area. */
export default function AdminHome({ data, error, go }: { data: Home | null; error: string; go: (tab: string) => void }) {
  const me = useMe();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const orderCounts = ORDER_STATUSES.map((s) => data?.orders?.byStatus[s] ?? 0);
  const orderMax = Math.max(1, ...orderCounts);
  const orderTotal = orderCounts.reduce((a, b) => a + b, 0);
  const step = niceStep(orderMax / 4);
  const axisMax = step * 4;
  const productEntries = Object.entries(PRODUCT_STATUS).map(([k, label]) => [label, data?.products?.byStatus[k] ?? 0] as const);
  const productTotal = productEntries.reduce((a, [, n]) => a + n, 0);
  const forSale = data?.products?.byStatus.APPROVED_FOR_SALE ?? 0;
  const salePct = productTotal === 0 ? 0 : (forSale / productTotal) * 100;

  const parts: string[] = [];
  if (data?.orders && data.orders.toHandle > 0) parts.push(`${plural(data.orders.toHandle, 'order')} to handle`);
  if (data?.messages && data.messages.new > 0) parts.push(`${plural(data.messages.new, 'new message')}`);
  if (data?.refunds && data.refunds.awaiting > 0) parts.push(`${plural(data.refunds.awaiting, 'refund')} to decide`);
  if (data?.issues && data.issues.open > 0) parts.push(`${plural(data.issues.open, 'open report')}`);
  const lead = parts.length === 0 ? 'Everything is up to date.' : null;

  const ctas = ([
    ['orders', 'Open orders', 'orders.read'],
    ['products', 'Open products', 'products.read'],
    ['messages', 'Read messages', 'messages.read'],
  ] as const).filter(([, , perm]) => me.can(perm));

  const lowTotal = data?.inventory ? data.inventory.low + data.inventory.out : 0;

  return (
    <section aria-labelledby="home-title" className="dash">
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {!data && !error && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          {data.unavailable && data.unavailable.length > 0 && (
            <div className="form-status form-status--info" role="status">
              <strong>Some information could not be loaded.</strong> The rest of the overview is shown below.
              <ul>
                {data.unavailable.map((u) => (
                  <li key={u.area}>
                    <strong>{u.area}:</strong> {u.hint}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!me.commerceEnabled && <p className="notice">Selling is off. Orders and checkout are locked.</p>}

          <div className="ov-top">
            <div className="ov-welcome">
              <span className="ov-date"><i aria-hidden="true" />{stamp(now)}</span>
              <h1 id="home-title">Welcome back, {firstName(me.email)}!</h1>
              <p className="ov-lead">
                {lead ?? (
                  <>
                    Here’s what needs you today: {parts.map((t, i) => (
                      <span key={t}>
                        {i > 0 && (i === parts.length - 1 ? ' and ' : ', ')}
                        <strong>{t}</strong>
                      </span>
                    ))}.
                  </>
                )}
              </p>
              {ctas.length > 0 && (
                <div className="ov-cta">
                  {ctas.slice(0, 2).map(([to, label], i) => (
                    <button key={to} type="button" className={i === 0 ? 'ov-btn ov-btn--primary' : 'ov-btn'} onClick={() => go(to)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ov-kpis">
              {data.orders && (
                <button type="button" className="ov-kpi" data-tone="ok" onClick={() => go('orders')}>
                  <span className="ov-kpi-head"><span>Orders to handle</span><span className="ov-kpi-icon"><Icon name="orders" size={18} /></span></span>
                  <span className="ov-kpi-num"><strong>{data.orders.toHandle}</strong></span>
                  <span className="ov-kpi-foot">{plural(orderTotal, 'order')} in total</span>
                </button>
              )}
              {data.members ? (
                <button type="button" className="ov-kpi" data-tone="info" onClick={() => go('members')}>
                  <span className="ov-kpi-head"><span>Members</span><span className="ov-kpi-icon"><Icon name="members" size={18} /></span></span>
                  <span className="ov-kpi-num">
                    <strong>{data.members.total}</strong>
                    {data.members.last7 > 0 && <span className="ov-delta ov-delta--up"><Icon name="up" size={14} />+{data.members.last7}</span>}
                  </span>
                  <span className="ov-kpi-foot">{data.members.last7 > 0 ? 'joined this week' : 'Customer accounts'}</span>
                </button>
              ) : (
                data.subscribers && (
                  <button type="button" className="ov-kpi" data-tone="info" onClick={() => go('subscribers')}>
                    <span className="ov-kpi-head"><span>Launch list</span><span className="ov-kpi-icon"><Icon name="subscribers" size={18} /></span></span>
                    <span className="ov-kpi-num">
                      <strong>{data.subscribers.total}</strong>
                      {data.subscribers.last7 > 0 && <span className="ov-delta ov-delta--up"><Icon name="up" size={14} />+{data.subscribers.last7}</span>}
                    </span>
                    <span className="ov-kpi-foot">{data.subscribers.last7 > 0 ? 'joined this week' : 'Confirmed sign-ups'}</span>
                  </button>
                )
              )}
              {data.inventory && (
                <button type="button" className="ov-kpi" data-tone={lowTotal > 0 ? 'warn' : 'ok'} onClick={() => go('inventory')}>
                  <span className="ov-kpi-head"><span>Low stock items</span><span className="ov-kpi-icon"><Icon name="alert" size={18} /></span></span>
                  <span className="ov-kpi-num">
                    <strong>{lowTotal}</strong>
                    {data.inventory.out > 0 && <span className="ov-delta ov-delta--bad"><Icon name="alert" size={13} />{data.inventory.out} out</span>}
                  </span>
                  <span className="ov-kpi-foot">{data.inventory.expired} expired · {data.inventory.expiring} expiring in 90 days</span>
                </button>
              )}
            </div>
          </div>

          <div className="ov-mid">
            {data.orders && (
              <article className="ov-card ov-chart" aria-labelledby="dash-chart-h">
                <div className="ov-card-head">
                  <h2 id="dash-chart-h" className="ov-card-title">Orders by status</h2>
                  <ul className="ov-legend">
                    {ORDER_STATUSES.map((s) => (
                      <li key={s}><i style={{ background: STATUS_COLOR[s] }} aria-hidden="true" />{ORDER_STATUS_LABELS[s]}</li>
                    ))}
                  </ul>
                  {me.can('orders.read') && (
                    <button type="button" className="ov-round" onClick={() => go('orders')} aria-label="Open orders"><Icon name="arrow" size={16} /></button>
                  )}
                </div>
                <div className="ov-plot" role="img" aria-label={ORDER_STATUSES.map((s, i) => `${ORDER_STATUS_LABELS[s]}: ${orderCounts[i]}`).join(', ')}>
                  <div className="ov-axis" aria-hidden="true">
                    {[4, 3, 2, 1, 0].map((i) => (
                      <span key={i}>{step * i}</span>
                    ))}
                  </div>
                  <div className="ov-grid" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} />
                    ))}
                  </div>
                  <div className="ov-cols">
                    {ORDER_STATUSES.map((s, i) => (
                      <div className="ov-col" key={s} tabIndex={0}>
                        <span className="ov-tip">
                          <strong>{ORDER_STATUS_LABELS[s]}</strong>
                          <span>{plural(orderCounts[i], 'order')}</span>
                        </span>
                        <span className="ov-bar" style={{ height: `${Math.max(orderCounts[i] === 0 ? 0 : 3, Math.round((orderCounts[i] / axisMax) * 100))}%`, background: STATUS_COLOR[s] }} />
                        <span className="ov-col-l">{ORDER_STATUS_LABELS[s]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="ov-note">Where every order stands right now. {plural(orderTotal, 'order')} in total.</p>
              </article>
            )}

            {data.products && (
              <article className="ov-card ov-gaugecard" aria-labelledby="dash-gauge-h">
                <div className="ov-card-head">
                  <h2 id="dash-gauge-h" className="ov-card-title">Catalogue overview</h2>
                  <button type="button" className="ov-round" onClick={() => go('products')} aria-label="Open products"><Icon name="arrow" size={16} /></button>
                </div>
                <div className="ov-gauge-wrap">
                  <Gauge pct={salePct} />
                  <div className="ov-gauge-mid">
                    <strong>{salePct.toFixed(1)}%</strong>
                    <span>Approved for sale</span>
                  </div>
                </div>
                <div className="ov-gauge-stats">
                  <div><span>Products</span><strong>{productTotal}</strong></div>
                  <div><span>Approved for sale</span><strong>{forSale}</strong></div>
                </div>
              </article>
            )}
          </div>

          <div className="dash-grid ov-low">
            {data.inventory && (
              <article className="dash-card dash-stock" aria-labelledby="dash-stock-h">
                <div className="dash-card-head">
                  <h2 id="dash-stock-h" className="dash-card-title">Stock needing attention</h2>
                  <button type="button" className="dash-btn dash-btn--sm" onClick={() => go('inventory')}>Open stock</button>
                </div>
                <ul className="dash-chips">
                  <li data-tone={data.inventory.expired > 0 ? 'bad' : undefined}>{data.inventory.expired} expired</li>
                  <li data-tone={data.inventory.out > 0 ? 'bad' : undefined}>{data.inventory.out} out of stock</li>
                  <li data-tone={data.inventory.low > 0 ? 'warn' : undefined}>{data.inventory.low} low</li>
                  <li data-tone={data.inventory.expiring > 0 ? 'warn' : undefined}>{data.inventory.expiring} expiring in 90 days</li>
                </ul>
                {data.inventory.attention.length === 0 ? (
                  <p className="muted dash-empty">{data.inventory.variants === 0 ? 'No pack sizes yet.' : 'Nothing needs attention.'}</p>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <caption className="sr-only">Stock needing attention</caption>
                      <thead>
                        <tr>
                          <th scope="col">Product</th>
                          <th scope="col">Pack</th>
                          <th scope="col">Issue</th>
                          <th scope="col">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.inventory.attention.map((a) => (
                          <tr key={`${a.variant_id}-${a.kind}`}>
                            <td><strong>{a.product}</strong></td>
                            <td>{a.pack_size}</td>
                            <td>
                              <span className={KIND_BADGE[a.kind]}>{KIND_LABEL[a.kind]}</span>
                            </td>
                            <td className="audit-detail">{a.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            )}

            {(data.subscribers || data.members) && (
              <article className="dash-card dash-audience" aria-labelledby="dash-aud-h">
                <h2 id="dash-aud-h" className="dash-card-title">Audience</h2>
                <ul className="dash-facts">
                  {data.members && fact('Members', data.members.total, 'members', data.members.last7 > 0 ? `+${data.members.last7} this week` : undefined)}
                  {data.subscribers && fact('On the launch list', data.subscribers.total, 'subscribers', data.subscribers.last7 > 0 ? `+${data.subscribers.last7} this week` : undefined)}
                  {data.subscribers && fact('Awaiting confirmation', data.subscribers.pending ?? 0, 'subscribers')}
                </ul>
              </article>
            )}

            {data.products && (
              <article className="dash-card dash-products" aria-labelledby="dash-prod-h">
                <div className="dash-card-head">
                  <h2 id="dash-prod-h" className="dash-card-title">Products by status</h2>
                  <button type="button" className="dash-btn dash-btn--sm" onClick={() => go('products')}>Open products</button>
                </div>
                <ul className="dash-meter">
                  {productEntries.map(([label, n]) => (
                    <li key={label}>
                      <span>{label}</span>
                      <span className="dash-meter-track" aria-hidden="true">
                        <span style={{ width: `${Math.round((n / Math.max(1, productTotal)) * 100)}%` }} />
                      </span>
                      <strong>{n}</strong>
                    </li>
                  ))}
                </ul>
              </article>
            )}
          </div>
        </>
      )}
    </section>
  );

  function fact(label: string, value: number, to?: string, note?: string, tone?: 'bad' | 'warn') {
    return (
      <li key={label} data-tone={value > 0 ? tone : undefined}>
        <span className="dash-fact-label">{label}</span>
        <strong>{value}</strong>
        {note && <span className="dash-pill dash-pill--up">{note}</span>}
        {to && (
          <button type="button" className="dash-fact-link" onClick={() => go(to)} aria-label={`Open ${label}`}>
            <Icon name="arrow" size={14} />
          </button>
        )}
      </li>
    );
  }
}
