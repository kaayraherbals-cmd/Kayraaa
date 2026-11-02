import { formatInr } from './orders.js';

/** The approved product facts the customer assistant may use. Built only from the public product views plus the shop's own price and stock rules. */
export interface CatalogPack { packSize: string; pricePaise: number | null; available: boolean | null }
export interface CatalogItem {
  slug: string;
  name: string;
  form: string;
  description: string;
  /** Present only when the formulation has been verified and released for public display. */
  ingredients: string[] | null;
  packs: CatalogPack[];
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'which', 'show', 'tell', 'about', 'any', 'you', 'your', 'have', 'has', 'are', 'can', 'could', 'would', 'please', 'want', 'need', 'looking', 'some', 'products', 'product', 'containing', 'contain', 'contains', 'made', 'does', 'how', 'who', 'compare', 'between', 'these', 'two', 'explore', 'wellness', 'herbal']);

export const queryTerms = (q: string): string[] => [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)))];

/**
 * Keyword search over name, ingredients, form and description (verified, public text only). With no usable keywords (for example
 * "I want to explore herbal products") the first products are returned so the assistant can describe the range. Never more than `limit`.
 */
export function rankProducts(items: readonly CatalogItem[], query: string, limit = 6): CatalogItem[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return items.slice(0, limit);
  const scored = items.map((p, i) => {
    const name = p.name.toLowerCase();
    const form = p.form.toLowerCase();
    const desc = p.description.toLowerCase();
    const ing = (p.ingredients ?? []).join(' ').toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (name.includes(t)) score += 3;
      if (ing.includes(t)) score += 3;
      if (form.includes(t)) score += 2;
      if (desc.includes(t)) score += 1;
    }
    return { p, score, i };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
  return (hits.length > 0 ? hits.map((h) => h.p) : []).slice(0, limit);
}

/** Exactly what the model is shown for each product (and nothing else). Prices appear only when the shop itself shows prices. */
export function contextFor(items: readonly CatalogItem[]): Record<string, unknown>[] {
  return items.map((p) => ({
    id: p.slug,
    name: p.name,
    form: p.form,
    description: p.description,
    ...(p.ingredients ? { verified_ingredients: p.ingredients } : { ingredients: 'not published' }),
    packs: p.packs.map((k) => ({ pack: k.packSize, ...(k.pricePaise != null ? { price: formatInr(k.pricePaise) } : {}), ...(k.available != null ? { in_stock: k.available } : {}) })),
  }));
}

/** Every real price (paise) in these items: the only amounts a reply may mention. */
export const realPrices = (items: readonly CatalogItem[]): number[] => items.flatMap((p) => p.packs.map((k) => k.pricePaise).filter((v): v is number => v != null));

/** Questions about the whole range ("each product", "all products", "list everything"), where keyword matching would hide most of the catalogue. */
const WHOLE_RANGE_RE = /\b(each|every|all|full|entire|whole|list|range|catalog\w*|everything|available|what (products|do you (sell|have|offer))|which products|products you|compare (them|all))\b/i;
/** Questions about a product fact in general ("ingredients", "price", "pack size"), where no single product was named. */
const PRODUCT_TOPIC_RE = /\b(ingredients?|prices?|cost|how much|pack ?sizes?|sizes?|in stock|stock|products?|forms?|syrups?|gels?|oils?|powders?|capsules?|tablets?)\b/i;
export const wantsWholeRange = (message: string): boolean => WHOLE_RANGE_RE.test(message);
export const isProductTopic = (message: string): boolean => PRODUCT_TOPIC_RE.test(message);

/** A shorter view of each product (no description) so that the whole catalogue fits in one prompt. Same facts, same price rules as contextFor. */
export function compactContextFor(items: readonly CatalogItem[]): Record<string, unknown>[] {
  return items.map((p) => ({
    id: p.slug,
    name: p.name,
    form: p.form,
    ...(p.ingredients ? { verified_ingredients: p.ingredients } : { ingredients: 'not published' }),
    packs: p.packs.map((k) => ({ pack: k.packSize, ...(k.pricePaise != null ? { price: formatInr(k.pricePaise) } : {}), ...(k.available != null ? { in_stock: k.available } : {}) })),
  }));
}
