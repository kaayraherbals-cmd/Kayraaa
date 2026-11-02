import { describe, expect, it } from 'vitest';
import { BundleError, allocate, bundleAvailability, bundleMessage, bundlePrice, frequentlyBoughtLabel, mergeWishlists, sanitizeGiftMessage, validateBundleInput } from './bundles.js';

const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as BundleError).code; } };

describe('bundle pricing (same cases as supabase/bundles_wishlists_selftest.sql)', () => {
  it('percent off floors the discount', () => {
    expect(bundlePrice({ mode: 'percent_off', percentBps: 1000 }, 130000)).toEqual({ combinedPaise: 130000, discountPaise: 13000, finalPaise: 117000, savingsPaise: 13000 });
    expect(bundlePrice({ mode: 'percent_off', percentBps: 3333 }, 100001).discountPaise).toBe(33330);
  });
  it('amount off and fixed price', () => {
    expect(bundlePrice({ mode: 'amount_off', amountOffPaise: 20000 }, 80000).finalPaise).toBe(60000);
    expect(bundlePrice({ mode: 'fixed_price', fixedPricePaise: 70000 }, 80000).savingsPaise).toBe(10000);
  });
  it('never fakes a saving and never goes to zero or below', () => {
    expect(code(() => bundlePrice({ mode: 'fixed_price', fixedPricePaise: 90000 }, 80000))).toBe('KH:BUNDLE_NO_SAVING');
    expect(code(() => bundlePrice({ mode: 'amount_off', amountOffPaise: 80000 }, 80000))).toBe('KH:BUNDLE_PRICE_INVALID');
    expect(code(() => bundlePrice({ mode: 'amount_off', amountOffPaise: 90000 }, 80000))).toBe('KH:BUNDLE_PRICE_INVALID');
    expect(code(() => bundlePrice({ mode: 'percent_off', percentBps: 1000 }, 0))).toBe('KH:INVALID');
  });
  it('a fixed price equal to the combined price shows zero savings, not a fake one', () => {
    expect(bundlePrice({ mode: 'fixed_price', fixedPricePaise: 80000 }, 80000).savingsPaise).toBe(0);
  });
});

describe('allocation', () => {
  it('adds up exactly and is deterministic', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(26000, [200000, 60000]).reduce((a, b) => a + b, 0)).toBe(26000);
    for (let amount = 0; amount < 200; amount++) expect(allocate(amount, [7, 13, 29]).reduce((a, b) => a + b, 0)).toBe(amount);
  });
  it('rejects bad weights', () => {
    expect(code(() => allocate(10, [0, 1]))).toBe('KH:INVALID');
    expect(code(() => allocate(-1, [1]))).toBe('KH:INVALID');
    expect(code(() => allocate(10, []))).toBe('KH:INVALID');
  });
});

describe('availability', () => {
  const comps = [{ variantId: 'a', qty: 2 }, { variantId: 'b', qty: 1 }];
  it('is the minimum over components (illustrative 10/2, 3/1 -> 3)', () => {
    expect(bundleAvailability(comps, { a: 10, b: 3 })).toBe(3);
    expect(bundleAvailability(comps, { a: 3, b: 30 })).toBe(1);
  });
  it('is zero when any component has no stock or fewer than two components exist', () => {
    expect(bundleAvailability(comps, { a: 10 })).toBe(0);
    expect(bundleAvailability([comps[0]!], { a: 10 })).toBe(0);
  });
});

describe('owner input', () => {
  const ok = { slug: 'wellness-kit', name: 'Wellness kit', pricing: { mode: 'percent_off' as const, percentBps: 1000 }, components: [{ variantId: 'a', qty: 1 }, { variantId: 'b', qty: 2 }] };
  it('accepts a valid bundle', () => expect(validateBundleInput(ok)).toEqual([]));
  it('refuses fewer than two components, duplicates, bad quantities', () => {
    expect(validateBundleInput({ ...ok, components: [{ variantId: 'a', qty: 1 }] })).toContain('components_min_two');
    expect(validateBundleInput({ ...ok, components: [{ variantId: 'a', qty: 1 }, { variantId: 'a', qty: 2 }] })).toContain('components_duplicate');
    expect(validateBundleInput({ ...ok, components: [{ variantId: 'a', qty: 0 }, { variantId: 'b', qty: 11 }] })).toContain('component_qty');
  });
  it('needs exactly one pricing value and gift messages only on gift sets', () => {
    expect(validateBundleInput({ ...ok, pricing: { mode: 'percent_off', percentBps: 1000, fixedPricePaise: 5000 } })).toContain('pricing_exactly_one_value');
    expect(validateBundleInput({ ...ok, giftMessageAllowed: true })).toContain('gift_message_needs_gift_set');
    expect(validateBundleInput({ ...ok, kind: 'gift_set', giftMessageAllowed: true })).toEqual([]);
  });
});

describe('gift message', () => {
  it('strips markup characters and control characters', () => {
    expect(sanitizeGiftMessage('Happy birthday <script>alert(1)</script>!')).toBe('Happy birthday scriptalert(1)/script!');
    expect(sanitizeGiftMessage('a\u0000b\u0007c')).toBe('abc');
    expect(sanitizeGiftMessage('<img src=x onerror=alert(1)>')).not.toMatch(/[<>]/);
  });
  it('trims, collapses whitespace, and treats blank or non-strings as no message', () => {
    expect(sanitizeGiftMessage('  with   love  ')).toBe('with love');
    expect(sanitizeGiftMessage('   ')).toBeNull();
    expect(sanitizeGiftMessage(42)).toBeNull();
  });
  it('refuses more than 200 characters', () => {
    expect(code(() => sanitizeGiftMessage('x'.repeat(201)))).toBe('KH:GIFT_MESSAGE_TOO_LONG');
    expect(sanitizeGiftMessage('x'.repeat(200))).toHaveLength(200);
  });
});

describe('wishlist merge and recommendations', () => {
  it('merges without duplicates, member first, capped', () => {
    expect(mergeWishlists(['a', 'b'], ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
    expect(mergeWishlists(['a'], Array.from({ length: 200 }, (_, i) => `g${i}`))).toHaveLength(100);
  });
  it('labels frequently bought together only with enough real orders', () => {
    expect(frequentlyBoughtLabel({ orders: 5 })).toBe('frequently_bought_together');
    expect(frequentlyBoughtLabel({ orders: 4 })).toBe('related');
    expect(frequentlyBoughtLabel(undefined)).toBe('related');
    expect(frequentlyBoughtLabel({ orders: 2 }, 1)).toBe('related');
    expect(frequentlyBoughtLabel({ orders: 3 }, 1)).toBe('frequently_bought_together');
  });
});

describe('messages', () => {
  it('maps database codes to plain words and never leaks the raw code', () => {
    expect(bundleMessage('KH:BUNDLE_COUPON_EXCLUDED')).toMatch(/Coupons cannot/);
    expect(bundleMessage('KH:BUNDLE_UNAVAILABLE:Kit')).toMatch(/not available/);
    expect(bundleMessage('KH:SOMETHING_ELSE')).not.toMatch(/KH:/);
  });
});
