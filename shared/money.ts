/**
 * Exact integer money for orders with bundle and loyalty savings (Phase 12 Stage 7B). Pure functions, no I/O.
 *
 * The AUTHORITY is the database (supabase/stage7_commerce.sql). This file is the TypeScript twin of its arithmetic so the same cases
 * can be tested on both sides and so the browser can SHOW a total. The browser's figure is never what is charged: the database
 * recomputes it, compares it with what the customer was shown (KH:PRICE_CHANGED on any difference), and Razorpay receives orders.total_paise.
 * All maths runs on BigInt, so a large product can never lose precision. Inputs and outputs are safe integers (paise).
 */

export class MoneyError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const need = (cond: boolean, code = 'KH:INVALID'): void => { if (!cond) throw new MoneyError(code); };
const toNum = (b: bigint): number => { need(b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER)); return Number(b); };

/** Mirror of public.bundle_alloc: largest remainder, ties to the lower index. The parts add up to `amount` exactly. */
export function allocateExact(amount: number, weights: number[]): number[] {
  need(isInt(amount) && amount >= 0 && weights.length > 0 && weights.every((w) => isInt(w) && w > 0));
  const A = BigInt(amount);
  const W = weights.map(BigInt);
  const total = W.reduce((a, b) => a + b, 0n);
  const out = W.map((w) => (A * w) / total);
  const rem = W.map((w) => (A * w) % total);
  let left = A - out.reduce((a, b) => a + b, 0n);
  while (left > 0n) {
    let best = 0;
    for (let j = 1; j < rem.length; j++) if (rem[j]! > rem[best]!) best = j;
    out[best]! += 1n;
    rem[best] = -1n;
    left -= 1n;
  }
  return out.map(toNum);
}

export interface OrderMoney {
  subtotalPaise: number;
  /** Coupon saving (orders.discount_paise). */
  couponDiscountPaise: number;
  /** Bundle saving (orders.bundle_discount_paise). */
  bundleDiscountPaise: number;
  /** Loyalty redemption (orders.loyalty_discount_paise). Never merged into the two above. */
  loyaltyDiscountPaise: number;
  shippingPaise: number;
}

/** total = subtotal - coupon - bundle - loyalty + shipping. The same invariant the database enforces (orders_total_matches). */
export function orderTotal(m: OrderMoney): number {
  for (const v of Object.values(m)) need(isInt(v) && v >= 0);
  const t = BigInt(m.subtotalPaise) - BigInt(m.couponDiscountPaise) - BigInt(m.bundleDiscountPaise) - BigInt(m.loyaltyDiscountPaise) + BigInt(m.shippingPaise);
  need(t > 0n, 'KH:TOTAL_NOT_POSITIVE');
  return toNum(t);
}

export interface RedemptionRules { redeemBlockPoints: number; redeemBlockPaise: number; minRedeemPoints: number; maxRedeemBps: number }

/** Value of a points request, from the rules (never from the caller). Throws KH:LIMIT for a request the database would also refuse. */
export function redemptionValuePaise(points: number, r: RedemptionRules): number {
  need(isInt(points) && points >= 0);
  if (points === 0) return 0;
  need(points >= r.minRedeemPoints && points % r.redeemBlockPoints === 0, 'KH:LIMIT');
  return toNum(BigInt(points / r.redeemBlockPoints) * BigInt(r.redeemBlockPaise));
}

/** The most the order may redeem, in paise: the percentage cap of eligible net, and goods must keep at least Rs 1 payable. */
export function maxRedeemablePaise(eligibleNetPaise: number, goodsAfterSavingsPaise: number, r: RedemptionRules): number {
  need(isInt(eligibleNetPaise) && eligibleNetPaise >= 0 && isInt(goodsAfterSavingsPaise) && goodsAfterSavingsPaise >= 0);
  const byPercent = toNum((BigInt(eligibleNetPaise) * BigInt(r.maxRedeemBps)) / 10000n);
  return Math.max(0, Math.min(byPercent, goodsAfterSavingsPaise - 100));
}

export interface LineWeight { id: string; netPaise: number }

/** Split a redemption across lines in a fixed order (by id), weighted by what is payable on each line. Sums to `valuePaise` exactly; no line goes below zero. */
export function allocateLoyalty(valuePaise: number, lines: LineWeight[]): { id: string; loyaltyPaise: number }[] {
  const eligible = lines.filter((l) => l.netPaise > 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  need(eligible.length > 0, 'KH:LIMIT');
  const parts = allocateExact(valuePaise, eligible.map((l) => l.netPaise));
  return eligible.map((l, i) => {
    need(parts[i]! <= l.netPaise, 'KH:LIMIT');
    return { id: l.id, loyaltyPaise: parts[i]! };
  });
}

/** Refund room left on an order: the customer's actual payment less every refund already requested, approved or paid. Never negative. */
export function refundRemainingPaise(paidPaise: number, committedRefundsPaise: number): number {
  need(isInt(paidPaise) && paidPaise >= 0 && isInt(committedRefundsPaise) && committedRefundsPaise >= 0);
  return Math.max(0, paidPaise - committedRefundsPaise);
}

/** Pro-rata share of `part` of a line's net value for q of its qty units, floored (as order_refund_basis). All units give exactly the net. */
export function lineShareForUnits(netPaise: number, qty: number, units: number): number {
  need(isInt(netPaise) && netPaise >= 0 && isInt(qty) && qty > 0 && isInt(units) && units >= 0 && units <= qty);
  return units === qty ? netPaise : toNum((BigInt(netPaise) * BigInt(units)) / BigInt(qty));
}
