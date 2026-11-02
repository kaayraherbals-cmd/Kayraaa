import { isUuid } from '../shared/cart.js';
import { toWishlistItems, type WishlistItem } from '../shared/wishlist.js';
import { rpc, type RpcResult } from './rpc.js';
import { rest, type SupabaseConfig } from './supabase.js';

/** Product id for a public slug. `forSaleOnly` is true for adding; removing must work even after a product was withdrawn. */
export async function productIdForSlug(db: SupabaseConfig, slug: string, forSaleOnly: boolean): Promise<string | null> {
  const r = await rest(db, `products?select=id&slug=eq.${encodeURIComponent(slug)}${forSaleOnly ? '&status=eq.APPROVED_FOR_SALE' : ''}&limit=1`);
  if (!r.ok) throw new Error(`product by slug ${r.status}`);
  const id = ((await r.json()) as { id: string }[])[0]?.id;
  return id && isUuid(id) ? id.toLowerCase() : null;
}

/** The signed-in member's own list, priced and checked for stock now. The member id comes from the session, never from the request. */
export async function wishlistFor(db: SupabaseConfig, memberId: string): Promise<{ ok: true; items: WishlistItem[] } | { ok: false }> {
  const r = await rpc<unknown>(db, 'wishlist_list', { p_member: memberId, p_limit: 100, p_offset: 0 });
  return r.ok ? { ok: true, items: toWishlistItems(r.data) } : { ok: false };
}

export const wishlistAdd = (db: SupabaseConfig, memberId: string, productId: string): Promise<RpcResult<boolean>> => rpc<boolean>(db, 'wishlist_add', { p_member: memberId, p_product: productId });
export const wishlistRemove = (db: SupabaseConfig, memberId: string, productId: string): Promise<RpcResult<boolean>> => rpc<boolean>(db, 'wishlist_remove', { p_member: memberId, p_product: productId });
export const wishlistTrackToCart = (db: SupabaseConfig, memberId: string, productId: string): Promise<RpcResult<null>> => rpc(db, 'wishlist_track_to_cart', { p_member: memberId, p_product: productId });
