import { describe, expect, it } from 'vitest';
import { auditFilter, auditLabel, parseAuditQuery, summariseDetail } from './audit.js';
import { MAX_GALLERY_IMAGES, removedPaths, validateGallery } from './gallery.js';
import { makeSku, publicPackSizes, touchesPrice, validateVariantCreate, validateVariantUpdate } from './variants.js';

const IMG1 = '/api/media/0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10.webp';
const IMG2 = '/api/media/1c7d3c1f-6d8a-4cab-9e2f-4a3b0d2e8f21.jpg';

describe('variants', () => {
  it('makes readable SKUs', () => {
    expect(makeSku('iron-syrup', '150 ml')).toBe('IRON-SYRUP-150ML');
    expect(makeSku('piles-cap', '30 capsules')).toBe('PILES-CAP-30CAPSULES');
    expect(makeSku('x', '')).toBe('X');
    expect(makeSku('a'.repeat(60), '200 ml').length).toBeLessThanOrEqual(40);
  });
  it('validates a new pack size', () => {
    const r = validateVariantCreate({ pack_size: ' 200 ml ', sku: 'iron-200', price_paise: 34900, gst_rate: 12, hsn_code: '3004', barcode: '8901234567890', low_stock_threshold: 25 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ pack_size: '200 ml', sku: 'IRON-200', price_paise: 34900, gst_rate: 12, hsn_code: '3004', barcode: '8901234567890', low_stock_threshold: 25 });
    expect(validateVariantCreate({}).ok).toBe(false);
    expect(validateVariantCreate({ pack_size: 'x'.repeat(41) }).ok).toBe(false);
  });
  it('rejects bad money, tax and codes', () => {
    for (const bad of [{ price_paise: 0 }, { price_paise: -5 }, { price_paise: 1.5 }, { price_paise: 'x' }, { gst_rate: 7 }, { gst_rate: '12' }, { hsn_code: '30' }, { hsn_code: 'ABCD' }, { barcode: '123' }, { sku: 'a b' }, { low_stock_threshold: -1 }, { status: 'gone' }]) {
      expect(validateVariantCreate({ pack_size: '200 ml', ...bad }).ok).toBe(false);
    }
    expect(validateVariantCreate({ pack_size: '200 ml', price_paise: null, gst_rate: null, hsn_code: '', barcode: null }).ok).toBe(true);
  });
  it('updates only what is sent, and spots price changes', () => {
    expect(validateVariantUpdate({}).ok).toBe(false);
    const a = validateVariantUpdate({ status: 'inactive' });
    expect(a.ok && touchesPrice(a.value)).toBe(false);
    const b = validateVariantUpdate({ price_paise: 29900 });
    expect(b.ok && touchesPrice(b.value)).toBe(true);
    const c = validateVariantUpdate({ gst_rate: 5 });
    expect(c.ok && touchesPrice(c.value)).toBe(true);
    const d = validateVariantUpdate({ hsn_code: null });
    expect(d.ok && touchesPrice(d.value)).toBe(true);
  });
  it('shows the public only pack-size labels, active ones, in order, without duplicates', () => {
    expect(publicPackSizes([{ pack_size: '200 ml', status: 'active', sort_order: 2 }, { pack_size: '100 ml', status: 'active', sort_order: 1 }, { pack_size: '500 ml', status: 'inactive', sort_order: 3 }, { pack_size: '100 ml', status: 'active', sort_order: 4 }])).toEqual(['100 ml', '200 ml']);
  });
});

describe('photo gallery', () => {
  it('accepts uploaded photos with descriptions, in order', () => {
    const r = validateGallery({ images: [{ path: IMG1, alt: 'Front of the pack' }, { path: IMG2, alt: ' Side label ' }] });
    expect(r).toEqual({ ok: true, images: [{ path: IMG1, alt: 'Front of the pack' }, { path: IMG2, alt: 'Side label' }] });
    expect(validateGallery({ images: [] }).ok).toBe(true);
  });
  it('requires a description and a real uploaded path', () => {
    expect(validateGallery({ images: [{ path: IMG1, alt: '' }] }).ok).toBe(false);
    expect(validateGallery({ images: [{ path: IMG1, alt: 'ab' }] }).ok).toBe(false);
    expect(validateGallery({ images: [{ path: 'https://evil.example/x.png', alt: 'Front of the pack' }] }).ok).toBe(false);
    expect(validateGallery({ images: [{ path: '/api/media/../../etc/passwd', alt: 'Front of the pack' }] }).ok).toBe(false);
    expect(validateGallery({ images: [{ path: IMG1, alt: 'Front' }, { path: IMG1, alt: 'Again' }] }).ok).toBe(false);
    expect(validateGallery({ images: 'x' }).ok).toBe(false);
    expect(validateGallery(null).ok).toBe(false);
  });
  it('caps the number of photos and screens descriptions for banned claims', () => {
    const many = Array.from({ length: MAX_GALLERY_IMAGES + 1 }, (_, i) => ({ path: `/api/media/${i.toString(16).padStart(8, '0')}-5c79-4b9a-8d1e-3f2a9c1d7e10.webp`, alt: 'A photo' }));
    expect(validateGallery({ images: many }).ok).toBe(false);
    expect(validateGallery({ images: many.slice(0, MAX_GALLERY_IMAGES) }).ok).toBe(true);
    expect(validateGallery({ images: [{ path: IMG1, alt: 'Clinically proven formula on the label' }] }).ok).toBe(false);
  });
  it('works out which stored files were dropped', () => {
    expect(removedPaths([IMG1, IMG2], [{ path: IMG2, alt: 'x' }])).toEqual([IMG1]);
    expect(removedPaths([], [{ path: IMG2, alt: 'x' }])).toEqual([]);
  });
});

describe('audit log filters', () => {
  it('keeps only recognised, safe filter values', () => {
    const q = parseAuditQuery({ actor: "boss@kaayra.in'; drop table", action: 'login', from: '2026-10-01', to: '2026-13-45' });
    expect(q).toEqual({ actor: 'boss@kaayra.indroptable', action: 'login', from: '2026-10-01', to: '' });
    expect(parseAuditQuery({ action: 'not_an_action' }).action).toBe('');
    expect(parseAuditQuery({ actor: ['a'] }).actor).toBe('');
    expect(parseAuditQuery({ actor: 'x'.repeat(200) }).actor).toHaveLength(80);
  });
  it('builds a filter with the day range in India time', () => {
    const f = auditFilter({ actor: 'boss', action: 'order_status', from: '2026-10-01', to: '2026-10-31' });
    expect(f).toBe('&actor=ilike.*boss*&action=eq.order_status&at=gte.2026-10-01T00%3A00%3A00%2B05%3A30&at=lt.2026-11-01T00%3A00%3A00%2B05%3A30');
    expect(auditFilter({ actor: '', action: '', from: '', to: '' })).toBe('');
  });
  it('labels actions and summarises details, masking anything secret-looking', () => {
    expect(auditLabel('batch_receive')).toBe('Stock received');
    expect(auditLabel('something_new')).toBe('something_new');
    expect(summariseDetail({ id: 'abc', fields: ['status', 'public_name'], count: 3, note: null })).toBe('id: abc · fields: status, public_name · count: 3 · note: ');
    expect(summariseDetail({ password: 'hunter2', recovery_code: 'AAAA', ok: true })).toBe('password: •••• · recovery_code: •••• · ok: true');
    expect(summariseDetail({ x: 'y'.repeat(500) }, 50)).toHaveLength(50);
    expect(summariseDetail(null)).toBe('');
  });
});
