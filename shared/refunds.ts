/**
 * Refunds and returns (admin record). This records the decision trail; it does not move money by itself; an owner can pay an
 * approved refund through Razorpay (server/admin/payments.ts), or record a bank reference by hand. A refund can only be requested for an order that was paid at some point, and the live refunds on an
 * order can never add up to more than its total (both rules are enforced again in the database).
 */
export const REFUND_KINDS = ['refund_only', 'return_and_refund'] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];
export const REFUND_KIND_LABELS: Record<RefundKind, string> = { refund_only: 'Refund only', return_and_refund: 'Return and refund' };

export const REFUND_REASONS = ['damaged', 'wrong_item', 'not_delivered', 'expired_on_arrival', 'quality_concern', 'health_concern', 'duplicate_payment', 'changed_mind', 'other'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  damaged: 'Arrived damaged',
  wrong_item: 'Wrong item sent',
  not_delivered: 'Not delivered',
  expired_on_arrival: 'Expired or near expiry on arrival',
  quality_concern: 'Quality concern',
  health_concern: 'Health concern after use',
  duplicate_payment: 'Paid twice',
  changed_mind: 'Changed mind',
  other: 'Other',
};

export const REFUND_STATUSES = ['requested', 'approved', 'rejected', 'refunded'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = { requested: 'Awaiting decision', approved: 'Approved, not yet paid', rejected: 'Rejected', refunded: 'Refunded' };
export const isRefundStatus = (v: unknown): v is RefundStatus => typeof v === 'string' && (REFUND_STATUSES as readonly string[]).includes(v);

const NEXT: Record<RefundStatus, readonly RefundStatus[]> = { requested: ['approved', 'rejected'], approved: ['refunded', 'rejected'], rejected: [], refunded: [] };
export const nextRefundStatuses = (from: RefundStatus): readonly RefundStatus[] => NEXT[from];
export const canRefundTransition = (from: RefundStatus, to: RefundStatus): boolean => NEXT[from].includes(to);
/** Statuses that count against the order total. A rejected request frees its amount again. */
export const LIVE_REFUND_STATUSES: readonly RefundStatus[] = ['requested', 'approved', 'refunded'];

export interface Refund {
  id: string;
  order_id: string;
  kind: RefundKind;
  reason_code: RefundReason;
  reason_note: string;
  amount_paise: number;
  status: RefundStatus;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  refunded_by: string | null;
  refunded_at: string | null;
  payment_ref: string | null;
  goods_received: boolean;
  updated_at: string;
  orders?: { order_no: string; customer_name: string; total_paise: number } | null;
}

export const MAX_REFUND_PAISE = 100_000_000; // Rs 10,00,000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Fail = { ok: false; errors: string[] };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, min: number, max: number): string | null => (typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);

/** "349" or "349.50" to paise. Anything else (commas, signs, three decimals, exponents) is refused. */
export function rupeesToPaise(raw: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}

export interface NewRefund {
  order_id: string;
  kind: RefundKind;
  reason_code: RefundReason;
  reason_note: string;
  amount_paise: number;
}
export function validateRefundCreate(raw: unknown): { ok: true; value: NewRefund } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const errors: string[] = [];
  const order_id = typeof raw.order_id === 'string' && UUID_RE.test(raw.order_id) ? raw.order_id : null;
  if (!order_id) errors.push('Choose an order.');
  const kind = (REFUND_KINDS as readonly unknown[]).includes(raw.kind) ? (raw.kind as RefundKind) : null;
  if (!kind) errors.push('Choose refund only, or return and refund.');
  const reason_code = (REFUND_REASONS as readonly unknown[]).includes(raw.reason_code) ? (raw.reason_code as RefundReason) : null;
  if (!reason_code) errors.push('Choose a reason.');
  const reason_note = text(raw.reason_note, 3, 500);
  if (!reason_note) errors.push('Describe what happened (3 to 500 characters).');
  const amt = raw.amount_paise;
  const amount_paise = typeof amt === 'number' && Number.isInteger(amt) && amt >= 1 && amt <= MAX_REFUND_PAISE ? amt : null;
  if (amount_paise === null) errors.push('Enter an amount above zero (up to ₹10,00,000).');
  if (errors.length || !order_id || !kind || !reason_code || !reason_note || amount_paise === null) return { ok: false, errors };
  return { ok: true, value: { order_id, kind, reason_code, reason_note, amount_paise } };
}

export interface RefundDecision {
  refund_id: string;
  status: RefundStatus;
  note: string | null;
  payment_ref: string | null;
  goods_received: boolean;
}
/** Rejecting needs a reason; marking refunded needs the bank or gateway reference so the payout can be matched later. */
export function validateRefundStatus(raw: unknown, current?: RefundStatus): { ok: true; value: RefundDecision } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const errors: string[] = [];
  const refund_id = typeof raw.refund_id === 'string' && UUID_RE.test(raw.refund_id) ? raw.refund_id : null;
  if (!refund_id) errors.push('Choose a refund.');
  const status = isRefundStatus(raw.status) && raw.status !== 'requested' ? raw.status : null;
  if (!status) errors.push('Choose approved, rejected or refunded.');
  if (status && current && !canRefundTransition(current, status)) errors.push(`A refund that is ${REFUND_STATUS_LABELS[current].toLowerCase()} cannot be marked ${status}.`);
  let note: string | null = null;
  let payment_ref: string | null = null;
  if (status === 'rejected') {
    note = text(raw.note, 3, 500);
    if (!note) errors.push('Give a reason for rejecting (3 to 500 characters).');
  } else if (typeof raw.note === 'string' && raw.note.trim() !== '') {
    note = text(raw.note, 1, 500);
    if (!note) errors.push('Keep the note under 500 characters.');
  }
  if (status === 'refunded') {
    payment_ref = typeof raw.payment_ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _/#.-]{3,79}$/.test(raw.payment_ref.trim()) ? raw.payment_ref.trim() : null;
    if (!payment_ref) errors.push('Enter the bank or gateway reference for the payout (4 to 80 letters, numbers or - _ / # .).');
  }
  if (errors.length || !refund_id || !status) return { ok: false, errors };
  return { ok: true, value: { refund_id, status, note, payment_ref, goods_received: raw.goods_received === true } };
}

/** What can still be refunded on an order: its total minus every request that is not rejected. */
export const refundableLeft = (totalPaise: number, refunds: Pick<Refund, 'amount_paise' | 'status'>[]): number =>
  Math.max(0, totalPaise - refunds.filter((r) => LIVE_REFUND_STATUSES.includes(r.status)).reduce((s, r) => s + r.amount_paise, 0));
