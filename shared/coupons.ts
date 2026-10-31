/**
 * Coupons (V5 Phase 5). Pure functions, no I/O.
 *
 * The AUTHORITY for a discount is the database function coupon_compute() (supabase/coupons.sql). Nothing here decides how much a
 * customer pays. This file holds: the code format, plain-language messages for every refusal, validation of what an owner types
 * into the coupon form, the GST re-calculation on discounted lines, and `referenceDiscount()`, a TypeScript twin of the SQL
 * arithmetic that exists only so the tests can check both implementations against the same cases.
 */
import { formatRupees } from './cart.js';

export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
/** Razorpay cannot take a zero amount: an order is never discounted below this (paise). */
export const MIN_PAYABLE_PAISE = 100;

export const normaliseCode = (v: unknown): string => (typeof v === 'string' ? v.trim().toUpperCase() : '');
export const isCouponCode = (v: unknown): v is string => typeof v === 'string' && COUPON_CODE_RE.test(v);

export type CouponReason =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'NOT_ELIGIBLE_ITEMS'
  | 'MIN_ORDER'
  | 'USAGE_LIMIT'
  | 'CUSTOMER_LIMIT'
  | 'FIRST_ORDER'
  | 'NO_DISCOUNT'
  | 'TOO_MANY'
  | 'STACKING';

/**
 * What a customer reads when a code is refused. An inactive coupon gets the same words as an unknown one, so the message does not
 * confirm that a switched-off code exists.
 */
export function couponMessage(reason: string, minOrderPaise?: number | null): string {
  switch (reason) {
    case 'NOT_FOUND':
    case 'INACTIVE':
      return 'That coupon code is not valid. Check the spelling and try again.';
    case 'NOT_STARTED':
      return 'This coupon is not active yet.';
    case 'EXPIRED':
      return 'This coupon has expired.';
    case 'NOT_ELIGIBLE_ITEMS':
      return 'This coupon does not apply to the items in your bag.';
    case 'MIN_ORDER':
      return typeof minOrderPaise === 'number' && minOrderPaise > 0 ? `Spend at least ${formatRupees(minOrderPaise)} on eligible items to use this coupon.` : 'Your bag is below the minimum for this coupon.';
    case 'USAGE_LIMIT':
      return 'This coupon has been fully claimed.';
    case 'CUSTOMER_LIMIT':
      return 'You have already used this coupon the most times it allows.';
    case 'FIRST_ORDER':
      return 'This coupon is for a first order only.';
    case 'NO_DISCOUNT':
      return 'This coupon would not reduce your total.';
    case 'TOO_MANY':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'STACKING':
      return 'Only one coupon can be used on an order.';
    default:
      return 'This coupon cannot be applied.';
  }
}

export interface CouponAllocation {
  ref: string;
  discount_paise: number;
}

/** What coupon_quote / coupon_cart_apply return. */
export type CouponCheck =
  | { ok: true; code: string; description: string | null; discount_paise: number; eligible_paise: number; subtotal_paise: number; allocations: CouponAllocation[] }
  | { ok: false; reason: string; min_order_paise?: number; code?: string; description?: string | null };

/** The coupon block the cart and checkout show. Money is paise. */
export interface AppliedCoupon {
  code: string;
  description: string | null;
  /** false: the code on the bag no longer qualifies; no discount is applied and `message` says why. */
  valid: boolean;
  discountPaise: number;
  message: string | null;
}

export const appliedFromCheck = (savedCode: string, c: CouponCheck): AppliedCoupon =>
  c.ok
    ? { code: c.code, description: c.description, valid: true, discountPaise: c.discount_paise, message: null }
    : { code: c.code ?? savedCode, description: c.description ?? null, valid: false, discountPaise: 0, message: couponMessage(c.reason, c.min_order_paise) };

/** GST contained in a tax-inclusive amount (same rule as shared/cart.ts gstIncluded). */
const gstIn = (inclusive: number, rate: number): number => Math.round((inclusive * rate) / (100 + rate));

/**
 * GST that is inside the amount customers pay, after the discount: each line's discount is taken off the line before the tax is
 * extracted. Informational (prices include GST); the order keeps line total and line discount so an invoice can show both.
 */
export function gstAfterDiscount(lines: { ref: string; lineTotalPaise: number; gstRate: number }[], allocations: CouponAllocation[]): number {
  const by = new Map(allocations.map((a) => [a.ref, a.discount_paise]));
  let gst = 0;
  for (const l of lines) gst += gstIn(Math.max(0, l.lineTotalPaise - (by.get(l.ref) ?? 0)), l.gstRate);
  return gst;
}

// ---- Reference arithmetic (tests only; the database is the authority) ---------------------------------------------------------------
export interface RefCoupon {
  type: 'percent' | 'fixed';
  percentBps?: number;
  fixedPaise?: number;
  maxDiscountPaise?: number | null;
}
export interface RefLine {
  ref: string;
  amt: number;
  eligible: boolean;
}
/** Same steps as coupon_compute(): round down, cap, eligible subtotal, payable floor, then split by largest remainder (ties by ref). */
export function referenceDiscount(c: RefCoupon, lines: RefLine[], shippingPaise: number): { discount: number; allocations: CouponAllocation[] } | null {
  const total = lines.reduce((s, l) => s + l.amt, 0);
  const eligible = lines.filter((l) => l.eligible);
  const elig = eligible.reduce((s, l) => s + l.amt, 0);
  if (elig <= 0) return null;
  let d = c.type === 'percent' ? Math.floor((elig * (c.percentBps ?? 0)) / 10000) : (c.fixedPaise ?? 0);
  if (c.maxDiscountPaise != null) d = Math.min(d, c.maxDiscountPaise);
  d = Math.min(d, elig, total + shippingPaise - MIN_PAYABLE_PAISE);
  if (d <= 0) return null;
  const parts = eligible.map((l) => ({ ref: l.ref, fl: Math.floor((d * l.amt) / elig), fr: (d * l.amt) % elig }));
  const left = d - parts.reduce((s, p) => s + p.fl, 0);
  const ranked = [...parts].sort((a, b) => b.fr - a.fr || (a.ref < b.ref ? -1 : 1));
  const extra = new Set(ranked.slice(0, left).map((p) => p.ref));
  const allocations = parts.map((p) => ({ ref: p.ref, discount_paise: p.fl + (extra.has(p.ref) ? 1 : 0) })).sort((a, b) => (a.ref < b.ref ? -1 : 1));
  return { discount: d, allocations };
}

// ---- Admin input ----------------------------------------------------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORM_RE = /^[\p{L}\p{N} .,'’&()/+-]{1,40}$/u;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** The row the database stores (snake_case), built only from fields that passed validation. */
export interface CouponWrite {
  code?: string;
  description: string | null;
  discount_type: 'percent' | 'fixed';
  percent_bps: number | null;
  fixed_paise: number | null;
  min_order_paise: number;
  max_discount_paise: number | null;
  starts_at: string | null;
  expires_at: string | null;
  usage_limit: number | null;
  per_customer_limit: number | null;
  first_order_only: boolean;
  product_ids: string[];
  product_forms: string[];
  active: boolean;
}

function readDate(v: unknown, label: string, errors: string[]): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') {
    errors.push(`${label} is not a valid date.`);
    return null;
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t)) {
    errors.push(`${label} is not a valid date.`);
    return null;
  }
  return new Date(t).toISOString();
}

function readLimit(v: unknown, label: string, max: number, errors: string[]): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (!isInt(v) || v < 1 || v > max) {
    errors.push(`${label} must be a whole number from 1 to ${max.toLocaleString('en-IN')}, or empty for no limit.`);
    return null;
  }
  return v;
}

/** Validates the coupon form. `create` requires the code (and refuses to change it later: the code is permanent). */
export function validateCouponInput(raw: unknown, mode: 'create' | 'update'): { ok: true; value: CouponWrite } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const b = isObj(raw) ? raw : {};
  let code: string | undefined;
  if (mode === 'create') {
    code = normaliseCode(b.code);
    if (!isCouponCode(code)) errors.push('Code must be 3 to 32 characters: capital letters, numbers, hyphen or underscore, starting with a letter or number.');
  }
  let description: string | null = null;
  if (b.description !== undefined && b.description !== null && b.description !== '') {
    if (typeof b.description !== 'string' || b.description.trim().length > 200 || /[<>]/.test(b.description) || [...b.description].some((ch) => ch.charCodeAt(0) < 32)) errors.push('Description can be up to 200 characters, without angle brackets.');
    else description = b.description.trim();
  }
  const type = b.type;
  let percentBps: number | null = null;
  let fixedPaise: number | null = null;
  if (type === 'percent') {
    if (!isInt(b.percentBps) || b.percentBps < 1 || b.percentBps > 10000) errors.push('Percentage must be between 0.01% and 100%.');
    else percentBps = b.percentBps;
  } else if (type === 'fixed') {
    if (!isInt(b.fixedPaise) || b.fixedPaise < 100 || b.fixedPaise > 100_000_000) errors.push('Fixed discount must be between ₹1 and ₹10,00,000.');
    else fixedPaise = b.fixedPaise;
  } else errors.push('Choose percentage or fixed amount.');

  const minOrder = b.minOrderPaise === undefined || b.minOrderPaise === null || b.minOrderPaise === '' ? 0 : b.minOrderPaise;
  if (!isInt(minOrder) || minOrder < 0 || minOrder > 1_000_000_000) errors.push('Minimum order must be ₹0 or more.');
  let maxDiscount: number | null = null;
  if (b.maxDiscountPaise !== undefined && b.maxDiscountPaise !== null && b.maxDiscountPaise !== '') {
    if (type !== 'percent') errors.push('A maximum discount only applies to percentage coupons.');
    else if (!isInt(b.maxDiscountPaise) || b.maxDiscountPaise < 100 || b.maxDiscountPaise > 1_000_000_000) errors.push('Maximum discount must be at least ₹1, or empty for no cap.');
    else maxDiscount = b.maxDiscountPaise;
  }
  const startsAt = readDate(b.startsAt, 'Start date', errors);
  const expiresAt = readDate(b.expiresAt, 'Expiry date', errors);
  if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) errors.push('The expiry date must be after the start date.');
  const usageLimit = readLimit(b.usageLimit, 'Total usage limit', 10_000_000, errors);
  const perCustomer = readLimit(b.perCustomerLimit, 'Per-customer limit', 1000, errors);

  const productIds: string[] = [];
  if (b.productIds !== undefined && b.productIds !== null) {
    if (!Array.isArray(b.productIds) || b.productIds.length > 100 || !b.productIds.every((x) => typeof x === 'string' && UUID_RE.test(x))) errors.push('Product list is not valid (up to 100 products).');
    else productIds.push(...new Set((b.productIds as string[]).map((x) => x.toLowerCase())));
  }
  const productForms: string[] = [];
  if (b.productForms !== undefined && b.productForms !== null) {
    if (!Array.isArray(b.productForms) || b.productForms.length > 30 || !b.productForms.every((x) => typeof x === 'string' && FORM_RE.test(x.trim()))) errors.push('Category list is not valid.');
    else productForms.push(...new Set((b.productForms as string[]).map((x) => x.trim())));
  }
  if (b.firstOrderOnly !== undefined && typeof b.firstOrderOnly !== 'boolean') errors.push('First-order setting must be on or off.');
  if (b.active !== undefined && typeof b.active !== 'boolean') errors.push('Status must be active or inactive.');

  if (errors.length || (type !== 'percent' && type !== 'fixed')) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...(code ? { code } : {}),
      description,
      discount_type: type,
      percent_bps: percentBps,
      fixed_paise: fixedPaise,
      min_order_paise: minOrder as number,
      max_discount_paise: maxDiscount,
      starts_at: startsAt,
      expires_at: expiresAt,
      usage_limit: usageLimit,
      per_customer_limit: perCustomer,
      first_order_only: b.firstOrderOnly === true,
      product_ids: productIds,
      product_forms: productForms,
      active: b.active === true,
    },
  };
}

/** Plain summary of a coupon's value for lists, e.g. "10% off, up to ₹300". */
export function describeValue(c: { discount_type: string; percent_bps: number | null; fixed_paise: number | null; max_discount_paise: number | null }): string {
  if (c.discount_type === 'fixed') return `${formatRupees(c.fixed_paise ?? 0)} off`;
  const pct = (c.percent_bps ?? 0) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}% off${c.max_discount_paise ? `, up to ${formatRupees(c.max_discount_paise)}` : ''}`;
}
