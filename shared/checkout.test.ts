import { describe, expect, it } from 'vitest';
import { COMMERCE_ENABLED } from './commerce.js';
import { canonicalRequest, checkoutOpen, checkoutTotals, flattenAddress, isTestOrder, isValidPin, normalisePhone, quoteShipping, validateAddress, validatePlaceRequest, validateQuoteRequest } from './checkout.js';
import { readFlags } from './flags.js';

const addr = { name: 'Asha Verma', phone: '98765 43210', line1: '12 Lanka Road', line2: 'Near the temple', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221005' };
const KEY = '123e4567-e89b-42d3-a456-426614174000';

describe('PIN codes', () => {
  it('accepts real-looking PIN codes and refuses bad shapes', () => {
    for (const ok of ['221005', '110001', '560001', '400001', '795001']) expect(isValidPin(ok)).toBe(true);
    for (const bad of ['022100', '12345', '1234567', '22 1005', 'abcdef', '', null, 221005]) expect(isValidPin(bad)).toBe(false);
  });
  it('refuses prefixes India Post does not use, and army post codes', () => {
    for (const bad of ['100001', '290001', '350001', '540001', '650001', '860001', '900001', '999999']) expect(isValidPin(bad)).toBe(false);
  });
});

describe('phone numbers', () => {
  it('normalises Indian mobiles', () => {
    for (const v of ['9876543210', '+91 98765 43210', '09876543210', '919876543210', '98765-43210']) expect(normalisePhone(v)).toBe('+919876543210');
  });
  it('refuses others', () => {
    for (const v of ['5876543210', '98765', '+1 202 555 0143', 'phone', '', null, 9876543210]) expect(normalisePhone(v)).toBeNull();
  });
});

describe('address validation', () => {
  it('accepts a good address and tidies it', () => {
    const r = validateAddress({ ...addr, name: '  Asha   Verma ' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Asha Verma');
      expect(r.value.phone).toBe('+919876543210');
    }
  });
  it('reports each bad field', () => {
    const r = validateAddress({ name: 'A', phone: '123', line1: 'x', city: '', state: 'Atlantis', pincode: '12' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['city', 'line1', 'name', 'phone', 'pincode', 'state']);
  });
  it('refuses markup and control characters', () => {
    for (const bad of ['<script>alert(1)</script>', 'Flat 4\u0000B', 'Road {x}']) {
      const r = validateAddress({ ...addr, line1: bad });
      expect(r.ok).toBe(false);
    }
  });
  it('treats the second line as optional but checked when given', () => {
    expect(validateAddress({ ...addr, line2: '' }).ok).toBe(true);
    expect(validateAddress({ ...addr, line2: undefined }).ok).toBe(true);
    expect(validateAddress({ ...addr, line2: '<b>' }).ok).toBe(false);
  });
  it('refuses non-objects', () => {
    for (const v of [null, 'x', 5, [], undefined]) expect(validateAddress(v).ok).toBe(false);
  });
  it('flattens within the order table limits', () => {
    const r = validateAddress(addr);
    if (!r.ok) throw new Error('setup');
    const f = flattenAddress(r.value);
    expect(f).toBe('12 Lanka Road, Near the temple, Varanasi, Uttar Pradesh');
    expect(f.length).toBeGreaterThanOrEqual(8);
    expect(f.length).toBeLessThanOrEqual(400);
  });
});

describe('shipping quote', () => {
  const row = { pincode: '221005', active: true, ratePaise: 6000, freeAbovePaise: 99900 };
  it('is not serviceable without a row or when switched off', () => {
    expect(quoteShipping(null, 50000).serviceable).toBe(false);
    expect(quoteShipping({ ...row, active: false }, 50000).serviceable).toBe(false);
    expect(quoteShipping({ ...row, ratePaise: -1 }, 50000).serviceable).toBe(false);
    expect(quoteShipping({ ...row, ratePaise: 1.5 }, 50000).serviceable).toBe(false);
  });
  it('charges the rate, and is free at the threshold', () => {
    expect(quoteShipping(row, 50000)).toMatchObject({ serviceable: true, shippingPaise: 6000 });
    expect(quoteShipping(row, 99899).shippingPaise).toBe(6000);
    expect(quoteShipping(row, 99900).shippingPaise).toBe(0);
    expect(quoteShipping({ ...row, freeAbovePaise: null }, 9_999_900).shippingPaise).toBe(6000);
  });
  it('adds up in whole paise', () => {
    expect(checkoutTotals(49900, 5346, 6000)).toEqual({ subtotalPaise: 49900, discountPaise: 0, shippingPaise: 6000, totalPaise: 55900, gstIncludedPaise: 5346 });
  });
});

describe('request validation', () => {
  it('quote needs only an address', () => {
    expect(validateQuoteRequest({ address: addr }).ok).toBe(true);
    expect(validateQuoteRequest({}).ok).toBe(false);
  });
  it('place needs an address, a UUID key and a sane expected total', () => {
    expect(validatePlaceRequest({ address: addr, idempotencyKey: KEY, expectedTotalPaise: 55900 }).ok).toBe(true);
    for (const bad of [{ idempotencyKey: 'nope' }, { idempotencyKey: KEY, expectedTotalPaise: 0 }, { idempotencyKey: KEY, expectedTotalPaise: -5 }, { idempotencyKey: KEY, expectedTotalPaise: 12.5 }, { idempotencyKey: KEY, expectedTotalPaise: '500' }, { idempotencyKey: KEY, expectedTotalPaise: 1e12 }]) {
      expect(validatePlaceRequest({ address: addr, ...bad }).ok).toBe(false);
    }
  });
  it('ignores client-sent prices, items and shipping: they never reach the value', () => {
    const r = validatePlaceRequest({ address: addr, idempotencyKey: KEY, expectedTotalPaise: 100, items: [{ variantId: 'x', qty: 1 }], pricePaise: 1, shippingPaise: 0, subtotalPaise: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value).sort()).toEqual(['address', 'expectedTotalPaise', 'idempotencyKey']);
  });
});

describe('rewards points on a place request', () => {
  const base = { address: addr, idempotencyKey: KEY, expectedTotalPaise: 55900 };
  it('absent or zero points leave the value unchanged; positive points are kept', () => {
    const a = validatePlaceRequest(base); const b = validatePlaceRequest({ ...base, loyaltyPoints: 0 }); const c = validatePlaceRequest({ ...base, loyaltyPoints: 200 });
    if (a.ok && b.ok && c.ok) { expect('loyaltyPoints' in a.value).toBe(false); expect('loyaltyPoints' in b.value).toBe(false); expect(c.value.loyaltyPoints).toBe(200); } else throw new Error('should be ok');
  });
  it('refuses fractions, negatives, text and absurd numbers', () => {
    for (const bad of [1.5, -1, '100', 1e9, NaN]) expect(validatePlaceRequest({ ...base, loyaltyPoints: bad }).ok).toBe(false);
  });
  it('points change the fingerprint, zero does not', () => {
    const l = [{ variantId: 'a', qty: 1 }];
    expect(canonicalRequest(l, addr as never, null, 0)).toBe(canonicalRequest(l, addr as never));
    expect(canonicalRequest(l, addr as never, null, 200)).not.toBe(canonicalRequest(l, addr as never));
    expect(canonicalRequest(l, addr as never, null, 200)).not.toBe(canonicalRequest(l, addr as never, null, 300));
  });
});

describe('request fingerprint', () => {
  const a = validateAddress(addr);
  if (!a.ok) throw new Error('setup');
  const l1 = { variantId: '11111111-1111-4111-8111-111111111111', qty: 2 };
  const l2 = { variantId: '22222222-2222-4222-8222-222222222222', qty: 1 };
  it('ignores the order of the bag', () => expect(canonicalRequest([l1, l2], a.value)).toBe(canonicalRequest([l2, l1], a.value)));
  it('changes with quantity, items or address', () => {
    const base = canonicalRequest([l1, l2], a.value);
    expect(canonicalRequest([{ ...l1, qty: 3 }, l2], a.value)).not.toBe(base);
    expect(canonicalRequest([l1], a.value)).not.toBe(base);
    expect(canonicalRequest([l1, l2], { ...a.value, pincode: '221001' })).not.toBe(base);
  });
});

describe('checkout gate', () => {
  it('master switch is on but checkout is closed in production without live-sales approval', () => {
    expect(COMMERCE_ENABLED).toBe(true);
    expect(checkoutOpen(readFlags({ VERCEL_ENV: 'production' }))).toBe(false);
    expect(checkoutOpen(readFlags({ VERCEL_ENV: 'production', FEATURE_CART_PREVIEW: 'on', FEATURE_CHECKOUT_TESTING: 'on' }))).toBe(false);
  });
  it('is open on staging / preview / local in test mode', () => {
    expect(checkoutOpen(readFlags({}))).toBe(true);
    expect(checkoutOpen(readFlags({ VERCEL_ENV: 'preview' }))).toBe(true);
  });
  it('orders are test orders unless live sales are approved in production', () => {
    expect(isTestOrder(readFlags({}))).toBe(true);
    expect(isTestOrder(readFlags({ VERCEL_ENV: 'production' }))).toBe(true);
    expect(isTestOrder(readFlags({ VERCEL_ENV: 'production', LIVE_SALES_APPROVED: 'on', LIVE_SALES_APPROVED_BY: 'o', LIVE_SALES_APPROVAL_REF: 'r' }))).toBe(false);
  });
});
