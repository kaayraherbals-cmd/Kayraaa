import { describe, expect, it } from 'vitest';
import { toPublicBundles } from './bundleView.js';

const row = { id: 'x', slug: 'kit', name: 'Kit', kind: 'wellness_kit', description: null, gift_note: null, available: 3,
  price: { ok: true, combined_paise: 130000, discount_paise: 13000, final_paise: 117000, savings_paise: 13000 },
  components: [{ variant_id: 'v1', product: 'A', pack_size: '60 tabs', qty: 2 }, { variant_id: 'v2', product: 'B', pack_size: '200 ml', qty: 1 }] };

describe('toPublicBundles', () => {
  it('maps a valid bundle and exposes no ids', () => {
    const [b] = toPublicBundles([row]);
    expect(b?.finalPaise).toBe(117000);
    expect(b?.savingsPaise).toBe(13000);
    expect(b?.components.length).toBe(2);
    expect(JSON.stringify(b).includes('variant_id')).toBe(false);
  });
  it('drops a bundle whose saving is not real or does not add up', () => {
    expect(toPublicBundles([{ ...row, price: { ...row.price, savings_paise: 0, final_paise: 130000 } }]).length).toBe(0);
    expect(toPublicBundles([{ ...row, price: { ...row.price, final_paise: 100000 } }]).length).toBe(0);
  });
  it('drops bundles with fewer than two valid components or bad input', () => {
    expect(toPublicBundles([{ ...row, components: [row.components[0]] }]).length).toBe(0);
    expect(toPublicBundles('x')).toEqual([]);
  });
  it('treats a missing availability as zero', () => {
    expect(toPublicBundles([{ ...row, available: undefined }])[0]?.available).toBe(0);
  });
});
