import type { Snapshot } from './data.js';

/**
 * Information panels shown under an admin answer. They are copied from the verified snapshot (the same figures the Analytics and Business
 * Intelligence screens use) and are never written by the model, so they are correct even when every AI provider is down. Nothing is
 * calculated here: each cell is a string or number that already exists in the snapshot.
 */
export interface Panel {
  id: string;
  title: string;
  /** Column headings. A panel with two columns "Measure" / "Value" is a plain list of facts. */
  columns: string[];
  rows: string[][];
  note?: string;
}

const text = (v: string | number | null | undefined): string => (v === null || v === undefined ? 'Not enough data' : String(v));

type Topic = 'sales' | 'stock' | 'operations' | 'finance';
const TOPIC_RES: Record<Topic, RegExp> = {
  sales: /\b(sell\w*|sold|sales?|revenue|orders?|products?|top|best|fastest|performance|average)\b/i,
  stock: /\b(stock\w*|restock\w*|inventory|expir\w*|cover|out of|running (out|low)|low)\b/i,
  operations: /\b(ship\w*|deliver\w*|delay\w*|refunds?|payments?|pending|fulfil\w*|queue|dispatch\w*|attention|urgent)\b/i,
  finance: /\b(money|profit\w*|margin|cash|collected|finance\w*|forecast|income|earn\w*)\b/i,
};
const BROAD_RE = /\b(summar\w*|overview|everything|attention|performance|business|today|briefing|how am i doing)\b/i;

/** Which topics a question is about. A broad or unclear question gets every topic. */
export function topicsFor(question: string): Topic[] {
  const hit = (Object.keys(TOPIC_RES) as Topic[]).filter((t) => TOPIC_RES[t].test(question));
  return BROAD_RE.test(question) || hit.length === 0 ? ['sales', 'stock', 'operations', 'finance'] : hit;
}

export function buildPanels(s: Snapshot, question: string): Panel[] {
  const topics = new Set(topicsFor(question));
  const out: Panel[] = [];

  if (topics.has('sales') && s.sales) {
    const x = s.sales;
    out.push({
      id: 'sales',
      title: `Sales, last ${x.windowDays} days`,
      columns: ['Measure', 'Value'],
      rows: [
        ['Orders', text(x.orders)],
        ['Revenue', text(x.revenue)],
        ['Average order', text(x.averageOrder)],
        ['Cancelled orders', text(x.cancelled)],
        ['Change vs previous period', text(x.revenueChangeVsPreviousPeriod)],
        ['Waiting for payment', text(x.awaitingPayment)],
        ['Paid, to pack or ship', text(x.paidToFulfil)],
      ],
      note: x.note,
    });
    if (x.topProducts.length > 0) out.push({ id: 'top-products', title: 'Top products', columns: ['Product', 'Units', 'Revenue'], rows: x.topProducts.map((p) => [p.name, text(p.units), p.revenue]) });
  }

  if (topics.has('stock') && s.inventory) {
    const i = s.inventory;
    const rows = [
      ...i.outOfStock.map((p) => [p.product, p.pack, 'Out of stock']),
      ...i.lowStock.map((p) => [p.product, p.pack, `${p.units} left (low)`]),
    ];
    out.push({ id: 'stock-alerts', title: 'Out of stock and low stock', columns: ['Product', 'Pack', 'Stock'], rows: rows.length > 0 ? rows : [['Nothing is out of stock or low', '', '']] });
    out.push({
      id: 'stock-summary',
      title: 'Stock summary',
      columns: ['Measure', 'Value'],
      rows: [['Pack sizes', text(i.packSizes)], ['Units on hand', text(i.sellableUnitsOnHand)], ['Expired units', text(i.expiredUnits)], ['Expiring soon (units)', text(i.expiringUnits)]],
    });
    if (i.roughDaysOfCover.length > 0) out.push({ id: 'cover', title: 'Days of cover (rough guide)', columns: ['Product', 'Pack', 'Units', 'Days'], rows: i.roughDaysOfCover.map((p) => [p.product, p.pack, text(p.units), text(p.days)]), note: i.note });
  }

  if (topics.has('operations') && s.operations) {
    const o = s.operations;
    const rows: string[][] = [];
    if (o.shipments) rows.push(['Shipments in motion', text(o.shipments.inMotion)], ['Delayed shipments', text(o.shipments.delayed.length)]);
    if (o.refundQueue) rows.push(['Refunds awaiting a decision', text(o.refundQueue.awaitingDecision)], ['Refunds approved, not yet paid', text(o.refundQueue.approvedNotYetPaid)]);
    if (o.paymentsNeedingReview !== undefined) rows.push(['Payments needing review', text(o.paymentsNeedingReview)]);
    if (rows.length > 0) out.push({ id: 'operations', title: 'Operations', columns: ['Measure', 'Value'], rows });
    if (o.shipments && o.shipments.delayed.length > 0) out.push({ id: 'delayed', title: 'Delayed shipments', columns: ['Shipment', 'Status', 'Days late'], rows: o.shipments.delayed.map((d) => [d.shipment_no, d.status, text(d.daysLate)]) });
  }

  if (topics.has('finance') && s.finance) {
    const f = s.finance;
    const rows: string[][] = [
      ['Collected today', f.today.netCollected],
      ['Collected, last 7 days', f.last7Days.netCollected],
      ['Growth vs previous 7 days', text(f.last7Days.growthVsPrevious7Days)],
      ['Collected, last 30 days', f.last30Days.netCollected],
      ['Refunds paid, last 30 days', f.last30Days.refundsPaid],
      ['Gross profit, last 30 days', text(f.last30Days.grossProfit)],
      ['Net profit, last 30 days', text(f.last30Days.netProfit)],
    ];
    if (f.salesForecast) rows.push(['Sales forecast (30 days)', f.salesForecast.expected === null ? 'Not enough data' : `${f.salesForecast.expected} (${text(f.salesForecast.low)} to ${text(f.salesForecast.high)})`]);
    out.push({ id: 'finance', title: 'Money', columns: ['Measure', 'Value'], rows, note: [f.notes[0], f.last30Days.profitMessage].filter(Boolean).join(' ') });
  }

  return out;
}
