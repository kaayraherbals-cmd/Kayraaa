import { describe, expect, it } from 'vitest';
import { IMAGE_PATH_RE, MEDIA_FILE_RE, paiseToRupees, rupeesToPaise, slugify, sniffImage, validateCreate, validateUpdate } from './products.js';

const base = { internal_name: 'Ashwagandha Capsules', form: 'Capsules', pack_size: '60 capsules' };

describe('rupeesToPaise', () => {
  it('converts rupee text exactly', () => {
    expect(rupeesToPaise('349')).toEqual({ ok: true, value: 34900 });
    expect(rupeesToPaise('1,299.50')).toEqual({ ok: true, value: 129950 });
    expect(rupeesToPaise('₹ 0.10')).toEqual({ ok: true, value: 10 });
    expect(rupeesToPaise('19.99')).toEqual({ ok: true, value: 1999 });
  });
  it('treats empty as no price and rejects junk, zero and absurd values', () => {
    expect(rupeesToPaise('')).toEqual({ ok: true, value: null });
    for (const bad of ['abc', '-5', '0', '12.345', '1e3', '99999999', '10,00,001']) expect(rupeesToPaise(bad).ok).toBe(false);
  });
  it('round-trips for display', () => {
    expect(paiseToRupees(34900)).toBe('349');
    expect(paiseToRupees(129950)).toBe('1299.50');
    expect(paiseToRupees(null)).toBe('');
  });
});

describe('sniffImage', () => {
  it('recognises real image headers', () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpg');
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('png');
    expect(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0]))).toBe('webp');
  });
  it('rejects SVG, HTML, scripts and empty input whatever the file name claims', () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    expect(sniffImage(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(enc('<html><script>1</script></html>'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe('image paths', () => {
  const id = '3f2b8c1e-9d4a-4e6b-8a1c-0b7d5e2f4a91';
  it('accepts uploaded media and self-hosted files only', () => {
    expect(IMAGE_PATH_RE.test(`/api/media/${id}.webp`)).toBe(true);
    expect(IMAGE_PATH_RE.test('/images/products/iron-syrup.webp')).toBe(true);
    for (const bad of ['https://evil.example/x.png', '/api/media/../../etc/passwd.png', `/api/media/${id}.svg`, '/images/products/../x.png', `//evil.example/${id}.png`]) {
      expect(IMAGE_PATH_RE.test(bad)).toBe(false);
    }
  });
  it('limits stored file names to the three sniffed types', () => {
    expect(MEDIA_FILE_RE.test(`${id}.png`)).toBe(true);
    expect(MEDIA_FILE_RE.test(`${id}.avif`)).toBe(false);
    expect(MEDIA_FILE_RE.test(`${id}.png/../x`)).toBe(false);
  });
});

describe('slugify', () => {
  it('makes safe slugs', () => {
    expect(slugify('LIVER DS + XZYME SYP')).toBe('liver-ds-xzyme-syp');
    expect(slugify('  Tulsi & Ginger Tea!  ')).toBe('tulsi-ginger-tea');
    expect(slugify('Café Ünïcode')).toBe('cafe-unicode');
  });
});

describe('validateCreate', () => {
  it('creates a minimal draft and derives the slug', () => {
    const v = validateCreate(base);
    expect(v.ok && v.product.slug).toBe('ashwagandha-capsules');
    expect(v.ok && v.product.country_of_origin).toBe('India');
    expect(v.ok && v.product.price_paise).toBeNull();
  });
  it('requires name, form and pack size', () => {
    expect(validateCreate({}).ok).toBe(false);
    expect(validateCreate({ ...base, pack_size: '  ' }).ok).toBe(false);
  });
  it('screens banned claims in public text at creation', () => {
    const v = validateCreate({ ...base, public_name: 'Ashwagandha', public_description: 'Clinically proven to cure stress. 100% guaranteed.' });
    expect(v.ok).toBe(false);
    expect(!v.ok && v.errors.join(' ')).toMatch(/clinically/i);
  });
  it('needs alt text with an image and rejects foreign image URLs and bad prices', () => {
    const id = '3f2b8c1e-9d4a-4e6b-8a1c-0b7d5e2f4a91';
    expect(validateCreate({ ...base, public_image: `/api/media/${id}.webp` }).ok).toBe(false);
    expect(validateCreate({ ...base, public_image: `/api/media/${id}.webp`, public_image_alt: 'Bottle on a table' }).ok).toBe(true);
    expect(validateCreate({ ...base, public_image: 'https://evil.example/a.png', public_image_alt: 'x' }).ok).toBe(false);
    expect(validateCreate({ ...base, price_paise: 12.5 }).ok).toBe(false);
    expect(validateCreate({ ...base, price_paise: -1 }).ok).toBe(false);
  });
  it('never accepts status or review flags: a new product is always a private draft', () => {
    const v = validateCreate({ ...base, status: 'APPROVED_FOR_SALE', claims_reviewed: true, reviewed_by: 'x', composition_verified: true });
    expect(v.ok).toBe(true);
    expect(v.ok && Object.keys(v.product)).not.toContain('status');
    expect(v.ok && Object.keys(v.product)).not.toContain('claims_reviewed');
  });
});

describe('validateUpdate (new fields)', () => {
  it('accepts price and labelling edits and rejects blanks in required fields', () => {
    expect(validateUpdate({ price_paise: 34900, country_of_origin: 'India', shelf_life: '24 months' }).ok).toBe(true);
    expect(validateUpdate({ price_paise: null }).ok).toBe(true);
    expect(validateUpdate({ price_paise: 0 }).ok).toBe(false);
    expect(validateUpdate({ internal_name: '  ' }).ok).toBe(false);
    expect(validateUpdate({ pack_size: 'x'.repeat(41) }).ok).toBe(false);
  });
});
