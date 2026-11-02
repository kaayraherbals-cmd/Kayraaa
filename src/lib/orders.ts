import { useEffect, useState } from 'react';
import { ORDER_STATUS_LABELS, isOrderStatus } from '../../shared/orders';

export interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  created_at: string;
  total_paise: number;
  is_test: boolean;
  ship_address?: string;
  ship_pincode?: string;
  customer_name?: string;
  order_refunds?: { status: string; amount_paise: number }[];
}

export interface OrderDetail {
  order: OrderRow & { subtotal_paise: number; shipping_paise: number; discount_paise?: number; coupon_code?: string | null };
  items: { product_name: string; pack_size: string; qty: number; unit_price_paise: number; line_total_paise: number }[];
  refunds: { kind: string; status: string; amount_paise: number; requested_at: string; decided_at: string | null; refunded_at: string | null }[];
}

export const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
export const rupees = (p: number) => `₹${(Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const statusLabel = (s: string) => (isOrderStatus(s) ? ORDER_STATUS_LABELS[s] : s);

const REFUND_LABELS: Record<string, string> = { requested: 'Refund requested', approved: 'Refund approved', rejected: 'Refund declined', refunded: 'Refunded' };
export const refundLabel = (s: string) => REFUND_LABELS[s] ?? s;

export type Fetched<T> = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'error'; message: string } | { kind: 'ready'; data: T };

/** GET a customer orders endpoint. 401 means signed out; anything else that fails becomes a plain message. */
export async function getOrders<T>(path: string): Promise<Fetched<T>> {
  try {
    const res = await fetch(`/api/orders/${path}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (res.status === 401) return { kind: 'signed-out' };
    const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok || !data) return { kind: 'error', message: typeof data?.message === 'string' ? data.message : 'Could not load your orders.' };
    return { kind: 'ready', data };
  } catch {
    return { kind: 'error', message: 'Could not reach the server. Check your connection and try again.' };
  }
}

export function useOrdersList(page = 1, attempt = 0, enabled = true) {
  const [state, setState] = useState<Fetched<{ items: OrderRow[]; total: number; pageSize: number }>>({ kind: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState({ kind: 'loading' });
    void getOrders<{ items: OrderRow[]; total: number; pageSize: number }>(`list?page=${page}`).then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [page, attempt, enabled]);
  return state;
}

/** Distinct delivery addresses from a list of orders, newest first. Addresses are kept per order, so this is a view of what was used, not a separate address book. */
export function addressesFrom(items: OrderRow[]) {
  const seen = new Map<string, { name: string; address: string; pin: string; last: string }>();
  for (const o of items) {
    if (!o.ship_address || !o.ship_pincode) continue;
    const key = `${o.ship_address}|${o.ship_pincode}`.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name: o.customer_name ?? '', address: o.ship_address, pin: o.ship_pincode, last: o.created_at });
  }
  return [...seen.values()];
}
