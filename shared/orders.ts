/**
 * Orders (admin side). Selling is NOT enabled: creating an order is locked behind COMMERCE_ENABLED (shared/commerce.ts), so
 * today this module only validates and describes orders that a future, approved checkout or manual entry would create.
 * Prices are never taken from the client: the database copies the MRP from the pack size when the order is created.
 */
export const ORDER_STATUSES = ['placed', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = { placed: 'Placed', paid: 'Paid', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
export const isOrderStatus = (v: unknown): v is OrderStatus => typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);

/** The only moves allowed. Stock is reserved when an order is placed, released on cancel and taken off the shelf on shipping. */
const NEXT: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: ['paid', 'cancelled'],
  paid: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};
export const nextStatuses = (from: OrderStatus): readonly OrderStatus[] => NEXT[from];
export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => NEXT[from].includes(to);

export const MAX_LINES = 20;
export const MAX_QTY_PER_LINE = 100;
export const MAX_SHIPPING_PAISE = 1_000_000; // Rs 10,000

export interface Order {
  id: string;
  order_no: string;
  status: OrderStatus;
  channel: 'manual' | 'online';
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  ship_address: string;
  ship_pincode: string;
  subtotal_paise: number;
  /** Coupon discount on items (0 or absent when none) and the code used. total = subtotal - discount + shipping. */
  discount_paise?: number;
  coupon_code?: string | null;
  shipping_paise: number;
  total_paise: number;
  courier: string | null;
  tracking_no: string | null;
  cancel_reason: string | null;
  internal_note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
export interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string;
  product_name: string;
  pack_size: string;
  sku: string;
  qty: number;
  unit_price_paise: number;
  gst_rate: number | null;
  hsn_code: string | null;
  line_total_paise: number;
}
export interface OrderAllocation {
  id: string;
  order_item_id: string;
  batch_id: string;
  batch_no: string;
  expiry_date: string;
  qty: number;
}
export interface OrderEvent {
  id: number;
  order_id: string;
  kind: 'created' | 'status' | 'note' | 'tracking';
  from_status: OrderStatus | null;
  to_status: OrderStatus | null;
  note: string | null;
  actor: string;
  at: string;
}

export const ORDER_NO_RE = /^KH-\d{4}-\d{6,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
type Fail = { ok: false; errors: string[] };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, min: number, max: number): string | null => (typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);

export interface NewOrder {
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  ship_address: string;
  ship_pincode: string;
  shipping_paise: number;
  note: string | null;
  items: { variant_id: string; qty: number }[];
}

export function validateNewOrder(raw: unknown): { ok: true; value: NewOrder } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const errors: string[] = [];
  const customer_name = text(raw.customer_name, 1, 120);
  if (!customer_name) errors.push('Enter the customer name.');
  let customer_email: string | null = null;
  if (raw.customer_email !== undefined && raw.customer_email !== null && raw.customer_email !== '') {
    if (typeof raw.customer_email === 'string' && raw.customer_email.length <= 254 && EMAIL_RE.test(raw.customer_email.trim())) customer_email = raw.customer_email.trim().toLowerCase();
    else errors.push('Enter a valid email address, or leave it blank.');
  }
  let customer_phone: string | null = null;
  if (raw.customer_phone !== undefined && raw.customer_phone !== null && raw.customer_phone !== '') {
    const digits = typeof raw.customer_phone === 'string' ? raw.customer_phone.replace(/[\s()-]/g, '') : '';
    if (/^\+?\d{7,15}$/.test(digits)) customer_phone = digits;
    else errors.push('Enter a phone number with 7 to 15 digits, or leave it blank.');
  }
  const ship_address = text(raw.ship_address, 8, 400);
  if (!ship_address) errors.push('Enter the delivery address (8 to 400 characters).');
  const ship_pincode = typeof raw.ship_pincode === 'string' && /^[1-9]\d{5}$/.test(raw.ship_pincode.trim()) ? raw.ship_pincode.trim() : null;
  if (!ship_pincode) errors.push('Enter a 6-digit PIN code.');
  let shipping_paise = 0;
  if (raw.shipping_paise !== undefined && raw.shipping_paise !== null) {
    if (typeof raw.shipping_paise === 'number' && Number.isInteger(raw.shipping_paise) && raw.shipping_paise >= 0 && raw.shipping_paise <= MAX_SHIPPING_PAISE) shipping_paise = raw.shipping_paise;
    else errors.push('Shipping must be between 0 and 10,000 rupees.');
  }
  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null && raw.note !== '') {
    note = text(raw.note, 1, 500);
    if (!note) errors.push('The note must be at most 500 characters.');
  }
  const items: NewOrder['items'] = [];
  if (!Array.isArray(raw.items) || raw.items.length === 0) errors.push('Add at least one item.');
  else if (raw.items.length > MAX_LINES) errors.push(`An order can have at most ${MAX_LINES} lines.`);
  else {
    const seen = new Set<string>();
    for (const it of raw.items) {
      if (!isObj(it) || typeof it.variant_id !== 'string' || !UUID_RE.test(it.variant_id)) {
        errors.push('Each line needs a pack size.');
        continue;
      }
      if (typeof it.qty !== 'number' || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > MAX_QTY_PER_LINE) {
        errors.push(`Quantity per line must be a whole number from 1 to ${MAX_QTY_PER_LINE}.`);
        continue;
      }
      if (seen.has(it.variant_id)) {
        errors.push('Each pack size can appear only once. Add the quantities together.');
        continue;
      }
      seen.add(it.variant_id);
      items.push({ variant_id: it.variant_id, qty: it.qty });
    }
  }
  if (errors.length || !customer_name || !ship_address || !ship_pincode) return { ok: false, errors: errors.length ? errors : ['Missing fields.'] };
  return { ok: true, value: { customer_name, customer_email, customer_phone, ship_address, ship_pincode, shipping_paise, note, items } };
}

export interface StatusChange {
  order_id: string;
  status: OrderStatus;
  courier: string | null;
  tracking_no: string | null;
  reason: string | null;
}

/** Shipping needs a courier and tracking number; cancelling needs a reason. Allowed moves are re-checked in the database. */
export function validateStatusChange(raw: unknown, current?: OrderStatus): { ok: true; value: StatusChange } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const errors: string[] = [];
  const order_id = typeof raw.order_id === 'string' && UUID_RE.test(raw.order_id) ? raw.order_id : null;
  if (!order_id) errors.push('Choose an order.');
  if (!isOrderStatus(raw.status)) errors.push('Choose a valid status.');
  const status = isOrderStatus(raw.status) ? raw.status : null;
  if (status && current && !canTransition(current, status)) errors.push(`An order cannot move from ${ORDER_STATUS_LABELS[current].toLowerCase()} to ${ORDER_STATUS_LABELS[status].toLowerCase()}.`);
  let courier: string | null = null;
  let tracking_no: string | null = null;
  let reason: string | null = null;
  if (status === 'shipped') {
    courier = text(raw.courier, 2, 60);
    tracking_no = typeof raw.tracking_no === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _/-]{3,59}$/.test(raw.tracking_no.trim()) ? raw.tracking_no.trim() : null;
    if (!courier) errors.push('Enter the courier name.');
    if (!tracking_no) errors.push('Enter the tracking number (4 to 60 letters, numbers, spaces or - _ /).');
  }
  if (status === 'cancelled') {
    reason = text(raw.reason, 3, 200);
    if (!reason) errors.push('Give a reason for cancelling (3 to 200 characters).');
  }
  if (errors.length || !order_id || !status) return { ok: false, errors };
  return { ok: true, value: { order_id, status, courier, tracking_no, reason } };
}

export function validateOrderNote(raw: unknown): { ok: true; value: { order_id: string; note: string } } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const order_id = typeof raw.order_id === 'string' && UUID_RE.test(raw.order_id) ? raw.order_id : null;
  const note = text(raw.note, 2, 1000);
  if (!order_id) return { ok: false, errors: ['Choose an order.'] };
  if (!note) return { ok: false, errors: ['Write a note of 2 to 1000 characters.'] };
  return { ok: true, value: { order_id, note } };
}

export const lineTotal = (unitPaise: number, qty: number): number => unitPaise * qty;
export const orderTotal = (lines: { unit_price_paise: number; qty: number }[], shippingPaise: number): { subtotal: number; total: number } => {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l.unit_price_paise, l.qty), 0);
  return { subtotal, total: subtotal + shippingPaise };
};

export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export const ORDER_CSV_HEADERS = ['order_no', 'created_at', 'status', 'customer_name', 'customer_email', 'customer_phone', 'ship_pincode', 'subtotal_inr', 'shipping_inr', 'total_inr', 'courier', 'tracking_no'] as const;
export function orderCsvRow(o: Order): Record<string, unknown> {
  const inr = (p: number) => (p / 100).toFixed(2);
  return { ...o, subtotal_inr: inr(o.subtotal_paise), shipping_inr: inr(o.shipping_paise), total_inr: inr(o.total_paise) };
}
