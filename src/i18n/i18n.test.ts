import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, isLangCode, languageOf } from '../../shared/languages';
import { asciiDigits, replyProblems } from '../../shared/ai';
import { serverText, languageInstruction } from '../../shared/aiLanguage';
import { en, type Messages } from './en';

const dictFiles = readdirSync(new URL('./dict', import.meta.url)).filter((f) => f.endsWith('.ts')).map((f) => f.replace('.ts', ''));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('language table', () => {
  it('lists English plus all 22 scheduled languages, with unique codes', () => {
    expect(LANGUAGES.length).toBe(23);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(23);
  });
  it('every language shows an interface that exists', () => {
    for (const l of LANGUAGES) expect(l.ui === 'en' || dictFiles.includes(l.ui), `${l.code} -> ${l.ui}`).toBe(true);
  });
  it('only accepts known codes', () => {
    expect(isLangCode('hi')).toBe(true);
    expect(isLangCode('xx')).toBe(false);
    expect(isLangCode('<script>')).toBe(false);
    expect(languageOf('zz').code).toBe('en');
  });
});

describe.each(dictFiles)('interface text: %s', (code) => {
  it('has every key, no extras, and keeps every placeholder', async () => {
    const m = ((await import(`./dict/${code}.ts`)) as { default: Messages }).default;
    const missing = Object.keys(en).filter((k) => !(k in m));
    const extra = Object.keys(m).filter((k) => !(k in en));
    expect(missing, 'missing keys').toEqual([]);
    expect(extra, 'unknown keys').toEqual([]);
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(m[k], k).toBeTruthy();
      expect(placeholders(m[k] as string), `placeholders in ${k}`).toBe(placeholders(en[k]));
    }
  });
});

describe('Kaayra AI in other languages', () => {
  it('writes its fixed replies in the chosen language and falls back to a language readers also read', () => {
    expect(serverText('safety', 'en')).toMatch(/healthcare professional/);
    expect(serverText('safety', 'ta')).not.toBe(serverText('safety', 'en'));
    expect(serverText('safety', 'mai')).toBe(serverText('safety', 'hi'));
    expect(serverText('safety', 'sd')).toBe(serverText('safety', 'ur'));
    expect(serverText('safety', 'sat')).toBe(serverText('safety', 'en'));
  });
  it('tells the model which language to use, and adds nothing for English', () => {
    expect(languageInstruction('en')).toBe('');
    expect(languageInstruction('bn')).toContain('Bengali');
    expect(languageInstruction('bn')).toContain('medical_concern');
  });
  it('reads prices written in Indian digits and rupee words, so an invented price cannot slip through', () => {
    expect(asciiDigits('₹४५०')).toBe('₹450');
    expect(asciiDigits('௪௫௦')).toBe('450');
    expect(replyProblems('कीमत ₹४५० है', [45000])).toEqual([]);
    expect(replyProblems('कीमत ₹९९९ है', [45000]).length).toBeGreaterThan(0);
    expect(replyProblems('விலை ரூ 999', [45000]).length).toBeGreaterThan(0);
    expect(replyProblems('விலை ரூ 450', [45000])).toEqual([]);
    expect(replyProblems('450 रुपये', [45000])).toEqual([]);
    expect(replyProblems('999 रुपये', [45000]).length).toBeGreaterThan(0);
  });
});
