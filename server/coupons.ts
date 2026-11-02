import { gstAfterDiscount, appliedFromCheck, normaliseCode, isCouponCode, type AppliedCoupon, type CouponCheck } from '../shared/coupons.js';
import { isUuid, type CartLineView, type VariantRecord } from '../shared/cart.js';
import { rpc, type RpcResult } from './rpc.js';
import { rest, type SupabaseConfig } from './supabase.js';

/**
 * Customer-facing coupon calls. Every amount comes from the database function coupon_compute (supabase/coupons.sql); the browser
 * sends a code and nothing else. The code applied to a bag lives on the server (carts.coupon_code), so checkout never reads a coupon
 * or a discount from the request.
 */

/** The bag's lines as the database wants them: variant id as the reference, and the server-priced line total. */
export const couponLines = (lines: CartLineView[]) =>
  lines.filter((l) => l.state !== 'unavailable' && l.lineTotalPaise > 0).map((l) => ({ ref: l.variantId, variant_id: l.variantId, line_total_paise: l.lineTotalPaise }));

/** The code saved on this member's bag, or null. A database error throws; it is never read as "no coupon". */
export async function savedCouponCode(db: SupabaseConfig, memberId: string): Promise<string | null> {
  if (!isUuid(memberId)) return null;
  const r = await rest(db, `carts?select=coupon_code&member_id=eq.${memberId}&limit=1`);
  if (!r.ok) throw new Error(`cart coupon ${r.status}`);
  const row = ((await r.json()) as { coupon_code: string | null }[])[0];
  const code = row?.coupon_code ?? null;
  return code && isCouponCode(code) ? code : null;
}

/** Previews a code against these lines (no side effects). */
export const quoteCoupon = (db: SupabaseConfig, memberId: string, code: string, lines: CartLineView[], shippingPaise: number): Promise<RpcResult<CouponCheck>> =>
  rpc<CouponCheck>(db, 'coupon_quote', { p_member: memberId, p_code: code, p_lines: couponLines(lines), p_shipping: shippingPaise });

/** Validates and saves a code on the bag. Failed attempts are recorded and throttled in the database. */
export const applyCoupon = (db: SupabaseConfig, memberId: string, rawCode: unknown, lines: CartLineView[]): Promise<RpcResult<CouponCheck>> =>
  rpc<CouponCheck>(db, 'coupon_cart_apply', { p_member: memberId, p_code: normaliseCode(rawCode), p_lines: couponLines(lines) });

export const removeCoupon = (db: SupabaseConfig, memberId: string): Promise<RpcResult<null>> => rpc<null>(db, 'coupon_cart_clear', { p_member: memberId });

export interface PricedCoupon {
  applied: AppliedCoupon | null;
  discountPaise: number;
  /** GST inside what the customer pays, after the discount. Equals the undiscounted figure when no coupon applies. */
  gstIncludedPaise: number;
}

/**
 * Re-checks the bag's saved coupon against the current lines and returns the figures the cart and checkout show. If the coupon no
 * longer qualifies (expired, minimum no longer met, limit reached) it is reported with the reason and gives no discount.
 */
export async function priceWithSavedCoupon(
  db: SupabaseConfig, memberId: string, lines: CartLineView[], records: Map<string, VariantRecord>, shippingPaise: number, undiscountedGst: number,
): Promise<PricedCoupon> {
  const code = await savedCouponCode(db, memberId);
  if (!code) return { applied: null, discountPaise: 0, gstIncludedPaise: undiscountedGst };
  const r = await quoteCoupon(db, memberId, code, lines, shippingPaise);
  if (!r.ok) throw new Error('coupon quote failed');
  const applied = appliedFromCheck(code, r.data);
  if (!r.data.ok) return { applied, discountPaise: 0, gstIncludedPaise: undiscountedGst };
  const gst = gstAfterDiscount(
    lines.filter((l) => l.state !== 'unavailable').map((l) => ({ ref: l.variantId, lineTotalPaise: l.lineTotalPaise, gstRate: records.get(l.variantId)?.gst_rate ?? 0 })),
    r.data.allocations,
  );
  return { applied, discountPaise: r.data.discount_paise, gstIncludedPaise: gst };
}
