import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { recolour, MASTER } from './packaging-variants.mjs';

const dir = new URL('../design/packaging/', import.meta.url);
const labels = ['label-syrup-150ml', 'label-syrup-200ml', 'label-capsule-30ct', 'container-syrup-150ml', 'container-syrup-200ml', 'container-capsule-30ct'];

describe('packaging palettes', () => {
  it('every women\u2019s wellness label is the master label with only the palette swapped', () => {
    for (const n of labels) {
      const master = readFileSync(new URL(`${n}.svg`, dir), 'utf8');
      const womens = readFileSync(new URL(`${n}.womens.svg`, dir), 'utf8');
      expect(womens).toBe(recolour(master));
      for (const c of [MASTER.green, MASTER.bronze, MASTER.sage]) expect(womens.toLowerCase()).not.toContain(c.toLowerCase());
    }
  });
  it('concept banner and empty zones are kept; no claims are added', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.womens.svg'))) {
      const t = readFileSync(new URL(f, dir), 'utf8');
      expect(t).toContain('CONCEPT');
      expect(t).not.toMatch(/clinically|certified|approved by|guaranteed|cure/i);
    }
  });
});
