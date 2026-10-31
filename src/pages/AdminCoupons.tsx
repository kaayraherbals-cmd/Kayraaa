import { useEffect, useState, type FormEvent } from 'react';
import { describeValue } from '../../shared/coupons';
import { rupeesToPaiseOrZero } from '../../shared/deliveryAreas';
import { formatInr } from '../../shared/orders';
import { paiseToRupees } from '../../shared/products';
import { Pager, api, errorText, useMe, usePaged, when, type Listing } from '../lib/adminKit';

interface Coupon {
  id: string; code: string; description: string | null; discount_type: 'percent' | 'fixed'; percent_bps: number | null; fixed_paise: number | null;
  min_order_paise: number; max_discount_paise: number | null; starts_at: string | null; expires_at: string | null; usage_limit: number | null;
  per_customer_limit: number | null; first_order_only: boolean; product_ids: string[]; product_forms: string[]; active: boolean; created_at: string;
  reserved?: number; committed?: number; released?: number; discount_committed_paise?: number; state?: 'active' | 'scheduled' | 'expired' | 'inactive';
}
interface Redemption { id: string; status: string; discount_paise: number; release_reason: string | null; reserved_at: string; orders: { order_no: string; total_paise: number; status: string } | null }
interface Options { products: { id: string; name: string; form: string }[]; forms: string[] }
interface Analytics {
  totals: { redemptions: number; discount_paise: number; revenue_paise: number; average_order_paise: number | null; refunded_paise: number };
  all_orders: { orders: number; average_order_paise: number | null };
  per_coupon: { code: string; redemptions: number; discount_paise: number; revenue_paise: number; average_order_paise: number | null }[];
  by_day: { day: string; redemptions: number; discount_paise: number }[];
  reserved_now: number; active_campaigns: number; expired_coupons: number;
}
type Filter = 'all' | 'active' | 'scheduled' | 'expired' | 'inactive';
const FILTERS: [Filter, string][] = [['all', 'All'], ['active', 'Active'], ['scheduled', 'Scheduled'], ['expired', 'Expired'], ['inactive', 'Inactive']];
const BADGE: Record<string, string> = { active: 'badge', scheduled: 'badge badge--warn', expired: 'badge badge--warn', inactive: 'badge badge--warn' };

const money = (t: string): number | null | undefined => {
  const p = rupeesToPaiseOrZero(t);
  return p.ok ? p.value : undefined;
};
/** A datetime-local value is read as India time. */
const toIso = (v: string): string | null => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
const fromIso = (iso: string | null): string => (iso ? new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 16) : '');
const intOrNull = (v: string): number | null | undefined => (v.trim() === '' ? null : /^\d{1,8}$/.test(v.trim()) ? Number(v) : undefined);

export default function AdminCoupons({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const canWrite = me.can('coupons.write');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setApplied(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const params = [filter === 'all' ? '' : `status=${filter}`, applied ? `q=${encodeURIComponent(applied)}` : ''].filter(Boolean).join('&');
  const paged = usePaged<Coupon>(`coupons${params ? `?${params}` : ''}`, onExpired);
  const { page, setPage, error, loading, reload } = paged;
  const data = paged.data as Listing<Coupon> | null;

  useEffect(() => {
    void api<Options>('coupon-options').then((r) => r.ok && r.data && setOptions(r.data));
  }, []);

  async function send(path: string, method: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true); setNotice(''); setProblem('');
    const r = await api(path, { method, body });
    setBusy(false);
    if (r.status === 401) { onExpired(); return false; }
    if (!r.ok) { setProblem(errorText(r, 'Could not save the change.')); return false; }
    setNotice(done);
    void reload();
    return true;
  }

  return (
    <section aria-labelledby="cp-title">
      <div className="admin-toolbar">
        <h1 id="cp-title">Coupons</h1>
        <div className="field admin-search">
          <label htmlFor="cp-q">Search code or description</label>
          <input id="cp-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
        </div>
        {canWrite && <button type="button" className="btn btn--sm" onClick={() => { setEditing('new'); setViewing(null); }}>New coupon</button>}
      </div>
      <p className="field-hint">
        Customers enter a code in their bag. The server checks every rule and works out the discount; nothing is trusted from the browser. A coupon is switched off, never deleted, and its code cannot change. One coupon per order.
        {!canWrite && ' You can look at coupons but not change them.'}
      </p>
      <div className="aprod-chips" role="group" aria-label="Show">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" className="aprod-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>
      {notice && <p className="form-status form-status--info" role="status">{notice}</p>}
      {problem && <p className="form-status form-status--error" role="alert">{problem}</p>}
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {editing && canWrite && (
        <CouponForm key={editing === 'new' ? 'new' : editing.id} coupon={editing === 'new' ? null : editing} options={options} busy={busy} onCancel={() => setEditing(null)}
          onSave={async (body) => {
            const ok = editing === 'new' ? await send('coupon', 'POST', body, 'Coupon created.') : await send(`coupon?id=${editing.id}`, 'PATCH', body, 'Coupon saved.');
            if (ok) setEditing(null);
          }} />
      )}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (data.items.length === 0 ? (
        <p className="muted">{applied || filter !== 'all' ? 'No coupons match.' : 'No coupons yet. Nothing is created for you; add one when you want to run an offer.'}</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Coupons</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th><th scope="col">Offer</th><th scope="col">Rules</th><th scope="col">Dates</th><th scope="col">Used</th><th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.code}</strong>{c.description && <small className="muted"> {c.description}</small>}</td>
                    <td>{describeValue(c)}</td>
                    <td>
                      {c.min_order_paise > 0 ? `Min ${formatInr(c.min_order_paise)}` : 'No minimum'}
                      {c.first_order_only && ', first order only'}
                      {(c.product_ids.length > 0 || c.product_forms.length > 0) && ', restricted items'}
                    </td>
                    <td>{c.starts_at ? when(c.starts_at) : 'Any time'} to {c.expires_at ? when(c.expires_at) : 'no end'}</td>
                    <td>{c.committed ?? 0}{c.usage_limit ? ` of ${c.usage_limit}` : ''}{(c.reserved ?? 0) > 0 && <small className="muted"> (+{c.reserved} pending)</small>}</td>
                    <td><span className={BADGE[c.state ?? 'inactive']}>{c.state ?? (c.active ? 'active' : 'inactive')}</span></td>
                    <td>
                      <div className="admin-actions">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setViewing(viewing === c.id ? null : c.id); setEditing(null); }} aria-expanded={viewing === c.id}>Details</button>
                        {canWrite && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { setEditing(c); setViewing(null); }}>Edit</button>}
                        {canWrite && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} aria-label={`${c.active ? 'Deactivate' : 'Activate'} ${c.code}`} onClick={() => void send(`coupon-toggle?id=${c.id}`, 'POST', { active: !c.active }, `${c.code} is now ${c.active ? 'inactive: customers cannot use it' : 'active'}.`)}>{c.active ? 'Deactivate' : 'Activate'}</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      ))}
      {viewing && <Details id={viewing} options={options} />}
      <Stats />
    </section>
  );
}

function Details({ id, options }: { id: string; options: Options | null }) {
  const [d, setD] = useState<{ item: Coupon; redemptions: Redemption[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setD(null); setErr('');
    void api<{ item: Coupon; redemptions: Redemption[] }>(`coupon?id=${id}`).then((r) => (r.ok && r.data ? setD(r.data) : setErr(errorText(r, 'Could not load this coupon.'))));
  }, [id]);
  if (err) return <p className="form-status form-status--error" role="alert">{err}</p>;
  if (!d) return <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /></div>;
  const c = d.item;
  const names = (c.product_ids ?? []).map((p) => options?.products.find((o) => o.id === p)?.name ?? p);
  return (
    <section className="admin-subsection" aria-label={`Details of ${c.code}`}>
      <h2 className="admin-subhead">{c.code}: details</h2>
      <dl className="admin-dl">
        <div><dt>Offer</dt><dd>{describeValue(c)}</dd></div>
        <div><dt>Limits</dt><dd>{c.usage_limit ? `${c.usage_limit} uses in total` : 'No total limit'}, {c.per_customer_limit ? `${c.per_customer_limit} per customer` : 'no per-customer limit'}</dd></div>
        <div><dt>Applies to</dt><dd>{names.length || c.product_forms.length ? [...names, ...c.product_forms.map((f) => `all ${f}`)].join(', ') + (names.length && c.product_forms.length ? ' (items must match both)' : '') : 'Every product'}</dd></div>
        <div><dt>Created</dt><dd>{when(c.created_at)}</dd></div>
      </dl>
      <h3 className="admin-subhead">Usage history (latest 50)</h3>
      {d.redemptions.length === 0 ? <p className="muted">Not used yet.</p> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Redemptions</caption>
            <thead><tr><th scope="col">Order</th><th scope="col">Reserved</th><th scope="col">State</th><th scope="col">Discount</th><th scope="col">Order total</th></tr></thead>
            <tbody>
              {d.redemptions.map((r) => (
                <tr key={r.id}>
                  <td>{r.orders?.order_no ?? '-'}</td>
                  <td>{when(r.reserved_at)}</td>
                  <td>{r.status}{r.release_reason ? ` (${r.release_reason.replace(/_/g, ' ')})` : ''}</td>
                  <td>{formatInr(r.discount_paise)}</td>
                  <td>{r.orders ? formatInr(r.orders.total_paise) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stats() {
  const [a, setA] = useState<Analytics | null>(null);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const qs = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join('&');
    void api<{ analytics: Analytics }>(`coupon-analytics${qs ? `?${qs}` : ''}`).then((r) => (r.ok && r.data ? (setA(r.data.analytics), setErr('')) : setErr(errorText(r, 'Could not load coupon figures.'))));
  }, [from, to]);
  return (
    <section className="admin-subsection" aria-labelledby="cp-stats">
      <h2 id="cp-stats" className="admin-subhead">Coupon results</h2>
      <p className="field-hint">Counted from real paid orders. "Sales with a coupon" is what customers paid on orders that used one. It does not show that the coupon caused the sale. Default period: last 30 days.</p>
      <div className="inline-form">
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {err && <p className="form-status form-status--error" role="alert">{err}</p>}
      {a && (
        <>
          <dl className="admin-dl">
            <div><dt>Redemptions</dt><dd>{a.totals.redemptions}</dd></div>
            <div><dt>Discount given</dt><dd>{formatInr(a.totals.discount_paise)}</dd></div>
            <div><dt>Sales with a coupon</dt><dd>{formatInr(a.totals.revenue_paise)}</dd></div>
            <div><dt>Average order with a coupon</dt><dd>{a.totals.average_order_paise === null ? 'None yet' : formatInr(a.totals.average_order_paise)}</dd></div>
            <div><dt>Average order, all paid orders</dt><dd>{a.all_orders.average_order_paise === null ? 'None yet' : formatInr(a.all_orders.average_order_paise)}</dd></div>
            <div><dt>Refunded on those orders</dt><dd>{formatInr(a.totals.refunded_paise)}</dd></div>
            <div><dt>Active campaigns</dt><dd>{a.active_campaigns}</dd></div>
            <div><dt>Expired coupons</dt><dd>{a.expired_coupons}</dd></div>
            <div><dt>Pending (reserved, unpaid)</dt><dd>{a.reserved_now}</dd></div>
          </dl>
          {a.per_coupon.length > 0 && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Most used coupons</caption>
                <thead><tr><th scope="col">Coupon</th><th scope="col">Used</th><th scope="col">Discount</th><th scope="col">Sales</th><th scope="col">Average order</th></tr></thead>
                <tbody>{a.per_coupon.map((p) => <tr key={p.code}><td><strong>{p.code}</strong></td><td>{p.redemptions}</td><td>{formatInr(p.discount_paise)}</td><td>{formatInr(p.revenue_paise)}</td><td>{p.average_order_paise === null ? '-' : formatInr(p.average_order_paise)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {a.by_day.length > 0 && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Redemptions by day</caption>
                <thead><tr><th scope="col">Day</th><th scope="col">Redemptions</th><th scope="col">Discount</th></tr></thead>
                <tbody>{a.by_day.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.redemptions}</td><td>{formatInr(d.discount_paise)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CouponForm({ coupon, options, busy, onSave, onCancel }: { coupon: Coupon | null; options: Options | null; busy: boolean; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const isNew = coupon === null;
  const [type, setType] = useState<'percent' | 'fixed'>(coupon?.discount_type ?? 'percent');
  const [products, setProducts] = useState<string[]>(coupon?.product_ids ?? []);
  const [forms, setForms] = useState<string[]>(coupon?.product_forms ?? []);
  const [msg, setMsg] = useState('');
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const body: Record<string, unknown> = { type, description: s('description') || null, firstOrderOnly: f.get('first') === 'on', active: f.get('active') === 'on', productIds: products, productForms: forms };
    if (isNew) body.code = s('code').toUpperCase();
    if (type === 'percent') {
      const pct = Number(s('percent'));
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(s('percent')) || pct <= 0 || pct > 100) return setMsg('Enter a percentage above 0 and up to 100 (at most two decimals).');
      body.percentBps = Math.round(pct * 100);
      const cap = money(s('cap'));
      if (cap === undefined) return setMsg('Maximum discount must be an amount in rupees, or empty for no cap.');
      body.maxDiscountPaise = cap;
    } else {
      const fx = money(s('fixed'));
      if (fx === undefined || fx === null) return setMsg('Enter the discount in rupees, for example 150.');
      body.fixedPaise = fx;
    }
    const min = money(s('min'));
    if (min === undefined) return setMsg('Minimum order must be an amount in rupees, or empty.');
    body.minOrderPaise = min ?? 0;
    const usage = intOrNull(s('usage'));
    const per = intOrNull(s('per'));
    if (usage === undefined || per === undefined) return setMsg('Usage limits must be whole numbers, or empty for no limit.');
    body.usageLimit = usage; body.perCustomerLimit = per;
    body.startsAt = toIso(s('starts')); body.expiresAt = toIso(s('expires'));
    setMsg('');
    onSave(body);
  }
  return (
    <form className="inline-form admin-search-form" onSubmit={submit} aria-label={isNew ? 'New coupon' : `Edit ${coupon.code}`}>
      <h2 className="admin-subhead">{isNew ? 'New coupon' : `Edit ${coupon.code}`}</h2>
      {isNew ? <label>Code<input name="code" maxLength={32} autoComplete="off" required placeholder="e.g. WELCOME10" style={{ textTransform: 'uppercase' }} /></label> : <p className="field-hint">The code {coupon.code} is permanent.</p>}
      <label>Description (shown to customers)<input name="description" maxLength={200} defaultValue={coupon?.description ?? ''} /></label>
      <label>Type
        <select value={type} onChange={(e) => setType(e.target.value as 'percent' | 'fixed')}>
          <option value="percent">Percentage</option>
          <option value="fixed">Fixed amount</option>
        </select>
      </label>
      {type === 'percent' ? (
        <>
          <label>Percentage off<input name="percent" inputMode="decimal" defaultValue={coupon?.percent_bps ? String(coupon.percent_bps / 100) : ''} required /></label>
          <label>Maximum discount ₹<input name="cap" inputMode="decimal" defaultValue={paiseToRupees(coupon?.max_discount_paise)} placeholder="Empty = no cap" /></label>
        </>
      ) : (
        <label>Amount off ₹<input name="fixed" inputMode="decimal" defaultValue={paiseToRupees(coupon?.fixed_paise)} required /></label>
      )}
      <label>Minimum order ₹<input name="min" inputMode="decimal" defaultValue={paiseToRupees(coupon?.min_order_paise)} placeholder="Empty = none" /></label>
      <label>Starts (India time)<input name="starts" type="datetime-local" defaultValue={fromIso(coupon?.starts_at ?? null)} /></label>
      <label>Expires (India time)<input name="expires" type="datetime-local" defaultValue={fromIso(coupon?.expires_at ?? null)} /></label>
      <label>Total uses allowed<input name="usage" inputMode="numeric" defaultValue={coupon?.usage_limit ?? ''} placeholder="Empty = unlimited" /></label>
      <label>Uses per customer<input name="per" inputMode="numeric" defaultValue={coupon?.per_customer_limit ?? ''} placeholder="Empty = unlimited" /></label>
      <label className="check"><input name="first" type="checkbox" defaultChecked={coupon?.first_order_only ?? false} /> First order only</label>
      <label className="check"><input name="active" type="checkbox" defaultChecked={coupon?.active ?? false} /> Active (customers can use it)</label>
      <fieldset>
        <legend>Only these products (leave empty for all)</legend>
        {options ? options.products.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={products.includes(p.id)} onChange={() => toggle(products, setProducts, p.id)} /> {p.name}</label>) : <span className="muted">Loading…</span>}
      </fieldset>
      <fieldset>
        <legend>Only these categories (leave empty for all)</legend>
        {options ? options.forms.map((fm) => <label key={fm} className="check"><input type="checkbox" checked={forms.includes(fm)} onChange={() => toggle(forms, setForms, fm)} /> {fm}</label>) : <span className="muted">Loading…</span>}
      </fieldset>
      {products.length > 0 && forms.length > 0 && <p className="field-hint">With both lists set, an item must match both to be discounted.</p>}
      <div className="admin-actions">
        <button className="btn btn--sm" type="submit" disabled={busy}>{isNew ? 'Create coupon' : 'Save changes'}</button>
        <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {msg && <p className="form-status form-status--error" role="alert">{msg}</p>}
    </form>
  );
}
