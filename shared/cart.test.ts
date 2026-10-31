import { describe, expect, it } from 'vitest';
import { CART_MAX_LINES, CART_MAX_QTY, evaluateLine, formatRupees, gstIncluded, lineBlocker, parseLines, priceCart, type VariantRecord } from './cart.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const rec = (over: Partial<VariantRecord> = {}): VariantRecord => ({
  variant_id: A, product_name: 'Test syrup', product_status: 'APPROVED_FOR_SALE', variant_status: 'active', pack_size: '200 ml',
  price_paise: 49900, gst_rate: 12, hsn_code: '3004', free_qty: 8, ...over,
});

describe('parseLines', () => {
  it('accepts valid lines and merges repeats', () => {
    const r = parseLines([{ variantId: A, qty: 2 }, { variantId: A.toUpperCase(), qty: 3 }, { variantId: B, qty: 1 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toEqual([{ variantId: A, qty: 5 }, { variantId: B, qty: 1 }]);
  });
  it('caps merged quantity instead of trusting it', () => {
    const r = parseLines([{ variantId: A, qty: 9 }, { variantId: A, qty: 9 }]);
    if (r.ok) expect(r.lines[0].qty).toBe(CART_MAX_QTY);
    else throw new Error('expected ok');
  });
  it('rejects invalid quantities', () => {
    for (const q of [0, -1, 1.5, CART_MAX_QTY + 1, '2', null, NaN, Infinity]) expect(parseLines([{ variantId: A, qty: q }]).ok).toBe(false);
  });
  it('rejects bad ids, non-arrays and oversized carts', () => {
    expect(parseLines([{ variantId: 'abc', qty: 1 }]).ok).toBe(false);
    expect(parseLines([{ variantId: '1 or 1=1', qty: 1 }]).ok).toBe(false);
    expect(parseLines('x').ok).toBe(false);
    expect(parseLines(null).ok).toBe(false);
    expect(parseLines([null]).ok).toBe(false);
    const many = Array.from({ length: CART_MAX_LINES + 1 }, (_, i) => ({ variantId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, qty: 1 }));
    expect(parseLines(many).ok).toBe(false);
  });
  it('ignores any price the browser sends', () => {
    const r = parseLines([{ variantId: A, qty: 1, price_paise: 1, unitPaise: 1, total: 1 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines[0]).toEqual({ variantId: A, qty: 1 });
  });
});

describe('eligibility (server-side purchasability)', () => {
  it('passes a fully approved, priced, stocked variant', () => expect(lineBlocker(rec())).toBeNull());
  it('blocks unknown variants', () => expect(lineBlocker(undefined)).toBe('not_found'));
  it('blocks every status that is not approved for sale', () => {
    for (const s of ['DRAFT', 'IN_DEVELOPMENT', 'UNDER_REVIEW', 'APPROVED_FOR_PREVIEW', '']) expect(lineBlocker(rec({ product_status: s }))).toBe('not_approved');
  });
  it('blocks inactive variants, missing or invalid prices, and missing tax data', () => {
    expect(lineBlocker(rec({ variant_status: 'inactive' }))).toBe('variant_inactive');
    expect(lineBlocker(rec({ price_paise: null }))).toBe('no_price');
    expect(lineBlocker(rec({ price_paise: 0 }))).toBe('no_price');
    expect(lineBlocker(rec({ price_paise: -5 }))).toBe('no_price');
    expect(lineBlocker(rec({ price_paise: 10.5 }))).toBe('no_price');
    expect(lineBlocker(rec({ gst_rate: null }))).toBe('incomplete_info');
    expect(lineBlocker(rec({ hsn_code: null }))).toBe('incomplete_info');
  });
  it('blocks when no sellable stock is left (including stock too close to expiry, which the server excludes)', () => {
    expect(lineBlocker(rec({ free_qty: 0 }))).toBe('out_of_stock');
    expect(lineBlocker(rec({ free_qty: -1 }))).toBe('out_of_stock');
    expect(lineBlocker(rec({ free_qty: NaN }))).toBe('out_of_stock');
  });
});

describe('evaluateLine', () => {
  it('prices from the server record, not the request', () => {
    const l = evaluateLine({ variantId: A, qty: 3 }, rec());
    expect(l.unitPaise).toBe(49900);
    expect(l.lineTotalPaise).toBe(149700);
    expect(l.state).toBe('ok');
  });
  it('reduces quantity to available stock and says so', () => {
    const l = evaluateLine({ variantId: A, qty: 6 }, rec({ free_qty: 4 }));
    expect(l.qty).toBe(4);
    expect(l.state).toBe('adjusted');
    expect(l.reason).toBe('reduced');
    expect(l.lineTotalPaise).toBe(4 * 49900);
  });
  it('never offers more than the per-line cap', () => {
    const l = evaluateLine({ variantId: A, qty: CART_MAX_QTY }, rec({ free_qty: 500 }));
    expect(l.maxQty).toBe(CART_MAX_QTY);
  });
  it('marks unavailable lines as zero money and zero quantity', () => {
    const l = evaluateLine({ variantId: A, qty: 2 }, rec({ product_status: 'DRAFT' }));
    expect(l.state).toBe('unavailable');
    expect(l.qty).toBe(0);
    expect(l.lineTotalPaise).toBe(0);
    expect(l.message).toBeTruthy();
  });
  it('does not leak the product name of an unknown variant', () => {
    expect(evaluateLine({ variantId: B, qty: 1 }, undefined).productName).toBe('Unavailable item');
  });
});

describe('priceCart', () => {
  const records = new Map<string, VariantRecord>([
    [A, rec()],
    [B, rec({ variant_id: B, product_name: 'Capsules', pack_size: '30 capsules', price_paise: 79900, gst_rate: 5, free_qty: 1 })],
  ]);
  it('totals only available lines', () => {
    const { lines, totals } = priceCart([{ variantId: A, qty: 2 }, { variantId: B, qty: 3 }, { variantId: '33333333-3333-4333-8333-333333333333', qty: 1 }], records);
    expect(lines.map((l) => l.state)).toEqual(['ok', 'adjusted', 'unavailable']);
    expect(totals.itemCount).toBe(3);
    expect(totals.subtotalPaise).toBe(2 * 49900 + 79900);
  });
  it('reflects a price change on the very next calculation', () => {
    const before = priceCart([{ variantId: A, qty: 1 }], records).totals.subtotalPaise;
    const changed = new Map(records).set(A, rec({ price_paise: 59900 }));
    expect(priceCart([{ variantId: A, qty: 1 }], changed).totals.subtotalPaise).toBe(59900);
    expect(before).toBe(49900);
  });
  it('reflects a stock change on the very next calculation', () => {
    const sold = new Map(records).set(A, rec({ free_qty: 0 }));
    expect(priceCart([{ variantId: A, qty: 1 }], sold).lines[0].state).toBe('unavailable');
  });
  it('computes included GST per line, rounded to the paisa', () => {
    expect(gstIncluded(11200, 12)).toBe(1200);
    expect(gstIncluded(10500, 5)).toBe(500);
    expect(gstIncluded(12345, 0)).toBe(0);
    const { totals } = priceCart([{ variantId: A, qty: 1 }], records);
    expect(totals.gstIncludedPaise).toBe(gstIncluded(49900, 12));
  });
  it('handles an empty cart', () => {
    expect(priceCart([], records).totals).toEqual({ itemCount: 0, subtotalPaise: 0, gstIncludedPaise: 0 });
  });
});

describe('formatRupees', () => {
  it('uses Indian digit grouping', () => {
    expect(formatRupees(0)).toBe('₹0');
    expect(formatRupees(49900)).toBe('₹499');
    expect(formatRupees(49950)).toBe('₹499.50');
    expect(formatRupees(123456700)).toBe('₹12,34,567');
    expect(formatRupees(100000)).toBe('₹1,000');
    expect(formatRupees(9999900)).toBe('₹99,999');
  });
});
