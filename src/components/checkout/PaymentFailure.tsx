import { Link } from 'react-router-dom';
import type { PayState, PlacedOrderView } from '../../lib/checkoutApi';

/** Shown when payment did not complete. It never claims a charge happened or that one did not, beyond what the server decided. */
export default function PaymentFailure({ order, state, onRetry }: { order: PlacedOrderView; state: Extract<PayState, 'failed' | 'review' | 'cancelled'>; onRetry?: () => void }) {
  const copy = {
    failed: { h: 'Payment did not go through', p: 'Your bank or Razorpay did not complete this payment. Your order is still held for a short time, so you can try again.' },
    review: { h: 'We are checking your payment', p: 'The payment and the order do not agree yet, so a person at Kaayra will look at it. Please do not pay again. Quote your order number if you contact us.' },
    cancelled: { h: 'This order was cancelled', p: 'Nothing is held for this order any more. If you were charged, quote your order number and contact us.' },
  }[state];
  return (
    <section className="co-done" aria-labelledby="co-fail-h" tabIndex={-1} id="co-done">
      <h1 id="co-fail-h">{copy.h}</h1>
      <p className="lede">Order <strong>{order.orderNo}</strong>. {copy.p}</p>
      {state === 'failed' && onRetry && <button type="button" className="btn" onClick={onRetry}>Try payment again</button>}
      <p><Link className="link-arrow" to="/bag">Back to your bag</Link></p>
    </section>
  );
}
