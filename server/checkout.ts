import { createHash } from 'node:crypto';
import { isUuid } from '../shared/cart.js';
import { isValidPin, type ShippingRow } from '../shared/checkout.js';
import { rpc, type RpcResult } from './rpc.js';
import { rest, type SupabaseConfig } from './supabase.js';

/** Stable short fingerprint of a canonical request (shared/checkout.ts canonicalRequest). */
export const requestHash = (canonical: string): string => createHash('sha256').update(canonical).digest('hex');

/** The serviceability row for one PIN code, or null when we do not deliver there. A database error throws; it is never read as "serviceable". */
export async function loadShippingRow(db: SupabaseConfig, pincode: string): Promise<ShippingRow | null> {
  if (!isValidPin(pincode)) return null;
  const r = await rest(db, `shipping_pincodes?select=pincode,active,rate_paise,free_above_paise&pincode=eq.${pincode}&limit=1`);
  if (!r.ok) throw new Error(`shipping ${r.status}`);
  const rows = (await r.json()) as { pincode: string; active: boolean; rate_paise: number; free_above_paise: number | string | null }[];
  const row = rows[0];
  if (!row) return null;
  return { pincode: row.pincode, active: row.active === true, ratePaise: row.rate_paise, freeAbovePaise: row.free_above_paise === null ? null : Number(row.free_above_paise) };
}

export interface PlaceArgs {
  memberId: string;
  key: string;
  hash: string;
  order: { customer_name: string; customer_email: string; customer_phone: string; ship_address: string; ship_pincode: string; shipping_paise: number; items: { variant_id: string; qty: number }[] };
  expectedTotalPaise: number;
  test: boolean;
  holdMinutes: number;
  /** Read from the member's saved bag on the server, never from the request. Null: no coupon. */
  couponCode?: string | null;
  /** Points to redeem, from the request; the database computes the value from its own settings. 0 or absent: the original path. */
  loyaltyPoints?: number;
}

/** Calls the atomic, idempotent database function. Stock is reserved there, in the same transaction as the order. */
export const placeOrder = (db: SupabaseConfig, a: PlaceArgs): Promise<RpcResult<{ order_id: string; replay: boolean }>> =>
  (a.loyaltyPoints ?? 0) > 0
    ? rpc(db, 'checkout_place_full', { p_member: a.memberId, p_key: a.key, p_hash: a.hash, p_order: a.order, p_expected_total: a.expectedTotalPaise, p_test: a.test, p_hold_minutes: a.holdMinutes, p_min_days: 30, p_coupon: a.couponCode ?? null, p_loyalty_points: a.loyaltyPoints })
    : rpc(db, 'checkout_place', { p_member: a.memberId, p_key: a.key, p_hash: a.hash, p_order: a.order, p_expected_total: a.expectedTotalPaise, p_test: a.test, p_hold_minutes: a.holdMinutes, p_min_days: 30, p_coupon: a.couponCode ?? null });

export interface PlacedOrder {
  id: string;
  orderNo: string;
  status: string;
  subtotalPaise: number;
  discountPaise: number;
  couponCode: string | null;
  shippingPaise: number;
  totalPaise: number;
  payBy: string | null;
  isTest: boolean;
}

/** Reads an order back, but only if it belongs to this member. Ownership is part of the query, not a check afterwards. */
export async function readOwnOrder(db: SupabaseConfig, memberId: string, orderId: string): Promise<PlacedOrder | null> {
  if (!isUuid(memberId) || !isUuid(orderId)) return null;
  const r = await rest(db, `orders?select=id,order_no,status,subtotal_paise,discount_paise,coupon_code,shipping_paise,total_paise,pay_by,is_test&id=eq.${orderId}&member_id=eq.${memberId}&limit=1`);
  if (!r.ok) throw new Error(`order ${r.status}`);
  const o = ((await r.json()) as { id: string; order_no: string; status: string; subtotal_paise: number | string; discount_paise: number | string; coupon_code: string | null; shipping_paise: number; total_paise: number | string; pay_by: string | null; is_test: boolean }[])[0];
  if (!o) return null;
  return { id: o.id, orderNo: o.order_no, status: o.status, subtotalPaise: Number(o.subtotal_paise), discountPaise: Number(o.discount_paise ?? 0), couponCode: o.coupon_code ?? null, shippingPaise: o.shipping_paise, totalPaise: Number(o.total_paise), payBy: o.pay_by, isTest: o.is_test };
}
