import { useEffect, useState, type FormEvent } from 'react';
import { rupeesToPaiseOrZero } from '../../shared/deliveryAreas';
import { formatInr } from '../../shared/orders';
import { paiseToRupees } from '../../shared/products';
import { api, errorText, useMe } from '../lib/adminKit';

interface Comp { variant_id: string; qty: number; product: string; pack_size: string; price_paise: number | null }
interface Bundle {
  id: string; slug: string; name: string; kind: string; description: string | null; gift_note: string | null; status: 'draft' | 'active' | 'inactive';
  pricing_mode: 'fixed_price' | 'percent_off' | 'amount_off'; fixed_price_paise: number | null; percent_bps: number | null; amount_off_paise: number | null;
  gift_message_allowed: boolean; price: { ok?: boolean; error?: string; combined_paise?: number; final_paise?: number; savings_paise?: number }; sellable: boolean; available: number; components: Comp[];
}
interface Variant { id: string; label: string; pricePaise: number }
interface Stats { analytics: { bundles: { name: string; units_sold: number; revenue_paise: number; discount_paise: number; orders: number }[]; profit_note: string }; constraints: { name: string; available: number }[] }
const KINDS: [string, string][] = [['bundle', 'Bundle'], ['wellness_kit', 'Wellness kit'], ['gift_set', 'Gift set'], ['promo', 'Promotion']];
const MODES: [Bundle['pricing_mode'], string][] = [['fixed_price', 'Fixed price (₹)'], ['percent_off', 'Percent off (%)'], ['amount_off', 'Amount off (₹)']];

/** Owner bundle management. Every price is checked again by the database: it refuses a bundle that is not cheaper than its parts. */
export default function AdminBundles({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const canWrite = me.can('bundles.write');
  const [items, setItems] = useState<Bundle[] | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [editing, setEditing] = useState<Bundle | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<{ items: Bundle[] }>('bundles');
    if (r.status === 401) return onExpired();
    if (!r.ok || !r.data) return setProblem(errorText(r, 'Could not load bundles.'));
    setItems(r.data.items);
  }
  useEffect(() => {
    void load();
    void api<{ variants: Variant[] }>('bundle-options').then((r) => r.ok && r.data && setVariants(r.data.variants));
    void api<Stats>('bundle-stats').then((r) => r.ok && r.data && setStats(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(path: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true); setNotice(''); setProblem('');
    const r = await api(path, { method: 'POST', body });
    setBusy(false);
    if (r.status === 401) { onExpired(); return false; }
    if (!r.ok) { setProblem(errorText(r, 'Could not save the change.')); return false; }
    setNotice(done);
    void load();
    return true;
  }

  return (
    <section aria-labelledby="bd-title">
      <div className="admin-toolbar">
        <h1 id="bd-title">Bundles</h1>
        {canWrite && <button type="button" className="btn btn--sm" onClick={() => setEditing('new')}>New bundle</button>}
      </div>
      <p className="field-hint">A bundle is two or more pack sizes sold together at a price lower than buying them separately. Stock is the stock of the parts. Customers cannot order bundles yet: they are shown on the Bundles page only.{!canWrite && ' You can look but not change.'}</p>
      {notice && <p className="form-status form-status--info" role="status">{notice}</p>}
      {problem && <p className="form-status form-status--error" role="alert">{problem}</p>}
      {editing && canWrite && (
        <BundleForm key={editing === 'new' ? 'new' : editing.id} bundle={editing === 'new' ? null : editing} variants={variants} busy={busy} onCancel={() => setEditing(null)}
          onSave={async (body) => { if (await send('bundle-save', body, 'Bundle saved.')) setEditing(null); }} />
      )}
      {!items ? <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div> : items.length === 0 ? (
        <p className="muted">No bundles yet. Nothing is created for you.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Bundles</caption>
            <thead><tr><th scope="col">Bundle</th><th scope="col">Parts</th><th scope="col">Price</th><th scope="col">Can sell now</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong><small className="muted"> {b.slug}</small></td>
                  <td>{b.components.map((c) => `${c.qty} × ${c.product} (${c.pack_size})`).join(', ')}</td>
                  <td>{b.price.ok ? <>{formatInr(b.price.final_paise ?? 0)} <small className="muted">saves {formatInr(b.price.savings_paise ?? 0)} of {formatInr(b.price.combined_paise ?? 0)}</small></> : <span className="muted">Not valid yet{b.price.error ? `: ${b.price.error.replace(/^KH:/, '')}` : ''}</span>}</td>
                  <td>{b.status === 'active' ? b.available : <span className="muted">{b.sellable ? `${b.available} possible` : 'A part is not on sale'}</span>}</td>
                  <td><span className={b.status === 'active' ? 'badge' : 'badge badge--warn'}>{b.status}</span></td>
                  <td>
                    {canWrite && (
                      <div className="admin-actions">
                        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setEditing(b)}>Edit</button>
                        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} aria-label={`${b.status === 'active' ? 'Deactivate' : 'Activate'} ${b.name}`}
                          onClick={() => void send('bundle-status', { id: b.id, status: b.status === 'active' ? 'inactive' : 'active' }, `${b.name} is now ${b.status === 'active' ? 'inactive' : 'active'}.`)}>{b.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {stats && (
        <div>
          <h2>Last 30 days</h2>
          {stats.analytics.bundles.length === 0 ? <p className="muted">No bundles sold yet.</p> : (
            <ul>{stats.analytics.bundles.map((x) => <li key={x.name}>{x.name}: {x.units_sold} sold, {formatInr(x.revenue_paise)} revenue, {formatInr(x.discount_paise)} given as savings</li>)}</ul>
          )}
          <p className="field-hint">{stats.analytics.profit_note}</p>
          {stats.constraints.length > 0 && <p className="field-hint">Fewest available: {stats.constraints.slice(0, 3).map((c) => `${c.name} (${c.available})`).join(', ')}.</p>}
        </div>
      )}
    </section>
  );
}

function BundleForm({ bundle, variants, busy, onCancel, onSave }: { bundle: Bundle | null; variants: Variant[]; busy: boolean; onCancel: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(bundle?.name ?? '');
  const [slug, setSlug] = useState(bundle?.slug ?? '');
  const [kind, setKind] = useState(bundle?.kind ?? 'bundle');
  const [description, setDescription] = useState(bundle?.description ?? '');
  const [giftNote, setGiftNote] = useState(bundle?.gift_note ?? '');
  const [mode, setMode] = useState<Bundle['pricing_mode']>(bundle?.pricing_mode ?? 'percent_off');
  const [value, setValue] = useState(bundle ? (bundle.pricing_mode === 'percent_off' ? String((bundle.percent_bps ?? 0) / 100) : paiseToRupees(bundle.pricing_mode === 'fixed_price' ? bundle.fixed_price_paise ?? 0 : bundle.amount_off_paise ?? 0)) : '');
  const [gift, setGift] = useState(bundle?.gift_message_allowed ?? false);
  const [parts, setParts] = useState<{ variantId: string; qty: number }[]>(bundle ? bundle.components.map((c) => ({ variantId: c.variant_id, qty: c.qty })) : [{ variantId: '', qty: 1 }, { variantId: '', qty: 1 }]);
  const [err, setErr] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const body: Record<string, unknown> = { ...(bundle ? { id: bundle.id } : {}), name, slug, kind, description, giftNote, pricingMode: mode, giftMessageAllowed: kind === 'gift_set' && gift, components: parts };
    if (mode === 'percent_off') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > 90) return setErr('Enter a percentage above 0 and up to 90.');
      body.percentBps = Math.round(n * 100);
    } else {
      const p = rupeesToPaiseOrZero(value);
      if (!p.ok || !p.value) return setErr('Enter an amount in rupees, for example 899 or 899.50.');
      body[mode === 'fixed_price' ? 'fixedPricePaise' : 'amountOffPaise'] = p.value;
    }
    void onSave(body);
  }
  const setPart = (i: number, patch: Partial<{ variantId: string; qty: number }>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <form className="admin-form" onSubmit={submit} aria-label={bundle ? `Edit ${bundle.name}` : 'New bundle'}>
      <div className="field"><label htmlFor="bd-name">Name</label><input id="bd-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></div>
      <div className="field"><label htmlFor="bd-slug">Web name (slug)</label><input id="bd-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={60} required /></div>
      <div className="field"><label htmlFor="bd-kind">Type</label><select id="bd-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label htmlFor="bd-desc">Description</label><textarea id="bd-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} /></div>
      <div className="field"><label htmlFor="bd-note">Gift note (shown with a gift set)</label><input id="bd-note" value={giftNote} onChange={(e) => setGiftNote(e.target.value)} maxLength={300} /></div>
      {kind === 'gift_set' && <div className="field"><label><input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} /> Let customers add a gift message</label></div>}
      <fieldset className="field"><legend>Parts (at least two different pack sizes)</legend>
        {parts.map((p, i) => (
          <div key={i} className="admin-actions">
            <label className="sr-only" htmlFor={`bd-v${i}`}>Pack size {i + 1}</label>
            <select id={`bd-v${i}`} value={p.variantId} onChange={(e) => setPart(i, { variantId: e.target.value })} required><option value="">Choose a pack size</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
            <label className="sr-only" htmlFor={`bd-q${i}`}>Quantity {i + 1}</label>
            <input id={`bd-q${i}`} type="number" min={1} max={10} value={p.qty} onChange={(e) => setPart(i, { qty: Number(e.target.value) })} />
            {parts.length > 2 && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setParts((ps) => [...ps, { variantId: '', qty: 1 }])}>Add a part</button>
      </fieldset>
      <div className="field"><label htmlFor="bd-mode">Price</label><select id="bd-mode" value={mode} onChange={(e) => setMode(e.target.value as Bundle['pricing_mode'])}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label htmlFor="bd-val">{mode === 'percent_off' ? 'Percent off' : mode === 'fixed_price' ? 'Bundle price (₹)' : 'Amount off (₹)'}</label><input id="bd-val" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required /></div>
      <p className="field-hint">The price must be lower than the parts bought separately. A new bundle stays a draft until you activate it.</p>
      {err && <p className="form-status form-status--error" role="alert">{err}</p>}
      <div className="admin-actions"><button type="submit" className="btn btn--sm" disabled={busy}>{busy ? 'Saving…' : 'Save bundle'}</button><button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
