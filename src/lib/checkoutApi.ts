import type { CartLineView } from '../../shared/cart';
import type { Address, AddressErrors, CheckoutTotals } from '../../shared/checkout';
import type { AppliedCoupon } from '../../shared/coupons';
import { errorInfo, networkError, type ErrorInfo } from './errors';

/** What /api/checkout/quote returns. Every figure is computed on the server. */
export interface QuoteView {
  lines: CartLineView[];
  totals: CheckoutTotals;
  coupon?: AppliedCoupon | null;
  shipping: { label: string; paise: number };
  pricesIncludeGst: boolean;
  test: boolean;
}

export interface PlacedOrderView {
  id: string;
  orderNo: string;
  status: string;
  subtotalPaise: number;
  discountPaise?: number;
  couponCode?: string | null;
  shippingPaise: number;
  totalPaise: number;
  payBy: string | null;
  isTest: boolean;
}

export type PayState = 'paid' | 'processing' | 'failed' | 'review' | 'unpaid' | 'cancelled';

/** What /api/checkout/pay returns: everything Razorpay Checkout needs, and nothing secret (the key id is public). */
export interface PayStart {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: 'INR';
  orderNo: string;
  isTest: boolean;
  payBy: string;
  prefill: { name: string; email: string; contact: string };
}

/** The state of one order's payment, as decided by the server. */
export interface PayStatus {
  state: PayState;
  order: { id: string; orderNo: string; status: string; totalPaise: number; payBy: string | null; isTest: boolean };
}

/** What Razorpay Checkout hands the page after a payment. Sent to the server, which checks it with Razorpay; it is not proof of payment. */
export interface RazorpayCallback {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export type CheckoutResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ErrorInfo; fields: AddressErrors; lines?: CartLineView[] };

async function post<T>(action: 'quote' | 'place' | 'pay' | 'verify' | 'status' | 'cancel', body: unknown): Promise<CheckoutResult<T>> {
  try {
    const res = await fetch(`/api/checkout/${action}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Kaayra-CSRF': '1' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && data) return { ok: true, data: data as T };
    const fields = data && typeof data.fields === 'object' && data.fields !== null ? (data.fields as AddressErrors) : {};
    const lines = data && Array.isArray(data.lines) ? (data.lines as CartLineView[]) : undefined;
    return { ok: false, status: res.status, error: errorInfo(data), fields, lines };
  } catch {
    return { ok: false, status: 0, error: networkError(), fields: {} };
  }
}

export const checkoutApi = {
  /** Whether checkout is open on this deployment. Never throws; any failure means closed. */
  async open(): Promise<boolean> {
    return (await checkoutApi.config()).open;
  },
  /** Whether checkout and online payment are open on this deployment. Never throws; any failure means closed. */
  async config(): Promise<{ open: boolean; paymentOpen: boolean }> {
    try {
      const res = await fetch('/api/checkout/config', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const data = (await res.json().catch(() => null)) as { checkoutOpen?: boolean; paymentOpen?: boolean } | null;
      const open = res.ok && data?.checkoutOpen === true;
      return { open, paymentOpen: open && data?.paymentOpen === true };
    } catch {
      return { open: false, paymentOpen: false };
    }
  },
  quote: (address: Address) => post<QuoteView>('quote', { address }),
  /** expectedTotalPaise is the total the customer was shown; the server only compares it, it is never the amount. */
  place: (address: Address, idempotencyKey: string, expectedTotalPaise: number) => post<{ replay: boolean; order: PlacedOrderView; paymentOpen: boolean }>('place', { address, idempotencyKey, expectedTotalPaise }),
  /** Asks the server to create (or reuse) the Razorpay order for one of this customer's own unpaid orders. No amount is sent. */
  pay: (orderId: string) => post<PayStart>('pay', { orderId }),
  /** Sends what Razorpay Checkout returned. The server verifies it with Razorpay; only then does the order become paid. */
  verify: (orderId: string, cb: RazorpayCallback) => post<PayStatus>('verify', { orderId, ...cb }),
  status: (orderId: string) => post<PayStatus>('status', { orderId }),
  cancel: (orderId: string) => post<PayStatus>('cancel', { orderId }),
};
