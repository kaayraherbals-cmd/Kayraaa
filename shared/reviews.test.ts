import { describe, expect, it } from 'vitest';
import { averageFrom, cleanText, parsePage, parseRating, parseReply, parseReviewInput, parseSort, parseStarFilter, prepareReviewImage, safetyFlags, stripImageMetadata } from './reviews.js';

describe('rating', () => {
  it('accepts only whole numbers 1 to 5', () => {
    for (const v of [1, 2, 3, 4, 5]) expect(parseRating(v)).toBe(v);
    for (const v of [0, 6, -1, 4.5, NaN, '5', null, undefined, Infinity]) expect(parseRating(v)).toBeNull();
  });
  it('computes the average from the distribution, null when empty', () => {
    expect(averageFrom({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 })).toBeNull();
    expect(averageFrom({ '1': 1, '2': 0, '3': 0, '4': 1, '5': 2 })).toBe(3.75);
  });
});

describe('review input', () => {
  it('strips markup and control characters and keeps plain text', () => {
    const r = parseReviewInput({ rating: 5, title: '<b>Great</b> value', body: 'Nice.<script>alert(1)</script> Used daily\u0000 for weeks.' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe('Great value');
      expect(r.value.body).not.toMatch(/[<>]/);
      expect(r.value.body).not.toContain('\u0000');
    }
  });
  it('rejects bad rating, short or long text and wrong types', () => {
    expect(parseReviewInput({ rating: 7, title: 'abc', body: 'a long enough body' }).ok).toBe(false);
    expect(parseReviewInput({ rating: 3, title: 'ab', body: 'a long enough body' }).ok).toBe(false);
    expect(parseReviewInput({ rating: 3, title: 'abc', body: 'short' }).ok).toBe(false);
    expect(parseReviewInput({ rating: 3, title: 'abc', body: 'x'.repeat(2001) }).ok).toBe(false);
    expect(parseReviewInput({ rating: 3, title: 12, body: {} }).ok).toBe(false);
  });
  it('does not let a client set a verified flag or status (they are not part of the parsed value)', () => {
    const r = parseReviewInput({ rating: 4, title: 'Fine syrup', body: 'Taste is fine, packaging ok.', verified_purchase: true, status: 'PUBLISHED', member_id: 'x' });
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['body', 'rating', 'title']);
  });
  it('cleans multiline text', () => {
    expect(cleanText('a\r\n\r\n\r\n\r\nb   c', true)).toBe('a\n\nb c');
  });
  it('validates replies', () => {
    expect(parseReply('ok').ok).toBe(false);
    expect(parseReply('Thank you for sharing your feedback.').ok).toBe(true);
  });
  it('bounds paging, sort and star filter', () => {
    expect(parsePage('99999')).toBe(500);
    expect(parsePage('-4')).toBe(1);
    expect(parseSort('drop table')).toBe('recent');
    expect(parseStarFilter('3')).toBe(3);
    expect(parseStarFilter('9')).toBeNull();
  });
});

describe('health-claim safety flags', () => {
  it('flags unsafe claims for a person to look at', () => {
    expect(safetyFlags('This syrup cured my diabetes completely')).toContain('cure_claim');
    expect(safetyFlags('I stopped my insulin and only took this')).toContain('stop_medication');
    expect(safetyFlags('Guaranteed results, a miracle')).toContain('guarantee');
    expect(safetyFlags('Call me on 9876543210')).toContain('contact_details');
    expect(safetyFlags('I was diagnosed with PCOS last year')).toContain('personal_medical');
  });
  it('does not flag ordinary negative or positive feedback', () => {
    for (const t of ['Did not work for me and the bottle leaked.', 'Packaging was damaged and delivery was late.', 'Tastes bitter, I stopped using it after a week.', 'Very happy, will order again.']) expect(safetyFlags(t)).toEqual([]);
  });
});

const jpeg = (extra: number[]) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, ...extra, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);
describe('image metadata stripping', () => {
  it('removes JPEG EXIF (APP1) and comments but keeps image data', () => {
    const exif = [0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xfe, 0, 4, 0x68, 0x69];
    const out = stripImageMetadata(jpeg(exif), 'jpg')!;
    expect(Buffer.from(out).includes(Buffer.from('Exif'))).toBe(false);
    expect(out[out.length - 1]).toBe(0xd9);
    expect(Array.from(out.slice(0, 2))).toEqual([0xff, 0xd8]);
  });
  it('removes PNG text and exif chunks', () => {
    const chunk = (t: string, d: number[]) => [0, 0, 0, d.length, ...Buffer.from(t), ...d, 0, 0, 0, 0];
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', new Array(13).fill(1)), ...chunk('tEXt', [0x61, 0, 0x62]), ...chunk('eXIf', [1, 2]), ...chunk('IDAT', [1]), ...chunk('IEND', [])]);
    const s = Buffer.from(stripImageMetadata(png, 'png')!).toString('latin1');
    expect(s).toContain('IHDR');
    expect(s).toContain('IDAT');
    expect(s).not.toContain('tEXt');
    expect(s).not.toContain('eXIf');
  });
  it('removes WebP EXIF and XMP chunks', () => {
    const ck = (t: string, d: number[]) => [...Buffer.from(t), d.length, 0, 0, 0, ...d, ...(d.length & 1 ? [0] : [])];
    const body = [...ck('VP8 ', [1, 2, 3, 4]), ...ck('EXIF', [9, 9, 9]), ...ck('XMP ', [8, 8])];
    const size = 4 + body.length;
    const w = Uint8Array.from([0x52, 0x49, 0x46, 0x46, size, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...body]);
    const s = Buffer.from(stripImageMetadata(w, 'webp')!).toString('latin1');
    expect(s).toContain('VP8 ');
    expect(s).not.toContain('EXIF');
    expect(s).not.toContain('XMP ');
  });
  it('rejects non-images, executables, disguised files and oversize uploads', () => {
    expect(prepareReviewImage(Buffer.from('MZ\x90\x00 this is an exe')).ok).toBe(false);
    expect(prepareReviewImage(Buffer.from('<?php echo 1; ?>')).ok).toBe(false);
    expect(prepareReviewImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')).ok).toBe(false);
    expect(prepareReviewImage(new Uint8Array(0)).ok).toBe(false);
    const big = new Uint8Array(2_000_001); big.set([0xff, 0xd8, 0xff]);
    expect(prepareReviewImage(big).ok).toBe(false);
    expect(prepareReviewImage(jpeg([])).ok).toBe(true);
  });
  it('rejects a truncated or malformed JPEG', () => {
    expect(prepareReviewImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3])).ok).toBe(false);
  });
});
