import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { formatRupees } from '../../../shared/cart';
import { useCart } from '../../lib/cart';
import type { CartView } from '../../lib/cartApi';

/** Totals as calculated by the server. Shipping is worked out at checkout; checkout stays closed until commerce is approved. */
export default function CartSummary({ view, onNavigate }: { view: CartView; onNavigate?: () => void }) {
  const t = view.totals;
  const hasItems = t.itemCount > 0;
  const { applyCoupon, removeCoupon, busy } = useCart();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const coupon = view.coupon ?? null;
  const discount = t.discountPaise ?? 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setProblem('Enter a coupon code.');
    setProblem(null);
    const msg = await applyCoupon(code.trim());
    if (msg) setProblem(msg);
    else setCode('');
  }
  return (
    <div className="cart-summary" aria-label="Order summary">
      <dl className="cart-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatRupees(t.subtotalPaise)}</dd>
        </div>
        {coupon?.valid && discount > 0 && (
          <div className="cart-discount">
            <dt>Coupon {coupon.code}</dt>
            <dd>−{formatRupees(discount)}</dd>
          </div>
        )}
        {hasItems && t.gstIncludedPaise > 0 && (
          <div className="cart-totals-sub">
            <dt>Includes GST</dt>
            <dd>{formatRupees(t.gstIncludedPaise)}</dd>
          </div>
        )}
        <div className="cart-totals-sub">
          <dt>Shipping</dt>
          <dd>Calculated at checkout</dd>
        </div>
      </dl>
      {view.checkoutOpen && hasItems && (
        <div className="cart-coupon">
          {coupon ? (
            <div className="cart-coupon-applied">
              <p>
                <strong>{coupon.code}</strong>
                {coupon.valid ? (coupon.description ? ` · ${coupon.description}` : ' applied') : ' cannot be used right now'}
              </p>
              {!coupon.valid && coupon.message && <p className="field-error" role="alert">{coupon.message}</p>}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void removeCoupon()} disabled={busy} aria-label={`Remove coupon ${coupon.code}`}>Remove</button>
            </div>
          ) : (
            <form className="field cart-coupon-form" onSubmit={(e) => void submit(e)} noValidate>
              <label htmlFor="coupon-code">Coupon code</label>
              <div className="cart-coupon-row">
                <input id="coupon-code" type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'coupon-problem' : undefined} />
                <button type="submit" className="btn btn--ghost btn--sm" disabled={busy}>Apply</button>
              </div>
              {problem && <p id="coupon-problem" className="field-error" role="alert">{problem}</p>}
            </form>
          )}
        </div>
      )}
      {view.checkoutOpen && hasItems ? (
        <Link className="btn cart-checkout" to="/checkout" onClick={onNavigate}>Continue to checkout</Link>
      ) : (
        <>
          <button type="button" className="btn cart-checkout" disabled aria-describedby="cart-closed-note">{view.checkoutOpen ? 'Add an item to check out' : 'Checkout opens at launch'}</button>
          <p id="cart-closed-note" className="cart-closed-note">{view.checkoutOpen ? 'Your bag is empty.' : 'Preview only. Nothing is for sale yet, so no order can be placed.'}</p>
        </>
      )}
    </div>
  );
}
