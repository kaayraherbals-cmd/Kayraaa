import { formatRupees } from '../../../shared/cart';
import { useCart } from '../../lib/cart';
import type { QuoteView } from '../../lib/checkoutApi';
import { useMedia } from '../../lib/useMedia';

/**
 * The order summary beside (desktop, sticky) or above (mobile, collapsible) the checkout form.
 * Lines come from the server-priced bag; once the server has quoted the order, its delivery charge and total replace "calculated next".
 */
export default function CheckoutSummary({ quote }: { quote: QuoteView | null }) {
  const { status, view } = useCart();
  const wide = useMedia('(min-width: 62rem)');
  const lines = quote ? quote.lines : view.lines;
  if (status !== 'ready' && !quote) return null;
  const subtotal = quote ? quote.totals.subtotalPaise : view.totals.subtotalPaise;
  const gst = quote ? quote.totals.gstIncludedPaise : view.totals.gstIncludedPaise;
  const count = lines.reduce((n, l) => n + l.qty, 0);
  return (
    <aside className="co-aside" aria-label="Order summary">
      <details className="co-sum" open={wide}>
        <summary>
          <span>Order summary <small>({count} {count === 1 ? 'item' : 'items'})</small></span>
          <span className="co-sum-total">{formatRupees(quote ? quote.totals.totalPaise : subtotal - (view.totals.discountPaise ?? 0))}</span>
        </summary>
        <ul className="co-sum-lines">
          {lines.map((l) => (
            <li key={l.variantId}>
              <span className="co-sum-name">{l.productName}<small>{l.packSize} × {l.qty}</small></span>
              <span>{formatRupees(l.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>
        <dl className="co-sum-totals">
          <div><dt>Subtotal</dt><dd>{formatRupees(subtotal)}</dd></div>
          {quote && quote.totals.discountPaise > 0 && <div className="co-sum-discount"><dt>Coupon {quote.coupon?.code ?? ''}</dt><dd>−{formatRupees(quote.totals.discountPaise)}</dd></div>}
          <div><dt>Delivery</dt><dd>{quote ? (quote.totals.shippingPaise === 0 ? 'Free' : formatRupees(quote.totals.shippingPaise)) : 'Calculated once you add your address'}</dd></div>
          <div className="co-sum-grand"><dt>Total</dt><dd>{quote ? formatRupees(quote.totals.totalPaise) : formatRupees(subtotal - (view.totals.discountPaise ?? 0))}</dd></div>
          {gst > 0 && <div className="co-sum-sub"><dt>GST included in prices</dt><dd>{formatRupees(gst)}</dd></div>}
        </dl>
        <p className="co-sum-note">Prices and delivery are confirmed by our server before you pay.</p>
      </details>
    </aside>
  );
}
