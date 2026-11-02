import { evaluateLine } from '../../shared/cart.js';
import type { CatalogItem } from '../../shared/aiCatalog.js';
import { loadVariantRecords, variantIdsForSlug } from '../cart.js';
import { listPublic } from '../products.js';
import type { SupabaseConfig } from '../supabase.js';

let cache: { at: number; withPrices: boolean; items: CatalogItem[] } | null = null;
const TTL_MS = 60_000;

let pending: { withPrices: boolean; promise: Promise<CatalogItem[] | null> } | null = null;

/**
 * Approved products only (the public_products view), with real prices and stock from the same server rules the shop uses. Cached for a
 * minute: it holds no personal data. Returns null when the catalogue cannot be read, so the assistant says so instead of guessing.
 */
export function loadCatalog(db: SupabaseConfig, withPrices: boolean, nowMs = Date.now()): Promise<CatalogItem[] | null> {
  if (cache && cache.withPrices === withPrices && nowMs - cache.at < TTL_MS) return Promise.resolve(cache.items);
  // Two visitors asking at the same moment share one read of the database.
  if (pending && pending.withPrices === withPrices) return pending.promise;
  const promise = build(db, withPrices, nowMs).finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { withPrices, promise };
  return promise;
}

async function build(db: SupabaseConfig, withPrices: boolean, nowMs: number): Promise<CatalogItem[] | null> {
  try {
    const rows = await listPublic(db);
    // All products are looked up at the same time, and all their packs are priced in one request (this was one request per product, one after another).
    const idLists = await Promise.all(rows.map((r) => (withPrices ? variantIdsForSlug(db, r.slug) : Promise.resolve([] as string[]))));
    const recs: Awaited<ReturnType<typeof loadVariantRecords>> = withPrices ? await loadVariantRecords(db, idLists.flat(), nowMs) : new Map();
    const items: CatalogItem[] = rows.map((r, i) => {
      const ids = idLists[i] ?? [];
      let packs: CatalogItem['packs'] = [{ packSize: r.pack_size, pricePaise: null, available: null }];
      if (withPrices && ids.length > 0) {
        packs = ids.map((id) => {
          const l = evaluateLine({ variantId: id, qty: 1 }, recs.get(id));
          return { packSize: l.packSize || r.pack_size, pricePaise: l.state === 'unavailable' ? null : l.unitPaise, available: l.state !== 'unavailable' };
        });
      }
      return { slug: r.slug, name: r.name, form: r.form, description: r.description, ingredients: Array.isArray(r.ingredients) && r.ingredients.length > 0 ? r.ingredients : null, packs };
    });
    cache = { at: nowMs, withPrices, items };
    return items;
  } catch {
    return null;
  }
}

export const clearCatalogCache = (): void => { cache = null; pending = null; };
