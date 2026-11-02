import { formatRupees } from '../../../shared/cart';
import type { QuoteView } from '../../lib/checkoutApi';
import ShippingMethod from './ShippingMethod';

/** The order exactly as the server priced it. Nothing here is computed in the browser. */
export default function OrderReview({ quote }: { quote: QuoteView }) {
  const t = quote.totals;
  return (
    <section className="co-review" aria-labelledby="co-review-h">
      <h2 id="co-review-h" className="co-legend">Review your order</h2>
      <ul className="co-lines">
        {quote.lines.map((l) => (
          <li key={l.variantId}>
            <span>{l.productName} <small>{l.packSize} × {l.qty}</small></span>
            <span>{formatRupees(l.lineTotalPaise)}</span>
          </li>
        ))}
      </ul>
      <ShippingMethod label={quote.shipping.label} paise={quote.shipping.paise} />
      <dl className="co-totals">
        <div><dt>Subtotal</dt><dd>{formatRupees(t.subtotalPaise)}</dd></div>
        {t.discountPaise > 0 && <div className="co-discount"><dt>Coupon {quote.coupon?.code ?? ''}</dt><dd>−{formatRupees(t.discountPaise)}</dd></div>}
        <div><dt>Delivery</dt><dd>{t.shippingPaise === 0 ? 'Free' : formatRupees(t.shippingPaise)}</dd></div>
        <div className="co-total"><dt>Total</dt><dd>{formatRupees(t.totalPaise)}</dd></div>
        {t.gstIncludedPaise > 0 && <div className="co-sub"><dt>GST included in prices</dt><dd>{formatRupees(t.gstIncludedPaise)}</dd></div>}
      </dl>
    </section>
  );
}
