/**
 * Shipment rules (Phase 7, Step 2). Pure functions. `canTransition` mirrors public.shipment_transition_ok in
 * supabase/shipments.sql: if one changes, change the other (the test lists every legal pair).
 * No courier provider is connected; every event is entered by a person and marked source "manual".
 */
export const SHIPMENT_STATUSES = ['pending', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'return_to_origin', 'returned', 'cancelled'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const EXCEPTION_KINDS = ['address_issue', 'recipient_unavailable', 'refused', 'damaged', 'lost', 'other'] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const SHIPMENT_LABELS: Record<ShipmentStatus, string> = {
  pending: 'Preparing', dispatched: 'Dispatched', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  delivery_failed: 'Delivery failed', return_to_origin: 'Returning to us', returned: 'Returned', cancelled: 'Cancelled',
};

const NEXT: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  pending: ['dispatched', 'cancelled'],
  dispatched: ['in_transit', 'out_for_delivery', 'delivered', 'delivery_failed'],
  in_transit: ['out_for_delivery', 'delivered', 'delivery_failed', 'return_to_origin'],
  out_for_delivery: ['delivered', 'delivery_failed'],
  delivery_failed: ['out_for_delivery', 'return_to_origin'],
  return_to_origin: ['returned'],
  delivered: [],
  returned: [],
  cancelled: [],
};

export const isShipmentStatus = (v: unknown): v is ShipmentStatus => typeof v === 'string' && (SHIPMENT_STATUSES as readonly string[]).includes(v);
export const isExceptionKind = (v: unknown): v is ExceptionKind => typeof v === 'string' && (EXCEPTION_KINDS as readonly string[]).includes(v);
export const canTransition = (from: ShipmentStatus, to: ShipmentStatus): boolean => NEXT[from].includes(to);
export const nextStatuses = (from: ShipmentStatus): readonly ShipmentStatus[] => NEXT[from];
export const isFinal = (s: ShipmentStatus): boolean => NEXT[s].length === 0;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s === '' ? null : s;
};

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface CreateShipment {
  order_id: string;
  items: { order_item_id: string; qty: number }[];
}

export function validateCreate(b: Record<string, unknown>): Checked<CreateShipment> {
  const errors: string[] = [];
  const order_id = typeof b.order_id === 'string' && UUID.test(b.order_id) ? b.order_id : '';
  if (!order_id) errors.push('Choose an order.');
  const raw = Array.isArray(b.items) ? b.items : [];
  if (raw.length < 1 || raw.length > 50) errors.push('Add at least one item.');
  const seen = new Set<string>();
  const items: CreateShipment['items'] = [];
  for (const r of raw.slice(0, 50)) {
    const o = typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : {};
    const id = typeof o.order_item_id === 'string' && UUID.test(o.order_item_id) ? o.order_item_id : '';
    const qty = o.qty;
    if (!id || typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 100) {
      errors.push('Each item needs an id and a whole quantity from 1 to 100.');
      break;
    }
    if (seen.has(id)) {
      errors.push('An item can appear only once.');
      break;
    }
    seen.add(id);
    items.push({ order_item_id: id, qty });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { order_id, items } };
}

export interface StatusChange {
  shipment_id: string;
  status: ShipmentStatus;
  courier: string | null;
  tracking_no: string | null;
  note: string | null;
  location: string | null;
  estimated_delivery: string | null;
  exception: ExceptionKind | null;
  visible: boolean;
}

export function validateStatusChange(b: Record<string, unknown>, current: ShipmentStatus): Checked<StatusChange> {
  const errors: string[] = [];
  const shipment_id = typeof b.shipment_id === 'string' && UUID.test(b.shipment_id) ? b.shipment_id : '';
  if (!shipment_id) errors.push('Invalid shipment.');
  if (!isShipmentStatus(b.status)) errors.push('Choose a valid status.');
  const status = isShipmentStatus(b.status) ? b.status : 'pending';
  if (isShipmentStatus(b.status) && !canTransition(current, status)) errors.push(`A shipment cannot move from ${SHIPMENT_LABELS[current]} to ${SHIPMENT_LABELS[status]}.`);
  const courier = clean(b.courier, 60);
  const tracking_no = clean(b.tracking_no, 60);
  if (status === 'dispatched' && (!courier || !tracking_no)) errors.push('A courier and a tracking number are needed to dispatch.');
  const exception = isExceptionKind(b.exception) ? b.exception : null;
  if (status === 'delivery_failed' && !exception) errors.push('Say why the delivery failed.');
  let estimated_delivery: string | null = null;
  if (b.estimated_delivery !== undefined && b.estimated_delivery !== null && b.estimated_delivery !== '') {
    if (typeof b.estimated_delivery === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.estimated_delivery) && !Number.isNaN(Date.parse(b.estimated_delivery))) estimated_delivery = b.estimated_delivery;
    else errors.push('The estimated delivery date must be a real date (YYYY-MM-DD).');
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { shipment_id, status, courier, tracking_no, note: clean(b.note, 500), location: clean(b.location, 120), estimated_delivery, exception, visible: b.visible !== false } };
}

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  address_issue: 'Address problem', recipient_unavailable: 'Recipient not available', refused: 'Refused by recipient', damaged: 'Damaged in transit', lost: 'Lost in transit', other: 'Other',
};

/** Row shapes returned by server/admin/shipments.ts (admin screens only). */
export interface ShipmentRow {
  id: string;
  order_id: string;
  shipment_no: string;
  status: ShipmentStatus;
  courier: string | null;
  tracking_no: string | null;
  estimated_delivery: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  created_by: string;
  created_at: string;
  orders: { order_no: string; customer_name: string; ship_pincode: string | null } | null;
  shipment_items: { order_item_id: string; qty: number }[];
}
export interface ShipmentEventRow {
  id: number | string;
  kind: 'created' | 'status' | 'note';
  from_status: ShipmentStatus | null;
  to_status: ShipmentStatus | null;
  note: string | null;
  location: string | null;
  visible: boolean;
  occurred_at: string;
  actor: string;
}
export interface DeliveryExceptionRow {
  id: string;
  shipment_id: string;
  kind: ExceptionKind;
  note: string | null;
  opened_by: string;
  opened_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  shipments?: { shipment_no: string; status: ShipmentStatus; order_id: string } | null;
}

/** Units still to ship per order line. Mirrors shipment_create in supabase/shipments.sql: cancelled shipments free their units. */
export function remainingToShip(
  lines: { id: string; qty: number }[],
  shipments: { status: ShipmentStatus; shipment_items: { order_item_id: string; qty: number }[] }[],
): Record<string, number> {
  const used: Record<string, number> = {};
  for (const s of shipments) {
    if (s.status === 'cancelled') continue;
    for (const i of s.shipment_items) used[i.order_item_id] = (used[i.order_item_id] ?? 0) + i.qty;
  }
  return Object.fromEntries(lines.map((l) => [l.id, Math.max(0, l.qty - (used[l.id] ?? 0))]));
}
