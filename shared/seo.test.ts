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
  const src = readFileSync(new URL('../scripts/prerender.mjs', import.meta.url), 'utf8');
  it('emits WebSite and Organization on the homepage in one graph', () => {
    expect(src).toContain("'@type': 'WebSite'");
    expect(src).toContain("'@type': 'Organization'");
    expect(src).toMatch(/'@graph': \[\s*website,\s*organization,/);
  });
  it('does not invent a logo, rating, review, price or contact detail', () => {
    expect(src).not.toMatch(/\b(aggregateRating|review|price|telephone|email|logo)\s*:/);
  });
  it('writes sitemap lastmod only from a real route date', () => {
    expect(src).toContain('r.date ?');
    expect(src).not.toMatch(/lastmod>\$\{today\}/);
  });
  it('describes the founders from the one shared file, without any contact detail', () => {
    expect(src).toContain("shared/founders.json");
    expect(src).toContain("'@type': 'Person'");
    expect(src).toContain("'@type': 'BreadcrumbList'");
  });
  it('lists the founders page as a public, indexable route', () => {
    expect(routes.some((r) => r.path === '/founders')).toBe(true);
  });
});
