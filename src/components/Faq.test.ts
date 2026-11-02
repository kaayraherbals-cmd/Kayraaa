import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import faq from '../../shared/faq.json';
import Faq from './Faq';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// Renders the real component the homepage uses, not a copy, and reads the visible text back out of the markup.
describe('visible FAQ on the homepage', () => {
  const html = renderToStaticMarkup(createElement(Faq));
  const pairs = [...html.matchAll(/<h3>(.*?)<\/h3><p>(.*?)<\/p>/g)].map((m) => [m[1], m[2]]);

  it('renders all 11 questions', () => {
    expect(faq).toHaveLength(11);
    expect(pairs).toHaveLength(11);
  });
  it('renders each question and answer exactly as in faq.json, in order (this is what the FAQPage JSON-LD is built from)', () => {
    expect(pairs).toEqual(faq.map((f) => [esc(f.q), esc(f.a)]));
  });
});
