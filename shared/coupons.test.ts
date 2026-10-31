import { describe, expect, it } from 'vitest';
import { checkoutTotals } from './checkout.js';
import { appliedFromCheck, couponMessage, describeValue, gstAfterDiscount, isCouponCode, normaliseCode, referenceDiscount, validateCouponInput, type CouponReason } from './coupons.js';

const base = { code: 'kaayra10', type: 'percent', percentBps: 1000, minOrderPaise: 99900, maxDiscountPaise: 30000, usageLimit: 500, perCustomerLimit: 1, active: true };

describe('coupon codes', () => {
  it('normalises to capitals and trims', () => expect(normaliseCode('  kaayra10 ')).toBe('KAAYRA10'));
  it('accepts 3 to 32 of A-Z 0-9 _ -, starting with a letter or number', () => {
    for (const ok of ['KAAYRA10', 'ABC', 'A_B-C', '10OFF', 'A'.repeat(32)]) expect(isCouponCode(ok)).toBe(true);
    for (const bad of ['AB', 'A'.repeat(33), 'kaayra', '-ABC', '_ABC', 'AB CD', 'AB;DROP', 'ÄBC', '', null, 5]) expect(isCouponCode(bad)).toBe(false);
  });
  it('treats non-strings as empty', () => expect(normaliseCode(undefined)).toBe(''));
});

describe('customer messages', () => {
  const reasons: CouponReason[] = ['NOT_FOUND', 'INACTIVE', 'NOT_STARTED', 'EXPIRED', 'NOT_ELIGIBLE_ITEMS', 'MIN_ORDER', 'USAGE_LIMIT', 'CUSTOMER_LIMIT', 'FIRST_ORDER', 'NO_DISCOUNT', 'TOO_MANY', 'STACKING'];
  it('has a plain sentence for every reason, and never leaks internals', () => {
    for (const r of reasons) {
      const m = couponMessage(r, 99900);
      expect(m.length).toBeGreaterThan(15);
      expect(m).not.toMatch(/KH:|SQL|exception|undefined|null/i);
    }
  });
  it('does not reveal that a switched-off code exists', () => expect(couponMessage('INACTIVE')).toBe(couponMessage('NOT_FOUND')));
  it('states the minimum in rupees', () => expect(couponMessage('MIN_ORDER', 99900)).toContain('₹999'));
  it('falls back safely for an unknown reason', () => expect(couponMessage('SOMETHING_NEW')).toBe('This coupon cannot be applied.'));
  it('turns a refused check into an explanation with no discount', () => {
    expect(appliedFromCheck('PCT10', { ok: false, reason: 'EXPIRED' })).toEqual({ code: 'PCT10', description: null, valid: false, discountPaise: 0, message: 'This coupon has expired.' });
  });
});

describe('admin coupon form', () => {
  it('accepts the example coupon and stores the code in capitals', () => {
    const v = validateCouponInput(base, 'create');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toMatchObject({ code: 'KAAYRA10', discount_type: 'percent', percent_bps: 1000, fixed_paise: null, min_order_paise: 99900, max_discount_paise: 30000, usage_limit: 500, per_customer_limit: 1, first_order_only: false, product_ids: [], product_forms: [], active: true });
  });
  it('accepts a fixed coupon and defaults to inactive', () => {
    const v = validateCouponInput({ code: 'FLAT100', type: 'fixed', fixedPaise: 10000 }, 'create');
    expect(v.ok && v.value.active).toBe(false);
    expect(v.ok && v.value.min_order_paise).toBe(0);
  });
  it('refuses a bad code, a missing or mixed type, and out-of-range values', () => {
    const bad = (over: Record<string, unknown>) => validateCouponInput({ ...base, ...over }, 'create');
    expect(bad({ code: 'a b' }).ok).toBe(false);
    expect(bad({ type: 'bogus' }).ok).toBe(false);
    expect(bad({ percentBps: 0 }).ok).toBe(false);
    expect(bad({ percentBps: 10001 }).ok).toBe(false);
    expect(bad({ percentBps: 10.5 }).ok).toBe(false);
    expect(bad({ type: 'fixed', fixedPaise: 99 }).ok).toBe(false);
    expect(bad({ type: 'fixed', fixedPaise: 5000, maxDiscountPaise: 3000 }).ok).toBe(false);
    expect(bad({ minOrderPaise: -1 }).ok).toBe(false);
    expect(bad({ maxDiscountPaise: 50 }).ok).toBe(false);
    expect(bad({ usageLimit: 0 }).ok).toBe(false);
    expect(bad({ usageLimit: 1.5 }).ok).toBe(false);
    expect(bad({ perCustomerLimit: '1' }).ok).toBe(false);
    expect(bad({ active: 'yes' }).ok).toBe(false);
    expect(bad({ firstOrderOnly: 1 }).ok).toBe(false);
  });
  it('checks dates: valid, and expiry after start', () => {
    expect(validateCouponInput({ ...base, startsAt: 'not a date' }, 'create').ok).toBe(false);
    expect(validateCouponInput({ ...base, startsAt: '2026-11-10T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' }, 'create').ok).toBe(false);
    expect(validateCouponInput({ ...base, startsAt: '2026-11-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' }, 'create').ok).toBe(false);
    const ok = validateCouponInput({ ...base, startsAt: '2026-11-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' }, 'create');
    expect(ok.ok && ok.value.expires_at).toBe('2026-12-01T00:00:00.000Z');
  });
  it('restricts to real-looking product ids and safe category names, deduplicated', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const ok = validateCouponInput({ ...base, productIds: [id, id.toUpperCase()], productForms: ['Syrup', 'Syrup', 'Churna'] }, 'create');
    expect(ok.ok && ok.value.product_ids).toEqual([id]);
    expect(ok.ok && ok.value.product_forms).toEqual(['Syrup', 'Churna']);
    expect(validateCouponInput({ ...base, productIds: ['nope'] }, 'create').ok).toBe(false);
    expect(validateCouponInput({ ...base, productIds: Array(101).fill(id) }, 'create').ok).toBe(false);
    expect(validateCouponInput({ ...base, productForms: ['<script>'] }, 'create').ok).toBe(false);
    expect(validateCouponInput({ ...base, productForms: 'Syrup' }, 'create').ok).toBe(false);
  });
  it('limits and cleans the description', () => {
    expect(validateCouponInput({ ...base, description: 'x'.repeat(201) }, 'create').ok).toBe(false);
    expect(validateCouponInput({ ...base, description: '<b>hi</b>' }, 'create').ok).toBe(false);
    const ok = validateCouponInput({ ...base, description: '  Diwali offer  ' }, 'create');
    expect(ok.ok && ok.value.description).toBe('Diwali offer');
  });
  it('never carries a code on update: the code is permanent', () => {
    const v = validateCouponInput({ ...base, code: 'CHANGED' }, 'update');
    expect(v.ok).toBe(true);
    if (v.ok) expect('code' in v.value).toBe(false);
  });
  it('ignores any field it does not know (no mass assignment)', () => {
    const v = validateCouponInput({ ...base, id: 'x', created_by: 'evil', created_at: 'x', discount_paise: 5 }, 'create');
    expect(v.ok && Object.keys(v.value).sort()).not.toContain('created_by');
    expect(v.ok && Object.keys(v.value)).not.toContain('id');
  });
  it('describes values for lists', () => {
    expect(describeValue({ discount_type: 'percent', percent_bps: 1000, fixed_paise: null, max_discount_paise: 30000 })).toBe('10% off, up to ₹300');
    expect(describeValue({ discount_type: 'percent', percent_bps: 1250, fixed_paise: null, max_discount_paise: null })).toBe('12.50% off');
    expect(describeValue({ discount_type: 'fixed', percent_bps: null, fixed_paise: 15000, max_discount_paise: null })).toBe('₹150 off');
  });
});

describe('discount arithmetic (reference twin of the database function)', () => {
  const pct = (bps: number, cap: number | null = null) => ({ type: 'percent' as const, percentBps: bps, maxDiscountPaise: cap });
  it('rounds percentages down to the paisa', () => {
    expect(referenceDiscount(pct(1000), [{ ref: 'a', amt: 99999, eligible: true }], 0)?.discount).toBe(9999);
    expect(referenceDiscount(pct(1000), [{ ref: 'a', amt: 149900, eligible: true }], 0)?.discount).toBe(14990);
  });
  it('applies the cap, then the eligible subtotal', () => {
    expect(referenceDiscount(pct(5000, 30000), [{ ref: 'a', amt: 179701, eligible: true }], 0)?.discount).toBe(30000);
    expect(referenceDiscount({ type: 'fixed', fixedPaise: 50000 }, [{ ref: 'a', amt: 30000, eligible: true }], 6000)?.discount).toBe(30000);
  });
  it('discounts only eligible lines', () => {
    const r = referenceDiscount(pct(2000), [{ ref: 'a', amt: 149700, eligible: true }, { ref: 'b', amt: 30001, eligible: false }], 0);
    expect(r?.discount).toBe(29940);
    expect(r?.allocations).toEqual([{ ref: 'a', discount_paise: 29940 }]);
  });
  it('never lets the total fall below 100 paise, and refuses a coupon that discounts nothing', () => {
    expect(referenceDiscount(pct(10000), [{ ref: 'a', amt: 49900, eligible: true }], 0)?.discount).toBe(49800);
    expect(referenceDiscount(pct(10000), [{ ref: 'a', amt: 49900, eligible: true }], 6000)?.discount).toBe(49900);
    expect(referenceDiscount(pct(10000), [{ ref: 'a', amt: 100, eligible: true }], 0)).toBeNull();
    expect(referenceDiscount(pct(1000), [{ ref: 'a', amt: 50, eligible: true }], 0)).toBeNull();
    expect(referenceDiscount(pct(1000), [{ ref: 'a', amt: 5000, eligible: false }], 0)).toBeNull();
  });
  it('splits across lines so the parts add up exactly (odd paise)', () => {
    const r = referenceDiscount({ type: 'fixed', fixedPaise: 10000 }, [{ ref: 'x', amt: 33333, eligible: true }, { ref: 'y', amt: 33334, eligible: true }, { ref: 'z', amt: 33335, eligible: true }], 0);
    expect(r?.allocations.reduce((s, a) => s + a.discount_paise, 0)).toBe(10000);
  });
  it('holds for 2,000 pseudo-random bags: parts sum to the discount, no line over-discounted, total never below Rs 1', () => {
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 2000; i++) {
      const n = 1 + rnd(6);
      const lines = Array.from({ length: n }, (_, k) => ({ ref: `l${k}`, amt: 100 + rnd(400000), eligible: rnd(4) !== 0 }));
      const ship = rnd(3) === 0 ? 0 : rnd(20000);
      const c = rnd(2) ? pct(1 + rnd(10000), rnd(2) ? 100 + rnd(100000) : null) : { type: 'fixed' as const, fixedPaise: 100 + rnd(300000) };
      const r = referenceDiscount(c, lines, ship);
      if (!r) continue;
      const total = lines.reduce((s, l) => s + l.amt, 0);
      const elig = lines.filter((l) => l.eligible).reduce((s, l) => s + l.amt, 0);
      expect(r.discount).toBeGreaterThan(0);
      expect(r.discount).toBeLessThanOrEqual(elig);
      expect(total + ship - r.discount).toBeGreaterThanOrEqual(100);
      expect(r.allocations.reduce((s, a) => s + a.discount_paise, 0)).toBe(r.discount);
      for (const a of r.allocations) expect(a.discount_paise).toBeLessThanOrEqual(lines.find((l) => l.ref === a.ref)!.amt);
      if (c.type === 'percent' && c.maxDiscountPaise != null) expect(r.discount).toBeLessThanOrEqual(c.maxDiscountPaise);
    }
  });
});

describe('totals and GST after a discount', () => {
  it('subtotal - discount + shipping', () => expect(checkoutTotals(149900, 16060, 0, 14990)).toEqual({ subtotalPaise: 149900, discountPaise: 14990, shippingPaise: 0, totalPaise: 134910, gstIncludedPaise: 16060 }));
  it('clamps a discount that is negative, fractional or larger than the subtotal', () => {
    expect(checkoutTotals(10000, 0, 6000, -500).totalPaise).toBe(16000);
    expect(checkoutTotals(10000, 0, 6000, 99999).totalPaise).toBe(6000);
    expect(checkoutTotals(10000, 0, 0, 1234.9).discountPaise).toBe(1234);
  });
  it('takes each line\'s discount off before extracting GST', () => {
    const lines = [{ ref: 'a', lineTotalPaise: 112000, gstRate: 12 }, { ref: 'b', lineTotalPaise: 10500, gstRate: 5 }];
    expect(gstAfterDiscount(lines, [])).toBe(12000 + 500);
    expect(gstAfterDiscount(lines, [{ ref: 'a', discount_paise: 11200 }])).toBe(10800 + 500);
  });
});
