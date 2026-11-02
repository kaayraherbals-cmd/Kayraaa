import { beforeEach, describe, expect, it } from 'vitest';
import { loadAiConfig } from './ai/config';
import type { Transport } from './ai/gemini';
import { clearProviderCooldowns } from './ai/providers';
import { clearTranslateCache, translateLines, translationSystem } from './translate';

const cfg = loadAiConfig({ AI_ENABLED: 'on', GEMINI_API_KEY: 'test-key' });
const reply = (items: { id: number; text: string }[]): Transport => async () => ({ text: JSON.stringify({ items }), inputTokens: 10, outputTokens: 10 });

beforeEach(() => { clearTranslateCache(); clearProviderCooldowns(); });

describe('translateLines', () => {
  it('translates, puts prices and brand back, and remembers the answer', async () => {
    let calls = 0;
    const t: Transport = async (...a) => { calls += 1; return reply([{ id: 0, text: '⟦0⟧ में ⟦1⟧ पाएँ' }])(...a); };
    const r1 = await translateLines(cfg, 'hi', ['Get Kaayra for ₹450'], t);
    expect(r1.items).toEqual(['Kaayra में ₹450 पाएँ'].map((s) => s)); // marker order is the model's choice; both pieces are restored
    const r2 = await translateLines(cfg, 'hi', ['Get Kaayra for ₹450'], t);
    expect(r2.items).toEqual(r1.items);
    expect(calls).toBe(1);
  });
  it('leaves a line untranslated when a marker is lost or the reply is unusable', async () => {
    const r = await translateLines(cfg, 'ta', ['Two packs for ₹300'], reply([{ id: 0, text: 'இரண்டு பொதிகள்' }]));
    expect(r.items).toEqual([null]);
  });
  it('reports failure when the model fails', async () => {
    const bad: Transport = async () => ({ text: null, blocked: true, inputTokens: 0, outputTokens: 0 });
    const r = await translateLines(cfg, 'bn', ['Our story'], bad);
    expect(r.items).toEqual([null]);
    expect(r.failed).toBe(true);
  });
  it('ignores ids the server never sent', async () => {
    const r = await translateLines(cfg, 'mr', ['Our story'], reply([{ id: 4, text: 'x' }, { id: 0, text: 'आमची कथा' }]));
    expect(r.items).toEqual(['आमची कथा']);
  });
});

describe('translationSystem', () => {
  it('names the language and forbids new claims', () => {
    const s = translationSystem('Hindi', 'हिन्दी');
    expect(s).toContain('Hindi');
    expect(s).toMatch(/never add, remove, strengthen or soften a claim/i);
    expect(s).toContain('Kaayra Herbals');
  });
});
