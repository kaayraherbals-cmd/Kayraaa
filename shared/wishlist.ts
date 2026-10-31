/** Wishlist view helpers (Phase 12 Stage 7D). Pure functions, no I/O. The database (wishlist_* in bundles_wishlists.sql) is the authority. */

export type WishState = 'in_stock' | 'out_of_stock' | 'unavailable';

/** One row as wishlist_list returns it (snake_case). */
export interface WishlistRow {
  product_id: string;
  slug: string;
  name: string;
  added_at: string;
  state: WishState;
  from_price_paise: number | null;
}

/** What the browser receives. No member id, no product id: the slug is the public handle. */
export interface WishlistItem {
  slug: string;
  name: string;
  addedAt: string;
  state: WishState;
  /** Current lowest active price, only while the product is for sale. Never a stored price. */
  fromPaise: number | null;
}

const STATES: readonly WishState[] = ['in_stock', 'out_of_stock', 'unavailable'];

/** Maps rows to the public shape. Rows that do not look right are dropped rather than shown. */
export function toWishlistItems(rows: unknown): WishlistItem[] {
  if (!Array.isArray(rows)) return [];
  const out: WishlistItem[] = [];
  for (const r of rows as Partial<WishlistRow>[]) {
    if (!r || typeof r.slug !== 'string' || typeof r.name !== 'string' || !STATES.includes(r.state as WishState)) continue;
    const price = typeof r.from_price_paise === 'number' && Number.isInteger(r.from_price_paise) && r.from_price_paise > 0 ? r.from_price_paise : null;
    out.push({ slug: r.slug, name: r.name, addedAt: typeof r.added_at === 'string' ? r.added_at : '', state: r.state as WishState, fromPaise: r.state === 'unavailable' ? null : price });
  }
  return out;
}

export const WISHLIST_MAX = 100;

export const wishStateLabel = (s: WishState): string => (s === 'in_stock' ? 'In stock' : s === 'out_of_stock' ? 'Currently out of stock' : 'No longer available');
