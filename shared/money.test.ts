import { describe, expect, it } from 'vitest';
import { MoneyError, allocateExact, allocateLoyalty, lineShareForUnits, maxRedeemablePaise, orderTotal, redemptionValuePaise, refundRemainingPaise, type RedemptionRules } from './money.js';
import { allocate } from './bundles.js';

const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as MoneyError).code; } };
const rules: RedemptionRules = { redeemBlockPoints: 100, redeemBlockPaise: 1000, minRedeemPoints: 100, maxRedeemBps: 2000 };

describe('orderTotal (same cases as supabase/stage7_selftest.sql)', () => {
  it('plain order, mixed bundle + loyalty order', () => {
    expect(orderTotal({ subtotalPaise: 100000, couponDiscountPaise: 0, bundleDiscountPaise: 0, loyaltyDiscountPaise: 2000, shippingPaise: 5000 })).toBe(103000);
    expect(orderTotal({ subtotalPaise: 163333, couponDiscountPaise: 0, bundleDiscountPaise: 13000, loyaltyDiscountPaise: 3000, shippingPaise: 5000 })).toBe(152333);
  });
  it('refuses negatives, fractions and a total that is not positive', () => {
    expect(code(() => orderTotal({ subtotalPaise: 100, couponDiscountPaise: -1, bundleDiscountPaise: 0, loyaltyDiscountPaise: 0, shippingPaise: 0 }))).toBe('KH:INVALID');
    expect(code(() => orderTotal({ subtotalPaise: 100.5, couponDiscountPaise: 0, bundleDiscountPaise: 0, loyaltyDiscountPaise: 0, shippingPaise: 0 }))).toBe('KH:INVALID');
    expect(code(() => orderTotal({ subtotalPaise: 100, couponDiscountPaise: 100, bundleDiscountPaise: 0, loyaltyDiscountPaise: 0, shippingPaise: 0 }))).toBe('KH:TOTAL_NOT_POSITIVE');
  });
});

describe('redemption value and cap', () => {
  it('200 points = Rs 20; blocks and minimum enforced', () => {
    expect(redemptionValuePaise(200, rules)).toBe(2000);
    expect(redemptionValuePaise(0, rules)).toBe(0);
    expect(code(() => redemptionValuePaise(150, rules))).toBe('KH:LIMIT');
    expect(code(() => redemptionValuePaise(50, rules))).toBe('KH:LIMIT');
  });
  it('percentage cap, and goods keep at least Rs 1', () => {
    expect(maxRedeemablePaise(100000, 100000, rules)).toBe(20000);
    expect(maxRedeemablePaise(100000, 10100, rules)).toBe(10000);
    expect(maxRedeemablePaise(100000, 50, rules)).toBe(0);
  });
});

describe('allocation of a redemption across lines', () => {
  it('sums exactly, deterministic, ordered by id', () => {
    const lines = [{ id: 'c', netPaise: 33333 }, { id: 'a', netPaise: 100000 }, { id: 'b', netPaise: 30000 }];
    const r = allocateLoyalty(3000, lines);
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.reduce((s, x) => s + x.loyaltyPaise, 0)).toBe(3000);
    expect(allocateLoyalty(3000, lines)).toEqual(r);
  });
  it('rounding remainders go to the largest remainder, ties to the lower index', () => {
    expect(allocateExact(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it('never exceeds a line, for every amount up to the whole', () => {
    const lines = [{ id: 'a', netPaise: 7 }, { id: 'b', netPaise: 13 }, { id: 'c', netPaise: 29 }];
    for (let v = 1; v <= 49; v++) {
      const r = allocateLoyalty(v, lines);
      expect(r.reduce((s, x) => s + x.loyaltyPaise, 0)).toBe(v);
      r.forEach((x) => expect(x.loyaltyPaise <= lines.find((l) => l.id === x.id)!.netPaise).toBe(true));
    }
  });
  it('agrees with the bundle allocator used by the database function bundle_alloc', () => {
    for (let a = 0; a < 300; a++) expect(allocateExact(a, [7, 13, 29, 5])).toEqual(allocate(a, [7, 13, 29, 5]));
  });
  it('is exact for amounts whose product would exceed 2^53 in floating point', () => {
    const r = allocateExact(900719925474, [900719925474, 1]);
    expect(r.reduce((s, x) => s + x, 0)).toBe(900719925474);
  });
  it('refuses a request with no eligible line', () => {
    expect(code(() => allocateLoyalty(100, [{ id: 'a', netPaise: 0 }]))).toBe('KH:LIMIT');
  });
});

describe('refund arithmetic', () => {
  it('room is paid less committed refunds and never negative', () => {
    expect(refundRemainingPaise(103000, 0)).toBe(103000);
    expect(refundRemainingPaise(103000, 50000)).toBe(53000);
    expect(refundRemainingPaise(103000, 120000)).toBe(0);
  });
  it('line share floors for part of the units and is exact for all of them', () => {
    expect(lineShareForUnits(134730, 3, 1)).toBe(44910);
    expect(lineShareForUnits(100, 3, 1)).toBe(33);
    expect(lineShareForUnits(100, 3, 3)).toBe(100);
    expect(code(() => lineShareForUnits(100, 3, 4))).toBe('KH:INVALID');
  });
});
