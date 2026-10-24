import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatInr, type Order, type OrderItem } from '../../shared/orders';
import {
  EXCEPTION_KINDS, EXCEPTION_LABELS, SHIPMENT_LABELS, SHIPMENT_STATUSES, nextStatuses, remainingToShip,
  type DeliveryExceptionRow, type ShipmentEventRow, type ShipmentRow, type ShipmentStatus,
} from '../../shared/shipments';
import { ConfirmDialog, Pager, api, day, errorText, useMe, usePaged, when } from '../lib/adminKit';

const BADGE = (s: ShipmentStatus): string => (s === 'delivered' ? 'badge' : s === 'delivery_failed' || s === 'return_to_origin' ? 'badge badge--bad' : s === 'cancelled' || s === 'returned' ? 'badge' : 'badge badge--warn');
const units = (s: ShipmentRow): number => s.shipment_items.reduce((n, i) => n + i.qty, 0);

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'detail'; id: string };

/* ---------------------------------------------------------------- Detail ---------------------------------------------------------------- */

interface Detail {
  shipment: ShipmentRow;
  events: ShipmentEventRow[];
  exceptions: DeliveryExceptionRow[];
}

function ShipmentDetail({ id, onExpired, onBack }: { id: string; onExpired: () => void; onBack: () => void }) {
  const me = useMe();
  const canWrite = me.can('shipments.write');
  const [d, setD] = useState<Detail | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [target, setTarget] = useState<ShipmentStatus | null>(null);
  const [form, setForm] = useState<FormData | null>(null);
  const [resolving, setResolving] = useState<DeliveryExceptionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Detail>(`shipment?id=${id}`);
    if (r.status === 401) return onExpired();
    if (!r.ok || !r.data) return setError(errorText(r, 'Could not load the shipment.'));
    setError('');
    setD(r.data);
    if (me.can('orders.read')) {
      const o = await api<{ order: Order; items: OrderItem[] }>(`order?id=${r.data.shipment.order_id}`);
      if (o.ok && o.data) setNames(Object.fromEntries(o.data.items.map((i) => [i.id, `${i.product_name} (${i.pack_size})`])));
    }
  }, [id, onExpired, me]);
  useEffect(() => {
    void load();
  }, [load]);

  async function submitStatus() {
    if (!target || !form) return;
    setBusy(true);
    const res = await api('shipment-status', {
      method: 'POST',
      body: {
        shipment_id: id, status: target, courier: String(form.get('courier') ?? ''), tracking_no: String(form.get('tracking_no') ?? ''),
        estimated_delivery: String(form.get('estimated_delivery') ?? ''), exception: String(form.get('exception') ?? ''),
        location: String(form.get('location') ?? ''), note: String(form.get('note') ?? ''), visible: form.get('visible') === 'on',
      },
    });
    setBusy(false);
    setForm(null);
    if (res.status === 401) return onExpired();
    if (!res.ok) return setError(errorText(res, 'Could not update the shipment.'));
    setError('');
    setTarget(null);
    await load();
  }
  async function addNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    const f = new FormData(el);
    const res = await api('shipment-note', { method: 'POST', body: { shipment_id: id, note: String(f.get('note') ?? ''), visible: f.get('visible') === 'on' } });
    if (res.status === 401) return onExpired();
    if (!res.ok) return setError(errorText(res, 'Could not add the note.'));
    setError('');
    el.reset();
    await load();
  }
  async function resolve() {
    if (!resolving) return;
    setBusy(true);
    const res = await api('delivery-exception-resolve', { method: 'POST', body: { exception_id: resolving.id } });
    setBusy(false);
    setResolving(null);
    if (res.status === 401) return onExpired();
    if (!res.ok) return setError(errorText(res, 'Could not resolve the exception.'));
    setError('');
    await load();
  }

  if (!d) {
    return (
      <section>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>All shipments</button>
        {error ? <p className="form-status form-status--error" role="alert">{error}</p> : <p role="status">Loading…</p>}
      </section>
    );
  }
  const s = d.shipment;
  const next = nextStatuses(s.status);
  const openEx = d.exceptions.filter((x) => !x.resolved_at);
  const needsFields = target === 'dispatched';
  return (
    <section aria-labelledby="ship-title">
      <div className="admin-toolbar">
        <h1 id="ship-title">{s.shipment_no}</h1>
        <span className={BADGE(s.status)}>{SHIPMENT_LABELS[s.status]}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>All shipments</button>
      </div>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}

      <div className="ship-grid">
        <dl className="ship-meta">
          <dt>Order</dt><dd>{s.orders ? `${s.orders.order_no} · ${s.orders.customer_name}` : s.order_id}</dd>
          <dt>Pincode</dt><dd>{s.orders?.ship_pincode ?? '—'}</dd>
          <dt>Courier</dt><dd>{s.courier ?? 'Not set until dispatch'}</dd>
          <dt>Tracking number</dt><dd>{s.tracking_no ?? 'Not set until dispatch'}</dd>
          <dt>Estimated delivery</dt><dd>{s.estimated_delivery ? day(s.estimated_delivery) : 'Not given'}</dd>
          {s.delivered_at && (<><dt>Delivered</dt><dd>{when(s.delivered_at)}</dd></>)}
        </dl>
        <div>
          <h2 className="admin-subhead">Contents</h2>
          <ul>
            {s.shipment_items.map((i) => (
              <li key={i.order_item_id}>{i.qty} × {names[i.order_item_id] ?? 'order line'}</li>
            ))}
          </ul>
        </div>
      </div>

      {openEx.length > 0 && (
        <>
          <h2 className="admin-subhead">Open delivery problems</h2>
          <ul className="admin-messages">
            {openEx.map((x) => (
              <li key={x.id} className="admin-message" data-status="exception">
                <div className="admin-message-head">
                  <strong>{EXCEPTION_LABELS[x.kind]}</strong>
                  <time dateTime={x.opened_at}>{when(x.opened_at)}</time>
                </div>
                {x.note && <p className="admin-message-body">{x.note}</p>}
                <p className="field-hint">Opened by {x.opened_by}</p>
                {canWrite && (
                  <div className="admin-actions">
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setResolving(x)}>Mark resolved</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {canWrite && next.length > 0 && (
        <>
          <h2 className="admin-subhead">Update status</h2>
          <div className="admin-actions">
            {next.map((st) => (
              <button key={st} type="button" className="btn btn--ghost btn--sm" aria-pressed={target === st} onClick={() => setTarget(target === st ? null : st)}>
                {SHIPMENT_LABELS[st]}
              </button>
            ))}
          </div>
          {target && (
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); setForm(new FormData(e.currentTarget)); }}>
              {needsFields && (
                <>
                  <label>Courier<input name="courier" required maxLength={60} /></label>
                  <label>Tracking number<input name="tracking_no" required maxLength={60} /></label>
                </>
              )}
              {target === 'delivery_failed' && (
                <label>Why did it fail?
                  <select name="exception" required defaultValue="">
                    <option value="" disabled>Choose a reason</option>
                    {EXCEPTION_KINDS.map((k) => (<option key={k} value={k}>{EXCEPTION_LABELS[k]}</option>))}
                  </select>
                </label>
              )}
              {(target === 'dispatched' || target === 'in_transit' || target === 'out_for_delivery') && (
                <label>Estimated delivery (optional)<input name="estimated_delivery" type="date" /></label>
              )}
              <label>Location (optional)<input name="location" maxLength={120} /></label>
              <label>Note (optional)<input name="note" maxLength={500} /></label>
              <label className="check"><input type="checkbox" name="visible" defaultChecked /> Show this update to the customer</label>
              <button className="btn btn--sm" type="submit">Review change</button>
              <p className="field-hint">Only enter what you have actually been told by the courier. Nothing is filled in automatically.</p>
            </form>
          )}
        </>
      )}

      <h2 className="admin-subhead">History</h2>
      <ol className="ship-timeline">
        {d.events.map((ev) => (
          <li key={ev.id} data-internal={!ev.visible}>
            <strong>{ev.kind === 'created' ? 'Shipment created' : ev.kind === 'note' ? 'Note' : `${ev.from_status ? SHIPMENT_LABELS[ev.from_status] : '—'} → ${ev.to_status ? SHIPMENT_LABELS[ev.to_status] : '—'}`}</strong>
            {!ev.visible && <span className="field-hint"> · internal only</span>}
            <time dateTime={ev.occurred_at}>{when(ev.occurred_at)} · {ev.actor}</time>
            {ev.location && <div>{ev.location}</div>}
            {ev.note && <div>{ev.note}</div>}
          </li>
        ))}
      </ol>

      {canWrite && (
        <form className="inline-form" onSubmit={(e) => void addNote(e)}>
          <label>Add a note<input name="note" required maxLength={500} /></label>
          <label className="check"><input type="checkbox" name="visible" /> Show to the customer</label>
          <button className="btn btn--ghost btn--sm" type="submit">Add note</button>
        </form>
      )}

      <ConfirmDialog
        open={form !== null && target !== null}
        title={`Change to ${target ? SHIPMENT_LABELS[target] : ''}?`}
        confirmLabel="Confirm change"
        danger={target === 'cancelled' || target === 'delivery_failed' || target === 'return_to_origin'}
        busy={busy}
        onConfirm={() => void submitStatus()}
        onCancel={() => setForm(null)}
      >
        <p>{s.shipment_no} will move from {SHIPMENT_LABELS[s.status]} to {target ? SHIPMENT_LABELS[target] : ''}. {target === 'dispatched' ? 'Dispatching can move the order to Shipped and take stock off the shelf. ' : ''}{form?.get('visible') === 'on' ? 'The customer may be emailed. ' : ''}This is recorded in the activity log and cannot be undone.</p>
      </ConfirmDialog>
      <ConfirmDialog open={resolving !== null} title="Mark this problem resolved?" confirmLabel="Mark resolved" busy={busy} onConfirm={() => void resolve()} onCancel={() => setResolving(null)}>
        <p>{resolving ? EXCEPTION_LABELS[resolving.kind] : ''}. Only do this once the problem has actually been dealt with.</p>
      </ConfirmDialog>
    </section>
  );
}

/* ---------------------------------------------------------------- Create ---------------------------------------------------------------- */

function CreateShipment({ onExpired, onDone, onBack }: { onExpired: () => void; onDone: (id: string) => void; onBack: () => void }) {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setApplied(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const { data, error: listError, loading } = usePaged<Order>(`orders?status=packed${applied ? `&q=${encodeURIComponent(applied)}` : ''}`, onExpired);
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<OrderItem[]>([]);
  const [left, setLeft] = useState<Record<string, number>>({});
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pick(o: Order) {
    const [det, sh] = await Promise.all([api<{ items: OrderItem[] }>(`order?id=${o.id}`), api<{ items: ShipmentRow[] }>(`shipments?order_id=${o.id}`)]);
    if (det.status === 401 || sh.status === 401) return onExpired();
    if (!det.ok || !det.data || !sh.ok || !sh.data) return setError(errorText(det.ok ? sh : det, 'Could not load the order.'));
    const rem = remainingToShip(det.data.items, sh.data.items);
    setOrder(o);
    setLines(det.data.items);
    setLeft(rem);
    setQty(Object.fromEntries(det.data.items.map((i) => [i.id, rem[i.id] ?? 0])));
    setError('');
  }
  const chosen = lines.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({ order_item_id: l.id, qty: qty[l.id] }));
  async function create() {
    if (!order) return;
    setBusy(true);
    const res = await api<{ id: string }>('shipment-create', { method: 'POST', body: { order_id: order.id, items: chosen } });
    setBusy(false);
    setConfirm(false);
    if (res.status === 401) return onExpired();
    if (!res.ok || !res.data) return setError(errorText(res, 'Could not create the shipment.'));
    onDone(res.data.id);
  }

  return (
    <section aria-labelledby="create-title">
      <div className="admin-toolbar">
        <h1 id="create-title">Create a shipment</h1>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>Cancel</button>
      </div>
      <p className="field-hint">Shipments can be made for packed orders. Split an order into several shipments by choosing fewer units; the rest stay available.</p>
      {(error || listError) && <p className="form-status form-status--error" role="alert">{error || listError}</p>}
      {!order && (
        <>
          <div className="field admin-search">
            <label htmlFor="ship-order-q">Find a packed order</label>
            <input id="ship-order-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number, name or phone" />
          </div>
          {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
          {data && data.items.length === 0 && <p>No packed orders{applied ? ' match' : ' right now'}.</p>}
          <ul className="admin-messages">
            {data?.items.map((o) => (
              <li key={o.id} className="admin-message">
                <div className="admin-message-head">
                  <strong>{o.order_no}</strong><span>{o.customer_name}</span><span>{formatInr(o.total_paise)}</span>
                </div>
                <div className="admin-actions"><button type="button" className="btn btn--sm" onClick={() => void pick(o)}>Choose</button></div>
              </li>
            ))}
          </ul>
        </>
      )}
      {order && (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (chosen.length) setConfirm(true); else setError('Choose at least one unit to ship.'); }}>
          <p><strong>{order.order_no}</strong> · {order.customer_name}</p>
          {lines.map((l) => (
            <label key={l.id}>
              {l.product_name} ({l.pack_size}) — {left[l.id] ?? 0} left to ship
              <input className="ship-qty" type="number" min={0} max={left[l.id] ?? 0} step={1} disabled={(left[l.id] ?? 0) === 0} value={qty[l.id] ?? 0}
                onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(left[l.id] ?? 0, Math.floor(Number(e.target.value) || 0))) })} />
            </label>
          ))}
          <button className="btn btn--sm" type="submit">Review shipment</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOrder(null)}>Choose a different order</button>
        </form>
      )}
      <ConfirmDialog open={confirm} title="Create this shipment?" confirmLabel="Create shipment" busy={busy} onConfirm={() => void create()} onCancel={() => setConfirm(false)}>
        <p>{chosen.reduce((n, c) => n + c.qty, 0)} unit(s) from {order?.order_no} will be put on a new shipment in the Preparing state. Courier and tracking are added when you dispatch it.</p>
      </ConfirmDialog>
    </section>
  );
}

/* ---------------------------------------------------------------- Dashboard ---------------------------------------------------------------- */

function Dashboard({ onExpired, open, create }: { onExpired: () => void; open: (id: string) => void; create: () => void }) {
  const me = useMe();
  const [status, setStatus] = useState<'all' | ShipmentStatus>('all');
  const { page, setPage, data, error, loading } = usePaged<ShipmentRow>(`shipments${status === 'all' ? '' : `?status=${status}`}`, onExpired);
  const [ex, setEx] = useState<DeliveryExceptionRow[]>([]);
  useEffect(() => {
    void (async () => {
      const r = await api<{ items: DeliveryExceptionRow[] }>('delivery-exceptions');
      if (r.status === 401) return onExpired();
      if (r.ok && r.data) setEx(r.data.items);
    })();
  }, [onExpired]);
  return (
    <section aria-labelledby="ships-title">
      <div className="admin-toolbar">
        <h1 id="ships-title">Shipments</h1>
        <div className="field admin-search">
          <label htmlFor="ship-status">Show</label>
          <select id="ship-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All</option>
            {SHIPMENT_STATUSES.map((s) => (<option key={s} value={s}>{SHIPMENT_LABELS[s]}</option>))}
          </select>
        </div>
        {me.can('shipments.write') && <button type="button" className="btn btn--sm" onClick={create}>Create shipment</button>}
      </div>
      <p className="field-hint">Shipments are updated by hand from what the courier tells you. No courier service is connected.</p>
      {ex.length > 0 && (
        <>
          <h2 className="admin-subhead">Delivery problems needing attention ({ex.length})</h2>
          <ul className="admin-messages">
            {ex.map((x) => (
              <li key={x.id} className="admin-message" data-status="exception">
                <div className="admin-message-head">
                  <strong>{x.shipments?.shipment_no ?? 'Shipment'}</strong><span>{EXCEPTION_LABELS[x.kind]}</span>
                  <time dateTime={x.opened_at}>{when(x.opened_at)}</time>
                </div>
                <div className="admin-actions"><button type="button" className="btn btn--ghost btn--sm" onClick={() => open(x.shipment_id)}>Open</button></div>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          {data.items.length === 0 && <p>No shipments {status === 'all' ? 'yet' : 'in this state'}.</p>}
          <ul className="admin-messages">
            {data.items.map((s) => (
              <li key={s.id} className="admin-message">
                <div className="admin-message-head">
                  <strong>{s.shipment_no}</strong>
                  {s.orders && <span>{s.orders.order_no} · {s.orders.customer_name}</span>}
                  <span className={BADGE(s.status)}>{SHIPMENT_LABELS[s.status]}</span>
                  <time dateTime={s.created_at}>{when(s.created_at)}</time>
                </div>
                <p className="field-hint">
                  {units(s)} unit(s){s.courier && s.tracking_no ? ` · ${s.courier} ${s.tracking_no}` : ''}{s.estimated_delivery ? ` · expected ${day(s.estimated_delivery)}` : ''}
                </p>
                <div className="admin-actions"><button type="button" className="btn btn--ghost btn--sm" onClick={() => open(s.id)}>Open</button></div>
              </li>
            ))}
          </ul>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </section>
  );
}

export default function AdminShipments({ onExpired }: { onExpired: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  if (view.kind === 'create') return <CreateShipment onExpired={onExpired} onBack={() => setView({ kind: 'list' })} onDone={(id) => setView({ kind: 'detail', id })} />;
  if (view.kind === 'detail') return <ShipmentDetail id={view.id} onExpired={onExpired} onBack={() => setView({ kind: 'list' })} />;
  return <Dashboard onExpired={onExpired} open={(id) => setView({ kind: 'detail', id })} create={() => setView({ kind: 'create' })} />;
}
