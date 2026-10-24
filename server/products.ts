import type { InternalProduct, NewProduct, ProductUpdate, PublicImageRow, PublicViewRow } from '../shared/products.js';
import { rest, type SupabaseConfig } from './supabase.js';

const PUBLIC_COLUMNS = 'slug,name,form,pack_size,status,description,public_image,public_image_alt,ingredients,sub_compositions,preservatives,preservative_label';

/** The only public read path: the public_products view (approved statuses; formulation only if verified for release). */
export async function listPublic(db: SupabaseConfig): Promise<PublicViewRow[]> {
  const r = await rest(db, `public_products?select=${PUBLIC_COLUMNS}&order=sort_order.asc,slug.asc`);
  if (!r.ok) throw new Error(`public products ${r.status}`);
  return (await r.json()) as PublicViewRow[];
}

export async function getPublic(db: SupabaseConfig, slug: string): Promise<PublicViewRow | null> {
  const r = await rest(db, `public_products?select=${PUBLIC_COLUMNS}&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  if (!r.ok) throw new Error(`public product ${r.status}`);
  return ((await r.json()) as PublicViewRow[])[0] ?? null;
}

/**
 * Gallery photos and pack-size labels of publicly approved products, from their own public views. Both degrade quietly
 * (empty) if supabase/variants_gallery.sql has not been run yet, so the site keeps working with the single legacy photo.
 */
export async function listPublicExtras(db: SupabaseConfig, slug?: string): Promise<{ images: PublicImageRow[]; packSizes: Record<string, string[]> }> {
  const filter = slug ? `&slug=eq.${encodeURIComponent(slug)}` : '';
  const [ir, vr] = await Promise.all([
    rest(db, `public_product_images?select=slug,path,alt,sort_order&order=sort_order.asc${filter}`).catch(() => null),
    rest(db, `public_product_variants?select=slug,pack_size,sort_order&order=sort_order.asc${filter}`).catch(() => null),
  ]);
  const images = ir?.ok ? ((await ir.json()) as PublicImageRow[]) : [];
  const packSizes: Record<string, string[]> = {};
  if (vr?.ok) for (const v of (await vr.json()) as { slug: string; pack_size: string }[]) { const list = (packSizes[v.slug] ??= []); if (!list.includes(v.pack_size)) list.push(v.pack_size); }
  return { images, packSizes };
}

// ---- admin only (callers must have checked an admin session) ------------------------------------------

export async function listInternal(db: SupabaseConfig): Promise<InternalProduct[]> {
  const r = await rest(db, 'products?select=*&order=sort_order.asc,created_at.asc');
  if (!r.ok) throw new Error(`products ${r.status}`);
  return (await r.json()) as InternalProduct[];
}

export async function getInternal(db: SupabaseConfig, id: string): Promise<InternalProduct | null> {
  const r = await rest(db, `products?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!r.ok) throw new Error(`product ${r.status}`);
  return ((await r.json()) as InternalProduct[])[0] ?? null;
}

export async function updateProduct(db: SupabaseConfig, id: string, patch: ProductUpdate): Promise<InternalProduct> {
  const r = await rest(db, `products?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`update product ${r.status}`);
  const rows = (await r.json()) as InternalProduct[];
  if (!rows[0]) throw new Error('update product: no row');
  return rows[0];
}

/** Creates a DRAFT with nothing public. Returns null when the slug is already taken. */
export async function createProduct(db: SupabaseConfig, p: NewProduct): Promise<InternalProduct | null> {
  const r = await rest(db, 'products', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...p, status: 'DRAFT', ingredients: [], sub_compositions: {}, preservatives: null, notes: 'Created in the admin panel. Composition not yet supplied or verified.', sort_order: 500 }),
  });
  if (r.status === 409) return null;
  if (!r.ok) throw new Error(`create product ${r.status}`);
  const rows = (await r.json()) as InternalProduct[];
  if (!rows[0]) throw new Error('create product: no row');
  return rows[0];
}
