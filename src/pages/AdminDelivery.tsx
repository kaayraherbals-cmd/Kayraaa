import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { MAX_BULK_PINS, MAX_LABEL, isFreeAbovePaise, isRatePaise, parseBulk, rupeesToPaiseOrZero, type DeliveryAreaRow } from '../../shared/deliveryAreas';
import { isValidPin } from '../../shared/checkout';
import { formatInr } from '../../shared/orders';
import { paiseToRupees } from '../../shared/products';
import { ConfirmDialog, Pager, api, errorText, useMe, usePaged, when, type Listing } from '../lib/adminKit';

type Data = Listing<DeliveryAreaRow> & { counts?: { on: number; off: number } };
type Filter = 'all' | 'on' | 'off';

/** Rupee text from a form field to paise. The charge is required (₹0 is allowed); the free-delivery amount may be empty (never free). */
function readMoney(text: string, kind: 'charge' | 'free'): { ok: true; value: number | null } | { ok: false; message: string } {
  const p = rupeesToPaiseOrZero(text);
  if (!p.ok) return { ok: false, message: kind === 'charge' ? 'Enter the delivery charge in rupees, for example 60.' : 'Enter the free-delivery amount in rupees, or leave it empty.' };
  if (kind === 'charge') return p.value !== null && isRatePaise(p.value) ? { ok: true, value: p.value } : { ok: false, message: 'Delivery charge must be between ₹0 and ₹10,000.' };
  return isFreeAbovePaise(p.value) ? { ok: true, value: p.value } : { ok: false, message: 'Free-delivery amount must be above ₹0, or empty for never free.' };
}

export default function AdminDelivery({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const canWrite = me.can('delivery.write');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setApplied(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const params = [filter === 'all' ? '' : `status=${filter}`, applied ? `q=${encodeURIComponent(applied)}` : ''].filter(Boolean).join('&');
  const paged = usePaged<DeliveryAreaRow>(`delivery-areas${params ? `?${params}` : ''}`, onExpired);
  const { page, setPage, error, loading, reload } = paged;
  const data = paged.data as Data | null;

  async function send(path: string, method: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true);
    setNotice('');
    setProblem('');
    const r = await api(path, { method, body });
    setBusy(false);
    if (r.status === 401) {
      onExpired();
      return false;
    }
    if (!r.ok) {
      setProblem(errorText(r, 'Could not save the change.'));
      return false;
    }
    setNotice(done);
    void reload();
    return true;
  }

  const toggle = (a: DeliveryAreaRow) => void send(`delivery-area?pincode=${a.pincode}`, 'PATCH', { active: !a.active }, `${a.pincode} is now ${a.active ? 'off: customers cannot order to it' : 'on'}.`);

  return (
    <section aria-labelledby="del-title">
      <div className="admin-toolbar">
        <h1 id="del-title">Delivery areas</h1>
        <div className="field admin-search">
          <label htmlFor="del-q">Search PIN, city or state</label>
          <input id="del-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
        </div>
        <a className="btn btn--ghost btn--sm" href="/api/admin/delivery-areas-export">Export CSV</a>
      </div>
      <p className="field-hint">
        Customers can only order to a PIN code that is listed here and switched on. Prices include any tax. Turning a PIN code off keeps its settings; nothing is deleted.
        {!canWrite && ' You can look at this list but not change it.'}
      </p>
      <div className="aprod-chips" role="group" aria-label="Show">
        {([['all', 'All', (data?.counts?.on ?? 0) + (data?.counts?.off ?? 0)], ['on', 'On', data?.counts?.on ?? 0], ['off', 'Off', data?.counts?.off ?? 0]] as const).map(([id, label, n]) => (
          <button key={id} type="button" className="aprod-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
            <span className="aprod-chip-n">{data?.counts ? n : ''}</span>
          </button>
        ))}
      </div>
      {notice && <p className="form-status form-status--info" role="status">{notice}</p>}
      {problem && <p className="form-status form-status--error" role="alert">{problem}</p>}
      {canWrite && <AddOne busy={busy} send={send} />}
      {canWrite && <BulkPaste busy={busy} send={send} />}
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          {data.items.length === 0 ? (
            <p className="muted">{data.counts && data.counts.on + data.counts.off === 0 ? 'No delivery areas yet. Until you add one, nobody can place an order.' : 'No PIN codes match.'}</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Delivery areas</caption>
                <thead>
                  <tr>
                    <th scope="col">PIN code</th>
                    <th scope="col">City, state</th>
                    <th scope="col">Charge</th>
                    <th scope="col">Free above</th>
                    <th scope="col">Status</th>
                    <th scope="col">Changed</th>
                    {canWrite && <th scope="col"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) =>
                    editing === a.pincode ? (
                      <EditRow key={a.pincode} area={a} busy={busy} onCancel={() => setEditing(null)} onSave={async (body) => {
                        if (await send(`delivery-area?pincode=${a.pincode}`, 'PATCH', body, `${a.pincode} saved.`)) setEditing(null);
                      }} />
                    ) : (
                      <tr key={a.pincode}>
                        <td><strong>{a.pincode}</strong></td>
                        <td>{[a.city, a.state].filter(Boolean).join(', ') || <span className="muted">No label</span>}</td>
                        <td>{a.rate_paise === 0 ? 'Free' : formatInr(a.rate_paise)}</td>
                        <td>{a.free_above_paise === null ? <span className="muted">Never</span> : formatInr(a.free_above_paise)}</td>
                        <td><span className={a.active ? 'badge' : 'badge badge--warn'}>{a.active ? 'On' : 'Off'}</span></td>
                        <td>{when(a.updated_at)}</td>
                        {canWrite && (
                          <td>
                            <div className="admin-actions">
                              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setEditing(a.pincode)}>Edit</button>
                              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} aria-label={`${a.active ? 'Turn off' : 'Turn on'} ${a.pincode}`} onClick={() => toggle(a)}>{a.active ? 'Turn off' : 'Turn on'}</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </section>
  );
}

type Send = (path: string, method: string, body: unknown, done: string) => Promise<boolean>;

function EditRow({ area, busy, onSave, onCancel }: { area: DeliveryAreaRow; busy: boolean; onSave: (body: Record<string, unknown>) => void; onCancel: () => void }) {
  const [city, setCity] = useState(area.city ?? '');
  const [state, setState] = useState(area.state ?? '');
  const [rate, setRate] = useState(paiseToRupees(area.rate_paise) || '0');
  const [free, setFree] = useState(paiseToRupees(area.free_above_paise));
  const [msg, setMsg] = useState('');
  function save() {
    const r = readMoney(rate, 'charge');
    const f = readMoney(free, 'free');
    if (!r.ok) return setMsg(r.message);
    if (!f.ok) return setMsg(f.message);
    setMsg('');
    onSave({ city: city.trim() || null, state: state.trim() || null, ratePaise: r.value, freeAbovePaise: f.value });
  }
  return (
    <tr>
      <td><strong>{area.pincode}</strong></td>
      <td>
        <input aria-label="City" value={city} maxLength={MAX_LABEL} placeholder="City" onChange={(e) => setCity(e.target.value)} />
        <input aria-label="State" value={state} maxLength={MAX_LABEL} placeholder="State" onChange={(e) => setState(e.target.value)} />
      </td>
      <td><input aria-label="Delivery charge in rupees" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></td>
      <td><input aria-label="Free delivery above, in rupees" inputMode="decimal" value={free} placeholder="Never" onChange={(e) => setFree(e.target.value)} /></td>
      <td><span className={area.active ? 'badge' : 'badge badge--warn'}>{area.active ? 'On' : 'Off'}</span></td>
      <td>{when(area.updated_at)}</td>
      <td>
        <div className="admin-actions">
          <button type="button" className="btn btn--sm" disabled={busy} onClick={save}>Save</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
        {msg && <p className="form-status form-status--error" role="alert">{msg}</p>}
      </td>
    </tr>
  );
}

function AddOne({ busy, send }: { busy: boolean; send: Send }) {
  const [msg, setMsg] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const pincode = String(f.get('pincode') ?? '').trim();
    if (!isValidPin(pincode)) return setMsg('Enter a valid 6-digit PIN code.');
    const r = readMoney(String(f.get('rate') ?? ''), 'charge');
    const fr = readMoney(String(f.get('free') ?? ''), 'free');
    if (!r.ok) return setMsg(r.message);
    if (!fr.ok) return setMsg(fr.message);
    setMsg('');
    const ok = await send('delivery-area', 'POST', { pincode, ratePaise: r.value, freeAbovePaise: fr.value, active: f.get('active') === 'on', city: String(f.get('city') ?? ''), state: String(f.get('state') ?? '') }, `${pincode} added.`);
    if (ok) form.reset();
  }
  return (
    <form className="inline-form admin-search-form" onSubmit={submit} aria-label="Add a PIN code">
      <h2 className="admin-subhead">Add a PIN code</h2>
      <label>PIN code<input name="pincode" inputMode="numeric" maxLength={6} autoComplete="off" required /></label>
      <label>City<input name="city" maxLength={MAX_LABEL} autoComplete="off" /></label>
      <label>State<input name="state" maxLength={MAX_LABEL} autoComplete="off" /></label>
      <label>Delivery charge ₹<input name="rate" inputMode="decimal" placeholder="e.g. 60" required /></label>
      <label>Free delivery above ₹<input name="free" inputMode="decimal" placeholder="Empty = never free" /></label>
      <label className="check delivery-check"><input name="active" type="checkbox" defaultChecked /> On</label>
      <div className="admin-actions"><button className="btn btn--sm" type="submit" disabled={busy}>Add PIN code</button></div>
      {msg && <p className="form-status form-status--error" role="alert">{msg}</p>}
    </form>
  );
}

function BulkPaste({ busy, send }: { busy: boolean; send: Send }) {
  const [text, setText] = useState('');
  const [rate, setRate] = useState('');
  const [free, setFree] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [active, setActive] = useState(true);
  const [onExisting, setOnExisting] = useState<'update' | 'skip'>('update');
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState<{ body: Record<string, unknown>; count: number; existing: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const parsed = useMemo(() => parseBulk(text), [text]);
  const charge = readMoney(rate, 'charge');
  const chargeText = charge.ok && charge.value !== null ? (charge.value === 0 ? 'free' : formatInr(charge.value)) : '';

  async function review() {
    const r = readMoney(rate, 'charge');
    const f = readMoney(free, 'free');
    if (!r.ok) return setMsg(r.message);
    if (!f.ok) return setMsg(f.message);
    if (parsed.problems.length) return setMsg('Fix the lines listed below first. Nothing is saved until every line is valid.');
    if (parsed.entries.length === 0) return setMsg('Paste at least one PIN code.');
    setMsg('');
    const body = { text, ratePaise: r.value, freeAbovePaise: f.value, active, city: city.trim(), state: state.trim(), onExisting };
    setChecking(true);
    const c = await api<{ existing: number }>('delivery-areas-bulk', { method: 'POST', body: { ...body, dryRun: true } });
    setChecking(false);
    if (!c.ok || !c.data) return setMsg(errorText(c, 'Could not check the list. Try again.'));
    setConfirm({ count: parsed.entries.length, existing: c.data.existing, body });
  }
  async function apply() {
    if (!confirm) return;
    const ok = await send('delivery-areas-bulk', 'POST', confirm.body, `Saved ${confirm.count} PIN codes.`);
    setConfirm(null);
    if (ok) setText('');
  }

  return (
    <details className="asec">
      <summary>Add many PIN codes at once</summary>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="bulk-text">PIN codes</label>
          <textarea id="bulk-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={'221005\n221006, Varanasi, Uttar Pradesh\n110001 110002 110003'} />
          <p className="field-hint">One per line, or several on a line. A line can also be PIN, city, state. Up to {MAX_BULK_PINS} at a time.</p>
        </div>
        <p role="status">
          {parsed.entries.length} PIN code{parsed.entries.length === 1 ? '' : 's'} ready
          {parsed.duplicates > 0 && `, ${parsed.duplicates} repeated (ignored)`}
          {parsed.problems.length > 0 && `, ${parsed.problems.length} to fix`}.
        </p>
        {parsed.problems.length > 0 && (
          <ul className="form-status form-status--error">
            {parsed.problems.slice(0, 8).map((p) => <li key={`${p.line}-${p.reason}`}>{p.line ? `Line ${p.line}: ` : ''}{p.reason}</li>)}
            {parsed.problems.length > 8 && <li>and {parsed.problems.length - 8} more.</li>}
          </ul>
        )}
        <label>Delivery charge ₹ (for all of them)<input inputMode="decimal" value={rate} placeholder="e.g. 60" onChange={(e) => setRate(e.target.value)} /></label>
        <label>Free delivery above ₹<input inputMode="decimal" value={free} placeholder="Empty = never free" onChange={(e) => setFree(e.target.value)} /></label>
        <label>City label (when a line has none)<input value={city} maxLength={MAX_LABEL} onChange={(e) => setCity(e.target.value)} /></label>
        <label>State label (when a line has none)<input value={state} maxLength={MAX_LABEL} onChange={(e) => setState(e.target.value)} /></label>
        <label className="check delivery-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Switch them on</label>
        <label>If a PIN code is already listed
          <select value={onExisting} onChange={(e) => setOnExisting(e.target.value as 'update' | 'skip')}>
            <option value="update">Update it with these settings</option>
            <option value="skip">Leave it as it is</option>
          </select>
        </label>
        {msg && <p className="form-status form-status--error" role="alert">{msg}</p>}
        <div className="admin-actions"><button type="button" className="btn btn--sm" disabled={busy || checking} onClick={() => void review()}>{checking ? 'Checking…' : 'Review and save'}</button></div>
      </div>
      <ConfirmDialog open={confirm !== null} title={`Save ${confirm?.count ?? 0} PIN codes?`} confirmLabel="Save PIN codes" busy={busy} onConfirm={() => void apply()} onCancel={() => setConfirm(null)}>
        <p>
          {`Charge ${chargeText}${free.trim() ? `, free above ₹${free.trim()}` : ', never free'}; ${active ? 'switched on' : 'switched off'}. `}
          {confirm ? `${confirm.count - confirm.existing} new, ${confirm.existing} already listed. ` : ''}
          {onExisting === 'update' ? 'PIN codes already listed will be changed to these settings.' : 'PIN codes already listed will not be touched.'}
        </p>
      </ConfirmDialog>
    </details>
  );
}
