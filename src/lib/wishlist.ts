import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { WishlistItem } from '../../shared/wishlist';
import { wishlistApi } from './wishlistApi';
import { useSession } from './session';

/**
 * The signed-in customer's wishlist, shared by every component through one small store. The server is the source of truth:
 * every change returns the whole list and the store replaces its copy. Nothing is kept for signed-out visitors.
 */
interface Snap { status: 'idle' | 'loading' | 'ready' | 'error'; items: WishlistItem[]; busy: string | null; message: string | null }
let snap: Snap = { status: 'idle', items: [], busy: null, message: null };
const subs = new Set<() => void>();
const set = (next: Partial<Snap>) => {
  snap = { ...snap, ...next };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
const get = () => snap;

async function load() {
  if (snap.status === 'loading') return;
  set({ status: 'loading', message: null });
  const r = await wishlistApi.list();
  if (r.ok) set({ status: 'ready', items: r.data.items });
  else set({ status: 'error', message: r.error.message });
}

export function useWishlist() {
  const { user } = useSession();
  const s = useSyncExternalStore(subscribe, get, get);
  const signedIn = !!user;

  useEffect(() => {
    if (user === null && snap.status !== 'idle') set({ status: 'idle', items: [], busy: null, message: null });
    if (user && snap.status === 'idle') void load();
  }, [user]);

  const mutate = useCallback(async (slug: string, kind: 'add' | 'remove') => {
    if (snap.busy) return false;
    set({ busy: slug, message: null });
    const r = kind === 'add' ? await wishlistApi.add(slug) : await wishlistApi.remove(slug);
    if (r.ok) set({ items: r.data.items, status: 'ready', busy: null });
    else set({ busy: null, message: r.message ?? r.error.message });
    return r.ok;
  }, []);

  return {
    signedIn,
    status: s.status,
    items: s.items,
    count: s.items.length,
    busy: s.busy,
    message: s.message,
    has: (slug: string) => s.items.some((i) => i.slug === slug),
    add: (slug: string) => mutate(slug, 'add'),
    remove: (slug: string) => mutate(slug, 'remove'),
    reload: load,
  };
}
