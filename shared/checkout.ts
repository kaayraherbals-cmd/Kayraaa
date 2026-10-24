/**
 * Checkout rules. Pure functions, no I/O, so the same logic is tested without a database.
 *
 * The browser sends a delivery address, an idempotency key and (as a consent check only) the total the customer was shown.
 * It never sends prices, tax, shipping or the list of items: the items come from the customer's saved bag on the server and
 * every figure is recalculated from the database. A total from the browser is compared, never used.
 */
import type { Flags } from './flags.js';

/**
 * Checkout endpoints open only when the bag is open AND readFlags() opened checkout for this environment: test mode on
 * staging, or production with live-sales approval. COMMERCE_ENABLED alone never opens production checkout.
 */
export function checkoutOpen(flags: Flags): boolean {
  return flags.checkout_testing && flags.cart_preview;
}

/** Orders are test orders (never fulfilled) unless live sales are approved in production. */
export const isTestOrder = (flags: Flags): boolean => !flags.live_sales;

/** How long an unpaid order holds its stock. Section 4 releases the stock when this passes. */
export const ORDER_HOLD_MINUTES = 30;

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;

/** First two digits that India Post does not use for delivery PIN codes (unused ranges 10, 29, 35, 54-55, 65-66, 86-89; 90-99 are army post offices). */
const UNUSED_PIN_PREFIXES = new Set(['10', '29', '35', '54', '55', '65', '66', '86', '87', '88', '89']);

/** Shape check only. Whether we can deliver there is decided by the serviceability table on the server. */
export function isValidPin(v: unknown): v is string {
  if (typeof v !== 'string' || !/^[1-9]\d{5}$/.test(v)) return false;
  const prefix = v.slice(0, 2);
  return !UNUSED_PIN_PREFIXES.has(prefix) && Number(prefix) < 90;
}

/** Indian mobile number, with or without +91 / 91 / 0 and with spaces or dashes. Returns +91XXXXXXXXXX, or null. */
export function normalisePhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let d = v.replace(/[\s()-]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.startsWith('91') && d.length === 12) d = d.slice(2);
  else if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export interface Address {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: (typeof INDIAN_STATES)[number];
  pincode: string;
}

export type AddressField = keyof Address;
export type AddressErrors = Partial<Record<AddressField, string>>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Letters, digits, spaces and ordinary address punctuation only; control characters and angle brackets never get through. */
const SAFE_TEXT = /^[\p{L}\p{M}\p{N} .,'’()#/&:;+-]+$/u;
const clean = (v: unknown, min: number, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length >= min && s.length <= max && SAFE_TEXT.test(s) ? s : null;
};

export function validateAddress(raw: unknown): { ok: true; value: Address } | { ok: false; errors: AddressErrors } {
  if (!isObj(raw)) return { ok: false, errors: { name: 'Enter your delivery details.' } };
  const errors: AddressErrors = {};
  const name = clean(raw.name, 2, 80);
  if (!name) errors.name = 'Enter the full name of the person receiving the order.';
  const phone = normalisePhone(raw.phone);
  if (!phone) errors.phone = 'Enter a 10-digit Indian mobile number.';
  const line1 = clean(raw.line1, 5, 120);
  if (!line1) errors.line1 = 'Enter the house or flat number and street (5 to 120 characters).';
  let line2 = '';
  if (raw.line2 !== undefined && raw.line2 !== null && raw.line2 !== '') {
    const l2 = clean(raw.line2, 1, 120);
    if (!l2) errors.line2 = 'Area or landmark can have letters, numbers and common punctuation only (up to 120 characters).';
    else line2 = l2;
  }
  const city = clean(raw.city, 2, 60);
  if (!city) errors.city = 'Enter the town or city.';
  const state = typeof raw.state === 'string' ? INDIAN_STATES.find((s) => s === raw.state) : undefined;
  if (!state) errors.state = 'Choose a state or union territory.';
  const pincode = typeof raw.pincode === 'string' ? raw.pincode.trim() : '';
  if (!isValidPin(pincode)) errors.pincode = 'Enter a valid 6-digit PIN code.';
  if (Object.keys(errors).length || !name || !phone || !line1 || !city || !state) return { ok: false, errors };
  return { ok: true, value: { name, phone, line1, line2, city, state, pincode } };
}

/** One line for the order record and the courier label. orders.ship_address allows 8 to 400 characters. */
export const flattenAddress = (a: Address): string => [a.line1, a.line2, a.city, a.state].filter(Boolean).join(', ');

/** A row of the serviceability table (supabase/checkout.sql). Section 6 replaces the source with a courier provider. */
export interface ShippingRow {
  pincode: string;
  active: boolean;
  ratePaise: number;
  /** Free shipping when the subtotal reaches this amount. null means never free. */
  freeAbovePaise: number | null;
}

export interface ShippingQuote {
  serviceable: boolean;
  shippingPaise: number;
  label: string;
}

/**
 * Shipping for one PIN code. No row, or an inactive row, means we cannot deliver there: checkout stops rather than guessing a rate.
 * Shipping is treated as tax-inclusive and no separate GST line is computed on it. Treatment of GST on shipping is for the
 * company's tax adviser to confirm before launch (docs/CHANGES_PHASE5.md, launch blockers).
 */
export function quoteShipping(row: ShippingRow | null, subtotalPaise: number): ShippingQuote {
  if (!row || !row.active || !Number.isInteger(row.ratePaise) || row.ratePaise < 0) return { serviceable: false, shippingPaise: 0, label: 'We cannot deliver to this PIN code yet.' };
  const free = row.freeAbovePaise !== null && subtotalPaise >= row.freeAbovePaise;
  return free ? { serviceable: true, shippingPaise: 0, label: 'Free delivery' } : { serviceable: true, shippingPaise: row.ratePaise, label: 'Standard delivery' };
}

export interface CheckoutTotals {
  subtotalPaise: number;
  /** Coupon discount on items (never on shipping). 0 when no coupon applies. */
  discountPaise: number;
  shippingPaise: number;
  /** What the customer pays: subtotal - discount + shipping. */
  totalPaise: number;
  /** GST already inside the amount paid (after any discount). */
  gstIncludedPaise: number;
}

/**
 * subtotal - discount + shipping, with the discount clamped so the total can never go negative. The discount itself comes from the
 * database (coupon_compute); this only adds the figures up for display and for comparing with the order the database creates.
 */
export const checkoutTotals = (subtotalPaise: number, gstIncludedPaise: number, shippingPaise: number, discountPaise = 0): CheckoutTotals => {
  const discount = Math.min(Math.max(0, Math.trunc(discountPaise)), subtotalPaise);
  return { subtotalPaise, discountPaise: discount, shippingPaise, totalPaise: subtotalPaise - discount + shippingPaise, gstIncludedPaise };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QuoteRequest {
  address: Address;
}
export interface PlaceRequest {
  address: Address;
  idempotencyKey: string;
  /** The total the customer saw. Used only to refuse the order if the price moved; never used as the amount. */
  expectedTotalPaise: number;
  /** Rewards points the customer chose to redeem. Present only when greater than 0. The database computes the value and re-checks every rule. */
  loyaltyPoints?: number;
}

export type RequestResult<T> = { ok: true; value: T } | { ok: false; errors: AddressErrors; message: string };

export function validateQuoteRequest(raw: unknown): RequestResult<QuoteRequest> {
  const body = isObj(raw) ? raw : {};
  const a = validateAddress(body.address);
  if (!a.ok) return { ok: false, errors: a.errors, message: 'Check the highlighted delivery details.' };
  return { ok: true, value: { address: a.value } };
}

export function validatePlaceRequest(raw: unknown): RequestResult<PlaceRequest> {
  const body = isObj(raw) ? raw : {};
  const a = validateAddress(body.address);
  if (!a.ok) return { ok: false, errors: a.errors, message: 'Check the highlighted delivery details.' };
  if (typeof body.idempotencyKey !== 'string' || !UUID_RE.test(body.idempotencyKey)) return { ok: false, errors: {}, message: 'Reload the page and try again.' };
  const t = body.expectedTotalPaise;
  if (typeof t !== 'number' || !Number.isInteger(t) || t <= 0 || t > 100_000_000) return { ok: false, errors: {}, message: 'Reload the page and try again.' };
  const lp = body.loyaltyPoints;
  if (lp !== undefined && lp !== null && (typeof lp !== 'number' || !Number.isInteger(lp) || lp < 0 || lp > 1_000_000)) return { ok: false, errors: {}, message: 'Check the rewards points you entered.' };
  const value: PlaceRequest = { address: a.value, idempotencyKey: body.idempotencyKey.toLowerCase(), expectedTotalPaise: t };
  if (typeof lp === 'number' && lp > 0) value.loyaltyPoints = lp;
  return { ok: true, value };
}

/**
 * Fingerprint of what is being ordered, used with the idempotency key: the same key with different contents is refused, and
 * the same contents resubmitted while an unpaid order is still open returns that order instead of reserving stock twice.
 * Lines are sorted so the order of the bag does not matter.
 */
export function canonicalRequest(lines: { variantId: string; qty: number }[], address: Address, couponCode: string | null = null, loyaltyPoints = 0): string {
  const sorted = [...lines].sort((x, y) => (x.variantId < y.variantId ? -1 : 1)).map((l) => [l.variantId, l.qty]);
  // The coupon is part of the fingerprint: the same idempotency key with a different coupon is a different order, and is refused.
  return JSON.stringify({ l: sorted, a: [address.name, address.phone, address.line1, address.line2, address.city, address.state, address.pincode], ...(couponCode ? { c: couponCode } : {}), ...(loyaltyPoints > 0 ? { p: loyaltyPoints } : {}) });
}
