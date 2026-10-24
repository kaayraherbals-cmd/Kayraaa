import { describe, expect, it } from 'vitest';
import { contextFor, queryTerms, rankProducts, realPrices, type CatalogItem } from './aiCatalog';

const item = (o: Partial<CatalogItem> & { slug: string; name: string }): CatalogItem => ({ form: 'Syrup', description: 'A herbal syrup.', ingredients: null, packs: [{ packSize: '200 ml', pricePaise: null, available: null }], ...o });
const items = [
  item({ slug: 'aloe-gel', name: 'Aloe Gel', form: 'Gel', ingredients: ['Aloe vera', 'Water'] }),
  item({ slug: 'tulsi-syrup', name: 'Tulsi Syrup', ingredients: ['Tulsi'], packs: [{ packSize: '200 ml', pricePaise: 24950, available: true }] }),
  item({ slug: 'neem-tea', name: 'Neem Tea', form: 'Tea', description: 'A tea blend.' }),
];

describe('product retrieval', () => {
  it('finds products by verified ingredient', () => {
    expect(rankProducts(items, 'Show me products containing aloe vera').map((p) => p.slug)).toEqual(['aloe-gel']);
  });
  it('finds by name and form, best match first', () => {
    expect(rankProducts(items, 'tulsi syrup')[0].slug).toBe('tulsi-syrup');
    expect(rankProducts(items, 'any tea?').map((p) => p.slug)).toEqual(['neem-tea']);
  });
  it('returns nothing when nothing matches, so the assistant cannot invent a product', () => {
    expect(rankProducts(items, 'ashwagandha capsules')).toEqual([]);
  });
  it('returns the range for a general request, capped', () => {
    expect(rankProducts(items, 'I want to explore herbal wellness products')).toHaveLength(3);
    expect(rankProducts(items, 'explore', 2)).toHaveLength(2);
  });
  it('drops filler words', () => {
    expect(queryTerms('Show me the products containing aloe')).toEqual(['aloe']);
  });
});

describe('what the model is shown', () => {
  it('includes ingredients only when verified and public', () => {
    const ctx = contextFor(items) as { id: string; ingredients?: string; verified_ingredients?: string[] }[];
    expect(ctx[0].verified_ingredients).toEqual(['Aloe vera', 'Water']);
    expect(ctx[2].ingredients).toBe('not published');
    expect(ctx[2]).not.toHaveProperty('verified_ingredients');
  });
  it('includes a price only when the shop supplied one', () => {
    const ctx = contextFor(items) as { packs: { price?: string; in_stock?: boolean }[] }[];
    expect(ctx[1].packs[0]).toEqual({ pack: '200 ml', price: '₹249.50', in_stock: true });
    expect(ctx[0].packs[0]).toEqual({ pack: '200 ml' });
  });
  it('lists exactly the real prices', () => {
    expect(realPrices(items)).toEqual([24950]);
  });
});
