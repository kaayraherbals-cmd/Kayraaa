import { describe, expect, it } from 'vitest';
import { byteCapacity, qrMatrix, qrPath } from './qr.js';

describe('qr', () => {
  it('uses the right size for each version and fits otpauth links', () => {
    const uri = 'otpauth://totp/Kaayra%20Herbals%3Aboss%40kaayra.in?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Kaayra%20Herbals';
    const m = qrMatrix(uri)!;
    expect(m).toBeTruthy();
    expect(m.length).toBe(45); // version 7
    expect(m.every((r) => r.length === m.length)).toBe(true);
    expect(qrMatrix('A')!.length).toBe(21);
  });
  it('draws the three finder patterns', () => {
    const m = qrMatrix('hello')!;
    const n = m.length;
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      expect(m[y][x]).toBe(true);
      expect(m[y + 3][x + 3]).toBe(true);
      expect(m[y + 1][x + 1]).toBe(false);
    }
  });
  it('refuses text that does not fit instead of drawing a broken code', () => {
    expect(qrMatrix('z'.repeat(byteCapacity(10)))).toBeTruthy();
    expect(qrMatrix('z'.repeat(byteCapacity(10) + 1))).toBeNull();
  });
  it('produces an SVG path with a quiet zone', () => {
    const { d, size } = qrPath(qrMatrix('A')!);
    expect(size).toBe(29);
    expect(d.startsWith('M')).toBe(true);
  });
});
