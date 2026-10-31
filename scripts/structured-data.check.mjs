// Checks for the Phase 4 structured data. Run: npm run seo:schema  (= node --test scripts/structured-data.check.mjs)
// Needs `npm ci` first (only for the `typescript` package, which loads src/content/journal.ts), but no build and no network.
// Works on every supported Node version: it does not depend on Node's own TypeScript type stripping (see scripts/lib/import-ts.mjs).
// It builds the JSON-LD for every public route from the real config, routes, founders, FAQ and journal files,
// using a stand-in for the rendered article page, and validates entities, references, roles and forbidden markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBrandFacts } from './brand-facts.mjs';
import { graphFor, ids, articleNodes } from './structured-data.mjs';
import { importTs } from './lib/import-ts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const siteUrl = 'https://kaayraherbals.com';
const brand = readBrandFacts(join(root, 'src/config/site.ts'), {});
const routes = json('shared/routes.json');
const founders = json('shared/founders.json');
const faq = json('shared/faq.json');
const { articles } = await importTs(join(root, 'src/content/journal.ts'));
const { ingredients } = await importTs(join(root, 'src/content/ingredients.ts'));

// Roles approved by the owner for Phase 4 (Decision 1). Changing a role is an owner decision.
const APPROVED = { 'Nitesh Jaiswal': 'Founder & CEO', 'Ritika Jaiswal': 'Co-Founder', 'Anuj Kumar': 'Co-Founder' };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/</g, '&lt;');
/** Stand-in for the server-rendered article: same H1 and <time> the real JournalArticle page renders. */
const articleHtml = (route) => {
  const a = articles.find((x) => `/journal/${x.slug}` === route.path);
  assert.ok(a, `no journal article for ${route.path}`);
  return `<article><h1>${esc(a.title)}</h1><p><time dateTime="${a.date}">x</time></p></article>`;
};
const metaFor = (route) => { const a = articles.find((x) => `/journal/${x.slug}` === route.path); return a ? { author: a.author, review: a.practitionerReviewed ? a.review : undefined, updated: a.updated, sources: a.sources } : {}; };
const build = (route) => graphFor({ route, url: siteUrl + (route.path === '/' ? '/' : route.path), html: route.type === 'article' ? articleHtml(route) : '', siteUrl, brand, founders, faq, articleMeta: metaFor(route) });
const nodesOf = (g) => (g ? g['@graph'] ?? [g] : []);
const all = routes.map((r) => ({ route: r, graph: build(r) }));

test('every graph is valid JSON and round-trips', () => {
  for (const { route, graph } of all) if (graph) assert.deepEqual(JSON.parse(JSON.stringify(graph)), graph, route.path);
});

test('no duplicate @id inside a page, and every @id reference resolves inside the same graph', () => {
  for (const { route, graph } of all) {
    const nodes = nodesOf(graph);
    const defined = nodes.map((n) => n['@id']).filter(Boolean);
    assert.equal(new Set(defined).size, defined.length, `${route.path}: duplicate @id`);
    const refs = [];
    const walk = (v, top) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, false));
      if (v && typeof v === 'object') {
        if (!top && Object.keys(v).length === 1 && v['@id']) refs.push(v['@id']);
        for (const x of Object.values(v)) walk(x, false);
      }
    };
    nodes.forEach((n) => walk(n, true));
    for (const r of refs) assert.ok(defined.includes(r), `${route.path}: unresolved reference ${r}`);
  }
});

test('exactly one Organization with the stable @id wherever one appears, identical identity facts everywhere', () => {
  const id = ids(siteUrl);
  const orgs = [];
  for (const { route, graph } of all) {
    const o = nodesOf(graph).filter((n) => n['@type'] === 'Organization');
    assert.ok(o.length <= 1, `${route.path}: ${o.length} Organization nodes`);
    if (o[0]) { assert.equal(o[0]['@id'], id.organization); orgs.push(o[0]); }
  }
  assert.ok(orgs.length >= 3);
  for (const o of orgs) {
    for (const k of ['name', 'legalName', 'url', 'slogan', 'description', 'foundingDate', 'foundingLocation', 'sameAs']) assert.deepEqual(o[k], orgs[0][k], k);
    assert.equal(o.name, 'Kaayra Herbals');
    assert.equal(o.legalName, 'Kaayra Herbals Private Limited');
    assert.equal(o.url, siteUrl + '/');
    assert.equal(o.taxID, '09AANCK3387L1ZQ');
  }
});

test('Instagram: the configured account is the only social profile, as a clean URL', () => {
  const o = nodesOf(build(routes[0])).find((n) => n['@type'] === 'Organization');
  assert.deepEqual(o.sameAs, ['https://www.instagram.com/kaayra.herbals/']);
  assert.equal(brand.instagramUrl, 'https://www.instagram.com/kaayra.herbals/');
  assert.ok(!JSON.stringify(all.map((a) => a.graph)).includes('kaayraherbals_official'));
});

test('three founders: approved names and roles, linked to the Organization both ways', () => {
  for (const f of founders) assert.equal(f.role, APPROVED[f.name], f.name);
  assert.equal(founders.length, 3);
  for (const path of ['/', '/founders']) {
    const nodes = nodesOf(build(routes.find((r) => r.path === path)));
    const people = nodes.filter((n) => n['@type'] === 'Person');
    assert.deepEqual(people.map((p) => p.name).sort(), Object.keys(APPROVED).sort(), path);
    const org = nodes.find((n) => n['@type'] === 'Organization');
    for (const p of people) {
      assert.equal(p.jobTitle, APPROVED[p.name]);
      assert.deepEqual(p.worksFor, { '@id': org['@id'] });
      assert.ok(org.founder.some((f) => f['@id'] === p['@id']), `${p.name} not in Organization.founder`);
      assert.match(p['@id'], /^https:\/\/kaayraherbals\.com\/founders#[a-z-]+$/);
    }
    assert.equal(org.founder.length, 3);
  }
});

test('founder structured data carries no qualification, contact detail or credential', () => {
  const raw = JSON.stringify(all.map((a) => a.graph));
  for (const f of founders) {
    for (const q of f.qualifications) assert.ok(!raw.includes(q), `qualification "${q}" leaked into structured data`);
    if (f.institution) assert.ok(!raw.includes(f.institution), `institution "${f.institution}" leaked into structured data`);
    if (f.email) assert.ok(!raw.includes(f.email));
  }
  assert.ok(!/hasCredential|alumniOf|award|knowsAbout|telephone|"email"/.test(raw));
});

test('articles: Organization is author and publisher, headline and date match the page, nothing invented', () => {
  const arts = all.filter((a) => a.route.type === 'article');
  assert.equal(arts.length, articles.length);
  for (const { route, graph } of arts) {
    const nodes = nodesOf(graph);
    const art = nodes.find((n) => n['@type'] === 'Article');
    const src = articles.find((x) => `/journal/${x.slug}` === route.path);
    const url = siteUrl + route.path;
    assert.equal(art.headline, src.title);
    assert.equal(art.datePublished, src.date);
    assert.equal(route.date, src.date, `${route.path}: routes.json date differs from journal.ts`);
    // No article names a verified author or reviewer yet, so each is authored and published by the Organization. When one does, the
    // dedicated tests below (synthetic data) pin the markup; this test then expects the named author instead.
    const named = Boolean(src.author?.name);
    assert.deepEqual(art.author, { '@id': named ? `${url}#author` : ids(siteUrl).organization });
    assert.deepEqual(art.publisher, { '@id': ids(siteUrl).organization });
    assert.equal(art.mainEntityOfPage['@id'], url);
    assert.equal(art.url, url);
    for (const k of ['image', 'review', 'aggregateRating', 'offers']) assert.ok(!(k in art), `${route.path}: unexpected ${k}`);
    assert.equal('dateModified' in art, Boolean(src.updated), `${route.path}: dateModified must exist exactly when the article data has an update date`);
    assert.equal(nodes.filter((n) => n['@type'] === 'Person').length, Number(named) + Number(Boolean(src.practitionerReviewed && src.review)), `${route.path}: Person nodes must match the verified people in the article data`);
    assert.equal(Boolean(src.practitionerReviewed), Boolean(src.review), `${route.path}: practitionerReviewed and review must be set together`);
    if (src.sources?.length) assert.deepEqual(art.citation.map((c) => c.url), src.sources.map((x) => x.url), `${route.path}: citation must list the visible sources`);
    const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList').itemListElement;
    assert.equal(crumbs.at(-1).item, url);
  }
});

test('no Offer, Product, Review, Rating, price or availability markup anywhere (pre-launch status preserved)', () => {
  const raw = JSON.stringify(all.map((a) => a.graph));
  assert.ok(!/"@type":"(Offer|AggregateOffer|Product|Review|AggregateRating|Rating)"/.test(raw));
  assert.ok(!/"(offers|price|priceCurrency|availability|aggregateRating|review)"/.test(raw));
});

test('the Organization carries the supplied logo: a real, square PNG under the site URL, same on every page', () => {
  assert.ok(brand.logo && brand.logo.width >= 112 && brand.logo.height >= 112, 'logo must be at least 112x112');
  assert.equal(brand.logo.width, brand.logo.height, 'logo must be square for search results');
  assert.ok(existsSync(join(root, 'public', brand.logo.path)), 'logo file is missing from /public');
  for (const { route, graph } of all) {
    const orgs = nodesOf(graph).filter((n) => n['@type'] === 'Organization');
    for (const o of orgs) {
      assert.equal(o.logo['@type'], 'ImageObject', route.path);
      assert.equal(o.logo.url, siteUrl + brand.logo.path, route.path);
      assert.equal(o.logo.width, brand.logo.width, route.path);
      assert.equal(o.logo.height, brand.logo.height, route.path);
      assert.equal(o.image, o.logo.url, route.path);
    }
  }
  assert.ok(all.some(({ graph }) => nodesOf(graph).some((n) => n['@type'] === 'Organization')), 'no page carries the Organization');
});

test('WebSite entity matches the brand and points at the Organization', () => {
  const w = nodesOf(build(routes[0])).find((n) => n['@type'] === 'WebSite');
  assert.equal(w['@id'], ids(siteUrl).website);
  assert.equal(w.name, 'Kaayra Herbals');
  assert.equal(w.url, siteUrl + '/');
  assert.deepEqual(w.publisher, { '@id': ids(siteUrl).organization });
});

test('home FAQ markup keeps every existing question and answer exactly', () => {
  const f = nodesOf(build(routes[0])).find((n) => n['@type'] === 'FAQPage');
  assert.deepEqual(f.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), faq.map((q) => [q.q, q.a]));
});

test('brand facts agree: config, home meta, llms files and route text use the same name, entity, location and date', () => {
  const llms = readFileSync(join(root, 'public/llms.txt'), 'utf8');
  const full = readFileSync(join(root, 'public/llms-full.txt'), 'utf8');
  for (const [n, t] of [['llms.txt', llms], ['llms-full.txt', full]]) {
    assert.ok(t.includes(brand.instagramUrl), `${n}: Instagram differs from the configured account`);
    assert.ok(t.includes(brand.legalName), `${n}: legal name`);
    assert.ok(t.includes('Varanasi, Uttar Pradesh, India'), `${n}: location`);
    assert.ok(t.includes('16 October 2026'), `${n}: incorporation date`);
    assert.ok(!t.includes('kaayraherbals_official'), `${n}: wrong Instagram account`);
    for (const [name, role] of Object.entries(APPROVED)) assert.ok(t.includes(`${name} (${role})`), `${n}: missing ${name} (${role})`);
    for (const f of founders) for (const q of f.qualifications) assert.ok(!t.includes(q), `${n}: qualification "${q}" duplicated in an AI-readable file`);
    for (const f of founders) if (f.institution) assert.ok(!t.includes(f.institution), `${n}: institution "${f.institution}" duplicated in an AI-readable file`);
  }
  const home = routes.find((r) => r.path === '/');
  assert.match(home.description, /Ayurvedic wellness company in Varanasi, India/);
});

// Phase 4.1 regression guard. The test above compares the markup with faq.json, so it could not notice faq.json itself losing questions
// (Phase 4 shipped 8 of the 11). These pin the set.
const REQUIRED_FAQ = [
  'What is Kaayra Herbals?',
  'Where is Kaayra Herbals based?',
  'Is anything for sale yet?',
  'Are Kaayra products approved or certified?',
  'How will I know when something launches?',
  'Does Kaayra give medical advice?',
  'Who founded Kaayra Herbals?',
  'How can I contact Kaayra Herbals?',
  'What is Kaayra Herbals’ philosophy?',
  'What is ingredient transparency?',
  'What is the difference between traditional Ayurvedic use and clinical evidence?',
];

test('home FAQPage markup has exactly the 11 priority questions, in order, each with a non-empty answer', () => {
  const f = nodesOf(build(routes[0])).find((n) => n['@type'] === 'FAQPage');
  assert.equal(f.mainEntity.length, 11);
  assert.deepEqual(f.mainEntity.map((q) => q.name), REQUIRED_FAQ);
  for (const q of f.mainEntity) {
    assert.equal(q['@type'], 'Question');
    assert.equal(q.acceptedAnswer['@type'], 'Answer');
    assert.ok(q.acceptedAnswer.text.trim().length > 30, `${q.name}: answer is too short`);
  }
});

test('FAQ markup keeps the approval disclaimer and makes no certification, rating or health claim', () => {
  const f = nodesOf(build(routes[0])).find((n) => n['@type'] === 'FAQPage');
  const approval = f.mainEntity.find((q) => q.name === 'Are Kaayra products approved or certified?');
  assert.ok(approval.acceptedAnswer.text.includes('We do not claim any approval, licence or certification.'));
  const all = f.mainEntity.map((q) => q.acceptedAnswer.text).join(' ');
  assert.doesNotMatch(all, /clinically|proven|cure|treats?\b|certified by|approved by|award|best |#1|guarantee/i);
});

test('FAQPage appears on the home page only, and no page has more than one', () => {
  for (const { route, graph } of all) {
    const n = nodesOf(graph).filter((x) => x['@type'] === 'FAQPage').length;
    assert.equal(n, route.path === '/' ? 1 : 0, route.path);
  }
});

test('articles with a real author and review: Person, reviewedBy, lastReviewed, dateModified and citation are emitted, and nothing else is invented', () => {
  const url = siteUrl + '/journal/example';
  const meta = {
    author: { name: 'A. Example', role: 'Writer', url: 'https://example.org/a' },
    review: { reviewer: { name: 'R. Reviewer', credentials: 'BAMS', url: 'https://example.org/r' }, reviewedOn: '2026-11-02' },
    updated: '2026-11-03',
    sources: [{ label: 'Source one', url: 'https://example.org/s' }],
  };
  const nodes = articleNodes({ siteUrl, url, route: { path: '/journal/example', description: 'd' }, visible: { headline: 'H', datePublished: '2026-11-01' }, meta });
  const art = nodes.find((n) => n['@type'] === 'Article');
  const people = nodes.filter((n) => n['@type'] === 'Person');
  const page = nodes.find((n) => n['@type'] === 'WebPage');
  assert.deepEqual(art.author, { '@id': `${url}#author` });
  assert.deepEqual(art.publisher, { '@id': ids(siteUrl).organization });
  assert.equal(art.dateModified, '2026-11-03');
  assert.deepEqual(art.mainEntityOfPage, { '@id': url });
  assert.equal(art.citation[0].url, 'https://example.org/s');
  assert.deepEqual(people.map((p) => p.name).sort(), ['A. Example', 'R. Reviewer']);
  assert.equal(people.find((p) => p.name === 'R. Reviewer').description, 'BAMS');
  assert.equal(page['@id'], url);
  assert.deepEqual(page.reviewedBy, { '@id': `${url}#reviewer` });
  assert.equal(page.lastReviewed, '2026-11-02');
  const raw = JSON.stringify(nodes);
  assert.ok(!/hasCredential|alumniOf|aggregateRating|"review"|"Review"|offers/.test(raw));
});

test('articles with no verified person emit exactly the Organization-authored shape (no Person, no reviewedBy, no dateModified)', () => {
  const url = siteUrl + '/journal/example';
  const nodes = articleNodes({ siteUrl, url, route: { path: '/journal/example', description: 'd' }, visible: { headline: 'H', datePublished: '2026-11-01' }, meta: {} });
  assert.equal(nodes.length, 1);
  assert.deepEqual(nodes[0].author, { '@id': ids(siteUrl).organization });
  assert.ok(!('dateModified' in nodes[0]) && !('citation' in nodes[0]));
});

test('every non-article public page carries a WebPage-type node tied to the WebSite, and generic pages keep their BreadcrumbList', () => {
  for (const { route, graph } of all) {
    if (route.type === 'article' || route.path === '/founders') continue;
    const nodes = nodesOf(graph);
    const page = nodes.find((n) => /^(WebPage|AboutPage|ContactPage|CollectionPage)$/.test(n['@type']));
    assert.ok(page, `${route.path}: no WebPage node`);
    assert.equal(page.url, siteUrl + (route.path === '/' ? '/' : route.path));
    assert.deepEqual(page.isPartOf, { '@id': ids(siteUrl).website });
    if (route.path !== '/') assert.ok(nodes.some((n) => n['@type'] === 'BreadcrumbList'), `${route.path}: breadcrumb missing`);
  }
});

test('journal data: a review exists exactly when an article is marked practitioner-reviewed, and a named reviewer always has credentials and a date', () => {
  for (const a of articles) {
    assert.equal(Boolean(a.practitionerReviewed), Boolean(a.review), `${a.slug}: practitionerReviewed and review must be set together`);
    if (a.review) {
      assert.ok(a.review.reviewer?.name && a.review.reviewer?.credentials, `${a.slug}: reviewer needs a name and credentials`);
      assert.match(a.review.reviewedOn ?? '', /^\d{4}-\d{2}-\d{2}$/, `${a.slug}: reviewedOn must be a real ISO date`);
    }
    for (const slug of a.related ?? []) assert.ok(articles.some((x) => x.slug === slug && x.slug !== a.slug), `${a.slug}: related slug ${slug} does not exist`);
  }
});

test('founder profiles, when supplied, appear in the Person sameAs list as https URLs and nothing else changes', () => {
  const f = { ...founders[0], profiles: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/example' }] };
  const home = graphFor({ route: routes[0], url: siteUrl + '/', html: '', siteUrl, brand, founders: [f, ...founders.slice(1)], faq });
  const p = nodesOf(home).find((n) => n['@type'] === 'Person' && n.name === f.name);
  assert.ok(p.sameAs.includes('https://www.linkedin.com/in/example'));
  assert.ok(p.sameAs.includes(`https://www.instagram.com/${f.instagram}/`));
});

test('ingredient library: optional safety and evidence fields are sourced, link to real articles, and never state a dose', () => {
  const slugs = new Set(ingredients.map((i) => i.slug));
  assert.equal(slugs.size, ingredients.length, 'duplicate ingredient slug');
  for (const i of ingredients) {
    for (const f of ['safety', 'evidence']) if (i[f]) assert.ok(i.references?.length, `${i.slug}: has ${f} text but no references`);
    for (const r of i.references ?? []) assert.match(r.url, /^https:\/\//, `${i.slug}: reference must be https`);
    for (const slug of i.articles ?? []) assert.ok(articles.some((a) => a.slug === slug), `${i.slug}: unknown article ${slug}`);
    assert.doesNotMatch([i.note, i.identification, i.traditionalContext, i.evidence, i.safety].filter(Boolean).join(' '), /\b\d+\s?(mg|g|ml|mcg|tablets?|capsules?|teaspoons?)\b|\bdose of\b/i, `${i.slug}: states a dose`);
  }
  for (const a of articles) for (const slug of a.ingredients ?? []) assert.ok(slugs.has(slug), `${a.slug}: unknown ingredient ${slug}`);
});

test('real founder LinkedIn profiles are plain https URLs without tracking parameters; a founder without one carries a note and no profile', () => {
  const home = nodesOf(build(routes[0]));
  for (const f of founders) {
    const p = home.find((n) => n['@type'] === 'Person' && n.name === f.name);
    if (f.profiles?.length) {
      for (const x of f.profiles) {
        assert.match(x.url, /^https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]+$/, `${f.name}: profile URL must be clean (no utm_ or share parameters)`);
        assert.ok(p.sameAs.includes(x.url), `${f.name}: profile missing from sameAs`);
      }
    } else {
      assert.ok(f.profileNote, `${f.name}: no profile and no note explaining it`);
      assert.ok(!(p.sameAs ?? []).some((u) => /linkedin/.test(u)));
    }
  }
  assert.equal(founders.find((f) => f.name === 'Ritika Jaiswal').profileNote, 'Ritika is not on LinkedIn.');
});
