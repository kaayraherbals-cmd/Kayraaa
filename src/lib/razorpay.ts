/**
 * Loads Razorpay Checkout on demand (never on page load), only from Razorpay's own address. Card, UPI and bank details are
 * typed into Razorpay's window; they never reach this site or our server. The CSP for /checkout allows exactly this script.
 */
const SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: 'INR';
  order_id: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
}

export interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', cb: (r: { error?: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (o: RazorpayOptions) => RazorpayInstance;
  }
}

let loading: Promise<NonNullable<Window['Razorpay']>> | null = null;

export function loadRazorpay(): Promise<NonNullable<Window['Razorpay']>> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay did not start')));
    s.onerror = () => {
      loading = null; // allow another try
      s.remove();
      reject(new Error('Razorpay could not be loaded'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
