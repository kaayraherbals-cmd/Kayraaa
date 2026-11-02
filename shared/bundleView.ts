/** Public bundle view (Phase 12 Stage 7E). Pure mapping of bundle_public_list rows; the database is the authority for price and stock. */

export interface PublicBundleComponent { product: string; packSize: string; qty: number }
export interface PublicBundle {
  slug: string;
  name: string;
  kind: string;
  description: string | null;
  giftNote: string | null;
  combinedPaise: number;
  finalPaise: number;
  savingsPaise: number;
  /** How many whole bundles can be bought now. 0 means unavailable. Never a stock count of any single product. */
  available: number;
  components: PublicBundleComponent[];
}

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Rows that do not look right, or that show no real saving, are dropped: a saving is never invented or shown when it is not true. */
export function toPublicBundles(rows: unknown): PublicBundle[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicBundle[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const price = (r?.price ?? {}) as Record<string, unknown>;
    const comps = Array.isArray(r?.components) ? (r.components as Record<string, unknown>[]) : [];
    if (typeof r?.slug !== 'string' || typeof r.name !== 'string' || !int(price.combined_paise) || !int(price.final_paise) || !int(price.savings_paise)) continue;
    if (price.savings_paise <= 0 || price.final_paise + price.savings_paise !== price.combined_paise) continue;
    const components = comps.filter((c) => typeof c.product === 'string' && typeof c.pack_size === 'string' && int(c.qty) && c.qty > 0).map((c) => ({ product: c.product as string, packSize: c.pack_size as string, qty: c.qty as number }));
    if (components.length < 2) continue;
    out.push({
      slug: r.slug, name: r.name, kind: typeof r.kind === 'string' ? r.kind : 'bundle',
      description: typeof r.description === 'string' ? r.description : null, giftNote: typeof r.gift_note === 'string' ? r.gift_note : null,
      combinedPaise: price.combined_paise, finalPaise: price.final_paise, savingsPaise: price.savings_paise, available: int(r.available) ? r.available : 0, components,
    });
  }
  return out;
}
