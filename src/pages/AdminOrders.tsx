import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, formatInr, nextStatuses, type Order, type OrderAllocation, type OrderEvent, type OrderItem, type OrderStatus } from '../../shared/orders';
import { OrderRefunds } from './AdminRefunds';
import { Loading, Pager, api, day, errorText, useMe, usePaged, when } from '../lib/adminKit';

interface Detail {
  order: Order;
  items: (OrderItem & { order_allocations: OrderAllocation[] })[];
  events: OrderEvent[];
}

function OrderDetail({ id, onExpired, onChanged }: { id: string; onExpired: () => void; onChanged: () => void }) {
  const me = useMe();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<OrderStatus | null>(null);

  const load = useCallback(async () => {
    const r = await api<Detail>(`order?id=${id}`);
    if (r.status === 401) return onExpired();
    if (r.ok && r.data) setD(r.data);
    else setError(errorText(r, 'Could not load the order.'));
  }, [id, onExpired]);
  useEffect(() => {
    void load();
  }, [load]);

  async function move(e: FormEvent<HTMLFormElement>, status: OrderStatus) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await api('order-status', { method: 'POST', body: { order_id: id, status, courier: String(f.get('courier') ?? ''), tracking_no: String(f.get('tracking_no') ?? ''), reason: String(f.get('reason') ?? '') } });
    if (r.status === 401) return onExpired();
    if (!r.ok) return setError(errorText(r, 'Could not change the status.'));
    setError('');
    setPending(null);
    await load();
    onChanged();
  }
  async function note(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const r = await api('order-note', { method: 'POST', body: { order_id: id, note: String(new FormData(form).get('note') ?? '') } });
    if (r.status === 401) return onExpired();
    if (!r.ok) return setError(errorText(r, 'Could not add the note.'));
    form.reset();
    setError('');
    await load();
  }

  if (!d) return error ? <p className="form-status form-status--error" role="alert">{error}</p> : <Loading />;
  const o = d.order;
  return (
    <div className="aprod-body">
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      <p>
        {o.customer_name}
        {o.customer_email ? ` · ${o.customer_email}` : ''}
        {o.customer_phone ? ` · ${o.customer_phone}` : ''}
        <br />
        {o.ship_address}, {o.ship_pincode}
        {o.tracking_no && (
          <>
            <br />
            Shipped with {o.courier}, tracking <code>{o.tracking_no}</code>
          </>
        )}
        {o.cancel_reason && (
          <>
            <br />
            Cancelled: {o.cancel_reason}
          </>
        )}
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--tight">
          <caption className="sr-only">Items</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
              <th scope="col">Batches</th>
              <th scope="col">Line</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.product_name} · {i.pack_size} <span className="muted">({i.sku})</span>
                </td>
                <td>{i.qty}</td>
                <td>{formatInr(i.unit_price_paise)}</td>
                <td>{i.order_allocations.map((a) => `${a.batch_no} ×${a.qty} (exp ${day(a.expiry_date)})`).join(', ')}</td>
                <td>{formatInr(i.line_total_paise)}</td>
              </tr>
            ))}
            {Number(o.discount_paise ?? 0) > 0 && (
              <tr>
                <td colSpan={4}>Coupon {o.coupon_code ?? ''} (already taken off the lines above, shown per line in the refund helper)</td>
                <td>−{formatInr(Number(o.discount_paise))}</td>
              </tr>
            )}
            <tr>
              <td colSpan={4}>Shipping</td>
              <td>{formatInr(o.shipping_paise)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={4}>
                Total (MRP, taxes included)
              </th>
              <td>
                <strong>{formatInr(o.total_paise)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {me.can('orders.write') && nextStatuses(o.status).length > 0 && (
        <div className="admin-actions">
          {/* KH6-013: an online order becomes paid only when Razorpay confirms the payment, so there is no button for it. */}
          {o.channel === 'online' && o.status === 'placed' && <p className="muted">Marked paid automatically when Razorpay confirms the payment.</p>}
          {nextStatuses(o.status).filter((s) => !(s === 'paid' && o.channel === 'online')).map((s) => (
            <button key={s} type="button" className={`btn btn--sm ${s === 'cancelled' ? 'btn--ghost btn--danger' : ''}`} onClick={() => setPending(pending === s ? null : s)}>
              {s === 'cancelled' ? 'Cancel order' : `Mark ${ORDER_STATUS_LABELS[s].toLowerCase()}`}
            </button>
          ))}
        </div>
      )}
      {pending && (
        <form className="inline-form" onSubmit={(e) => void move(e, pending)}>
          {pending === 'shipped' && (
            <>
              <label>
                Courier
                <input name="courier" required maxLength={60} />
              </label>
              <label>
                Tracking number
                <input name="tracking_no" required maxLength={60} />
              </label>
            </>
          )}
          {pending === 'cancelled' && (
            <label>
              Reason
              <input name="reason" required minLength={3} maxLength={200} />
            </label>
          )}
          <button className="btn btn--sm" type="submit">
            Confirm {ORDER_STATUS_LABELS[pending].toLowerCase()}
          </button>
        </form>
      )}

      <OrderRefunds orderId={id} onExpired={onExpired} />

      <h3 className="admin-subhead">Timeline</h3>
      <ul className="timeline">
        {d.events.map((e) => (
          <li key={e.id}>
            <time dateTime={e.at}>{when(e.at)}</time> · {e.actor} ·{' '}
            {e.kind === 'status' ? `${e.from_status ? ORDER_STATUS_LABELS[e.from_status] : ''} → ${e.to_status ? ORDER_STATUS_LABELS[e.to_status] : ''}` : e.kind === 'created' ? 'Order created' : 'Note'}
            {e.note ? `: ${e.note}` : ''}
          </li>
        ))}
      </ul>
      {me.can('orders.note') && (
        <form className="inline-form" onSubmit={note}>
          <label>
            Add an internal note
            <input name="note" required minLength={2} maxLength={1000} />
          </label>
          <button className="btn btn--ghost btn--sm" type="submit">
            Add note
          </button>
        </form>
      )}
    </div>
  );
}

/** One order in the list. Its detail (and the request behind it) is only mounted once the row has been opened. */
function OrderRow({ order: o, onExpired, onChanged }: { order: Order; onExpired: () => void; onChanged: () => void }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="aprod aprod--row" onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}>
      <summary>
        <span className="aprod-title">
          <span className="aprod-name">{o.order_no}</span>
          <span className="aprod-meta">
            {o.customer_name} · {formatInr(o.total_paise)} · {when(o.created_at).replace(/ (am|pm)$/i, '\u00a0$1')}
          </span>
        </span>
        <span className="badge" data-order-status={o.status}>
          {ORDER_STATUS_LABELS[o.status]}
        </span>
      </summary>
      {opened && <OrderDetail id={o.id} onExpired={onExpired} onChanged={onChanged} />}
    </details>
  );
}

export default function AdminOrders({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [status, setStatus] = useState<'all' | OrderStatus>('all');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { page, setPage, data, error, loading, reload } = usePaged<Order>(`orders?status=${status}${term ? `&q=${encodeURIComponent(term)}` : ''}`, onExpired);

  return (
    <section aria-labelledby="orders-title">
      <div className="admin-toolbar">
        <h1 id="orders-title">Orders</h1>
        <form
          className="admin-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
          }}
        >
          <div className="field admin-search">
            <label htmlFor="ord-status">Show</label>
            <select id="ord-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="all">All</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field admin-search">
            <label htmlFor="ord-q">Search order, name, email, phone or tracking</label>
            <input id="ord-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
          </div>
        </form>
        {me.can('orders.export') && (
          <a className="btn btn--ghost btn--sm" href="/api/admin/orders-export">
            Export CSV
          </a>
        )}
      </div>
      {!me.commerceEnabled && (
        <div className="notice" role="status">
          <strong>Selling is not enabled, so orders cannot be created yet.</strong> This screen is ready for when it is: reserving stock from the earliest-expiring batch, the status ladder (placed, paid, packed, shipped, delivered), cancellation, notes and export. Turning selling on needs written business approval (see docs/ECOMMERCE_ARCHITECTURE.md).
        </div>
      )}
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          {data.items.length === 0 && <p>No orders {term || status !== 'all' ? 'match' : 'yet'}.</p>}
          <div className="aprods">
            {data.items.map((o) => (
              <OrderRow key={o.id} order={o} onExpired={onExpired} onChanged={() => void reload()} />
            ))}
          </div>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </section>
  );
}
