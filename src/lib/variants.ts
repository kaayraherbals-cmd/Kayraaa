import { useEffect, useState } from 'react';
import { cartApi, type VariantOption } from './cartApi';

/**
 * Pack sizes, prices and availability per product, as the server states them (/api/cart/variants).
 * Nothing is priced in the browser. Results are cached for a minute so a collection of cards and the filters above them share one request each.
 */
const TTL = 60_000;
const cache = new Map<string, { at: number; p: Promise<VariantOption[] | null> }>();

export function loadVariants(slug: string): Promise<VariantOption[] | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = cartApi.variants(slug).then((r) => (r.ok ? r.data.options : null)).catch(() => null);
  cache.set(slug, { at: Date.now(), p });
  void p.then((v) => {
    if (v === null && cache.get(slug)?.p === p) cache.delete(slug);
  });
  return p;
}

export type VariantsState = { status: 'off' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; options: VariantOption[] };

export function useVariants(slug: string, enabled: boolean): VariantsState {
  const [state, setState] = useState<VariantsState>({ status: enabled ? 'loading' : 'off' });
  useEffect(() => {
    if (!enabled) return setState({ status: 'off' });
    let live = true;
    setState({ status: 'loading' });
    void loadVariants(slug).then((o) => live && setState(o ? { status: 'ready', options: o } : { status: 'error' }));
    return () => {
      live = false;
    };
  }, [slug, enabled]);
  return state;
}

/** Loads every product's options once (for sorting and the availability filter). */
export function useCatalogueVariants(slugs: string[], enabled: boolean): Map<string, VariantOption[]> {
  const [map, setMap] = useState<Map<string, VariantOption[]>>(new Map());
  const key = slugs.join('|');
  useEffect(() => {
    if (!enabled || !key) return setMap(new Map());
    let live = true;
    void Promise.all(key.split('|').map(async (s) => [s, await loadVariants(s)] as const)).then((rows) => {
      if (live) setMap(new Map(rows.filter((r): r is readonly [string, VariantOption[]] => r[1] !== null)));
    });
    return () => {
      live = false;
    };
  }, [key, enabled]);
  return map;
}

export interface Summary {
  anyAvailable: boolean;
  /** Lowest price among options that can be bought, in paise. */
  fromPaise: number | null;
  priceVaries: boolean;
  /** The only buyable option, when there is exactly one (a card can then add it straight to the bag). */
  only: VariantOption | null;
}

export function summarise(options: VariantOption[]): Summary {
  const buyable = options.filter((o) => o.available && o.unitPaise !== null);
  const prices = buyable.map((o) => o.unitPaise as number);
  const fromPaise = prices.length ? Math.min(...prices) : null;
  return { anyAvailable: buyable.length > 0, fromPaise, priceVaries: prices.length > 1 && Math.max(...prices) !== Math.min(...prices), only: buyable.length === 1 ? buyable[0] : null };
}
