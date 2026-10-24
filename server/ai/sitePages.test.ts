import { describe, expect, it } from 'vitest';
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
  it('sends nothing when the site says nothing about the topic, so the assistant admits it', () => {
    expect(pagesFor('What payment methods do you accept?')).toEqual([]);
  });
  it('sends the overview when the question has nothing specific to look for', () => {
    expect(pagesOf('hi').length).toBeGreaterThan(0);
  });
  it('never sends more than a few short sections', () => {
    const r = pagesFor('tell me everything about ingredients, quality, founders and the story');
    expect(r.length).toBeLessThanOrEqual(4);
    expect(r.map((p) => p.text).join('').length).toBeLessThanOrEqual(3000);
  });
});
