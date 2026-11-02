import { MIN_DAYS_BEFORE_EXPIRY, isUuid, type CartLineInput, type VariantRecord } from '../shared/cart.js';
import { rpc, type RpcResult } from './rpc.js';
import { rest, type SupabaseConfig } from './supabase.js';

/** Today's date in India plus the no-sell window, as YYYY-MM-DD. Batches expiring before this are not sellable. */
export function sellableFromDate(nowMs = Date.now()): string {
  const ist = nowMs + 5.5 * 60 * 60 * 1000;
  return new Date(ist + MIN_DAYS_BEFORE_EXPIRY * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface VariantRow {
  id: string;
  pack_size: string;
  price_paise: number | null;
  gst_rate: number | string | null;
  hsn_code: string | null;
  status: string;
  products: { status: string; public_name: string | null; internal_name: string } | { status: string; public_name: string | null; internal_name: string }[] | null;
}
interface BatchRow {
  variant_id: string;
  qty_on_hand: number;
  qty_reserved: number;
}

const inList = (ids: string[]) => `in.(${ids.join(',')})`;

/**
 * Live variant records: price, tax, status and sellable stock, read fresh on every call. Only valid UUIDs are put into the
 * query (the caller's input is never concatenated unchecked). Unknown ids are simply absent from the map.
 */
export async function loadVariantRecords(db: SupabaseConfig, ids: string[], nowMs = Date.now()): Promise<Map<string, VariantRecord>> {
  const safe = [...new Set(ids.filter(isUuid))];
  const out = new Map<string, VariantRecord>();
  if (!safe.length) return out;
  const [vr, br] = await Promise.all([
    rest(db, `product_variants?select=id,pack_size,price_paise,gst_rate,hsn_code,status,products(status,public_name,internal_name)&id=${inList(safe)}`),
    rest(db, `inventory_batches?select=variant_id,qty_on_hand,qty_reserved&variant_id=${inList(safe)}&status=eq.active&expiry_date=gte.${sellableFromDate(nowMs)}`),
  ]);
  if (!vr.ok) throw new Error(`variants ${vr.status}`);
  if (!br.ok) throw new Error(`batches ${br.status}`);
  const variants = (await vr.json()) as VariantRow[];
  const batches = (await br.json()) as BatchRow[];
  const free = new Map<string, number>();
  for (const b of batches) free.set(b.variant_id, (free.get(b.variant_id) ?? 0) + Math.max(0, b.qty_on_hand - b.qty_reserved));
  for (const v of variants) {
    const p = Array.isArray(v.products) ? v.products[0] : v.products;
    if (!p) continue;
    out.set(v.id.toLowerCase(), {
      variant_id: v.id.toLowerCase(),
      product_name: p.public_name?.trim() || p.internal_name,
      product_status: p.status,
      variant_status: v.status,
      pack_size: v.pack_size,
      price_paise: v.price_paise,
      gst_rate: v.gst_rate === null ? null : Number(v.gst_rate),
      hsn_code: v.hsn_code,
      free_qty: free.get(v.id) ?? 0,
    });
  }
  return out;
}

/** Variant ids of one product, by its slug, for the pack-size picker. */
export async function variantIdsForSlug(db: SupabaseConfig, slug: string): Promise<string[]> {
  const r = await rest(db, `product_variants?select=id,products!inner(slug)&products.slug=eq.${encodeURIComponent(slug)}&order=sort_order.asc`);
  if (!r.ok) throw new Error(`variants by slug ${r.status}`);
  return ((await r.json()) as { id: string }[]).map((v) => v.id.toLowerCase());
}

/** The saved cart of one signed-in member: variant ids and quantities only. */
export async function getSavedCart(db: SupabaseConfig, memberId: string): Promise<CartLineInput[]> {
  if (!isUuid(memberId)) return [];
  const r = await rest(db, `carts?select=cart_items(variant_id,qty)&member_id=eq.${memberId}&limit=1`);
  if (!r.ok) throw new Error(`cart ${r.status}`);
  const rows = (await r.json()) as { cart_items: { variant_id: string; qty: number }[] }[];
  return (rows[0]?.cart_items ?? []).map((i) => ({ variantId: i.variant_id.toLowerCase(), qty: i.qty }));
}

export const setSavedItem = (db: SupabaseConfig, memberId: string, variantId: string, qty: number): Promise<RpcResult<null>> =>
  rpc<null>(db, 'cart_set_item', { p_member: memberId, p_variant: variantId, p_qty: qty });

export const mergeSavedCart = (db: SupabaseConfig, memberId: string, lines: CartLineInput[]): Promise<RpcResult<null>> =>
  rpc<null>(db, 'cart_merge', { p_member: memberId, p_lines: lines.map((l) => ({ variant_id: l.variantId, qty: l.qty })) });

export const clearSavedCart = (db: SupabaseConfig, memberId: string): Promise<RpcResult<null>> => rpc<null>(db, 'cart_clear', { p_member: memberId });
