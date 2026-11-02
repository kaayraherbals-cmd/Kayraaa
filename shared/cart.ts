/**
 * Cart rules. Pure functions, no I/O, so the same logic is tested without a database.
 *
 * The browser only ever sends variant ids and quantities. Names, prices, tax and stock are read from the database on the
 * server and returned; nothing the browser claims about money is used. Prices are MRP in paise, inclusive of GST (the
 * same basis the order_create database function uses), so the tax figure is "included", not added on top.
 */
export const CART_MAX_LINES = 20;
export const CART_MAX_QTY = 10;
/** Units this close to expiry are not sold. Mirrors the p_min_days default of order_create in supabase/inventory_orders.sql. */
export const MIN_DAYS_BEFORE_EXPIRY = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export interface CartLineInput {
  variantId: string;
  qty: number;
}

export type ParseResult = { ok: true; lines: CartLineInput[] } | { ok: false; errors: string[] };

/** Validates a list of lines from the browser. Repeated variants are merged; quantities are capped, never trusted. */
export function parseLines(raw: unknown): ParseResult {
  if (!Array.isArray(raw)) return { ok: false, errors: ['Send a list of items.'] };
  if (raw.length > CART_MAX_LINES * 2) return { ok: false, errors: ['Too many items.'] };
  const merged = new Map<string, number>();
  const errors: string[] = [];
  for (const item of raw) {
    const o = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null;
    if (!o || !isUuid(o.variantId)) {
      errors.push('An item has an invalid product reference.');
      continue;
    }
    const q = o.qty;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > CART_MAX_QTY) {
      errors.push(`Quantity must be a whole number from 1 to ${CART_MAX_QTY}.`);
      continue;
    }
    const id = o.variantId.toLowerCase();
    merged.set(id, Math.min(CART_MAX_QTY, (merged.get(id) ?? 0) + q));
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  if (merged.size > CART_MAX_LINES) return { ok: false, errors: [`A cart can hold at most ${CART_MAX_LINES} different items.`] };
  return { ok: true, lines: [...merged].map(([variantId, qty]) => ({ variantId, qty })) };
}

/** One variant as read from the database on the server. Never sent to the browser as is. */
export interface VariantRecord {
  variant_id: string;
  product_name: string;
  product_status: string;
  variant_status: string;
  pack_size: string;
  price_paise: number | null;
  gst_rate: number | null;
  hsn_code: string | null;
  /** Units free to sell now: on hand minus reserved, active batches only, not within MIN_DAYS_BEFORE_EXPIRY of expiry. */
  free_qty: number;
}

export type LineReason = 'not_found' | 'not_approved' | 'variant_inactive' | 'no_price' | 'incomplete_info' | 'out_of_stock' | 'reduced';

export const REASON_TEXT: Record<LineReason, string> = {
  not_found: 'This item is no longer available.',
  not_approved: 'This product is not available to order.',
  variant_inactive: 'This pack size is not available.',
  no_price: 'This item is not available to order yet.',
  incomplete_info: 'This item is not available to order yet.',
  out_of_stock: 'Out of stock.',
  reduced: 'Quantity reduced to what is in stock.',
};

export type LineState = 'ok' | 'adjusted' | 'unavailable';

export interface CartLineView {
  variantId: string;
  productName: string;
  packSize: string;
  /** Quantity the customer asked for. */
  requestedQty: number;
  /** Quantity that can actually be bought now (0 when unavailable). */
  qty: number;
  /** Most that could be added for this line right now, for the quantity stepper. */
  maxQty: number;
  unitPaise: number;
  lineTotalPaise: number;
  state: LineState;
  reason: LineReason | null;
  message: string | null;
}

export interface CartTotals {
  itemCount: number;
  subtotalPaise: number;
  /** GST that is already inside the subtotal (MRP is tax inclusive). Informational. */
  gstIncludedPaise: number;
}

/** Product statuses that may be bought. Preview and development statuses never can. */
export const PURCHASABLE_PRODUCT_STATUS = 'APPROVED_FOR_SALE';

/** Everything between a variant and a customer's cart line being buyable, in the order a customer should hear about it. */
export function lineBlocker(rec: VariantRecord | undefined): LineReason | null {
  if (!rec) return 'not_found';
  if (rec.product_status !== PURCHASABLE_PRODUCT_STATUS) return 'not_approved';
  if (rec.variant_status !== 'active') return 'variant_inactive';
  if (rec.price_paise === null || !Number.isInteger(rec.price_paise) || rec.price_paise <= 0) return 'no_price';
  if (rec.gst_rate === null || !rec.hsn_code) return 'incomplete_info';
  if (!Number.isFinite(rec.free_qty) || rec.free_qty <= 0) return 'out_of_stock';
  return null;
}

export function evaluateLine(input: CartLineInput, rec: VariantRecord | undefined): CartLineView {
  const blocker = lineBlocker(rec);
  if (blocker || !rec) {
    const reason = blocker ?? 'not_found';
    return {
      variantId: input.variantId,
      productName: rec?.product_name ?? 'Unavailable item',
      packSize: rec?.pack_size ?? '',
      requestedQty: input.qty,
      qty: 0,
      maxQty: 0,
      unitPaise: 0,
      lineTotalPaise: 0,
      state: 'unavailable',
      reason,
      message: REASON_TEXT[reason],
    };
  }
  const maxQty = Math.min(CART_MAX_QTY, Math.floor(rec.free_qty));
  const qty = Math.min(input.qty, maxQty);
  const reduced = qty < input.qty;
  const unit = rec.price_paise as number;
  return {
    variantId: input.variantId,
    productName: rec.product_name,
    packSize: rec.pack_size,
    requestedQty: input.qty,
    qty,
    maxQty,
    unitPaise: unit,
    lineTotalPaise: unit * qty,
    state: reduced ? 'adjusted' : 'ok',
    reason: reduced ? 'reduced' : null,
    message: reduced ? REASON_TEXT.reduced : null,
  };
}

/** GST contained in a tax-inclusive amount: amount * rate / (100 + rate), rounded to the nearest paisa. */
export const gstIncluded = (inclusivePaise: number, ratePercent: number): number => Math.round((inclusivePaise * ratePercent) / (100 + ratePercent));

export function priceCart(inputs: CartLineInput[], records: Map<string, VariantRecord>): { lines: CartLineView[]; totals: CartTotals } {
  const lines = inputs.map((i) => evaluateLine(i, records.get(i.variantId)));
  let subtotal = 0;
  let gst = 0;
  let count = 0;
  for (const l of lines) {
    if (l.state === 'unavailable') continue;
    subtotal += l.lineTotalPaise;
    count += l.qty;
    const rate = records.get(l.variantId)?.gst_rate ?? 0;
    gst += gstIncluded(l.lineTotalPaise, rate);
  }
  return { lines, totals: { itemCount: count, subtotalPaise: subtotal, gstIncludedPaise: gst } };
}

/** Indian rupees, for display only. All arithmetic stays in paise. */
export const formatRupees = (paise: number): string => {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const s = rupees.toString();
  const grouped = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`;
  return `₹${grouped}${p ? `.${String(p).padStart(2, '0')}` : ''}`;
};
