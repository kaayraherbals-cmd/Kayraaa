/**
 * Reports, Sales and Stock health numbers for the admin. Pure functions: the API reads rows, these add them up.
 * Real data only. Revenue = order total (goods + shipping) of every order that is not cancelled, in paise.
 * Refunds, discounts applied outside the order total and GST are NOT netted out. The screens say so.
 */
export const ANALYTICS_WINDOWS = [30, 90, 365] as const;
export type AnalyticsDays = (typeof ANALYTICS_WINDOWS)[number];
export const parseDays = (v: unknown): AnalyticsDays => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (ANALYTICS_WINDOWS as readonly number[]).includes(n) ? (n as AnalyticsDays) : 30;
};

export interface OrderRow { id: string; status: string; channel: string; total_paise: number; ship_pincode: string; created_at: string }
export interface ItemRow { order_id: string; variant_id?: string; product_name: string; qty: number; line_total_paise: number }
export interface PincodeRow { pincode: string; state: string | null }

export interface Totals { revenue: number; orders: number; units: number; aov: number; cancelled: number }
export interface DayPoint { date: string; revenue: number; orders: number; manual: number; online: number }
export interface SalesReport {
  days: AnalyticsDays;
  from: string;
  to: string;
  current: Totals;
  previous: Totals;
  series: DayPoint[];
  previousSeries: number[];
  byChannel: { channel: string; revenue: number; orders: number }[];
  byState: { state: string; revenue: number; orders: number }[];
  topProducts: { name: string; units: number; revenue: number }[];
  truncated: boolean;
}

const IST_MS = 330 * 60_000;
/** Calendar day (YYYY-MM-DD) in India time. */
export const istDay = (ms: number): string => new Date(ms + IST_MS).toISOString().slice(0, 10);
const dayStartMs = (isoDay: string): number => Date.parse(`${isoDay}T00:00:00Z`) - IST_MS;
const DAY = 86_400_000;
const zero = (): Totals => ({ revenue: 0, orders: 0, units: 0, aov: 0, cancelled: 0 });

export function buildSales(orders: OrderRow[], items: ItemRow[], pins: PincodeRow[], days: AnalyticsDays, nowMs: number, truncated = false): SalesReport {
  const today = istDay(nowMs);
  const startMs = dayStartMs(today) - (days - 1) * DAY;
  const prevStartMs = startMs - days * DAY;
  const endMs = dayStartMs(today) + DAY;
  const stateOf = new Map(pins.map((p) => [p.pincode, p.state?.trim() || '']));
  const unitsByOrder = new Map<string, number>();
  const prodByOrder = new Map<string, ItemRow[]>();
  for (const it of items) {
    unitsByOrder.set(it.order_id, (unitsByOrder.get(it.order_id) ?? 0) + it.qty);
    const list = prodByOrder.get(it.order_id);
    if (list) list.push(it);
    else prodByOrder.set(it.order_id, [it]);
  }
  const cur = zero();
  const prev = zero();
  const series: DayPoint[] = Array.from({ length: days }, (_, i) => ({ date: istDay(startMs + i * DAY + 1), revenue: 0, orders: 0, manual: 0, online: 0 }));
  const previousSeries: number[] = Array.from({ length: days }, () => 0);
  const channel = new Map<string, { revenue: number; orders: number }>();
  const state = new Map<string, { revenue: number; orders: number }>();
  const product = new Map<string, { units: number; revenue: number }>();

  for (const o of orders) {
    const t = Date.parse(o.created_at);
    if (!Number.isFinite(t) || t < prevStartMs || t >= endMs) continue;
    const inCurrent = t >= startMs;
    const bucket = inCurrent ? cur : prev;
    if (o.status === 'cancelled') {
      bucket.cancelled++;
      continue;
    }
    bucket.revenue += o.total_paise;
    bucket.orders++;
    bucket.units += unitsByOrder.get(o.id) ?? 0;
    if (!inCurrent) {
      const i = Math.floor((t - prevStartMs) / DAY);
      if (i >= 0 && i < days) previousSeries[i] = (previousSeries[i] ?? 0) + o.total_paise;
      continue;
    }
    const i = Math.min(days - 1, Math.floor((t - startMs) / DAY));
    const p = series[i];
    if (p) {
      p.revenue += o.total_paise;
      p.orders++;
      if (o.channel === 'online') p.online += o.total_paise;
      else p.manual += o.total_paise;
    }
    const c = channel.get(o.channel) ?? { revenue: 0, orders: 0 };
    c.revenue += o.total_paise;
    c.orders++;
    channel.set(o.channel, c);
    const sName = stateOf.get(o.ship_pincode) || 'Not labelled';
    const s = state.get(sName) ?? { revenue: 0, orders: 0 };
    s.revenue += o.total_paise;
    s.orders++;
    state.set(sName, s);
    for (const it of prodByOrder.get(o.id) ?? []) {
      const pr = product.get(it.product_name) ?? { units: 0, revenue: 0 };
      pr.units += it.qty;
      pr.revenue += it.line_total_paise;
      product.set(it.product_name, pr);
    }
  }
  for (const b of [cur, prev]) b.aov = b.orders === 0 ? 0 : Math.round(b.revenue / b.orders);
  const top = <T extends { revenue: number }>(m: Map<string, T>, n: number) => [...m.entries()].sort((a, b) => b[1].revenue - a[1].revenue || a[0].localeCompare(b[0])).slice(0, n);
  return {
    days,
    from: series[0]?.date ?? today,
    to: today,
    current: cur,
    previous: prev,
    series,
    previousSeries,
    byChannel: top(channel, 5).map(([c, v]) => ({ channel: c, ...v })),
    byState: top(state, 8).map(([s, v]) => ({ state: s, ...v })),
    topProducts: top(product, 8).map(([name, v]) => ({ name, ...v })),
    truncated,
  };
}

/** Units sold per variant over the window, cancelled orders excluded. */
export function soldByVariant(orders: OrderRow[], items: ItemRow[], days: AnalyticsDays, nowMs: number): Map<string, number> {
  const startMs = dayStartMs(istDay(nowMs)) - (days - 1) * DAY;
  const ok = new Set(orders.filter((o) => o.status !== 'cancelled' && Date.parse(o.created_at) >= startMs).map((o) => o.id));
  const out = new Map<string, number>();
  for (const it of items) if (it.variant_id && ok.has(it.order_id)) out.set(it.variant_id, (out.get(it.variant_id) ?? 0) + it.qty);
  return out;
}

/** Percentage change, null when there is nothing to compare with. */
export const pctChange = (now: number, before: number): number | null => (before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10);

export interface StockVariant { id: string; product: string; pack_size: string; price_paise: number | null; threshold: number }
export interface StockBatch { variant_id: string; status: string; expiry_date: string; qty_on_hand: number; qty_reserved: number }
export interface StockHealth {
  skus: number;
  units: number;
  value: number;
  valueUnpriced: number;
  out: number;
  low: number;
  healthy: number;
  expiring: number;
  expired: number;
  expiryBuckets: { label: string; units: number }[];
  lines: { variant_id: string; product: string; pack_size: string; units: number; value: number | null; state: 'out' | 'low' | 'ok'; nextExpiry: string | null; soldInWindow: number; daysCover: number | null }[];
}

const addDays = (isoDay: string, n: number): string => new Date(Date.parse(`${isoDay}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Sellable = active batch, not expired, on hand minus reserved. Value = sellable-or-not units on hand at the pack's selling price. */
export function buildStockHealth(variants: StockVariant[], batches: StockBatch[], soldByVariant: Map<string, number>, windowDays: number, today: string): StockHealth {
  const d30 = addDays(today, 30);
  const d90 = addDays(today, 90);
  const buckets = [0, 0, 0, 0];
  const lines: StockHealth['lines'] = [];
  let units = 0, value = 0, valueUnpriced = 0, out = 0, low = 0, healthy = 0, expiring = 0, expired = 0;
  for (const v of variants) {
    const bs = batches.filter((b) => b.variant_id === v.id && b.qty_on_hand > 0);
    let onHand = 0, avail = 0, next: string | null = null;
    for (const b of bs) {
      onHand += b.qty_on_hand;
      if (b.expiry_date < today) {
        expired += b.qty_on_hand;
        buckets[0]! += b.qty_on_hand;
      } else {
        if (b.status === 'active') avail += Math.max(0, b.qty_on_hand - b.qty_reserved);
        if (b.expiry_date <= d30) buckets[1]! += b.qty_on_hand;
        else if (b.expiry_date <= d90) buckets[2]! += b.qty_on_hand;
        else buckets[3]! += b.qty_on_hand;
        if (b.expiry_date <= d90) expiring += b.qty_on_hand;
      }
      if (next === null || b.expiry_date < next) next = b.expiry_date;
    }
    const state: 'out' | 'low' | 'ok' = avail === 0 ? 'out' : avail <= v.threshold ? 'low' : 'ok';
    if (state === 'out') out++;
    else if (state === 'low') low++;
    else healthy++;
    units += onHand;
    const lineValue = v.price_paise === null ? null : onHand * v.price_paise;
    if (lineValue === null) valueUnpriced += onHand;
    else value += lineValue;
    const sold = soldByVariant.get(v.id) ?? 0;
    lines.push({ variant_id: v.id, product: v.product, pack_size: v.pack_size, units: onHand, value: lineValue, state, nextExpiry: next, soldInWindow: sold, daysCover: sold > 0 ? Math.round((avail / sold) * windowDays) : null });
  }
  const rank = { out: 0, low: 1, ok: 2 } as const;
  lines.sort((a, b) => rank[a.state] - rank[b.state] || a.product.localeCompare(b.product));
  return {
    skus: variants.length, units, value, valueUnpriced, out, low, healthy, expiring, expired,
    expiryBuckets: [{ label: 'Expired', units: buckets[0]! }, { label: '≤ 30 days', units: buckets[1]! }, { label: '31–90 days', units: buckets[2]! }, { label: '> 90 days', units: buckets[3]! }],
    lines,
  };
}
