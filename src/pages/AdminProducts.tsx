import type React from 'react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PRODUCT_STATUSES, STATUS_LABELS, paiseToRupees, publishProblems, rupeesToPaise, type InternalProduct, type ProductStatus, type ProductUpdate } from '../../shared/products';
import { GST_RATES, MAX_VARIANTS_PER_PRODUCT, type Variant } from '../../shared/variants';
import { MAX_GALLERY_IMAGES, type GalleryImage } from '../../shared/gallery';
import { errorText, useMe } from '../lib/adminKit';
import { prepareImage } from '../lib/image';

type Api = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<{ ok: boolean; status: number; data: (T & { message?: string; problems?: string[] }) | null }>;

const FIELDS = ['public_name', 'public_description', 'reviewed_by', 'ingredients_public', 'composition_verified', 'preservatives_verified', 'claims_reviewed', 'internal_name', 'form', 'country_of_origin', 'manufacturer_details', 'shelf_life'] as const;


/** A collapsible block with a plain-language title. Same fields as before, just folded so the form is short. */
function Section({ title, hint, open = false, children }: { title: string; hint?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="asec" open={open}>
      <summary>{title}</summary>
      <div className="asec-body">
        {hint && <p className="field-hint">{hint}</p>}
        {children}
      </div>
    </details>
  );
}

const STATUS_HELP: Record<ProductStatus, string> = {
  DRAFT: 'Private. Only your team can see it.',
  IN_DEVELOPMENT: 'Private. Still being worked on.',
  UNDER_REVIEW: 'Private. Waiting for sign-off.',
  APPROVED_FOR_PREVIEW: 'Shown on the website as a preview. It cannot be bought.',
  APPROVED_FOR_SALE: 'Shown on the website. It can be bought once a price and stock are set.',
};

const FORMS = ['Syrup', 'Capsules', 'Tablets', 'Powder', 'Oil', 'Churna', 'Ointment'];

/** Photo picker: compresses in the browser, uploads to private storage, and shows the stored file back from the admin API. */
function ImageField({ value, alt, api, onExpired, onChange, onAlt }: { value: string | null; alt: string | null; api: Api; onExpired: () => void; onChange: (path: string | null) => void; onAlt: (v: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [local, setLocal] = useState<{ path: string; url: string } | null>(null);
  const shown = (local && local.path === value ? local.url : null) ?? (value?.startsWith('/api/media/') ? `/api/admin/product-image?file=${value.slice('/api/media/'.length)}` : value);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    const prepared = await prepareImage(file);
    if ('error' in prepared) {
      setBusy(false);
      return setError(prepared.error);
    }
    const r = await api<{ path: string }>('product-image', { method: 'POST', body: { data: prepared.base64 } });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (r.ok && r.data?.path) {
      setLocal({ path: r.data.path, url: prepared.previewUrl });
      onChange(r.data.path);
    } else setError(r.data?.message ?? 'Upload failed.');
  }

  return (
    <div className="imgfield">
      {shown ? <img className="imgfield-preview" loading="lazy" decoding="async" src={shown} alt={alt ?? 'Product photo preview'} /> : <div className="imgfield-empty">No photo</div>}
      <div className="imgfield-controls">
        <label className="btn btn--ghost imgfield-pick">
          {busy ? 'Uploading…' : shown ? 'Replace photo' : 'Upload photo'}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {value && <button type="button" className="btn btn--ghost" onClick={() => { setLocal(null); onChange(null); onAlt(null); }}>Remove</button>}
        <span className="field-hint">JPEG, PNG or WebP. Resized to 1600 px and re-encoded in your browser; location data is dropped.</span>
      </div>
      <label>Photo description (alt text, required with a photo)<input value={alt ?? ''} maxLength={200} onChange={(e) => onAlt(e.target.value || null)} /></label>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
    </div>
  );
}

/** Several photos per product. The first is the primary photo (cards and previews). Saved together, in order. */
function GalleryEditor({ product, api, onExpired, canEdit, onPrimary }: { product: InternalProduct; api: Api; onExpired: () => void; canEdit: boolean; onPrimary: (first: GalleryImage | null) => void }) {
  const [images, setImages] = useState<GalleryImage[] | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void api<{ images: GalleryImage[] }>(`product-gallery?product_id=${product.id}`).then((r) => {
      if (r.status === 401) return onExpired();
      const list = r.ok && r.data ? r.data.images : [];
      setImages(list);
      setSaved(JSON.stringify(list));
    });
  }, [api, onExpired, product.id]);

  if (!images) return <p role="status">Loading photos…</p>;
  const dirty = JSON.stringify(images) !== saved;
  const valid = images.every((i) => i.alt.trim().length >= 3);
  const urlFor = (p: string) => (p.startsWith('/api/media/') ? `/api/admin/product-image?file=${p.slice('/api/media/'.length)}` : p);
  const move = (i: number, d: number) => setImages((cur) => {
    const next = [...(cur ?? [])];
    const j = i + d;
    if (j < 0 || j >= next.length) return next;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  async function add(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage('');
    const prepared = await prepareImage(file);
    if ('error' in prepared) {
      setBusy(false);
      return setMessage(prepared.error);
    }
    const r = await api<{ path: string }>('product-image', { method: 'POST', body: { data: prepared.base64 } });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (r.ok && r.data?.path) setImages((cur) => [...(cur ?? []), { path: r.data!.path, alt: '' }]);
    else setMessage(errorText(r, 'Upload failed.'));
  }
  async function save() {
    const list = images ?? [];
    setBusy(true);
    setMessage('');
    const r = await api<{ images: GalleryImage[] }>(`product-gallery?product_id=${product.id}`, { method: 'PUT', body: { images: list } });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (!r.ok) return setMessage(errorText(r, 'Could not save the photos.'));
    setSaved(JSON.stringify(list));
    onPrimary(list[0] ?? null);
    setMessage('Photos saved.');
  }

  return (
    <Section title={`2. Photos (${images.length} of ${MAX_GALLERY_IMAGES})`} hint="The first photo is the main one. Every photo needs a short description.">
      {images.length === 0 && <p className="field-hint">No photos yet.</p>}
      <ol className="gallery">
        {images.map((img, i) => (
          <li key={img.path}>
            <img loading="lazy" decoding="async" src={urlFor(img.path)} alt={img.alt || 'Product photo preview'} />
            <label>
              Description (alt text, required)
              <input value={img.alt} maxLength={200} disabled={!canEdit} onChange={(e) => setImages((cur) => (cur ?? []).map((x, k) => (k === i ? { ...x, alt: e.target.value } : x)))} />
            </label>
            {canEdit && (
              <div className="admin-actions">
                <button type="button" className="btn btn--ghost btn--sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move photo ${i + 1} earlier`}>←</button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={i === images.length - 1} onClick={() => move(i, 1)} aria-label={`Move photo ${i + 1} later`}>→</button>
                <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setImages((cur) => (cur ?? []).filter((_, k) => k !== i))}>Remove</button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="admin-actions">
          {images.length < MAX_GALLERY_IMAGES && (
            <label className="btn btn--ghost btn--sm imgfield-pick">
              {busy ? 'Working…' : 'Add a photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
          <button type="button" className="btn btn--sm" disabled={busy || !dirty || !valid} onClick={() => void save()}>Save photos</button>
        </div>
      )}
      {!valid && <p className="field-hint">Every photo needs a description of at least 3 characters.</p>}
      <div aria-live="polite">{message && <p className={`form-status ${message === 'Photos saved.' ? 'form-status--info' : 'form-status--error'}`}>{message}</p>}</div>
    </Section>
  );
}

/** Pack sizes. Each has its own SKU, MRP, tax fields and low-stock level. Stock and orders attach to these, not to the product. */
function VariantsEditor({ product, api, onExpired, canEdit, canPrice }: { product: InternalProduct; api: Api; onExpired: () => void; canEdit: boolean; canPrice: boolean }) {
  const [rows, setRows] = useState<Variant[] | null>(null);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ items: Variant[] }>(`variants?product_id=${product.id}`);
    if (r.status === 401) return onExpired();
    if (r.ok && r.data) setRows(r.data.items);
    else setMessage(errorText(r, 'Could not load pack sizes. Has supabase/variants_gallery.sql been run?'));
  }, [api, onExpired, product.id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await api(`variants?id=${id}`, { method: 'PATCH', body });
    if (r.status === 401) return onExpired();
    setMessage(r.ok ? '' : errorText(r, 'Could not save.'));
    if (r.ok) void load();
  }
  async function remove(v: Variant) {
    if (!window.confirm(`Delete the ${v.pack_size} pack size? This cannot be undone. If it has stock or orders, switch it off instead.`)) return;
    const r = await api(`variants?id=${v.id}`, { method: 'DELETE' });
    if (r.status === 401) return onExpired();
    setMessage(r.ok ? '' : errorText(r, 'Could not delete.'));
    if (r.ok) void load();
  }
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body: Record<string, unknown> = { pack_size: String(f.get('pack_size') ?? '') };
    if (canPrice) {
      const price = rupeesToPaise(String(f.get('price') ?? ''));
      if (!price.ok) return setMessage('Enter a price like 349 or 349.50.');
      if (price.value !== null) body.price_paise = price.value;
    }
    const r = await api(`variants?product_id=${product.id}`, { method: 'POST', body });
    if (r.status === 401) return onExpired();
    if (!r.ok) return setMessage(errorText(r, 'Could not add the pack size.'));
    form.reset();
    setMessage('');
    void load();
  }

  if (!rows) return message ? <p className="form-status form-status--error" role="alert">{message}</p> : <p role="status">Loading pack sizes…</p>;
  return (
    <Section title="3. Pack sizes, prices and tax" hint="Only the pack-size names can show publicly.">
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--tight variants">
          <caption className="sr-only">Pack sizes of {product.internal_name}</caption>
          <thead>
            <tr><th scope="col">Pack size</th><th scope="col">SKU</th><th scope="col">MRP ₹ (all taxes incl.)</th><th scope="col">GST %</th><th scope="col">HSN</th><th scope="col">Low at</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((v) => <VariantRow key={`${v.id}-${v.updated_at ?? ''}`} v={v} canEdit={canEdit} canPrice={canPrice} onPatch={patch} onDelete={remove} />)}
          </tbody>
        </table>
      </div>
      {canEdit && rows.length < MAX_VARIANTS_PER_PRODUCT && (
        <form className="inline-form" onSubmit={add}>
          <label>New pack size<input name="pack_size" required maxLength={40} placeholder="e.g. 100 ml" /></label>
          {canPrice && <label>MRP ₹<input name="price" inputMode="decimal" placeholder="e.g. 349" /></label>}
          <button className="btn btn--ghost btn--sm" type="submit">Add pack size</button>
        </form>
      )}
      {!canPrice && <p className="field-hint">Prices, GST and HSN codes can be changed by an owner.</p>}
      <div aria-live="polite">{message && <p className="form-status form-status--error" role="alert">{message}</p>}</div>
    </Section>
  );
}

function VariantRow({ v, canEdit, canPrice, onPatch, onDelete }: { v: Variant; canEdit: boolean; canPrice: boolean; onPatch: (id: string, body: Record<string, unknown>) => Promise<void>; onDelete: (v: Variant) => Promise<void> }) {
  const [size, setSize] = useState(v.pack_size);
  const [price, setPrice] = useState(paiseToRupees(v.price_paise));
  const [gst, setGst] = useState(v.gst_rate === null ? '' : String(Number(v.gst_rate)));
  const [hsn, setHsn] = useState(v.hsn_code ?? '');
  const [low, setLow] = useState(String(v.low_stock_threshold));
  const [status, setStatus] = useState(v.status);
  const p = rupeesToPaise(price);
  const body: Record<string, unknown> = {};
  if (size.trim() !== v.pack_size) body.pack_size = size.trim();
  if (status !== v.status) body.status = status;
  if (Number(low) !== v.low_stock_threshold) body.low_stock_threshold = Number(low);
  if (canPrice) {
    if (p.ok && p.value !== v.price_paise) body.price_paise = p.value;
    if ((gst === '' ? null : Number(gst)) !== (v.gst_rate === null ? null : Number(v.gst_rate))) body.gst_rate = gst === '' ? null : Number(gst);
    if ((hsn.trim() || null) !== v.hsn_code) body.hsn_code = hsn.trim() || null;
  }
  const dirty = Object.keys(body).length > 0;
  const lowOk = /^\d{1,6}$/.test(low);
  return (
    <tr data-status={v.status}>
      <td><input aria-label="Pack size" value={size} maxLength={40} disabled={!canEdit} onChange={(e) => setSize(e.target.value)} /></td>
      <td><code>{v.sku}</code></td>
      <td><input aria-label="MRP in rupees" inputMode="decimal" value={price} disabled={!canPrice} aria-invalid={!p.ok} onChange={(e) => setPrice(e.target.value)} /></td>
      <td>
        <select aria-label="GST percent" value={gst} disabled={!canPrice} onChange={(e) => setGst(e.target.value)}>
          <option value="">Not set</option>
          {GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}
        </select>
      </td>
      <td><input aria-label="HSN code" value={hsn} maxLength={8} inputMode="numeric" disabled={!canPrice} onChange={(e) => setHsn(e.target.value)} /></td>
      <td><input aria-label="Low-stock level" value={low} inputMode="numeric" disabled={!canEdit} aria-invalid={!lowOk} onChange={(e) => setLow(e.target.value)} /></td>
      <td>
        <select aria-label="Status" value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value as Variant['status'])}>
          <option value="active">Active</option>
          <option value="inactive">Switched off</option>
        </select>
      </td>
      <td className="admin-actions">
        {canEdit && <button type="button" className="btn btn--sm" disabled={!dirty || !p.ok || !lowOk} onClick={() => void onPatch(v.id, body)}>Save</button>}
        {canPrice && <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => void onDelete(v)}>Delete</button>}
      </td>
    </tr>
  );
}

function ProductEditor({ product, api, onExpired, onSaved }: { product: InternalProduct; api: Api; onExpired: () => void; onSaved: (p: InternalProduct) => void }) {
  const [draft, setDraft] = useState<InternalProduct>(product);
  const [busy, setBusy] = useState(false);
  // The form, photos and pack sizes are only built (and fetched) the first time this product is opened.
  const [opened, setOpened] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; problems?: string[] } | null>(null);
  const me = useMe();
  const canEdit = me.can('products.edit');
  const canPublish = me.can('products.status');
  const changed = useMemo(() => {
    const patch: Record<string, unknown> = {};
    if (draft.status !== product.status) patch.status = draft.status;
    for (const f of FIELDS) if (draft[f] !== product[f]) patch[f] = draft[f];
    return patch as ProductUpdate;
  }, [draft, product]);
  const dirty = Object.keys(changed).length > 0;

  // The same rules the server enforces, shown live so the checklist is never a surprise.
  const needs = useMemo(
    () => publishProblems(draft, draft.status, { screenText: true, checkIngredients: draft.ingredients_public }),
    [draft],
  );
  const set = <K extends keyof InternalProduct>(key: K, value: InternalProduct[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    setBusy(true);
    setMessage(null);
    const r = await api<{ item: InternalProduct }>(`products?id=${product.id}`, { method: 'PATCH', body: changed });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (r.ok && r.data?.item) {
      setDraft(r.data.item);
      onSaved(r.data.item);
      return setMessage({ kind: 'ok', text: 'Saved.' });
    }
    setMessage({ kind: 'error', text: r.data?.message ?? 'Could not save.', problems: r.data?.problems });
  }

  const isPublic = product.status === 'APPROVED_FOR_PREVIEW' || product.status === 'APPROVED_FOR_SALE';

  return (
    <details className="aprod" data-public={isPublic} onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}>
      <summary>
        <span className="aprod-mono" aria-hidden="true">{(product.public_name ?? product.internal_name).trim().charAt(0).toUpperCase()}</span>
        <span className="aprod-title">
          <span className="aprod-name">{product.internal_name}</span>
          <span className="aprod-meta">{product.form} · {product.pack_size}</span>
        </span>
        <span className="badge" data-status={product.status}>{STATUS_LABELS[product.status]}</span>
        <span className="aprod-state" data-live={isPublic}>{isPublic ? 'On website' : 'Private'}</span>
        {needs.length > 0 && <span className="badge badge--warn">{needs.length} to finish</span>}
        {dirty && <span className="badge badge--warn">Unsaved</span>}
      </summary>

      {opened && (
      <div className="aprod-body">
        <div className="aprod-row">
          {!canPublish && <p className="field-hint">Only an owner can change the status or sign off the review.</p>}
          <label>
            Where is this product?
            <select value={draft.status} disabled={!canPublish} onChange={(e) => set('status', e.target.value as ProductStatus)}>
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <span className="field-hint">{STATUS_HELP[draft.status]}</span>
          </label>
        </div>

        {needs.length > 0 && (
          <div className="notice" role="status">
            <strong>To finish before this status can be saved:</strong>
            <ul>{needs.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}

        <Section title="1. Website text" hint="Only this text can ever appear on the website." open>
          <label>Public name<input value={draft.public_name ?? ''} maxLength={80} onChange={(e) => set('public_name', e.target.value || null)} /></label>
          <label>Approved description<textarea rows={3} maxLength={1200} value={draft.public_description ?? ''} onChange={(e) => set('public_description', e.target.value || null)} /></label>
          <label>Public text reviewed by<input value={draft.reviewed_by ?? ''} maxLength={120} disabled={!canPublish} onChange={(e) => set('reviewed_by', e.target.value || null)} /></label>
          <label className="check"><input type="checkbox" checked={draft.claims_reviewed} disabled={!canPublish} onChange={(e) => set('claims_reviewed', e.target.checked)} /> Public text checked for regulatory and advertising claims</label>
        </Section>

        <GalleryEditor product={product} api={api} onExpired={onExpired} canEdit={canEdit} onPrimary={(first) => onSaved({ ...product, public_image: first?.path ?? null, public_image_alt: first?.alt ?? null })} />
        <VariantsEditor product={product} api={api} onExpired={onExpired} canEdit={canEdit} canPrice={me.can('products.price')} />

        <Section title="4. Ingredients shown publicly">
          <label className="check"><input type="checkbox" checked={draft.composition_verified} disabled={!canPublish} onChange={(e) => set('composition_verified', e.target.checked)} /> Manufacturer-approved composition verified for public release</label>
          <label className="check"><input type="checkbox" checked={draft.preservatives_verified} disabled={!canPublish} onChange={(e) => set('preservatives_verified', e.target.checked)} /> Preservatives verified{product.preservatives === null ? ' (not supplied; verification required)' : ''}</label>
          <label className="check"><input type="checkbox" checked={draft.ingredients_public} disabled={!canPublish} onChange={(e) => set('ingredients_public', e.target.checked)} /> Show ingredients publicly</label>
        </Section>

        <Section title="Advanced: label details and internal record" hint="Rarely needed. Nothing here is shown on the website.">
          <Section title="Label details" hint="Internal label information for your team.">
            <label>Product name (internal)<input value={draft.internal_name} maxLength={120} onChange={(e) => set('internal_name', e.target.value)} /></label>
            <label>Form<input list="product-forms" value={draft.form} maxLength={40} onChange={(e) => set('form', e.target.value)} /></label>
            <label>Country of origin<input value={draft.country_of_origin} maxLength={60} onChange={(e) => set('country_of_origin', e.target.value)} /></label>
            <label>Manufacturer / packer name and address<textarea rows={2} maxLength={400} value={draft.manufacturer_details ?? ''} onChange={(e) => set('manufacturer_details', e.target.value || null)} /></label>
            <label>Shelf life / best before (as on the pack)<input value={draft.shelf_life ?? ''} maxLength={60} onChange={(e) => set('shelf_life', e.target.value || null)} /></label>
          </Section>
          <details className="asec">
            <summary>Internal formulation record (as supplied, not verified; never public)</summary>
            <div className="asec-body">
            <p className="field-hint">{product.notes}</p>
            <h4>Ingredients ({product.ingredients.length})</h4>
            <ul className="ing-list">{product.ingredients.map((i) => <li key={i}>{i}</li>)}</ul>
          {Object.entries(product.sub_compositions).map(([g, parts]) => (
              <div key={g}><h4>{g} composition ({parts.length})</h4><ul className="ing-list">{parts.map((i) => <li key={i}>{i}</li>)}</ul></div>
          ))}
            <h4>{product.preservative_label}</h4>
          {product.preservatives ? <ul className="ing-list">{product.preservatives.map((i) => <li key={i}>{i}</li>)}</ul> : <p>Not supplied. Verification required.</p>}
            </div>
          </details>
        </Section>

        <div className="admin-actions">
          <button type="button" className="btn" disabled={busy || !dirty || !canEdit} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="btn btn--ghost" disabled={busy || !dirty} onClick={() => { setDraft(product); setMessage(null); }}>Discard</button>
        </div>
        <div aria-live="polite">
          {message && (
            <div className={`form-status form-status--${message.kind === 'ok' ? 'info' : 'error'}`}>
              {message.text}
              {message.problems && <ul>{message.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            </div>
          )}
        </div>
      </div>
      )}
    </details>
  );
}


const EMPTY_NEW = { internal_name: '', public_name: '', form: 'Syrup', pack_size: '', price: '', public_description: '', public_image: null as string | null, public_image_alt: null as string | null, country_of_origin: 'India', manufacturer_details: '', shelf_life: '' };

function NewProduct({ api, onExpired, onCreated }: { api: Api; onExpired: () => void; onCreated: (p: InternalProduct) => void }) {
  const me = useMe();
  const canPrice = me.can('products.price');
  const [f, setF] = useState(EMPTY_NEW);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; problems?: string[] } | null>(null);
  const price = useMemo(() => rupeesToPaise(f.price), [f.price]);
  const set = <K extends keyof typeof EMPTY_NEW>(k: K, v: (typeof EMPTY_NEW)[K]) => setF((d) => ({ ...d, [k]: v }));
  const valid = f.internal_name.trim() !== '' && f.form.trim() !== '' && f.pack_size.trim() !== '' && price.ok;

  async function create() {
    setBusy(true);
    setMessage(null);
    const body = {
      internal_name: f.internal_name,
      public_name: f.public_name || null,
      form: f.form,
      pack_size: f.pack_size,
      ...(canPrice ? { price_paise: price.ok ? price.value : null } : {}),
      public_description: f.public_description || null,
      public_image: f.public_image,
      public_image_alt: f.public_image_alt,
      country_of_origin: f.country_of_origin,
      manufacturer_details: f.manufacturer_details || null,
      shelf_life: f.shelf_life || null,
    };
    const r = await api<{ item: InternalProduct }>('products', { method: 'POST', body });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (r.ok && r.data?.item) {
      onCreated(r.data.item);
      setF(EMPTY_NEW);
      setOpen(false);
      return;
    }
    setMessage({ text: r.data?.message ?? 'Could not create the product.', problems: r.data?.problems });
  }

  return (
    <details className="aprod anew" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><span className="aprod-name">+ Add a new product</span><span className="aprod-meta">Starts as a private draft</span></summary>
      <div className="aprod-body">
        <p className="field-hint">Fill the four boxes marked * and press Create draft. Everything else is optional and can be added later. A new product is always private until you approve it.</p>
        <div className="aprod-fields aprod-essentials">
          <label>1. Product name * <span className="field-hint">(for your team)</span><input value={f.internal_name} maxLength={120} onChange={(e) => set('internal_name', e.target.value)} /></label>
          <label>2. Form * <span className="field-hint">(syrup, capsules, powder…)</span><input list="product-forms" value={f.form} maxLength={40} onChange={(e) => set('form', e.target.value)} /></label>
          <label>3. Pack size * <span className="field-hint">(for example 200 ml or 30 capsules)</span><input value={f.pack_size} maxLength={40} placeholder="e.g. 200 ml or 30 capsules" onChange={(e) => set('pack_size', e.target.value)} /></label>
          {canPrice && <label>4. Price (MRP) in rupees <span className="field-hint">(all taxes included)</span><input inputMode="decimal" value={f.price} placeholder="e.g. 349" onChange={(e) => set('price', e.target.value)} aria-invalid={!price.ok} /></label>}
          {canPrice && !price.ok && <p className="form-status form-status--error" role="alert">Enter a price like 349 or 349.50.</p>}
        </div>
        <Section title="Website text and photo (optional)" hint="Checked for banned claims. Never public until reviewed and approved.">
          <label>Public name<input value={f.public_name} maxLength={80} onChange={(e) => set('public_name', e.target.value)} /></label>
          <label>Description<textarea rows={3} maxLength={1200} value={f.public_description} onChange={(e) => set('public_description', e.target.value)} /></label>
          <ImageField value={f.public_image} alt={f.public_image_alt} api={api} onExpired={onExpired} onChange={(v) => set('public_image', v)} onAlt={(v) => set('public_image_alt', v)} />
        </Section>
        <Section title="Label details (optional)">
          <label>Country of origin<input value={f.country_of_origin} maxLength={60} onChange={(e) => set('country_of_origin', e.target.value)} /></label>
          <label>Manufacturer / packer name and address<textarea rows={2} maxLength={400} value={f.manufacturer_details} onChange={(e) => set('manufacturer_details', e.target.value)} /></label>
          <label>Shelf life / best before<input value={f.shelf_life} maxLength={60} onChange={(e) => set('shelf_life', e.target.value)} /></label>
        </Section>
        <div className="admin-actions">
          <button type="button" className="btn" disabled={busy || !valid} onClick={() => void create()}>{busy ? 'Creating…' : 'Create draft'}</button>
        </div>
        <div aria-live="polite">
          {message && (
            <div className="form-status form-status--error">
              {message.text}
              {message.problems && <ul>{message.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

export default function AdminProducts({ api, onExpired }: { api: Api; onExpired: () => void }) {
  const me = useMe();
  const [items, setItems] = useState<InternalProduct[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const load = useCallback(async () => {
    const r = await api<{ items: InternalProduct[] }>('products');
    if (r.status === 401) return onExpired();
    if (r.ok && r.data) setItems(r.data.items);
    else setError(r.data?.message ?? 'Could not load products. Have the products tables been created (supabase/products.sql)?');
  }, [api, onExpired]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="form-status form-status--error" role="alert">{error}</p>;
  if (!items) return <p role="status">Loading products…</p>;
  const counts: Record<string, number> = {};
  for (const p of items) counts[p.status] = (counts[p.status] ?? 0) + 1;
  const needle = q.trim().toLowerCase();
  const shown = items.filter(
    (p) => (statusFilter === 'ALL' || p.status === statusFilter) && (!needle || `${p.internal_name} ${p.public_name ?? ''} ${p.form} ${p.pack_size}`.toLowerCase().includes(needle)),
  );

  return (
    <div className="aprods">
      <datalist id="product-forms">{FORMS.map((x) => <option key={x} value={x} />)}</datalist>
      {me.can('products.create') && <NewProduct api={api} onExpired={onExpired} onCreated={(p) => setItems((cur) => [...(cur ?? []), p])} />}
      {items.length === 0 && <p>No products yet. Add one above, or run supabase/products_seed.sql for the eight formulations.</p>}
      <p className="field-hint">
        A product stays private until it is set to “Approved for preview” or “Approved for sale” and passes the checks. Open a product to edit it.
      </p>
      {items.length > 0 && (
        <div className="aprod-filter">
          <input type="search" value={q} placeholder="Search products" aria-label="Search products" onChange={(e) => setQ(e.target.value)} />
          <div className="aprod-chips" role="group" aria-label="Filter by status">
            {[{ id: 'ALL', label: 'All' }, ...PRODUCT_STATUSES.map((st) => ({ id: st as string, label: STATUS_LABELS[st] }))]
              .filter((c) => c.id === 'ALL' || counts[c.id])
              .map((c) => (
                <button key={c.id} type="button" className="aprod-chip" aria-pressed={statusFilter === c.id} onClick={() => setStatusFilter(c.id)}>
                  {c.label} <span className="aprod-chip-n">{c.id === 'ALL' ? items.length : counts[c.id]}</span>
                </button>
              ))}
          </div>
        </div>
      )}
      {shown.length === 0 && items.length > 0 && <p className="field-hint">No products match. Clear the search or filter.</p>}
      {shown.map((p) => (
        <ProductEditor key={p.id} product={p} api={api} onExpired={onExpired} onSaved={(n) => setItems((cur) => cur?.map((x) => (x.id === n.id ? n : x)) ?? cur)} />
      ))}
    </div>
  );
}
