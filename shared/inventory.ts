import { couponMessage } from './coupons.js';
/**
 * Stock by batch with expiry. Rules shared by the admin API, the admin screens and the tests.
 * The database functions in supabase/inventory_orders.sql enforce the same rules atomically; this module validates input
 * early and summarises stock for display. Dates are calendar dates in India (Asia/Kolkata).
 */
export const BATCH_STATUSES = ['active', 'quarantine', 'recalled', 'closed'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = { active: 'Active', quarantine: 'Quarantine', recalled: 'Recalled', closed: 'Closed' };
export const isBatchStatus = (v: unknown): v is BatchStatus => typeof v === 'string' && (BATCH_STATUSES as readonly string[]).includes(v);

/** Stock is never offered for an order when fewer than this many days of shelf life remain. */
export const MIN_DAYS_TO_EXPIRY = 30;
/** A batch is flagged "expiring soon" inside this many days. */
export const EXPIRING_SOON_DAYS = 90;
export const MAX_BATCH_QTY = 1_000_000;

export const MOVEMENT_KINDS = ['receive', 'adjust', 'write_off', 'reserve', 'release', 'ship'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  receive: 'Received',
  adjust: 'Adjustment',
  write_off: 'Write-off',
  reserve: 'Reserved for order',
  release: 'Released from order',
  ship: 'Shipped',
};

export interface Batch {
  id: string;
  variant_id: string;
  batch_no: string;
  mfg_date: string | null;
  expiry_date: string;
  qty_received: number;
  qty_on_hand: number;
  qty_reserved: number;
  status: BatchStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Movement {
  id: number;
  batch_id: string;
  variant_id: string;
  kind: MovementKind;
  delta_on_hand: number;
  delta_reserved: number;
  reason: string | null;
  order_id: string | null;
  actor: string;
  at: string;
}

const DAY_MS = 86_400_000;

/** Today's calendar date in India as YYYY-MM-DD. */
export function todayIST(nowMs = Date.now()): string {
  return new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Whole days from one date to another (positive when `to` is later). */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export type ExpiryState = 'expired' | 'expiring' | 'ok';
export function expiryState(expiry: string, today: string): ExpiryState {
  const d = daysBetween(today, expiry);
  return d < 0 ? 'expired' : d <= EXPIRING_SOON_DAYS ? 'expiring' : 'ok';
}

/** Units that could go to a customer today: active, in date with enough shelf life left, not already reserved. */
export function sellableUnits(b: Pick<Batch, 'status' | 'expiry_date' | 'qty_on_hand' | 'qty_reserved'>, today: string, minDays = MIN_DAYS_TO_EXPIRY): number {
  if (b.status !== 'active') return 0;
  if (daysBetween(today, b.expiry_date) < minDays) return 0;
  return Math.max(0, b.qty_on_hand - b.qty_reserved);
}

export interface StockSummary {
  onHand: number;
  reserved: number;
  /** Sellable now (see sellableUnits). */
  available: number;
  /** Units sitting in expired batches: they must be written off, never sold. */
  expiredUnits: number;
  /** Units in batches expiring soon (still in date). */
  expiringUnits: number;
  /** Earliest expiry among batches that still hold stock. */
  nextExpiry: string | null;
  low: boolean;
  out: boolean;
}

export function summariseStock(batches: Pick<Batch, 'status' | 'expiry_date' | 'qty_on_hand' | 'qty_reserved'>[], threshold: number, today: string): StockSummary {
  let onHand = 0;
  let reserved = 0;
  let available = 0;
  let expiredUnits = 0;
  let expiringUnits = 0;
  let nextExpiry: string | null = null;
  for (const b of batches) {
    if (b.qty_on_hand <= 0) continue;
    onHand += b.qty_on_hand;
    reserved += b.qty_reserved;
    available += sellableUnits(b, today);
    const st = expiryState(b.expiry_date, today);
    if (st === 'expired') expiredUnits += b.qty_on_hand;
    if (st === 'expiring') expiringUnits += b.qty_on_hand;
    if (nextExpiry === null || b.expiry_date < nextExpiry) nextExpiry = b.expiry_date;
  }
  return { onHand, reserved, available, expiredUnits, expiringUnits, nextExpiry, out: available === 0, low: available > 0 && available <= threshold };
}

// ---- Validation -------------------------------------------------------------------------------------

const BATCH_NO_RE = /^[A-Z0-9][A-Z0-9/_.-]{0,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Fail = { ok: false; errors: string[] };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const clean = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= max ? v.trim() : null);

export interface ReceiveInput {
  variant_id: string;
  batch_no: string;
  mfg_date: string | null;
  expiry_date: string;
  qty: number;
  note: string | null;
}

/** Receiving stock: a batch number, an expiry date that is still in the future, and a positive quantity. */
export function validateReceive(raw: unknown, today = todayIST()): { ok: true; value: ReceiveInput } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const errors: string[] = [];
  const variant_id = typeof raw.variant_id === 'string' && UUID_RE.test(raw.variant_id) ? raw.variant_id : null;
  if (!variant_id) errors.push('Choose a pack size (variant).');
  const batch_no = typeof raw.batch_no === 'string' ? raw.batch_no.trim().toUpperCase() : '';
  if (!BATCH_NO_RE.test(batch_no)) errors.push('Batch number must be 1 to 40 letters, numbers or / _ . - characters.');
  const expiry = raw.expiry_date;
  if (!isIsoDate(expiry)) errors.push('Enter the expiry date.');
  else if (expiry <= today) errors.push('That expiry date has already passed. Expired stock cannot be received.');
  let mfg: string | null = null;
  if (raw.mfg_date !== undefined && raw.mfg_date !== null && raw.mfg_date !== '') {
    if (!isIsoDate(raw.mfg_date)) errors.push('Enter the manufacturing date as a valid date, or leave it blank.');
    else if (raw.mfg_date > today) errors.push('The manufacturing date cannot be in the future.');
    else if (isIsoDate(expiry) && raw.mfg_date >= expiry) errors.push('The expiry date must be after the manufacturing date.');
    else mfg = raw.mfg_date;
  }
  if (!intIn(raw.qty, 1, MAX_BATCH_QTY)) errors.push(`Quantity must be a whole number from 1 to ${MAX_BATCH_QTY.toLocaleString('en-IN')}.`);
  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null && raw.note !== '') {
    note = clean(raw.note, 200);
    if (!note) errors.push('The note must be at most 200 characters.');
  }
  if (errors.length || !variant_id || !isIsoDate(expiry) || !intIn(raw.qty, 1, MAX_BATCH_QTY)) return { ok: false, errors: errors.length ? errors : ['Missing fields.'] };
  return { ok: true, value: { variant_id, batch_no, mfg_date: mfg, expiry_date: expiry, qty: raw.qty, note } };
}

export interface AdjustInput {
  batch_id: string;
  kind: 'adjust' | 'write_off';
  delta: number;
  reason: string;
}

/** Corrections after a count, damage, expiry or loss. Always with a reason; a write-off only ever removes stock. */
export function validateAdjust(raw: unknown): { ok: true; value: AdjustInput } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const errors: string[] = [];
  const batch_id = typeof raw.batch_id === 'string' && UUID_RE.test(raw.batch_id) ? raw.batch_id : null;
  if (!batch_id) errors.push('Choose a batch.');
  const kind = raw.kind === 'write_off' ? 'write_off' : raw.kind === 'adjust' ? 'adjust' : null;
  if (!kind) errors.push('Choose adjustment or write-off.');
  if (!intIn(raw.delta, -MAX_BATCH_QTY, MAX_BATCH_QTY) || raw.delta === 0) errors.push('Enter a whole number of units other than zero.');
  if (kind === 'write_off' && typeof raw.delta === 'number' && raw.delta > 0) errors.push('A write-off removes stock, so the number must be negative.');
  const reason = clean(raw.reason, 200);
  if (!reason || reason.length < 3) errors.push('Give a reason (at least 3 characters).');
  if (errors.length || !batch_id || !kind || !intIn(raw.delta, -MAX_BATCH_QTY, MAX_BATCH_QTY) || !reason) return { ok: false, errors };
  return { ok: true, value: { batch_id, kind, delta: raw.delta, reason } };
}

export function validateBatchStatus(raw: unknown): { ok: true; value: { batch_id: string; status: BatchStatus } } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  if (typeof raw.batch_id !== 'string' || !UUID_RE.test(raw.batch_id)) return { ok: false, errors: ['Choose a batch.'] };
  if (!isBatchStatus(raw.status)) return { ok: false, errors: ['That is not a valid batch status.'] };
  return { ok: true, value: { batch_id: raw.batch_id, status: raw.status } };
}

/**
 * Maps the "KH:" messages raised by the database functions to something an admin can act on.
 * Unknown messages become a generic failure so internal details never reach the screen.
 */
export interface RpcFailure {
  kind: 'insufficient_stock' | 'not_found' | 'state' | 'invalid' | 'commerce_off' | 'unknown';
  message: string;
}
export function parseRpcError(body: unknown): RpcFailure {
  const text = isObj(body) && typeof body.message === 'string' ? body.message : '';
  const m = /KH:([A-Z_]+)(?::([^\n]*))?/.exec(text);
  if (!m) return { kind: 'unknown', message: 'The database rejected the request.' };
  const arg = (m[2] ?? '').trim();
  switch (m[1]) {
    case 'INSUFFICIENT_STOCK':
      return { kind: 'insufficient_stock', message: `Not enough in-date stock for ${arg.split('|')[0] || 'one of the items'}${arg.includes('|') ? ` (only ${arg.split('|')[1]} available)` : ''}.` };
    case 'CART_FULL':
      return { kind: 'state', message: 'Your bag is full. Remove an item before adding another.' };
    case 'NOT_FOUND':
      return { kind: 'not_found', message: 'That record no longer exists.' };
    case 'NEGATIVE_STOCK':
      return { kind: 'state', message: 'That change would take the stock below zero or below what is reserved for orders.' };
    case 'PAYMENT_REQUIRED':
      return { kind: 'state', message: 'An online order is marked paid only when Razorpay confirms the payment. It cannot be marked paid by hand.' };
    case 'BAD_TRANSITION':
      return { kind: 'state', message: `An order cannot move from ${arg.replace('>', ' to ')}.` };
    case 'NOT_FOR_SALE':
      return { kind: 'state', message: `${arg || 'A product'} is not approved for sale, so it cannot be ordered.` };
    case 'VARIANT_INACTIVE':
      return { kind: 'state', message: `${arg || 'A pack size'} is switched off.` };
    case 'BATCH_CLOSED':
      return { kind: 'state', message: 'That batch is closed. Reopen it (set it to active) before changing its stock.' };
    case 'RESERVED_STOCK':
      return { kind: 'state', message: 'That batch still has units reserved for open orders. Ship or cancel those orders first.' };
    case 'NO_PRICE':
      return { kind: 'state', message: `${arg || 'A pack size'} has no price set.` };
    case 'EXPIRED_ALLOCATION':
      return { kind: 'state', message: `Batch ${arg || ''} has expired or is no longer active. Cancel this order and create it again from in-date stock.`.replace('  ', ' ') };
    case 'PRICE_CHANGED':
      return { kind: 'state', message: 'A price changed while you were checking out.' };
    case 'NOT_SERVICEABLE':
      return { kind: 'state', message: 'We cannot deliver to that PIN code yet.' };
    case 'TOO_MANY_OPEN':
      return { kind: 'state', message: 'You already have unpaid orders waiting. Pay for or wait out one of them first.' };
    case 'IDEMPOTENCY_MISMATCH':
      return { kind: 'state', message: 'This submission was already used for a different order.' };
    case 'PAY_WINDOW_ENDED':
      return { kind: 'state', message: 'The time to pay for this order has ended.' };
    case 'PAYMENT_IN_PROGRESS':
      return { kind: 'state', message: 'A payment for this order is in progress, so it cannot be cancelled right now.' };
    case 'ALREADY_PAID':
      return { kind: 'state', message: 'This order is already paid.' };
    case 'WISHLIST_FULL':
      return { kind: 'state', message: 'Your wishlist is full (100 products). Remove one to add another.' };
    case 'BUNDLE_COMPONENTS':
      return { kind: 'state', message: 'A bundle needs at least two different products that are all on sale, each with a price.' };
    case 'BUNDLE_PRICE_INVALID':
      return { kind: 'state', message: 'That bundle price is not valid.' };
    case 'BUNDLE_NO_SAVING':
      return { kind: 'state', message: 'The bundle price must be lower than buying the items separately.' };
    case 'DISABLED':
      return { kind: 'state', message: 'Rewards points are not available right now.' };
    case 'LOYALTY_POLICY_PENDING':
      return { kind: 'state', message: 'Rewards points are not available right now.' };
    case 'NOT_ENROLLED':
      return { kind: 'state', message: 'Join Kaayra Rewards before using points.' };
    case 'STACKING':
      return { kind: 'state', message: 'Rewards points cannot be used together with a coupon. Remove one of them to continue.' };
    case 'LIMIT':
      return { kind: 'state', message: 'That number of points cannot be used on this order. Choose fewer points.' };
    case 'INSUFFICIENT':
      return { kind: 'state', message: 'You do not have enough available points for that.' };
    case 'BUNDLE_COUPON_EXCLUDED':
      return { kind: 'state', message: 'Coupons cannot be used on orders that contain a bundle. Remove the coupon or the bundle to continue.' };
    case 'BUNDLE_UNAVAILABLE':
      return { kind: 'state', message: `${arg || 'A bundle'} is not available right now.` };
    case 'COUPON':
      return { kind: 'state', message: couponMessage(arg.split('|')[0] ?? '') };
    case 'NOT_PAID':
      return { kind: 'state', message: 'This order was never marked as paid, so there is nothing to refund.' };
    case 'REFUND_EXCEEDS': {
      const left = Number(arg);
      return { kind: 'state', message: Number.isFinite(left) ? `That is more than can still be refunded on this order (₹${(left / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} left).` : 'That is more than can still be refunded on this order.' };
    }
    case 'REFUND_BAD_TRANSITION':
      return { kind: 'state', message: `A refund cannot move from ${arg.replace('>', ' to ')}.` };
    case 'SHIPMENT_BAD_TRANSITION':
      return { kind: 'state', message: `A shipment cannot move from ${arg.replace('>', ' to ')}.` };
    case 'BAD_STATE':
      return { kind: 'state', message: arg || 'That is not possible in the current state.' };
    case 'INVALID':
      return { kind: 'invalid', message: arg || 'The request was not valid.' };
    default:
      return { kind: 'invalid', message: 'The request was not valid.' };
  }
}
