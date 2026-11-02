import { describe, expect, it } from 'vitest';
import { buildSales, buildStockHealth, istDay, parseDays, pctChange, soldByVariant, type ItemRow, type OrderRow } from './analytics';

const NOW = Date.parse('2026-10-22T06:00:00Z'); // 11:30 IST on 22 Oct
const o = (id: string, iso: string, total: number, over: Partial<OrderRow> = {}): OrderRow => ({ id, status: 'delivered', channel: 'online', total_paise: total, ship_pincode: '221005', created_at: iso, ...over });

describe('parseDays', () => {
  it('accepts only the three windows', () => {
    expect(parseDays('90')).toBe(90);
    expect(parseDays('365')).toBe(365);
    expect(parseDays('7')).toBe(30);
    expect(parseDays(undefined)).toBe(30);
    expect(parseDays(['90'])).toBe(90);
  });
});

describe('buildSales', () => {
  const orders = [
    o('a', '2026-10-22T04:00:00Z', 100_000),
    o('b', '2026-10-21T20:00:00Z', 50_000, { channel: 'manual', ship_pincode: '400001' }), // 22 Oct 01:30 IST
    o('c', '2026-10-20T10:00:00Z', 70_000, { status: 'cancelled' }),
    o('d', '2026-09-15T10:00:00Z', 40_000), // previous period (30d)
    o('e', '2026-07-01T10:00:00Z', 999_000), // outside both
  ];
  const items: ItemRow[] = [
    { order_id: 'a', variant_id: 'v1', product_name: 'Ashwagandha', qty: 2, line_total_paise: 100_000 },
    { order_id: 'b', variant_id: 'v1', product_name: 'Ashwagandha', qty: 1, line_total_paise: 50_000 },
    { order_id: 'd', variant_id: 'v2', product_name: 'Triphala', qty: 4, line_total_paise: 40_000 },
  ];
  const pins = [{ pincode: '221005', state: 'Uttar Pradesh' }, { pincode: '400001', state: null }];
  const r = buildSales(orders, items, pins, 30, NOW);

  it('adds revenue, orders, units and average for the window', () => {
    expect(r.current).toEqual({ revenue: 150_000, orders: 2, units: 3, aov: 75_000, cancelled: 1 });
  });
  it('keeps the previous period separate and ignores older orders', () => {
    expect(r.previous.revenue).toBe(40_000);
    expect(r.previous.units).toBe(4);
  });
  it('has one point per day, last day is today in India time, and IST day boundaries hold', () => {
    expect(r.series).toHaveLength(30);
    expect(r.series[29]?.date).toBe('2026-10-22');
    expect(r.series[29]?.revenue).toBe(150_000);
    expect(r.series[29]?.online).toBe(100_000);
    expect(r.series[29]?.manual).toBe(50_000);
    expect(r.series[0]?.date).toBe('2026-09-23');
  });
  it('puts the previous order on its own day of the previous series', () => {
    expect(r.previousSeries.reduce((a, b) => a + b, 0)).toBe(40_000);
  });
  it('groups by state and labels PIN codes without a state', () => {
    expect(r.byState.map((s) => s.state)).toEqual(['Uttar Pradesh', 'Not labelled']);
  });
  it('ranks channels and best sellers, cancelled excluded', () => {
    expect(r.byChannel[0]).toEqual({ channel: 'online', revenue: 100_000, orders: 1 });
    expect(r.topProducts).toEqual([{ name: 'Ashwagandha', units: 3, revenue: 150_000 }]);
  });
  it('handles no orders', () => {
    const e = buildSales([], [], [], 30, NOW);
    expect(e.current).toEqual({ revenue: 0, orders: 0, units: 0, aov: 0, cancelled: 0 });
    expect(e.byState).toEqual([]);
  });
});

describe('soldByVariant', () => {
  it('counts only in-window, non-cancelled orders', () => {
    const m = soldByVariant(
      [o('a', '2026-10-22T04:00:00Z', 1), o('x', '2026-10-21T04:00:00Z', 1, { status: 'cancelled' }), o('old', '2026-01-01T00:00:00Z', 1)],
      [{ order_id: 'a', variant_id: 'v1', product_name: 'P', qty: 2, line_total_paise: 1 }, { order_id: 'x', variant_id: 'v1', product_name: 'P', qty: 9, line_total_paise: 1 }, { order_id: 'old', variant_id: 'v1', product_name: 'P', qty: 5, line_total_paise: 1 }],
      30,
      NOW,
    );
    expect(m.get('v1')).toBe(2);
  });
});

describe('pctChange / istDay', () => {
  it('is null without an earlier figure and rounds to one decimal', () => {
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(1, 3)).toBe(-66.7);
  });
  it('rolls over at midnight India time', () => {
    expect(istDay(Date.parse('2026-10-21T18:29:00Z'))).toBe('2026-10-21');
    expect(istDay(Date.parse('2026-10-21T18:31:00Z'))).toBe('2026-10-22');
  });
});

describe('buildStockHealth', () => {
  const vs = [
    { id: 'v1', product: 'Ashwagandha', pack_size: '60 caps', price_paise: 50_000, threshold: 10 },
    { id: 'v2', product: 'Triphala', pack_size: '100 g', price_paise: null, threshold: 5 },
    { id: 'v3', product: 'Neem', pack_size: '60 caps', price_paise: 30_000, threshold: 5 },
  ];
  const bs = [
    { variant_id: 'v1', status: 'active', expiry_date: '2027-06-01', qty_on_hand: 40, qty_reserved: 5 },
    { variant_id: 'v1', status: 'active', expiry_date: '2026-10-01', qty_on_hand: 6, qty_reserved: 0 }, // expired
    { variant_id: 'v2', status: 'active', expiry_date: '2026-11-15', qty_on_hand: 4, qty_reserved: 0 }, // low, <=30d
    { variant_id: 'v3', status: 'quarantine', expiry_date: '2027-01-01', qty_on_hand: 20, qty_reserved: 0 }, // not sellable
  ];
  const h = buildStockHealth(vs, bs, new Map([['v1', 30]]), 30, '2026-10-22');
  it('counts shelf states', () => {
    expect([h.healthy, h.low, h.out]).toEqual([1, 1, 1]);
  });
  it('totals units and values, flagging unpriced units', () => {
    expect(h.units).toBe(70);
    expect(h.value).toBe(46 * 50_000 + 20 * 30_000);
    expect(h.valueUnpriced).toBe(4);
  });
  it('buckets expiry and counts expiring within 90 days', () => {
    expect(h.expiryBuckets.map((b) => b.units)).toEqual([6, 4, 20, 40]);
    expect(h.expired).toBe(6);
    expect(h.expiring).toBe(24);
  });
  it('sorts problems first and computes cover', () => {
    expect(h.lines[0]?.state).toBe('out');
    expect(h.lines.find((l) => l.variant_id === 'v1')?.daysCover).toBe(35);
    expect(h.lines.find((l) => l.variant_id === 'v2')?.daysCover).toBeNull();
  });
});
