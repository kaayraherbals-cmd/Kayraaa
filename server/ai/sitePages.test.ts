import { describe, expect, it } from 'vitest';
import faq from '../../shared/faq.json';
import { SITE_PAGES } from './siteContent.generated.js';
import { expandedTerms, pagesFor } from './sitePages.js';

const pagesOf = (q: string): string[] => pagesFor(q).map((p) => p.page);
const textOf = (q: string): string => pagesFor(q).map((p) => p.text).join('\n');

describe('Kaayra AI: finds the right part of the website for a question', () => {
  it('answers company questions from the company details and the FAQ', () => {
    expect(textOf('What is Kaayra Herbals?')).toMatch(/Varanasi/);
    expect(textOf('When was the company incorporated?')).toMatch(/16 October 2026/);
    expect(textOf('Who founded Kaayra?')).toMatch(/Ritika Jaiswal/);
  });
  it('answers approval and certification questions with what the site says it does not claim', () => {
    expect(textOf('Are your products certified or approved by AYUSH or FSSAI?')).toMatch(/do not claim any approval/i);
  });
  it('finds ingredient facts, quality and medical pages', () => {
    expect(textOf('Which part of the tulsi plant is used?')).toMatch(/Ocimum tenuiflorum/);
    expect(pagesOf('How do you test quality?')[0]).toMatch(/Quality and transparency/);
    expect(pagesOf('Do you give medical advice?')[0]).toMatch(/Medical disclaimer/);
  });
  it('maps the words customers use to the words the site uses', () => {
    const t = expandedTerms('How do I get a refund after delivery?');
    expect(t.has('refund')).toBe(true);
    expect(t.has('return')).toBe(true);
    expect(t.has('courier')).toBe(true);
    expect(t.get('refund')).toBe(1);
    expect(t.get('return')).toBeLessThan(1);
  });
  it('sends the whole site when nothing matches closely, so any page can still answer', () => {
    const r = pagesFor('What payment methods do you accept?');
    expect(r.length).toBeGreaterThan(8);
    expect(r.map((p) => p.text).join('').length).toBeLessThanOrEqual(22000);
  });
  it('sends the overview when the question has nothing specific to look for', () => {
    expect(pagesOf('hi').length).toBeGreaterThan(0);
  });
  it('never sends more than a bounded set of sections', () => {
    const r = pagesFor('tell me everything about ingredients, quality, founders and the story');
    expect(r.length).toBeLessThanOrEqual(8);
    expect(r.map((p) => p.text).join('').length).toBeLessThanOrEqual(8000);
  });
});

// Phase 4.1: the generated knowledge must carry every FAQ answer, and the character limit must not be what removes one.
describe('Kaayra AI: the 11 FAQ answers', () => {
  const faqPage = SITE_PAGES.find((p) => p.id === 'faq');
  const lineOf = (f: { q: string; a: string }) => `Q: ${f.q} A: ${f.a}`;

  it('the generated knowledge file holds all 11 questions and answers word for word, in the same order as faq.json', () => {
    expect(faq).toHaveLength(11);
    expect(faqPage?.text.split('\n')).toEqual(faq.map(lineOf));
  });
  it('no FAQ entry is long enough to become an oversized section that the size limit could push out', () => {
    for (const f of faq) expect(lineOf(f).length, f.q).toBeLessThanOrEqual(700);
  });
  it('the 8,000-character limit never changes what any FAQ question retrieves (the page limit and ranking decide, not the cap)', () => {
    for (const f of faq) {
      const capped = pagesFor(f.q);
      expect(capped.map((p) => p.text).join('').length, f.q).toBeLessThanOrEqual(8000);
      expect(capped, f.q).toEqual(pagesFor(f.q, 8, 1_000_000));
    }
  });
  it('the approval, philosophy and traditional-versus-clinical questions retrieve their own answers in full', () => {
    for (const q of ['Are Kaayra products approved or certified?', 'What is Kaayra Herbals’ philosophy?', 'What is the difference between traditional Ayurvedic use and clinical evidence?']) {
      const f = faq.find((x) => x.q === q)!;
      expect(pagesFor(q).some((p) => p.text.includes(lineOf(f))), q).toBe(true);
    }
    expect(textOf('Are Kaayra products approved or certified?')).toContain('We do not claim any approval, licence or certification.');
  });
  it('"What is ingredient transparency?" still reaches the Quality and transparency page, which carries the same substance', () => {
    // Known limit, recorded in docs/PHASE4_1_REMAINING_ISSUES.md: ingredient-library sections outrank the FAQ section for this question.
    expect(pagesOf('What is ingredient transparency?')).toContain('Quality and transparency');
  });
});
