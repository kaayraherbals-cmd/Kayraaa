/**
 * Kaayra Rewards (V5 Phase 9). Pure functions, no I/O.
 *
 * The AUTHORITY for every point movement is the database (supabase/loyalty.sql). Nothing here decides a balance or a discount.
 * This file holds the TypeScript twin of the SQL arithmetic (so tests can check both against the same cases), plain-language
 * messages for refusals, and validation of what an owner types into the settings form. All money is integer paise, all points integers.
 * Division is integer floor, never floating point.
 */

export interface LoyaltyRules {
  earnPoints: number;
  earnPerPaise: number;
  minOrderPaise: number;
  maxPointsPerOrder: number | null;
  redeemBlockPoints: number;
  redeemBlockPaise: number;
  minRedeemPoints: number;
  maxRedeemBps: number;
}

export const DEFAULT_RULES: LoyaltyRules = {
  earnPoints: 10,
  earnPerPaise: 10000,
  minOrderPaise: 0,
  maxPointsPerOrder: null,
  redeemBlockPoints: 100,
  redeemBlockPaise: 1000,
  minRedeemPoints: 100,
  maxRedeemBps: 2000,
};

/** The payable floor used by coupons: an order is never discounted below Rs 1 (Razorpay cannot take zero). */
export const MIN_PAYABLE_PAISE = 100;

const floorDiv = (a: number, b: number): number => Math.floor(a / b);

/** points = floor(floor(net x earnPoints / earnPerPaise) x multiplierBps / 10000), then the per-order cap. 0 below the minimum order. */
export function earnPoints(netPaise: number, rules: LoyaltyRules, multiplierBps = 10000): number {
  if (!Number.isSafeInteger(netPaise) || netPaise <= 0 || netPaise < rules.minOrderPaise) return 0;
  const base = floorDiv(netPaise * rules.earnPoints, rules.earnPerPaise);
  let pts = floorDiv(base * multiplierBps, 10000);
  if (rules.maxPointsPerOrder !== null) pts = Math.min(pts, rules.maxPointsPerOrder);
  return Math.max(pts, 0);
}

export type RedeemRefusal = 'BELOW_MINIMUM' | 'NOT_WHOLE_BLOCK' | 'OVER_SHARE_LIMIT' | 'BELOW_PAYABLE_FLOOR' | 'INSUFFICIENT' | 'STACKING';

export interface RedeemInput {
  points: number;
  availablePoints: number;
  eligibleNetPaise: number;
  /** subtotal minus coupon discount, items only */
  itemsPayablePaise: number;
  hasCoupon: boolean;
  stacking: 'exclusive' | 'both';
}

export type RedeemResult = { ok: true; valuePaise: number } | { ok: false; reason: RedeemRefusal };

export function redeemValue(points: number, rules: LoyaltyRules): number {
  return floorDiv(points, rules.redeemBlockPoints) * rules.redeemBlockPaise;
}

export function checkRedemption(i: RedeemInput, rules: LoyaltyRules): RedeemResult {
  if (i.hasCoupon && i.stacking === 'exclusive') return { ok: false, reason: 'STACKING' };
  if (!Number.isInteger(i.points) || i.points < rules.minRedeemPoints) return { ok: false, reason: 'BELOW_MINIMUM' };
  if (i.points % rules.redeemBlockPoints !== 0) return { ok: false, reason: 'NOT_WHOLE_BLOCK' };
  const value = redeemValue(i.points, rules);
  if (value > floorDiv(i.eligibleNetPaise * rules.maxRedeemBps, 10000)) return { ok: false, reason: 'OVER_SHARE_LIMIT' };
  if (value > i.itemsPayablePaise - MIN_PAYABLE_PAISE) return { ok: false, reason: 'BELOW_PAYABLE_FLOOR' };
  if (i.availablePoints < i.points) return { ok: false, reason: 'INSUFFICIENT' };
  return { ok: true, valuePaise: value };
}

export function redeemMessage(reason: RedeemRefusal, rules: LoyaltyRules = DEFAULT_RULES): string {
  switch (reason) {
    case 'BELOW_MINIMUM': return `Redeem at least ${rules.minRedeemPoints} points.`;
    case 'NOT_WHOLE_BLOCK': return `Points are redeemed in steps of ${rules.redeemBlockPoints}.`;
    case 'OVER_SHARE_LIMIT': return 'That is more than the share of this order that points can cover.';
    case 'BELOW_PAYABLE_FLOOR': return 'Points cannot take the order below the minimum payable amount.';
    case 'INSUFFICIENT': return 'You do not have enough available points.';
    case 'STACKING': return 'Points cannot be combined with a coupon on the same order.';
  }
}

/** Points to have reversed in total after refunding `refundedPaise` of an order that paid `totalPaise` (floor, proportional). A full refund reverses everything. */
export function reversalTarget(earned: number, refundedPaise: number, totalPaise: number, full: boolean): number {
  if (full || totalPaise <= 0) return earned;
  return floorDiv(earned * Math.min(refundedPaise, totalPaise), totalPaise);
}

export interface Reversal { fromPending: number; fromAvailable: number; debt: number }
/** Split a reversal: pending first, then available, and whatever was already spent becomes debt (never a negative balance). */
export function splitReversal(delta: number, pending: number, available: number): Reversal {
  const fromPending = Math.min(delta, pending);
  const fromAvailable = Math.min(delta - fromPending, available);
  return { fromPending, fromAvailable, debt: delta - fromPending - fromAvailable };
}

export interface Lot { id: string; remaining: number; expiresAt: number | null; createdAt: number }
/** Earliest-expiring first (lots that never expire last), then oldest. Expired lots are skipped. Returns null when the balance is not enough. */
export function allocateFifo(lots: Lot[], points: number, now: number): { id: string; points: number }[] | null {
  const live = lots.filter((l) => l.remaining > 0 && (l.expiresAt === null || l.expiresAt > now))
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const out: { id: string; points: number }[] = [];
  let need = points;
  for (const l of live) {
    if (need === 0) break;
    const take = Math.min(need, l.remaining);
    out.push({ id: l.id, points: take });
    need -= take;
  }
  return need === 0 ? out : null;
}

export interface Tier { code: string; minSpendPaise: number; active: boolean }
/** One model: eligible lifetime net spend. The highest active tier whose threshold is met. */
export function tierFor(spendPaise: number, tiers: Tier[]): string | null {
  const ok = tiers.filter((t) => t.active && t.minSpendPaise <= spendPaise).sort((a, b) => b.minSpendPaise - a.minSpendPaise);
  return ok[0]?.code ?? null;
}

/** Estimated liability: spendable points (available + reserved) at the current redemption rate. Pending points are excluded. Not a cash expense. */
export function liabilityPaise(available: number, reserved: number, rules: LoyaltyRules): number {
  return floorDiv(available + reserved, rules.redeemBlockPoints) * rules.redeemBlockPaise;
}

export interface RuleErrors { [field: string]: string }
/** Validate the owner's settings form before it is sent. The database re-checks every one of these. */
export function validateRules(r: Partial<LoyaltyRules>): RuleErrors {
  const e: RuleErrors = {};
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (r.earnPoints !== undefined && !int(r.earnPoints, 1, 1000)) e.earnPoints = 'Whole number from 1 to 1000.';
  if (r.earnPerPaise !== undefined && !int(r.earnPerPaise, 100, 100000000)) e.earnPerPaise = 'Between Rs 1 and Rs 1,000,000 (in paise).';
  if (r.redeemBlockPoints !== undefined && !int(r.redeemBlockPoints, 1, 100000)) e.redeemBlockPoints = 'Whole number from 1 to 100000.';
  if (r.redeemBlockPaise !== undefined && !int(r.redeemBlockPaise, 1, 10000000)) e.redeemBlockPaise = 'Whole paise, at least 1.';
  if (r.maxRedeemBps !== undefined && !int(r.maxRedeemBps, 0, 10000)) e.maxRedeemBps = 'From 0 to 10000 (100%).';
  // Programme cost guard: redeeming must never be worth more than the points earn at the same rate.
  if (r.earnPoints && r.earnPerPaise && r.redeemBlockPoints && r.redeemBlockPaise && Object.keys(e).length === 0) {
    const giveBackBps = Math.floor((r.redeemBlockPaise * r.earnPoints * 10000) / (r.redeemBlockPoints * r.earnPerPaise));
    if (giveBackBps > 2000) e.redeemBlockPaise = 'This gives back more than 20% of spend. Lower the redemption value or raise the points needed.';
  }
  return e;
}
