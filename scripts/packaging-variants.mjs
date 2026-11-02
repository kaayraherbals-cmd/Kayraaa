// Generates the women's wellness concept labels from the master-brand labels by swapping the palette only.
// Layout, type, zones and the CONCEPT banner are unchanged, so both families share one packaging identity.
// The women's wellness hex values are PROPOSED (the brief names the colours, not the values) and need brand approval.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MASTER = { green: '#173A2D', ivory: '#F7F5EF', bronze: '#A88452', sage: '#A9BBA6' };
export const WOMENS = { burgundy: '#5E2233', ivory: '#F7F5EF', gold: '#B39454', rose: '#D9A9B2' };
export const PAIRS = [
  [MASTER.green, WOMENS.burgundy],
  [MASTER.bronze, WOMENS.gold],
  [MASTER.sage, WOMENS.rose],
];

export function recolour(svg) {
  let out = svg;
  for (const [from, to] of PAIRS) out = out.split(from).join(to).split(from.toLowerCase()).join(to);
  return out
    .replace(/<title>([^<]*)<\/title>/, '<title>$1 (women\u2019s wellness palette)</title>')
    .replace(/aria-label="([^"]*)"/, 'aria-label="$1, women\u2019s wellness palette"');
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'packaging');
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of ['label-syrup-150ml', 'label-syrup-200ml', 'label-capsule-30ct', 'container-syrup-150ml', 'container-syrup-200ml', 'container-capsule-30ct']) {
    writeFileSync(join(dir, `${name}.womens.svg`), recolour(readFileSync(join(dir, `${name}.svg`), 'utf8')));
  }
  console.log('Wrote women\u2019s wellness label concepts.');
}
