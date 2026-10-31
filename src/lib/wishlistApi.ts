import type { WishlistItem } from '../../shared/wishlist';
import { errorInfo, networkError, type ErrorInfo } from './errors';

export type WishResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ErrorInfo; code?: string; message?: string };

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<WishResult<T>> {
  try {
    const res = await fetch(`/api/cart/${path}`, {
      method,
      headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Kaayra-CSRF': '1' },
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
    if (res.ok && data && typeof data === 'object') return { ok: true, data: data as T };
    return { ok: false, status: res.status, error: errorInfo(data), ...(data?.status ? { code: data.status } : {}), ...(data?.message ? { message: data.message } : {}) };
  } catch {
    return { ok: false, status: 0, error: networkError() };
  }
}

export interface WishlistView { items: WishlistItem[]; count: number }

export const wishlistApi = {
  list: () => call<WishlistView>('wishlist', 'GET'),
  add: (slug: string) => call<WishlistView>('wishlist-add', 'POST', { slug }),
  remove: (slug: string) => call<WishlistView>('wishlist-remove', 'POST', { slug }),
  /** Adds one unit when the product has exactly one orderable pack size. Otherwise ok is false with code 'choose_size' or 'unavailable'. */
  toCart: (slug: string) => call<unknown>('wishlist-to-cart', 'POST', { slug }),
};
