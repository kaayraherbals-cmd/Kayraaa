import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { claimProblems, publishProblems, toPublic, validateUpdate, type InternalProduct, type PublicViewRow } from './products.js';

interface Seed { slug: string; internal_name: string; form: string; pack_size: string; ingredients: string[]; sub: Record<string, string[]>; pres: string[] | null; label: string }
const seed = JSON.parse(readFileSync(new URL('../supabase/products.seed.json', import.meta.url), 'utf8')) as Seed[];
const bySlug = (s: string) => seed.find((p) => p.slug === s)!;

const ready = {
  public_name: 'Iron Syrup',
  public_description: 'A formulation currently in development at Kaayra.',
  public_image: null,
  public_image_alt: null,
  ingredients_public: false,
  composition_verified: false,
  preservatives_verified: false,
  claims_reviewed: true,
  reviewed_by: 'A. Reviewer',
  preservatives: null,
} satisfies Pick<InternalProduct, 'public_name' | 'public_description' | 'public_image' | 'public_image_alt' | 'ingredients_public' | 'composition_verified' | 'preservatives_verified' | 'claims_reviewed' | 'reviewed_by' | 'preservatives'>;

describe('the eight supplied formulations', () => {
  it('are all present, in order, with the supplied form and pack size', () => {
    expect(seed.map((p) => p.internal_name)).toEqual(['LIVER DS + XZYME SYP', 'PILES SYRUP', 'PILES CAP', 'LEUCORRHOEA SYP', 'PCOS SYRUP', 'PCOS CAP', 'IRON SYRUP', 'MULTI-VITAMIN SYRUP']);
    expect(seed.map((p) => `${p.form}/${p.pack_size}`)).toEqual(['Syrup/200 ml', 'Syrup/200 ml', 'Capsules/30 capsules', 'Syrup/200 ml', 'Syrup/200 ml', 'Capsules/30 capsules', 'Syrup/150 ml', 'Syrup/200 ml']);
  });
  it('keep every supplied ingredient (counts match the brief)', () => {
    expect(seed.map((p) => p.ingredients.length)).toEqual([18, 9, 16, 19, 36, 13, 8, 17]);
    expect(bySlug('pcos-syrup').sub.Dashmool).toHaveLength(10);
  });
  it('preserve the supplied spelling, including parenthetical names', () => {
    expect(bySlug('piles-syrup').ingredients).toContain('Kuvarpathu (Aloe Vera)');
    expect(bySlug('iron-syrup').ingredients).toContain('Annabhedi / Kasisa');
    expect(bySlug('pcos-cap').ingredients).toContain('Yashad Bhasma');
    expect(bySlug('piles-cap').label).toBe('Preservatives / Excipients');
  });
  it('do not invent preservatives where none were supplied', () => {
    expect(bySlug('iron-syrup').pres).toBeNull();
    expect(bySlug('multi-vitamin-syrup').pres).toBeNull();
    expect(bySlug('piles-syrup').pres).toEqual(['Sodium Methyl Paraben IP', 'Sodium Propyl Paraben IP', 'Sodium Benzoate IP', 'Bronopol IP']);
  });
  it('start with every record unpublished in the seed SQL', () => {
    const sql = readFileSync(new URL('../supabase/products_seed.sql', import.meta.url), 'utf8');
    expect(sql.includes('APPROVED')).toBe(false);
    expect(sql.includes('status')).toBe(false); // status column is left at its DRAFT default
  });
});

describe('claim screening', () => {
  it('blocks the claims the brief forbids and common treatment claims', () => {
    for (const t of ['AYUSH Approved formula', 'Government approved medicine', 'Clinically proven results', 'GMP Certified facility', 'Cures piles', 'treats PCOS', '100% safe', 'guaranteed relief', 'no side effects']) {
      expect(claimProblems(t).length > 0).toBe(true);
    }
  });
  it('allows plain, factual preview text', () => {
    expect(claimProblems('A syrup formulation currently in development. Details will be shared once confirmed.')).toEqual([]);
  });
});

describe('publication gate', () => {
  it('allows a reviewed preview', () => {
    expect(publishProblems(ready, 'APPROVED_FOR_PREVIEW')).toEqual([]);
  });
  it('requires name, description, claims review and a named reviewer', () => {
    expect(publishProblems({ ...ready, public_name: null }, 'APPROVED_FOR_PREVIEW').length).toBe(1);
    expect(publishProblems({ ...ready, public_description: 'Too short' }, 'APPROVED_FOR_PREVIEW').length).toBe(1);
    expect(publishProblems({ ...ready, claims_reviewed: false }, 'APPROVED_FOR_PREVIEW').length).toBe(1);
    expect(publishProblems({ ...ready, reviewed_by: '  ' }, 'APPROVED_FOR_PREVIEW').length).toBe(1);
  });
  it('allows approval for sale once reviewed, and blocks it without the review', () => {
    expect(publishProblems(ready, 'APPROVED_FOR_SALE')).toEqual([]);
    expect(publishProblems({ ...ready, claims_reviewed: false }, 'APPROVED_FOR_SALE').length).toBe(1);
  });
  it('blocks ingredients until composition and preservatives are verified', () => {
    expect(publishProblems({ ...ready, ingredients_public: true }, 'APPROVED_FOR_PREVIEW').length).toBe(2);
    expect(publishProblems({ ...ready, ingredients_public: true, composition_verified: true }, 'APPROVED_FOR_PREVIEW').length).toBe(1);
    expect(publishProblems({ ...ready, ingredients_public: true, composition_verified: true, preservatives_verified: true }, 'APPROVED_FOR_PREVIEW')).toEqual([]);
    expect(publishProblems({ ...ready, preservatives: null, ingredients_public: true, composition_verified: true }, 'APPROVED_FOR_PREVIEW')[0]!.includes('not supplied')).toBe(true);
  });
  it('blocks unsupported claims in public text', () => {
    expect(publishProblems({ ...ready, public_description: 'A clinically proven formulation for everyone.' }, 'APPROVED_FOR_PREVIEW').length).toBe(1);
  });
  it('always lets an admin hide a product, even one with poor text', () => {
    expect(publishProblems({ ...ready, public_description: 'Cures everything, clinically proven.', ingredients_public: true }, 'UNDER_REVIEW')).toEqual([]);
    expect(publishProblems({ ...ready, public_name: null }, 'DRAFT')).toEqual([]);
  });
  it('still screens text that is being edited on a hidden product', () => {
    expect(publishProblems({ ...ready, public_description: 'This cures piles.' }, 'DRAFT', { screenText: true }).length).toBe(1);
  });
});

describe('update validation', () => {
  it('accepts only whitelisted fields and ignores everything else', () => {
    const r = validateUpdate({ status: 'UNDER_REVIEW', public_name: ' Iron Syrup ', ingredients: ['x'], slug: 'hack', notes: 'hack', sort_order: 1, id: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.update).toEqual({ status: 'UNDER_REVIEW', public_name: 'Iron Syrup' });
  });
  it('rejects bad statuses, types and image paths', () => {
    expect(validateUpdate({ status: 'LIVE' }).ok).toBe(false);
    expect(validateUpdate({ claims_reviewed: 'yes' }).ok).toBe(false);
    expect(validateUpdate({ public_image: 'https://evil.example/x.png' }).ok).toBe(false);
    expect(validateUpdate({ public_image: '/images/products/../../x.png' }).ok).toBe(false);
    expect(validateUpdate({ public_image: '/images/products/iron-syrup.webp' }).ok).toBe(true);
    expect(validateUpdate([]).ok).toBe(false);
  });
});

describe('public projection', () => {
  const row: PublicViewRow = { slug: 'iron-syrup', name: 'Iron Syrup', form: 'Syrup', pack_size: '150 ml', status: 'APPROVED_FOR_PREVIEW', description: 'In development.', public_image: null, public_image_alt: null, ingredients: null, sub_compositions: null, preservatives: null };
  it('exposes no internal fields and no price, and marks only approved-for-sale products purchasable', () => {
    const out = toPublic({ ...row, internal_name: 'IRON SYRUP', notes: 'secret' } as PublicViewRow);
    expect(Object.keys(out).sort()).toEqual(['description', 'form', 'image', 'images', 'ingredients', 'name', 'packSize', 'packSizes', 'preservativeLabel', 'preservatives', 'purchasable', 'slug', 'statusLabel', 'subCompositions']);
    expect(out.purchasable).toBe(false);
    expect(out.ingredients).toBeNull();
    expect(out.statusLabel).toBe('In Development');
    expect(toPublic({ ...row, status: 'APPROVED_FOR_SALE' }).purchasable).toBe(true);
  });
  it('only passes through ingredients the database view released, and only same-origin images', () => {
    expect(toPublic({ ...row, ingredients: ['A', 'B'], preservatives: ['P'] }).ingredients).toEqual(['A', 'B']);
    expect(toPublic({ ...row, ingredients: [], preservatives: ['P'] }).preservatives).toBeNull();
    expect(toPublic({ ...row, public_image: 'https://evil.example/a.png', public_image_alt: 'x' }).image).toBeNull();
    expect(toPublic({ ...row, public_image: '/images/products/iron-syrup.webp', public_image_alt: 'A bottle' }).image).toEqual({ src: '/images/products/iron-syrup.webp', alt: 'A bottle' });
  });
  it('adds the photo gallery and pack-size labels, and nothing else, from the extra views', () => {
    const IMG = (n: string) => `/api/media/0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e${n}.webp`;
    const out = toPublic(row, {
      images: [
        { slug: 'iron-syrup', path: IMG('20'), alt: 'Side label', sort_order: 2 },
        { slug: 'iron-syrup', path: IMG('10'), alt: 'Front of pack', sort_order: 1 },
        { slug: 'other-product', path: IMG('30'), alt: 'Not mine', sort_order: 1 },
        { slug: 'iron-syrup', path: 'https://evil.example/x.png', alt: 'Offsite', sort_order: 3 },
      ],
      packSizes: ['150 ml', '300 ml'],
    });
    expect(out.images).toEqual([{ src: IMG('10'), alt: 'Front of pack' }, { src: IMG('20'), alt: 'Side label' }]);
    expect(out.image).toEqual({ src: IMG('10'), alt: 'Front of pack' });
    expect(out.packSizes).toEqual(['150 ml', '300 ml']);
    const json = JSON.stringify(out);
    for (const secret of ['price', 'sku', 'stock', 'batch', 'gst', 'hsn']) expect(json.toLowerCase()).not.toContain(secret);
  });
  it('falls back to the single legacy photo and the product pack size when there is no gallery or variant data', () => {
    const out = toPublic({ ...row, public_image: '/images/products/iron-syrup.webp', public_image_alt: 'A bottle' });
    expect(out.images).toEqual([{ src: '/images/products/iron-syrup.webp', alt: 'A bottle' }]);
    expect(out.packSizes).toEqual(['150 ml']);
    expect(toPublic(row).images).toEqual([]);
  });
});
