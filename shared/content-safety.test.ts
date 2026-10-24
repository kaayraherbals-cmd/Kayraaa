import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const textFiles = (dirs: string[]) => dirs.flatMap((d) => walk(join(root, d))).filter((f) => /\.(tsx?|json|html|txt|md|sql|css|mjs|svg)$/.test(f));

// Built from fragments so this file does not itself contain the identifiers it forbids.
const hidden = new RegExp(['AANCK', '3387L', '|', 'ALDK', '04433C'].join(''));

describe('regulatory and privacy safeguards in the shipped site', () => {
  it('never prints PAN or TAN anywhere in the project', () => {
    const hits = textFiles(['src', 'public', 'shared', 'server', 'api', 'scripts', 'supabase', 'docs', 'design']).filter((f) => hidden.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('makes none of the forbidden claims in site content or templates', () => {
    const banned = /(AYUSH|government)[\s-]*(approved|certified)|clinically[\s-]*proven|GMP[\s-]*certified/i;
    const files = textFiles(['src', 'public', 'design']).filter((f) => !f.endsWith('README.md'));
    const hits = files.filter((f) => banned.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('keeps unapproved formulation data out of the front end', () => {
    const ingredients = ['Himsra', 'Biranjasipha', 'Kasamarda', 'Yashad Bhasma', 'Kababchini', 'Apoedika', 'Bronopol', 'Prishniparni'];
    const hits = textFiles(['src', 'public', 'shared', 'api', 'scripts']).filter((f) => !f.endsWith('.test.ts') && ingredients.some((i) => readFileSync(f, 'utf8').includes(i)));
    expect(hits).toEqual([]);
  });
  it('has no legacy product names in the front end', () => {
    const hits = textFiles(['src', 'public']).filter((f) => /I-Care Syrup|Liv Mitra|Liv Shield/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('shows the verified company details in the footer source', () => {
    const cfg = readFileSync(join(root, 'src/config/site.ts'), 'utf8');
    expect(cfg.includes("legalName: 'KAAYRA HERBALS PRIVATE LIMITED'")).toBe(true);
    expect(cfg.includes("incorporatedOn: '2026-10-16'")).toBe(true);
    expect(cfg.includes("cin: 'U21003UP2026PTC253906'")).toBe(true);
    expect(cfg.includes("registeredLocation: 'Varanasi, Uttar Pradesh, India'")).toBe(true);
    expect(readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8').includes('company.cin')).toBe(true);
  });
  it('points at the correct Instagram account', () => {
    const cfg = readFileSync(join(root, 'src/config/site.ts'), 'utf8');
    expect(cfg.includes("INSTAGRAM_USERNAME = 'kaayra.herbals'")).toBe(true);
    expect(cfg.includes('https://www.instagram.com/kaayra.herbals?srtk=MXc4aXA3YmsycWRldg==')).toBe(true);
    expect(cfg.includes('kaayraherbals_official')).toBe(false);
  });
});
