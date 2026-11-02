import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES as R, allocateFifo, checkRedemption, earnPoints, liabilityPaise, redeemValue, reversalTarget, splitReversal, tierFor, validateRules } from './loyalty.js';

describe('earning', () => {
  it('Rs 100 = 10 points on net merchandise, floored', () => {
    expect(earnPoints(10000, R)).toBe(10);
    expect(earnPoints(9999, R)).toBe(9);
    expect(earnPoints(130000, R)).toBe(130);
    expect(earnPoints(54000, R)).toBe(54);
  });
  it('is zero for zero, negative, fractional or non-numeric totals', () => {
    expect(earnPoints(0, R)).toBe(0);
    expect(earnPoints(-500, R)).toBe(0);
    expect(earnPoints(100.5, R)).toBe(0);
    expect(earnPoints(Number.NaN, R)).toBe(0);
  });
  it('respects the minimum order and the per-order cap', () => {
    expect(earnPoints(49999, { ...R, minOrderPaise: 50000 })).toBe(0);
    expect(earnPoints(50000, { ...R, minOrderPaise: 50000 })).toBe(50);
    expect(earnPoints(1000000, { ...R, maxPointsPerOrder: 200 })).toBe(200);
  });
  it('applies a tier multiplier after the base floor', () => {
    expect(earnPoints(130000, R, 11000)).toBe(143);
    expect(earnPoints(10000, R, 12500)).toBe(12);
  });
});

describe('redemption', () => {
  const ok = { points: 100, availablePoints: 130, eligibleNetPaise: 60000, itemsPayablePaise: 60000, hasCoupon: false, stacking: 'exclusive' as const };
  it('100 points = Rs 10', () => {
    expect(redeemValue(100, R)).toBe(1000);
    expect(checkRedemption(ok, R)).toEqual({ ok: true, valuePaise: 1000 });
  });
  it('refuses insufficient, below minimum and partial blocks', () => {
    expect(checkRedemption({ ...ok, availablePoints: 99 }, R)).toEqual({ ok: false, reason: 'INSUFFICIENT' });
    expect(checkRedemption({ ...ok, points: 50 }, R)).toEqual({ ok: false, reason: 'BELOW_MINIMUM' });
    expect(checkRedemption({ ...ok, points: 150 }, R)).toEqual({ ok: false, reason: 'NOT_WHOLE_BLOCK' });
  });
  it('caps the share of the order and keeps Rs 1 payable (never a negative total)', () => {
    expect(checkRedemption({ ...ok, points: 1300, availablePoints: 5000 }, R)).toEqual({ ok: false, reason: 'OVER_SHARE_LIMIT' });
    expect(checkRedemption({ ...ok, eligibleNetPaise: 100000, itemsPayablePaise: 1050 }, R)).toEqual({ ok: false, reason: 'BELOW_PAYABLE_FLOOR' });
  });
  it('coupon plus points is refused by default and allowed only when configured', () => {
    expect(checkRedemption({ ...ok, hasCoupon: true }, R)).toEqual({ ok: false, reason: 'STACKING' });
    expect(checkRedemption({ ...ok, hasCoupon: true, stacking: 'both' }, R).ok).toBe(true);
  });
});

describe('refunds', () => {
  it('reverses proportionally and fully on a full refund', () => {
    expect(reversalTarget(54, 27000, 54000, false)).toBe(27);
    expect(reversalTarget(54, 54000, 54000, true)).toBe(54);
    expect(reversalTarget(130, 999999, 130000, false)).toBe(130);
    expect(reversalTarget(130, 65000, 130000, false)).toBe(65);
  });
  it('a repeated event computes a zero difference', () => {
    const t = reversalTarget(54, 27000, 54000, false);
    expect(t - t).toBe(0);
  });
  it('takes pending first, then available, and records the rest as debt', () => {
    expect(splitReversal(10, 4, 3)).toEqual({ fromPending: 4, fromAvailable: 3, debt: 3 });
    expect(splitReversal(65, 0, 0)).toEqual({ fromPending: 0, fromAvailable: 0, debt: 65 });
    expect(splitReversal(5, 10, 10)).toEqual({ fromPending: 5, fromAvailable: 0, debt: 0 });
  });
});

describe('expiry order', () => {
  const day = 86400000;
  const lots = [
    { id: 'late', remaining: 100, expiresAt: 200 * day, createdAt: 1 },
    { id: 'soon', remaining: 60, expiresAt: 20 * day, createdAt: 2 },
    { id: 'never', remaining: 100, expiresAt: null, createdAt: 0 },
    { id: 'dead', remaining: 500, expiresAt: 1 * day, createdAt: 0 },
  ];
  it('spends earliest-expiring first, never expired, never-expiring last', () => {
    expect(allocateFifo(lots, 100, 10 * day)).toEqual([{ id: 'soon', points: 60 }, { id: 'late', points: 40 }]);
    expect(allocateFifo(lots, 260, 10 * day)?.map((x) => x.id)).toEqual(['soon', 'late', 'never']);
  });
  it('returns null when only expired points would cover it', () => {
    expect(allocateFifo(lots, 261, 10 * day)).toBeNull();
  });
});

describe('tiers and liability', () => {
  const tiers = [{ code: 'SILVER', minSpendPaise: 0, active: true }, { code: 'GOLD', minSpendPaise: 500000, active: true }, { code: 'PLATINUM', minSpendPaise: 2000000, active: false }];
  it('uses the highest active tier whose threshold is met', () => {
    expect(tierFor(0, tiers)).toBe('SILVER');
    expect(tierFor(500000, tiers)).toBe('GOLD');
    expect(tierFor(9999999, tiers)).toBe('GOLD');
  });
  it('values only spendable points', () => {
    expect(liabilityPaise(130, 100, R)).toBe(2000);
    expect(liabilityPaise(99, 0, R)).toBe(0);
  });
});

describe('owner settings', () => {
  it('accepts the defaults and rejects a rate that gives back too much', () => {
    expect(validateRules(R)).toEqual({});
    expect(validateRules({ ...R, redeemBlockPaise: 25000 }).redeemBlockPaise).toMatch(/more than 20%/);
    expect(validateRules({ earnPoints: 0 }).earnPoints).toBeDefined();
    expect(validateRules({ maxRedeemBps: 10001 }).maxRedeemBps).toBeDefined();
  });
});
