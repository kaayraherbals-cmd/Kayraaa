import { describe, expect, it } from 'vitest';
import { isLangCode } from './languages';
import { TRANSLATE_LIMITS, mask, parseBatch, parseRun, runTag, splitSpace, translatable, unmask } from './translate';

describe('translatable', () => {
  it('accepts real English text', () => {
    expect(translatable('Add to bag')).toBe(true);
    expect(translatable('Formulated in Kashi')).toBe(true);
  });
  it('skips numbers, codes, brand-only text, links and text already in another script', () => {
    for (const s of ['', ' ', '₹450', '221001', 'Kaayra Herbals', 'hello@kaayraherbals.com', 'https://kaayraherbals.com/', 'खोजें', 'Kaayra AI से पूछें', 'x']) expect(translatable(s), s).toBe(false);
  });
  it('skips text that is too long', () => expect(translatable('a word '.repeat(200))).toBe(false));
});

describe('mask and unmask', () => {
  it('keeps prices, numbers, brand names and e-mail addresses out of the model', () => {
    const m = mask('Pay ₹1,250 to Kaayra Herbals for 2 packs, PIN 221001, write to care@kaayraherbals.com');
    expect(m.text.replace(/⟦\d+⟧/g, '')).not.toMatch(/₹|\d|Kaayra|@/);
    expect(unmask(m.text, m.tokens)).toBe('Pay ₹1,250 to Kaayra Herbals for 2 packs, PIN 221001, write to care@kaayraherbals.com');
  });
  it('lets the model move markers around', () => {
    const m = mask('Order 12 ships in 3 days');
    expect(unmask('⟦1⟧ दिनों में ⟦0⟧', m.tokens)).toBe('3 दिनों में 12');
  });
  it('rejects a dropped, repeated or invented marker', () => {
    const m = mask('Order 12 ships in 3 days');
    expect(unmask('⟦0⟧ only', m.tokens)).toBeNull();
    expect(unmask('⟦0⟧ ⟦0⟧', m.tokens)).toBeNull();
    expect(unmask('⟦0⟧ ⟦1⟧ ⟦7⟧', m.tokens)).toBeNull();
    expect(unmask('⟦0⟧ ⟦1⟧ ⟦', m.tokens)).toBeNull();
  });
  it('round-trips text with no markers', () => expect(unmask('सादा पाठ', [])).toBe('सादा पाठ'));
});

describe('splitSpace', () => {
  it('keeps spacing around a node', () => expect(splitSpace('  Shop now \n')).toEqual({ lead: '  ', core: 'Shop now', trail: ' \n' }));
  it('collapses inner white space', () => expect(splitSpace('Shop\n   now').core).toBe('Shop now'));
});

describe('parseBatch', () => {
  it('accepts a valid batch', () => {
    const r = parseBatch({ lang: 'hi', items: ['Add to bag', 'Our story'] }, isLangCode);
    expect(r.ok).toBe(true);
  });
  it('rejects English, unknown languages, empty, oversized and non-string input', () => {
    for (const body of [null, 'x', { lang: 'en', items: ['Hello'] }, { lang: 'xx', items: ['Hello'] }, { lang: 'hi', items: [] }, { lang: 'hi', items: [5] }, { lang: 'hi', items: ['12345'] }, { lang: 'hi', items: Array.from({ length: TRANSLATE_LIMITS.maxItems + 1 }, () => 'Hello there') }])
      expect(parseBatch(body, isLangCode).ok, JSON.stringify(body)).toBe(false);
  });
  it('rejects a batch over the total size', () => {
    const big = Array.from({ length: 14 }, (_, i) => `${'word '.repeat(110)}${i}x`);
    expect(parseBatch({ lang: 'hi', items: big }, isLangCode).ok).toBe(false);
  });
});

describe('parseRun', () => {
  it('reads tagged pieces in any order', () => {
    expect(runTag(0, 'now')).toBe('⟨a⟩now⟨/a⟩');
    expect(parseRun('आज ⟨b⟩वादा⟨/b⟩ ⟨a⟩पढ़ें⟨/a⟩', 2)).toEqual([{ tag: null, text: 'आज ' }, { tag: 1, text: 'वादा' }, { tag: null, text: ' ' }, { tag: 0, text: 'पढ़ें' }]);
  });
  it('rejects missing, repeated, nested, unclosed or invented tags', () => {
    for (const [s, n] of [['सादा', 1], ['⟨a⟩x⟨/a⟩⟨a⟩y⟨/a⟩', 1], ['⟨a⟩⟨b⟩x⟨/b⟩⟨/a⟩', 2], ['⟨a⟩x', 1], ['⟨c⟩x⟨/c⟩', 1], ['x ⟨/a⟩', 1], ['⟨a⟩x⟨/a⟩ ⟨', 1]] as [string, number][]) expect(parseRun(s, n), s).toBeNull();
  });
});
