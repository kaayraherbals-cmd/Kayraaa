import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BATCH_STATUSES, BATCH_STATUS_LABELS, MOVEMENT_LABELS, expiryState, type Batch, type BatchStatus, type Movement, type StockSummary } from '../../shared/inventory';
import { api, day, errorText, useMe, when } from '../lib/adminKit';

interface VariantStock {
  id: string;
  sku: string;
  pack_size: string;
  price_paise: number | null;
  low_stock_threshold: number;
  status: 'active' | 'inactive';
  products: { slug: string; internal_name: string; public_name: string | null; status: string } | null;
  stock: StockSummary;
  batches: Batch[];
}
interface Inventory {
  today: string;
  minDaysToExpiry: number;
  items: VariantStock[];
}

function Movements({ batchId, onExpired }: { batchId: string; onExpired: () => void }) {
  const [rows, setRows] = useState<Movement[] | null>(null);
  useEffect(() => {
    void api<{ items: Movement[] }>(`movements?batch_id=${batchId}`).then((r) => {
      if (r.status === 401) return onExpired();
      setRows(r.data?.items ?? []);
    });
  }, [batchId, onExpired]);
  if (!rows) return <p role="status">Loading…</p>;
  return (
    <table className="admin-table admin-table--tight">
      <caption className="sr-only">Stock movements</caption>
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">What</th>
          <th scope="col">On hand</th>
          <th scope="col">Reserved</th>
          <th scope="col">Who / why</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <td className="nowrap">{when(m.at)}</td>
            <td>{MOVEMENT_LABELS[m.kind]}</td>
            <td>{m.delta_on_hand ? (m.delta_on_hand > 0 ? `+${m.delta_on_hand}` : m.delta_on_hand) : ''}</td>
            <td>{m.delta_reserved ? (m.delta_reserved > 0 ? `+${m.delta_reserved}` : m.delta_reserved) : ''}</td>
            <td>
              {m.actor}
              {m.reason ? `: ${m.reason}` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BatchRow({ b, today, canWrite, onExpired, onChanged }: { b: Batch; today: string; canWrite: boolean; onExpired: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState<'none' | 'adjust' | 'history'>('none');
  const [msg, setMsg] = useState('');
  const st = expiryState(b.expiry_date, today);

  async function adjust(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const kind = String(f.get('kind'));
    let delta = Number(f.get('delta'));
    if (kind === 'write_off') delta = -Math.abs(delta);
    const r = await api('batch-adjust', { method: 'POST', body: { batch_id: b.id, kind, delta, reason: String(f.get('reason') ?? '') } });
    if (r.status === 401) return onExpired();
    if (!r.ok) return setMsg(errorText(r, 'Could not adjust.'));
    setMsg('');
    setOpen('none');
    onChanged();
  }
  async function setStatus(status: BatchStatus) {
    const r = await api('batch-status', { method: 'POST', body: { batch_id: b.id, status } });
    if (r.status === 401) return onExpired();
    if (!r.ok) setMsg(errorText(r, 'Could not change status.'));
    else setMsg('');
    onChanged();
  }

  return (
    <>
      <tr data-expiry={st} data-status={b.status}>
        <td>{b.batch_no}</td>
        <td>
          {day(b.expiry_date)} {st === 'expired' && <span className="badge badge--bad">Expired</span>}
          {st === 'expiring' && <span className="badge badge--warn">Expiring soon</span>}
        </td>
        <td>{b.qty_on_hand}</td>
        <td>{b.qty_reserved}</td>
        <td>
          {canWrite ? (
            <select aria-label={`Status of batch ${b.batch_no}`} value={b.status} onChange={(e) => void setStatus(e.target.value as BatchStatus)}>
              {BATCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {BATCH_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          ) : (
            BATCH_STATUS_LABELS[b.status]
          )}
        </td>
        <td className="admin-actions">
          {canWrite && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(open === 'adjust' ? 'none' : 'adjust')}>
              Adjust
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(open === 'history' ? 'none' : 'history')}>
            History
          </button>
        </td>
      </tr>
      {(open !== 'none' || msg) && (
        <tr>
          <td colSpan={6}>
            {msg && <p className="form-status form-status--error" role="alert">{msg}</p>}
            {open === 'adjust' && (
              <form className="inline-form" onSubmit={adjust}>
                <label>
                  Type
                  <select name="kind" defaultValue="adjust">
                    <option value="adjust">Correction (+ or −)</option>
                    <option value="write_off">Write-off (damaged, expired, lost)</option>
                  </select>
                </label>
                <label>
                  Units
                  <input name="delta" type="number" step={1} required />
                </label>
                <label>
                  Reason
                  <input name="reason" maxLength={200} required minLength={3} />
                </label>
                <button className="btn btn--sm" type="submit">
                  Save
                </button>
              </form>
            )}
            {open === 'history' && <Movements batchId={b.id} onExpired={onExpired} />}
          </td>
        </tr>
      )}
    </>
  );
}

function ReceiveForm({ variantId, onExpired, onDone }: { variantId: string; onExpired: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError('');
    const r = await api('batches', { method: 'POST', body: { variant_id: variantId, batch_no: String(f.get('batch_no') ?? ''), mfg_date: String(f.get('mfg_date') ?? '') || null, expiry_date: String(f.get('expiry_date') ?? ''), qty: Number(f.get('qty')), note: String(f.get('note') ?? '') || null } });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (!r.ok) return setError(errorText(r, 'Could not receive stock.'));
    form.reset();
    onDone();
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <strong>Receive stock</strong>
      <label>
        Batch number
        <input name="batch_no" required maxLength={40} />
      </label>
      <label>
        Manufactured
        <input name="mfg_date" type="date" />
      </label>
      <label>
        Expiry date
        <input name="expiry_date" type="date" required />
      </label>
      <label>
        Units
        <input name="qty" type="number" min={1} step={1} required />
      </label>
      <label>
        Note
        <input name="note" maxLength={200} />
      </label>
      <button className="btn btn--sm" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Receive'}
      </button>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
    </form>
  );
}

export default function AdminInventory({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const canWrite = me.can('inventory.write');
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention'>('all');

  const load = useCallback(async () => {
    const r = await api<Inventory>('inventory');
    if (r.status === 401) return onExpired();
    if (r.ok && r.data) {
      setInv(r.data);
      setError('');
    } else setError(errorText(r, 'Could not load inventory. Have supabase/variants_gallery.sql and supabase/inventory_orders.sql been run?'));
  }, [onExpired]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="form-status form-status--error" role="alert">{error}</p>;
  if (!inv) return <p role="status">Loading inventory…</p>;

  const needsAttention = (v: VariantStock) => v.status === 'active' && (v.stock.low || v.stock.out || v.stock.expiredUnits > 0 || v.stock.expiringUnits > 0);
  const items = filter === 'attention' ? inv.items.filter(needsAttention) : inv.items;
  const count = (fn: (v: VariantStock) => boolean) => inv.items.filter((v) => v.status === 'active' && fn(v)).length;

  return (
    <section aria-labelledby="inv-title">
      <div className="admin-toolbar">
        <h1 id="inv-title">Inventory</h1>
        <div className="field admin-search">
          <label htmlFor="inv-filter">Show</label>
          <select id="inv-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All pack sizes</option>
            <option value="attention">Needs attention</option>
          </select>
        </div>
      </div>
      <ul className="stat-row" aria-label="Stock alerts">
        <li data-tone={count((v) => v.stock.out) ? 'bad' : 'ok'}><strong>{count((v) => v.stock.out)}</strong> out of stock</li>
        <li data-tone={count((v) => v.stock.low) ? 'warn' : 'ok'}><strong>{count((v) => v.stock.low)}</strong> low</li>
        <li data-tone={count((v) => v.stock.expiringUnits > 0) ? 'warn' : 'ok'}><strong>{count((v) => v.stock.expiringUnits > 0)}</strong> with stock expiring soon</li>
        <li data-tone={count((v) => v.stock.expiredUnits > 0) ? 'bad' : 'ok'}><strong>{count((v) => v.stock.expiredUnits > 0)}</strong> with expired stock</li>
      </ul>
      <p className="field-hint">
        “Available” counts only active, in-date batches with at least {inv.minDaysToExpiry} days of shelf life left, minus units reserved for orders. Expired stock is never offered for sale: write it off. Selling is not enabled yet.
      </p>
      {items.length === 0 && <p>{filter === 'attention' ? 'Nothing needs attention.' : 'No pack sizes yet. Add products and pack sizes in the Products tab.'}</p>}
      <div className="aprods">
        {items.map((v) => (
          <details key={v.id} className="aprod" data-public={false}>
            <summary>
              <span className="aprod-name">
                {v.products?.public_name ?? v.products?.internal_name} · {v.pack_size}
              </span>
              <span className="aprod-meta">
                {v.sku} · {v.stock.available} available · {v.stock.onHand} on hand · {v.stock.reserved} reserved{v.stock.nextExpiry ? ` · next expiry ${day(v.stock.nextExpiry)}` : ''}
              </span>
              {v.status === 'inactive' && <span className="badge">Switched off</span>}
              {v.stock.out && v.status === 'active' && <span className="badge badge--bad">Out</span>}
              {v.stock.low && <span className="badge badge--warn">Low</span>}
              {v.stock.expiredUnits > 0 && <span className="badge badge--bad">{v.stock.expiredUnits} expired</span>}
              {v.stock.expiringUnits > 0 && <span className="badge badge--warn">{v.stock.expiringUnits} expiring</span>}
            </summary>
            <div className="aprod-body">
              {v.batches.length === 0 ? (
                <p>No batches yet.</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table--tight">
                    <caption className="sr-only">Batches of {v.pack_size}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Batch</th>
                        <th scope="col">Expiry</th>
                        <th scope="col">On hand</th>
                        <th scope="col">Reserved</th>
                        <th scope="col">Status</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.batches.map((b) => (
                        <BatchRow key={b.id} b={b} today={inv.today} canWrite={canWrite} onExpired={onExpired} onChanged={() => void load()} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {canWrite && <ReceiveForm variantId={v.id} onExpired={onExpired} onDone={() => void load()} />}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
