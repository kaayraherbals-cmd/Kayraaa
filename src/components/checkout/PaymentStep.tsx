import { useEffect, useRef, useState } from 'react';
import { formatRupees } from '../../../shared/cart';
import ErrorNotice from '../ErrorNotice';
import { checkoutApi, type PayState, type PayStatus, type PlacedOrderView } from '../../lib/checkoutApi';
import type { ErrorInfo } from '../../lib/errors';
import { loadRazorpay } from '../../lib/razorpay';

const POLL_MS = 3000;
const POLL_MAX = 10;

interface Props {
  /** Before an order exists this is only an explanation. After placement it carries the Pay button. */
  order?: PlacedOrderView;
  paymentOpen: boolean;
  /** Called with the server's decision. "paid" is only ever passed when the server says so. */
  onResult?: (s: PayStatus) => void;
}

/**
 * Payment. The amount shown comes from the server; the browser never sends one. Razorpay's own window collects card/UPI
 * details. When it reports success we ask OUR server, which checks the signature and asks Razorpay before the order is paid.
 */
export default function PaymentStep({ order, paymentOpen, onResult }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [waiting, setWaiting] = useState(false);
  const live = useRef(true);
  const tapped = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  if (!order) {
    return (
      <section className="co-pay" aria-labelledby="co-pay-h">
        <h2 id="co-pay-h" className="co-legend">Payment</h2>
        <p className="co-note">
          {paymentOpen
            ? 'You will pay in the next step, in a secure window run by Razorpay. We never see or store your card or UPI details. This is a test: use Razorpay test details only.'
            : 'Payment is not connected in this build. Placing a test order reserves stock and creates an unpaid order; nothing is charged.'}
        </p>
      </section>
    );
  }

  const done = (s: PayStatus) => {
    if (live.current) onResult?.(s);
  };

  /** After the window closes we ask the server what happened; while the bank is still settling we ask a few more times. */
  async function settle(first: PayStatus | null) {
    let s = first;
    for (let i = 0; i < POLL_MAX && live.current; i++) {
      if (s && s.state !== 'processing' && s.state !== 'unpaid') return done(s);
      setWaiting(true);
      await new Promise((r) => setTimeout(r, POLL_MS));
      const r = await checkoutApi.status(order!.id);
      if (r.ok) s = r.data;
    }
    setWaiting(false);
    if (live.current) setMsg('Your bank is still confirming this payment. You have not been charged twice. Check your email and your order page shortly; do not pay again.');
  }

  async function pay() {
    if (tapped.current || busy) return; // a ref, so a double tap in one frame cannot start two payments
    tapped.current = true;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const start = await checkoutApi.pay(order!.id);
      if (!start.ok) {
        setError(start.error);
        return;
      }
      const Razorpay = await loadRazorpay();
      const p = start.data;
      const rzp = new Razorpay({
        key: p.keyId,
        amount: p.amountPaise,
        currency: 'INR',
        order_id: p.razorpayOrderId,
        name: 'Kaayra Herbals',
        description: `Order ${p.orderNo}`,
        prefill: p.prefill,
        theme: { color: '#173A2D' },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            if (!live.current) return;
            setBusy(false);
            tapped.current = false;
            setMsg('Payment window closed. Nothing was charged unless you completed the payment. You can try again.');
          },
        },
        handler: (cb) => {
          void (async () => {
            setMsg('Confirming your payment…');
            const v = await checkoutApi.verify(order!.id, cb);
            if (v.ok) await settle(v.data);
            else {
              // Could not confirm: the money may have moved. Ask the server for the truth before showing anything.
              const st = await checkoutApi.status(order!.id);
              if (st.ok && st.data.state !== 'unpaid') await settle(st.data);
              else if (live.current) setError(v.error);
            }
            if (live.current) {
              setBusy(false);
              tapped.current = false;
            }
          })();
        },
      });
      rzp.on('payment.failed', (r) => {
        if (live.current) setMsg(r.error?.description ? `The payment did not go through: ${r.error.description}` : 'The payment did not go through. You can try again.');
      });
      rzp.open();
      return; // busy stays on until the window closes or the callback finishes
    } catch {
      setMsg('The payment window could not be opened. Check your connection and try again. Nothing was charged.');
    }
    setBusy(false);
    tapped.current = false;
  }

  async function cancel() {
    if (busy) return;
    setBusy(true);
    const r = await checkoutApi.cancel(order!.id);
    setBusy(false);
    if (r.ok) done(r.data);
    else setError(r.error);
  }

  return (
    <section className="co-pay" aria-labelledby="co-pay-h" aria-busy={busy}>
      <h2 id="co-pay-h" className="co-legend">Payment</h2>
      {order.isTest && <p className="co-banner">Test payment. Use Razorpay test details only. No real money moves and nothing will be shipped.</p>}
      <div aria-live="polite">
        {msg && <p className="co-note" role="status">{msg}</p>}
        {error && <ErrorNotice error={error} />}
      </div>
      <button type="button" className="btn co-submit" onClick={() => void pay()} disabled={busy || waiting}>
        {waiting ? 'Confirming…' : busy ? 'Opening payment…' : `Pay ${formatRupees(order.totalPaise)}`}
      </button>
      <p className="co-note">The amount is fixed by your order. Your stock is held until {order.payBy ? new Date(order.payBy).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'the time shown on your order'}.</p>
      <button type="button" className="co-link" onClick={() => void cancel()} disabled={busy || waiting}>Cancel this order</button>
    </section>
  );
}

export const isFinal = (s: PayState): boolean => s === 'paid' || s === 'cancelled';
