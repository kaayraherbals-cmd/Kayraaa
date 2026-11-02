import { Link } from 'react-router-dom';
import { formatRupees } from '../../../shared/cart';
import type { PlacedOrderView } from '../../lib/checkoutApi';

/** `paid` is true only when the server has verified the payment. Otherwise the order is unpaid and the page says so. */
export default function OrderConfirmation({ order, replay, paid = false }: { order: PlacedOrderView; replay: boolean; paid?: boolean }) {
  return (
    <section className="co-done" aria-labelledby="co-done-h" tabIndex={-1} id="co-done">
      <h1 id="co-done-h">{paid ? (order.isTest ? 'Test payment received' : 'Payment received') : order.isTest ? 'Test order created' : 'Order created'}</h1>
      <p className="lede">
        {paid ? (
          <>Order <strong>{order.orderNo}</strong> for {formatRupees(order.totalPaise)} is paid. A confirmation email follows once email sending is switched on.</>
        ) : (
          <>Order <strong>{order.orderNo}</strong> for {formatRupees(order.totalPaise)} is waiting for payment. {replay ? 'You already had this order open, so we showed it again instead of making a second one.' : ''}</>
        )}
      </p>
      {order.isTest && <p className="co-note">This is a test order. {paid ? 'No real money moved and nothing will be shipped.' : 'Nothing was charged and nothing will be shipped.'}</p>}
      <p className="co-done-links">
        <Link className="btn" to={`/track-order/${order.id}`}>View order and tracking</Link>
        <Link className="link-arrow" to="/collection">Continue shopping</Link>
      </p>
    </section>
  );
}
