import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ORDER_STATUSES } from '../../shared/orders';
import type { TrackShipment } from '../../shared/tracking';
import { useNoIndex } from '../lib/auth';
import { day, getOrders, refundLabel, rupees, statusLabel, useOrdersList, when, type OrderDetail, type Fetched } from '../lib/orders';

type Detail = OrderDetail & { shipments: TrackShipment[] };
const FLOW = ORDER_STATUSES.filter((s) => s !== 'cancelled');

/** Orders list and a single order's detail: items, totals, delivery address, shipment tracking and refund status. */
export default function TrackOrder() {
  useNoIndex('Your orders | Kaayra Herbals');
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const [attempt, setAttempt] = useState(0);
  const list = useOrdersList(page, attempt, !id);
  const [detail, setDetail] = useState<Fetched<Detail>>({ kind: 'loading' });

  useEffect(() => {
    if (!id) return;
    let live = true;
    setDetail({ kind: 'loading' });
    const q = encodeURIComponent(id);
    void Promise.all([getOrders<OrderDetail>(`detail?order=${q}`), getOrders<{ shipments: TrackShipment[] }>(`track?order=${q}`)]).then(([d, t]) => {
      if (!live) return;
      if (d.kind !== 'ready') return setDetail(d);
      setDetail({ kind: 'ready', data: { ...d.data, shipments: t.kind === 'ready' ? t.data.shipments : [] } });
    });
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const state = id ? detail : list;
  useEffect(() => {
    if (state.kind === 'signed-out') navigate(`/login?return=${id ? `/track-order/${encodeURIComponent(id)}` : '/track-order'}`, { replace: true });
  }, [state.kind, id, navigate]);

  return (
    <section className="section acc-section track">
      <div className="wrap" aria-live="polite">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/account">Account</Link> <span aria-hidden="true">/</span>{' '}
          {id ? <><Link to="/track-order">Orders</Link> <span aria-hidden="true">/</span> <span aria-current="page">Order</span></> : <span aria-current="page">Orders</span>}
        </nav>
        <h1>{id ? 'Your order' : 'Your orders'}</h1>
        {state.kind === 'loading' && <p role="status" aria-busy="true">Loading…</p>}
        {state.kind === 'error' && (
          <div role="alert" className="acc-card">
            <p>{state.message}</p>
            <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        )}

        {!id && list.kind === 'ready' && (
          <>
            {list.data.items.length === 0 ? (
              <p className="lede">You have no orders yet. <Link className="link-arrow" to="/collection">Shop the collection</Link></p>
            ) : (
              <ul className="order-list order-list--full">
                {list.data.items.map((o) => (
                  <li key={o.id}>
                    <Link to={`/track-order/${o.id}`}>
                      <span className="order-no">{o.order_no}{o.is_test ? ' (test order)' : ''}</span>
                      <span className="order-date">{when(o.created_at)}</span>
                      <span className="pill" data-status={o.status}>{statusLabel(o.status)}</span>
                      {o.order_refunds?.[0] && <span className="pill pill--refund">{refundLabel(o.order_refunds[0].status)}</span>}
                      <span className="order-total">{rupees(o.total_paise)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {list.data.total > list.data.pageSize && (
              <nav className="track__pager" aria-label="Orders pages">
                <button type="button" className="btn btn--ghost" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}>Newer</button>
                <span>Page {page} of {Math.ceil(list.data.total / list.data.pageSize)}</span>
                <button type="button" className="btn btn--ghost" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setParams({ page: String(page + 1) })}>Older</button>
              </nav>
            )}
          </>
        )}

        {id && detail.kind === 'ready' && <OrderView d={detail.data} />}
        <p className="track__support">Questions about an order? <Link to="/contact">Contact us</Link> and quote your order number.</p>
      </div>
    </section>
  );
}

function OrderView({ d }: { d: Detail }) {
  const o = d.order;
  const cancelled = o.status === 'cancelled';
  const at = FLOW.indexOf(o.status as (typeof FLOW)[number]);
  return (
    <div className="ord">
      <header className="ord-head">
        <div>
          <p className="ord-no">{o.order_no}{o.is_test ? ' (test order)' : ''}</p>
          <p className="muted">Placed {when(o.created_at)}</p>
        </div>
        <span className="pill" data-status={o.status}>{statusLabel(o.status)}</span>
      </header>

      {cancelled ? (
        <p className="ord-cancel">This order was cancelled.</p>
      ) : (
        <ol className="stepper" aria-label="Order progress">
          {FLOW.map((s, i) => (
            <li key={s} data-done={i <= at} aria-current={i === at ? 'step' : undefined}><span>{statusLabel(s)}</span></li>
          ))}
        </ol>
      )}

      <div className="ord-grid">
        <section className="acc-card" aria-labelledby="ord-items">
          <h2 id="ord-items">Items</h2>
          <ul className="co-sum-lines">
            {d.items.map((it, i) => (
              <li key={i}><span className="co-sum-name">{it.product_name}<small>{it.pack_size} × {it.qty}</small></span><span>{rupees(it.line_total_paise)}</span></li>
            ))}
          </ul>
          <dl className="co-sum-totals">
            <div><dt>Subtotal</dt><dd>{rupees(o.subtotal_paise)}</dd></div>
            {Number(o.discount_paise ?? 0) > 0 && <div><dt>Coupon {o.coupon_code ?? ''}</dt><dd>−{rupees(o.discount_paise ?? 0)}</dd></div>}
            <div><dt>Delivery</dt><dd>{Number(o.shipping_paise) === 0 ? 'Free' : rupees(o.shipping_paise)}</dd></div>
            <div className="co-sum-grand"><dt>Total</dt><dd>{rupees(o.total_paise)}</dd></div>
          </dl>
        </section>

        <section className="acc-card" aria-labelledby="ord-ship">
          <h2 id="ord-ship">Delivery address</h2>
          <p className="ord-addr"><strong>{o.customer_name}</strong><br />{o.ship_address}<br />PIN {o.ship_pincode}</p>
        </section>

        <section className="acc-card acc-card--wide" aria-labelledby="ord-track">
          <h2 id="ord-track">Shipment tracking</h2>
          {d.shipments.length === 0 && <p className="muted">Your order has not been dispatched yet. Tracking appears here once we hand it to the courier.</p>}
          {d.shipments.map((s) => (
            <div key={s.shipmentNo} className="ship">
              <h3>Shipment {s.shipmentNo}: {s.label}</h3>
              <p className="muted">
                {s.courier ? `Courier: ${s.courier}. ` : ''}
                {s.trackingNo ? `Tracking number: ${s.trackingNo}. ` : ''}
                {s.estimatedDelivery ? `Estimated delivery: ${day(s.estimatedDelivery)}.` : ''}
              </p>
              {s.events.length > 0 && (
                <ol className="track__timeline">
                  {s.events.map((e, i) => (
                    <li key={`${e.at}-${i}`}>
                      <strong>{e.label}</strong> <time dateTime={e.at}>{when(e.at)}</time>
                      {e.location ? ` · ${e.location}` : ''}
                      {e.note ? <div>{e.note}</div> : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </section>

        <section className="acc-card acc-card--wide" aria-labelledby="ord-refund">
          <h2 id="ord-refund">Refund status</h2>
          {d.refunds.length === 0 ? (
            <p className="muted">There is no refund request on this order. If something is wrong, <Link to="/contact">contact us</Link> and quote {o.order_no}.</p>
          ) : (
            <ul className="addr-list">
              {d.refunds.map((r, i) => (
                <li key={i}>
                  <strong>{refundLabel(r.status)} · {rupees(r.amount_paise)}</strong>
                  <span>Requested {day(r.requested_at)}{r.refunded_at ? ` · Refunded ${day(r.refunded_at)}` : r.decided_at ? ` · Decided ${day(r.decided_at)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p><Link className="link-arrow" to="/track-order">Back to all orders</Link></p>
    </div>
  );
}
