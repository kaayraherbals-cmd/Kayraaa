import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const css = (f: string) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8');
// Brand brief (Premium UI V3): five master colours, defined once in tokens.css.
const MASTER: Record<string, string> = { midnight: '#09231c', 'forest-deep': '#102f25', parchment: '#f6f1e7', gold: '#c49c62', cream: '#fffcf5' };
const OTHER_FILES = readdirSync(new URL('../src/styles/', import.meta.url)).filter((f) => f.endsWith('.css') && f !== 'tokens.css');

describe('master brand colours', () => {
  it('tokens.css defines the five master colours exactly', () => {
    const s = css('tokens.css').toLowerCase();
    for (const [name, hex] of Object.entries(MASTER)) expect(s).toContain(`--${name}: ${hex}`);
  });
  it('no other stylesheet redefines them (one source of truth)', () => {
    for (const f of OTHER_FILES) for (const name of Object.keys(MASTER)) expect(css(f), `${f} redefines --${name}`).not.toMatch(new RegExp(`--${name}:\\s*#`));
  });
  it('legacy brand variable names are aliases of the new tokens, not separate colours', () => {
    const t = css('tokens.css');
    for (const [legacy, token] of [['ivory', 'parchment'], ['forest', 'forest-deep'], ['brass', 'gold'], ['paper', 'cream']]) expect(t).toContain(`--${legacy}: var(--${token})`);
  });
});

describe('logo and image slots', () => {
  it('no logo artwork is invented: all slots stay null until approved artwork is supplied', () => {
    const b = readFileSync(new URL('../src/content/brand.ts', import.meta.url), 'utf8');
    expect(b).toContain('horizontal: null');
    expect(b).toContain('stacked: null');
    expect(b).toContain('icon: null');
  });
  it('no photograph slot is filled without supplied assets', () => {
    // Strip comments: the file's own instructions contain an example path.
    const i = readFileSync(new URL('../src/content/images.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(i).toContain('instagramPhotos: Photo[] = []');
    expect(i).not.toMatch(/src:\s*'\/images/);
  });
});
