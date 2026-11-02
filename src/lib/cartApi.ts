import type { CartLineInput, CartLineView, CartTotals } from '../../shared/cart';
import type { AppliedCoupon } from '../../shared/coupons';
import { errorInfo, networkError, type ErrorInfo } from './errors';

/** What /api/cart/* returns for a priced bag. Every figure is computed on the server. */
export interface CartView {
  lines: CartLineView[];
  /** discountPaise and afterDiscountPaise are present for a signed-in bag; absent means no discount. */
  totals: CartTotals & { discountPaise?: number; afterDiscountPaise?: number };
  /** The coupon saved on a signed-in bag, with its reason when it no longer qualifies. */
  coupon?: AppliedCoupon | null;
  checkoutOpen: boolean;
  pricesIncludeGst: boolean;
}

export interface VariantOption {
  variantId: string;
  packSize: string;
  productName: string;
  unitPaise: number | null;
  available: boolean;
  maxQty: number;
  message: string | null;
}

export type CartResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ErrorInfo };

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<CartResult<T>> {
  try {
    const res = await fetch(`/api/cart/${path}`, {
      method,
      headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Kaayra-CSRF': '1' },
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (res.ok && data && typeof data === 'object') return { ok: true, data: data as T };
    return { ok: false, status: res.status, error: errorInfo(data) };
  } catch {
    return { ok: false, status: 0, error: networkError() };
  }
}

export const cartApi = {
  /** Whether the cart preview is open on this deployment. Never throws; any failure means closed. */
  async enabled(): Promise<boolean> {
    return (await cartApi.enabledKnown()) === true;
  },
  /** Same question, but `null` when the server could not be reached (network or 5xx), so a blip is never remembered as "closed". */
  async enabledKnown(): Promise<boolean | null> {
    const r = await call<{ cartPreview?: boolean }>('config', 'GET');
    if (r.ok) return r.data.cartPreview === true;
    return r.status === 0 || r.status >= 500 ? null : false;
  },
  view: () => call<CartView>('view', 'GET'),
  validate: (lines: CartLineInput[]) => call<CartView>('validate', 'POST', { lines }),
  set: (variantId: string, qty: number) => call<CartView>('set', 'POST', { variantId, qty }),
  merge: (lines: CartLineInput[]) => call<CartView>('merge', 'POST', { lines }),
  clear: () => call<CartView>('clear', 'POST', {}),
  /** Reminder-email preference of the signed-in customer. Off unless they switched it on themselves. */
  prefs: () => call<{ available: boolean; cartReminders: boolean; consentText: string }>('prefs', 'GET'),
  setPrefs: (cartReminders: boolean) => call<{ cartReminders: boolean }>('prefs', 'POST', { cartReminders }),
  /** Opens a link from a reminder email. Never throws; the server decides whether it is genuine, current and for this customer. */
  async recover(token: string): Promise<{ result: string; message: string }> {
    try {
      const res = await fetch('/api/cart/recover', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Kaayra-CSRF': '1' }, credentials: 'same-origin', body: JSON.stringify({ token }) });
      const data = (await res.json().catch(() => null)) as { status?: string; message?: string; recover?: string } | null;
      if (res.ok && data?.recover === 'ok') return { result: 'ok', message: '' };
      return { result: typeof data?.status === 'string' ? data.status : 'error', message: data?.message ?? 'We could not open your reminder link. Your saved bag is below.' };
    } catch {
      return { result: 'error', message: 'We could not reach the server. Please check your connection and try again.' };
    }
  },
  applyCoupon: (code: string) => call<CartView>('coupon-apply', 'POST', { code }),
  removeCoupon: () => call<CartView>('coupon-remove', 'POST', {}),
  variants: (slug: string) => call<{ options: VariantOption[]; maxPerLine: number }>(`variants?slug=${encodeURIComponent(slug)}`, 'GET'),
};

export const EMPTY_VIEW: CartView = { lines: [], totals: { itemCount: 0, subtotalPaise: 0, gstIncludedPaise: 0 }, checkoutOpen: false, pricesIncludeGst: true };
