import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { validateAddress, type AddressErrors } from '../../shared/checkout';
import AddressForm, { type AddressValue } from '../components/checkout/AddressForm';
import CustomerDetails, { type DetailsValue } from '../components/checkout/CustomerDetails';
import OrderConfirmation from '../components/checkout/OrderConfirmation';
import CheckoutSummary from '../components/checkout/CheckoutSummary';
import OrderReview from '../components/checkout/OrderReview';
import PaymentFailure from '../components/checkout/PaymentFailure';
import PaymentStep from '../components/checkout/PaymentStep';
import ErrorNotice from '../components/ErrorNotice';
import { checkoutApi, type PayState, type PlacedOrderView, type QuoteView } from '../lib/checkoutApi';
import { useNoIndex } from '../lib/auth';
import { useCart } from '../lib/cart';
import type { ErrorInfo } from '../lib/errors';
import { useSession } from '../lib/session';

const FIELD_ORDER = ['name', 'phone', 'line1', 'line2', 'pincode', 'city', 'state'] as const;
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '');

/** Checkout (development testing only). Closed unless the server says so; creates an unpaid test order, takes no payment. */
export default function Checkout() {
  useNoIndex('Checkout | Kaayra Herbals');
  const { user } = useSession();
  const cart = useCart();
  const [open, setOpen] = useState<boolean | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payState, setPayState] = useState<PayState>('unpaid');
  const [details, setDetails] = useState<DetailsValue>({ name: '', phone: '' });
  const [addr, setAddr] = useState<AddressValue>({ line1: '', line2: '', city: '', state: '', pincode: '' });
  const [fields, setFields] = useState<AddressErrors>({});
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<{ order: PlacedOrderView; replay: boolean; paymentOpen: boolean } | null>(null);
  const key = useRef(newKey());
  const submitting = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void checkoutApi.config().then((c) => {
      if (!live) return;
      setOpen(c.open);
      setPayOpen(c.paymentOpen);
    });
    return () => {
      live = false;
    };
  }, []);

  // Any edit invalidates the quote and the idempotency key: a new key belongs to a new set of contents.
  const edited = useCallback(() => {
    setQuote(null);
    setError(null);
    key.current = newKey();
  }, []);

  useEffect(() => {
    if (placed) document.getElementById('co-done')?.focus();
  }, [placed]);

  const focusFirst = (errs: AddressErrors) => {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (first) document.getElementById(`co-${first}`)?.focus();
  };

  const full = () => validateAddress({ ...details, ...addr });

  async function review(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = full();
    if (!v.ok) {
      setFields(v.errors);
      setError(null);
      focusFirst(v.errors);
      return;
    }
    setFields({});
    setBusy(true);
    const r = await checkoutApi.quote(v.value);
    setBusy(false);
    if (r.ok) {
      setQuote(r.data);
      setError(null);
      return;
    }
    setQuote(null);
    setFields(r.fields);
    setError(r.error);
    if (r.status === 409) void cart.refresh();
    if (Object.keys(r.fields).length) focusFirst(r.fields);
    else errorRef.current?.focus();
  }

  async function place() {
    // A ref, not state: a double tap in the same frame must not send twice.
    if (submitting.current || !quote) return;
    const v = full();
    if (!v.ok || !key.current) return;
    submitting.current = true;
    setBusy(true);
    const r = await checkoutApi.place(v.value, key.current, quote.totals.totalPaise);
    setBusy(false);
    submitting.current = false;
    if (r.ok) {
      setPlaced({ order: r.data.order, replay: r.data.replay, paymentOpen: r.data.paymentOpen });
      setPayState('unpaid');
      void cart.refresh();
      return;
    }
    setError(r.error);
    if (r.status === 409 || r.status === 422) {
      setQuote(null);
      key.current = newKey();
      if (r.status === 409) void cart.refresh();
    }
    errorRef.current?.focus();
  }

  if (placed) {
    const retry = () => setPayState('unpaid');
    return (
      <section className="section co-section">
        <div className="wrap co-page">
          {payState === 'paid' ? (
            <OrderConfirmation order={placed.order} replay={placed.replay} paid />
          ) : payState === 'failed' || payState === 'review' || payState === 'cancelled' ? (
            <PaymentFailure order={placed.order} state={payState} onRetry={retry} />
          ) : placed.paymentOpen ? (
            <>
              <h1>Pay for your order</h1>
              <p className="lede">Order <strong>{placed.order.orderNo}</strong></p>
              <PaymentStep
                order={placed.order}
                paymentOpen
                onResult={(s) => {
                  setPayState(s.state);
                  if (s.state === 'paid') void cart.refresh();
                }}
              />
            </>
          ) : (
            <OrderConfirmation order={placed.order} replay={placed.replay} />
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="section co-section">
      <div className="wrap co-wrap">
        <header className="co-head">
          <p className="eyebrow">Checkout</p>
          <h1>Complete your order</h1>
        </header>
        {open === null ? (
          <p role="status" aria-busy="true">Loading…</p>
        ) : !open ? (
          <p className="lede">
            Checkout is closed right now. <Link className="link-arrow" to="/#notify">Join the launch list</Link> and we will tell you first.
          </p>
        ) : !user ? (
          <p className="lede">
            Please <Link className="link-arrow" to="/login">sign in</Link> to check out. Your bag is kept.
          </p>
        ) : cart.status === 'ready' && cart.view.lines.length === 0 ? (
          <p className="lede">
            Your bag is empty. <Link className="link-arrow" to="/collection">See the products</Link>
          </p>
        ) : (
          <div className="co-layout">
          <form className="co-form" onSubmit={(e) => void review(e)} noValidate aria-busy={busy}>
            <p className="co-banner">{payOpen ? 'Test checkout. Payment uses Razorpay test mode: no real money moves and nothing will be shipped.' : 'Test checkout. No payment is taken and nothing will be shipped.'}</p>
            <div ref={errorRef} tabIndex={-1} aria-live="polite">
              {error && <ErrorNotice error={error} />}
            </div>
            <CustomerDetails email={user.email} value={details} errors={fields} onChange={(v) => { setDetails(v); edited(); }} />
            <AddressForm value={addr} errors={fields} onChange={(v) => { setAddr(v); edited(); }} />
            {quote ? (
              <>
                <OrderReview quote={quote} />
                <PaymentStep paymentOpen={payOpen} />
                <button type="button" className="btn co-submit" onClick={() => void place()} disabled={busy}>
                  {busy ? 'Placing…' : payOpen ? 'Place order and continue to payment' : 'Place test order'}
                </button>
              </>
            ) : (
              <button type="submit" className="btn co-submit" disabled={busy}>
                {busy ? 'Checking…' : 'Review order'}
              </button>
            )}
          </form>
          <CheckoutSummary quote={quote} />
          </div>
        )}
      </div>
    </section>
  );
}
