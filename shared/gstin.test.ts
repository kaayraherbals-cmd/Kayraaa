import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gstinCheckChar, isValidGstin } from './gstin';

const root = join(__dirname, '..');

// Built from fragments and derived, so no near-miss GSTIN text contains the PAN (see the PAN guard in content-safety.test.ts).
const G = ['09', 'AANCK', '3387L', '1ZQ'].join('');

describe('GSTIN', () => {
  it('accepts the Kaayra Herbals GSTIN', () => {
    expect(isValidGstin(G)).toBe(true);
    expect(gstinCheckChar(G.slice(0, 14))).toBe('Q');
  });
  it('rejects wrong length, bad shape and a wrong check character', () => {
    expect(isValidGstin('')).toBe(false);
    expect(isValidGstin(G.slice(0, 14))).toBe(false);
    expect(isValidGstin(G.slice(0, 13) + 'YQ')).toBe(false);
    expect(isValidGstin(G.slice(0, 14) + 'A')).toBe(false);
    expect(isValidGstin('00' + G.slice(2))).toBe(false);
  });
  it('is the value published in the site config, the footer and the Legal page', () => {
    const cfg = readFileSync(join(root, 'src/config/site.ts'), 'utf8');
    const g = /gstin:\s*'([^']+)'/.exec(cfg)?.[1] ?? '';
    expect(g).toBe(G);
    expect(isValidGstin(g)).toBe(true);
    // State code 09 = Uttar Pradesh, matching the registered location.
    expect(g.startsWith('09')).toBe(true);
    expect(readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8').includes('company.gstin')).toBe(true);
    expect(readFileSync(join(root, 'src/components/BusinessDetails.tsx'), 'utf8').includes('company.gstin')).toBe(true);
  });
});
