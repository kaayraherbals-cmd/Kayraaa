import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import routes from './routes.json';
import privateRoutes from './private-routes.json';

describe('route metadata used by the prerender and the sitemap', () => {
  it('has unique paths, titles and descriptions', () => {
    for (const key of ['path', 'title', 'description'] as const) {
      const values = routes.map((r) => r[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
  });
  it('uses the exact brand spelling and one site name in every title', () => {
    for (const r of routes) {
      if (r.path === '/') expect(r.title).toBe('Kaayra Herbals | Official Ayurvedic Wellness Brand');
      else expect(r.title.endsWith(' | Kaayra Herbals'), r.path).toBe(true);
      expect(`${r.title} ${r.description}`).not.toMatch(/Kaira|Kayra|Kiara|Kiyara|Kaayra Journal/);
    }
  });
  it('keeps titles and descriptions a sensible length for search results', () => {
    for (const r of routes) {
      expect(r.title.length, r.path).toBeLessThanOrEqual(70);
      expect(r.description.length, r.path).toBeGreaterThanOrEqual(50);
      expect(r.description.length, r.path).toBeLessThanOrEqual(175);
    }
  });
  it('never lists a private route as public', () => {
    const pub = new Set(routes.map((r) => r.path));
    for (const p of privateRoutes) expect(pub.has(p.path), p.path).toBe(false);
  });
  it('does not claim anything the company cannot support', () => {
    const text = routes.map((r) => `${r.title} ${r.description}`).join(' ');
    expect(text).not.toMatch(/clinically|proven|cure|treats?\b|certified|approved by|award|best |#1|official store/i);
  });
});

import faq from './faq.json';

describe('FAQ, llms.txt and email privacy', () => {
  it('has unique, complete questions with no unsupported claim', () => {
    expect(new Set(faq.map((f) => f.q)).size).toBe(faq.length);
    for (const f of faq) {
      expect(f.q.endsWith('?')).toBe(true);
      expect(f.a.length).toBeGreaterThan(30);
    }
    expect(faq.map((f) => f.a).join(' ')).not.toMatch(/clinically|proven|cure|treats?\b|certified by|approved by|award|best |#1/i);
  });
  it('ships an llms.txt that uses the site-address placeholder and no contact detail', () => {
    const t = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
    expect(t).toContain('__SITE_URL__/');
    expect(t).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });
  it('ships a detailed AI-readable guide with factual boundaries and canonical page links', () => {
    const t = readFileSync(new URL('../public/llms-full.txt', import.meta.url), 'utf8');
    expect(t).toContain('__SITE_URL__/sitemap.xml');
    expect(t).toContain('nothing is currently for sale');
    expect(t).toContain('Do not invent products');
    expect(t).toContain('not personalised medical advice');
    expect(t).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });
  it('keeps founder and site addresses out of the prerendered markup (EmailLink reveals them on request)', () => {
    for (const f of ['FounderCards', 'Contact', 'Privacy']) {
      const p = f === 'FounderCards' ? '../src/components/FounderCards.tsx' : `../src/pages/${f}.tsx`;
      expect(readFileSync(new URL(p, import.meta.url), 'utf8'), f).not.toMatch(/mailto:\$\{/);
    }
  });
});

describe('prerender structured data and sitemap rules', () => {
  // The graphs are built in scripts/structured-data.mjs; the prerender wires them to the pages, the sitemap and the files.
  const prerenderSrc = readFileSync(new URL('../scripts/prerender.mjs', import.meta.url), 'utf8');
  const graphSrc = readFileSync(new URL('../scripts/structured-data.mjs', import.meta.url), 'utf8');
  const src = `${prerenderSrc}\n${graphSrc}`;
  it('emits WebSite and Organization on the homepage in one graph', () => {
    expect(src).toContain("'@type': 'WebSite'");
    expect(src).toContain("'@type': 'Organization'");
    // The homepage graph is WebSite, then its WebPage, then the Organization (the WebPage node sits between them).
    expect(src).toMatch(/'@graph': \[\s*website,[^\]]*?organization\w*,/);
  });
  it('does not invent a rating, review, price or contact detail', () => {
    // `review:` is checked in the graph builder only: prerender.mjs passes an article's review data through under that key, it is not markup.
    expect(src).not.toMatch(/\b(aggregateRating|price|telephone|email)\s*:/);
    expect(graphSrc).not.toMatch(/\breview\s*:/);
  });
  it('gives the Organization the registered logo, read from brand.ts and the real PNG', () => {
    expect(graphSrc).toMatch(/logo:\s*\{[\s\S]*'@type': 'ImageObject'/);
    expect(readFileSync(new URL('../scripts/brand-facts.mjs', import.meta.url), 'utf8')).toContain('SCHEMA_LOGO_PATH');
  });
  it('writes sitemap lastmod only from a real route date', () => {
    expect(prerenderSrc).toContain('r.date ?');
    expect(src).not.toMatch(/lastmod>\$\{today\}/);
  });
  it('describes the founders from the one shared file, without any contact detail', () => {
    expect(prerenderSrc).toContain("shared/founders.json");
    expect(src).toContain("'@type': 'Person'");
    expect(src).toContain("'@type': 'BreadcrumbList'");
  });
  it('lists the founders page as a public, indexable route', () => {
    expect(routes.some((r) => r.path === '/founders')).toBe(true);
  });
});

import founders from './founders.json';
import { articles } from '../src/content/journal';

describe('Phase 4 brand entity consistency', () => {
  it('uses exactly the approved founder names and roles', () => {
    expect(founders.map((f) => [f.name, f.role])).toEqual([
      ['Nitesh Jaiswal', 'Founder & CEO'],
      ['Ritika Jaiswal', 'Co-Founder'],
      ['Anuj Kumar', 'Co-Founder'],
    ]);
  });
  it('keeps every article route in step with the journal content (path, date)', () => {
    const arts = routes.filter((r) => 'type' in r && r.type === 'article');
    expect(arts.length).toBe(articles.length);
    for (const a of articles) {
      const r = arts.find((x) => x.path === `/journal/${a.slug}`);
      expect(r, a.slug).toBeDefined();
      expect((r as { date?: string }).date, a.slug).toBe(a.date);
    }
  });
  it('keeps founder qualifications out of the AI-readable files', () => {
    for (const file of ['llms.txt', 'llms-full.txt']) {
      const t = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
      for (const f of founders) for (const q of f.qualifications) expect(t, `${file}: ${q}`).not.toContain(q);
      for (const f of founders) if (f.institution) expect(t, `${file}: ${f.institution}`).not.toContain(f.institution);
      for (const f of founders) expect(t, file).toContain(`${f.name} (${f.role})`);
    }
  });
  it('uses the configured Instagram account everywhere and never the old guess', () => {
    const cfg = readFileSync(new URL('../src/config/site.ts', import.meta.url), 'utf8');
    expect(cfg).toContain("INSTAGRAM_USERNAME = 'kaayra.herbals'");
    for (const file of ['llms.txt', 'llms-full.txt']) {
      const t = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
      expect(t).toContain('https://www.instagram.com/kaayra.herbals/');
      expect(t).not.toContain('kaayraherbals_official');
    }
  });
});

// Phase 4.1: the 11-question AEO set. Phase 4 shipped only 8 (a regression); these tests make sure it cannot shrink again unnoticed.
describe('FAQ: the 11 priority questions', () => {
  const ORIGINAL_EIGHT = [
    'What is Kaayra Herbals?',
    'Where is Kaayra Herbals based?',
    'Is anything for sale yet?',
    'Are Kaayra products approved or certified?',
    'How will I know when something launches?',
    'Does Kaayra give medical advice?',
    'Who founded Kaayra Herbals?',
    'How can I contact Kaayra Herbals?',
  ];
  const RESTORED_THREE = [
    'What is Kaayra Herbals’ philosophy?',
    'What is ingredient transparency?',
    'What is the difference between traditional Ayurvedic use and clinical evidence?',
  ];
  it('has exactly 11 questions: the original eight in their original order, then the three restored priority questions', () => {
    expect(faq).toHaveLength(11);
    expect(faq.map((f) => f.q)).toEqual([...ORIGINAL_EIGHT, ...RESTORED_THREE]);
  });
  it('keeps the approval disclaimer word for word', () => {
    const a = faq.find((f) => f.q === 'Are Kaayra products approved or certified?')?.a ?? '';
    expect(a).toContain('We do not claim any approval, licence or certification.');
  });
  it('answers the three restored questions concisely and in the site’s own claim-safe terms', () => {
    for (const q of RESTORED_THREE) {
      const a = faq.find((f) => f.q === q)?.a ?? '';
      expect(a.length, q).toBeGreaterThan(100);
      expect(a.length, q).toBeLessThan(450);
    }
    const all = faq.filter((f) => RESTORED_THREE.includes(f.q)).map((f) => f.a).join(' ');
    expect(all).not.toMatch(/clinically|proven|cure|treats?\b|certified by|approved by|award|best |#1|guarantee|rated|stars?\b/i);
    expect(all).not.toMatch(/\b(?:FSSAI|AYUSH|GMP|ISO|NABL)\b/);
    expect(all).toMatch(/no health claims/i);
  });
  it('uses no straight apostrophe in a question, so the visible HTML and the FAQPage JSON-LD stay identical', () => {
    for (const f of faq) expect(f.q, f.q).not.toMatch(/['"<>&]/);
  });
});
