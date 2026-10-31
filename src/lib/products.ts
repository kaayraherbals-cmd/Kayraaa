import { useEffect, useState } from 'react';
import type { PublicProduct } from '../../shared/products';
import { withConceptImages } from '../content/concept-renders';
import { setHint } from './siteHints';

/**
 * Public product previews. Data comes from /api/products, which returns only products an admin has approved for preview.
 * Nothing about unapproved products exists in the browser bundle. Types only are imported from /shared.
 */
export type CollectionState = { status: 'loading' } | { status: 'ready'; items: PublicProduct[] } | { status: 'error' };

let cache: { at: number; promise: Promise<PublicProduct[] | null> } | null = null;

export function loadProducts(): Promise<PublicProduct[] | null> {
  if (cache && Date.now() - cache.at < 20_000) return cache.promise;
  const promise = fetch('/api/products', { headers: { Accept: 'application/json' } })
    .then(async (r) => {
      if (!r.ok) return null;
      const data = (await r.json()) as { items?: PublicProduct[] };
      const items = Array.isArray(data.items) ? data.items.map(withConceptImages) : [];
      // Remember the answer so the next visit paints the right home-page buttons in its first frame (see siteHints.ts).
      setHint('shop', { has: items.length > 0, sale: items.some((p) => p.purchasable) });
      return items;
    })
    .catch(() => null);
  cache = { at: Date.now(), promise };
  void promise.then((v) => {
    if (v === null && cache?.promise === promise) cache = null;
  });
  return promise;
}

export function useCollection(): CollectionState {
  const [state, setState] = useState<CollectionState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    void loadProducts().then((items) => {
      if (live) setState(items ? { status: 'ready', items } : { status: 'error' });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export async function loadProduct(slug: string): Promise<PublicProduct | null | 'error'> {
  try {
    const r = await fetch(`/api/products?slug=${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) return 'error';
    const data = (await r.json()) as { item?: PublicProduct };
    return data.item ? withConceptImages(data.item) : null;
  } catch {
    return 'error';
  }
}
