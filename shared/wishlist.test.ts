import { describe, expect, it } from 'vitest';
import { toWishlistItems, wishStateLabel } from './wishlist.js';

describe('toWishlistItems', () => {
  const row = { product_id: 'p1', slug: 'liver-syrup', name: 'Liver Syrup', added_at: '2026-10-24T00:00:00Z', state: 'in_stock', from_price_paise: 24000 };
  it('maps a row and never exposes ids', () => {
    const [i] = toWishlistItems([row]);
    expect(i).toEqual({ slug: 'liver-syrup', name: 'Liver Syrup', addedAt: '2026-10-24T00:00:00Z', state: 'in_stock', fromPaise: 24000 });
    expect('product_id' in (i as object)).toBe(false);
  });
  it('shows no price for an unavailable product', () => {
    expect(toWishlistItems([{ ...row, state: 'unavailable', from_price_paise: 24000 }])[0]?.fromPaise).toBe(null);
  });
  it('drops malformed rows and bad prices', () => {
    expect(toWishlistItems([{ slug: 5 }, null, { ...row, state: 'weird' }]).length).toBe(0);
    expect(toWishlistItems([{ ...row, from_price_paise: 12.5 }])[0]?.fromPaise).toBe(null);
    expect(toWishlistItems('x')).toEqual([]);
  });
  it('labels states plainly', () => {
    expect(wishStateLabel('in_stock')).toBe('In stock');
    expect(wishStateLabel('unavailable')).toBe('No longer available');
  });
});
