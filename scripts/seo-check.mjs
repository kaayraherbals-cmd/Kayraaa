// Post-build SEO check. Reads dist/ (run `npm run build` first) and fails with exit code 1 on any problem.
// Usage: VITE_SITE_URL=https://kaayraherbals.com node scripts/seo-check.mjs
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/import-ts.mjs';
import { readBrandFacts } from './brand-facts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const site = (process.env.VITE_SITE_URL || 'https://kaayraherbals.com').replace(/\/$/, '');
const routes = JSON.parse(await readFile(join(root, 'shared/routes.json'), 'utf8'));
const privateRoutes = JSON.parse(await readFile(join(root, 'shared/private-routes.json'), 'utf8'));
// Brand facts from src/config/site.ts, shared by every check below (the homepage logo check needs them before section 2c).
const brand = readBrandFacts(join(root, 'src/config/site.ts'), process.env);

// Verified author / reviewer facts per article (src/content/journal.ts). With none, the Organization is author and no Person or review markup may appear.
const { articles: journal } = await importTs(join(root, 'src/content/journal.ts'));
const metaOf = (path) => journal.find((a) => `/journal/${a.slug}` === path) ?? {};
const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const fileFor = (p) => (p === '/' ? join(dist, 'index.html') : join(dist, p.slice(1), 'index.html'));
const count = (s, re) => (s.match(re) || []).length;
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<');

// 1. Every public route
for (const r of routes) {
  const f = fileFor(r.path);
  if (!existsSync(f)) { fail(`${r.path}: no prerendered file`); continue; }
  const html = await readFile(f, 'utf8');
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => decode(m[1]));
  if (!titles.includes(r.title)) fail(`${r.path}: <title> is not "${r.title}"`);
  if (count(html, /<head>[\s\S]*?<title>/g) !== 1) fail(`${r.path}: expected exactly one <title> in <head>`);
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
  const want = site + (r.path === '/' ? '/' : r.path);
  if (canon.length !== 1 || canon[0] !== want) fail(`${r.path}: canonical is ${JSON.stringify(canon)}, expected ${want}`);
  if (/<meta name="robots"[^>]*noindex/i.test(html)) fail(`${r.path}: public route carries noindex`);
  if (count(html, /<meta name="description"/g) !== 1) fail(`${r.path}: expected one meta description`);
  if (/<meta name="keywords"/i.test(html)) fail(`${r.path}: has meta keywords`);
  if (count(html, /<h1[\s>]/g) !== 1) fail(`${r.path}: expected exactly one <h1>, found ${count(html, /<h1[\s>]/g)}`);
  if (/kaayraherbals\.example/.test(html)) fail(`${r.path}: placeholder domain in output`);
  if (!/property="og:site_name" content="Kaayra Herbals"/.test(html)) fail(`${r.path}: og:site_name is not "Kaayra Herbals"`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { fail(`${r.path}: invalid JSON-LD (${e.message})`); }
  }
  // Brand spelling: the misspellings that would split the brand signal.
  if (/\bKaira Herbals\b|\bKayra Herbals\b|\bKiara Herbals\b|\bKiyara Herbals\b/.test(html)) fail(`${r.path}: misspelt brand name`);
}

// 2. Homepage specifics
{
  const html = await readFile(fileFor('/'), 'utf8');
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]?.replace(/<[^>]+>/g, '').trim();
  if (h1 !== 'Kaayra Herbals') fail(`/: H1 is ${JSON.stringify(h1)}, expected "Kaayra Herbals"`);
  if (!html.includes('Ancient <em>Wisdom.</em>')) fail('/: tagline is missing from the visible page');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const nodes = blocks.flatMap((b) => b['@graph'] ?? [b]);
  const ws = nodes.filter((n) => n['@type'] === 'WebSite');
  const org = nodes.filter((n) => n['@type'] === 'Organization');
  if (ws.length !== 1) fail(`/: expected 1 WebSite node, found ${ws.length}`);
  else {
    if (ws[0].name !== 'Kaayra Herbals') fail('/: WebSite.name is not "Kaayra Herbals"');
    if (ws[0].url !== site + '/') fail(`/: WebSite.url is ${ws[0].url}`);
  }
  if (org.length !== 1) fail(`/: expected 1 Organization node, found ${org.length}`);
  else {
    if (org[0].name !== 'Kaayra Herbals') fail('/: Organization.name is not "Kaayra Herbals"');
    if (org[0].url !== site + '/') fail(`/: Organization.url is ${org[0].url}`);
    const logoUrl = org[0].logo?.url;
    if (!logoUrl) fail('/: Organization.logo is missing');
    else if (logoUrl !== site + brand.logo.path) fail(`/: Organization.logo.url is ${logoUrl}, expected ${site + brand.logo.path}`);
    if (org[0].aggregateRating || org[0].review) fail('/: Organization carries rating or review markup');
  }
  if (!/<title>Kaayra Herbals \| Official Ayurvedic Wellness Brand<\/title>/.test(html)) fail('/: homepage title is not the agreed brand title');
}

// 2a. Audit fixes: first heading, plain-text emails, hreflang, FAQ markup, llms.txt, inline boot script
{
  for (const r of routes) {
    const html = await readFile(fileFor(r.path), 'utf8');
    const first = (html.match(/<h([1-6])[\s>]/) || [])[1];
    if (first !== '1') fail(`${r.path}: first heading is H${first}, expected H1`);
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) fail(`${r.path}: plain-text email address in the page markup`);
    if (!html.includes('hreflang="en-IN"') || !html.includes('hreflang="x-default"')) fail(`${r.path}: hreflang links missing`);
    if (/<script src="\/boot\.js">/.test(html)) fail(`${r.path}: boot.js is still a render-blocking request`);
  }
  const home = await readFile(fileFor('/'), 'utf8');
  if (!home.includes('"@type":"FAQPage"')) fail('/: FAQPage structured data is missing');
  const faqList = JSON.parse(await readFile(join(root, 'shared/faq.json'), 'utf8'));
  for (const f of faqList) if (!home.includes(f.q)) fail(`/: FAQ question not visible on the page: ${f.q}`);
  // Phase 4.1: the visible FAQ and the FAQPage JSON-LD must be the same questions and answers, in the same order, and the set must not shrink below the 11 priority questions.
  {
    const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
    const faqBlock = (home.match(/<div class="faq">([\s\S]*?)<\/div><\/div>|<div class="faq">([\s\S]*)/) || [])[0] || '';
    const visible = [...faqBlock.matchAll(/<h3>(.*?)<\/h3><p>(.*?)<\/p>/g)].map((m) => [decode(m[1]), decode(m[2])]);
    const ld = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const b = JSON.parse(m[1]); return b['@graph'] ?? [b]; });
    const pages = ld.filter((n) => n['@type'] === 'FAQPage');
    if (pages.length !== 1) fail(`/: expected 1 FAQPage node, found ${pages.length}`);
    const marked = (pages[0]?.mainEntity ?? []).map((q) => [q.name, q.acceptedAnswer?.text]);
    const source = faqList.map((f) => [f.q, f.a]);
    if (faqList.length < 11) fail(`/: shared/faq.json has ${faqList.length} questions; the AEO set is 11 (Phase 4.1 regression)`);
    if (JSON.stringify(visible) !== JSON.stringify(source)) fail(`/: visible FAQ (${visible.length} items) differs from shared/faq.json (${source.length} items)`);
    if (JSON.stringify(marked) !== JSON.stringify(source)) fail(`/: FAQPage JSON-LD (${marked.length} items) differs from shared/faq.json (${source.length} items)`);
    notes.push(`FAQ: ${visible.length} visible, ${marked.length} in FAQPage JSON-LD, ${source.length} in faq.json, identical.`);
  }
  const llms = existsSync(join(dist, 'llms.txt')) ? await readFile(join(dist, 'llms.txt'), 'utf8') : '';
  if (!llms.includes(site + '/') || llms.includes('__SITE_URL__')) fail('llms.txt is missing or still has the placeholder');
}

// 2b. Founders page: Person markup for every founder, no contact detail in structured data
{
  const html = await readFile(fileFor('/founders'), 'utf8');
  const founders = JSON.parse(await readFile(join(root, 'shared/founders.json'), 'utf8'));
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const raw = JSON.stringify(blocks);
  for (const f of founders) {
    if (!raw.includes(f.name)) fail(`/founders: structured data is missing ${f.name}`);
    if (f.email && raw.includes(f.email)) fail(`/founders: structured data exposes ${f.name}'s email`);
    if (!html.includes(f.name)) fail(`/founders: ${f.name} is missing from the visible page`);
  }
}

// 2c. Phase 4 GEO: entity graph, founder relationships, article authorship, Instagram, forbidden markup
{
  const approved = { 'Nitesh Jaiswal': 'Founder & CEO', 'Ritika Jaiswal': 'Co-Founder', 'Anuj Kumar': 'Co-Founder' };
  const foundersList = JSON.parse(await readFile(join(root, 'shared/founders.json'), 'utf8'));
  const orgId = `${site}/#organization`;
  const graphOf = async (path) => {
    const html = await readFile(fileFor(path), 'utf8');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    return { html, nodes: blocks.flatMap((b) => b['@graph'] ?? [b]) };
  };
  for (const r of routes) {
    const { html, nodes } = await graphOf(r.path);
    const ids = nodes.map((n) => n['@id']).filter(Boolean);
    if (new Set(ids).size !== ids.length) fail(`${r.path}: duplicate @id in structured data`);
    const refs = [];
    const walk = (v, top) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, false));
      if (v && typeof v === 'object') {
        if (!top && Object.keys(v).length === 1 && v['@id']) refs.push(v['@id']);
        Object.values(v).forEach((x) => walk(x, false));
      }
    };
    nodes.forEach((n) => walk(n, true));
    for (const ref of refs) if (!ids.includes(ref)) fail(`${r.path}: structured-data reference ${ref} does not resolve inside the page's graph`);
    const orgs = nodes.filter((n) => n['@type'] === 'Organization');
    if (orgs.length > 1) fail(`${r.path}: ${orgs.length} Organization nodes (expected at most one)`);
    if (orgs[0] && orgs[0]['@id'] !== orgId) fail(`${r.path}: Organization @id is ${orgs[0]['@id']}, expected ${orgId}`);
    if (orgs[0] && JSON.stringify(orgs[0].sameAs) !== JSON.stringify([brand.instagramUrl, ...(orgs[0].sameAs || []).slice(1)])) fail(`${r.path}: Organization.sameAs does not start with the configured Instagram ${brand.instagramUrl}`);
    const raw = JSON.stringify(nodes);
    // dateModified and reviewedBy are allowed only on an article whose own data (journal.ts) carries a real update date or a real review.
    const meta = metaOf(r.path);
    const forbidden = ['offers', 'price', 'priceCurrency', 'availability', 'aggregateRating', 'review', 'hasCredential', 'alumniOf', ...(meta.updated ? [] : ['dateModified']), ...(meta.practitionerReviewed && meta.review ? [] : ['reviewedBy'])];
    if (new RegExp(`"@type":"(Offer|AggregateOffer|Product|Review|AggregateRating|Rating)"|"(${forbidden.join('|')})"`).test(raw)) fail(`${r.path}: forbidden structured-data property or type present`);
    if (/kaayraherbals_official/.test(html)) fail(`${r.path}: wrong Instagram account in the page`);
    for (const f of foundersList) for (const q of f.qualifications) if (raw.includes(q)) fail(`${r.path}: founder qualification "${q}" appears in structured data`);
    for (const f of foundersList) if (f.institution && raw.includes(f.institution)) fail(`${r.path}: founder institution "${f.institution}" appears in structured data`);
    // canonical, og:url and the structured-data URL must be the same address
    const want = site + (r.path === '/' ? '/' : r.path);
    const og = html.match(/<meta property="og:url" content="([^"]*)"/)?.[1];
    if (og !== want) fail(`${r.path}: og:url is ${og}, expected ${want}`);
    for (const n of nodes) for (const k of ['url', 'item']) if (typeof n[k] === 'string' && n[k].startsWith(site) && n['@type'] !== 'Organization' && n['@type'] !== 'WebSite' && n['@type'] !== 'ListItem' && n[k] !== want) fail(`${r.path}: ${n['@type']}.${k} is ${n[k]}, expected ${want}`);
  }
  // Founders: names and approved roles, linked both ways, on the home page and the founders page
  for (const path of ['/', '/founders']) {
    const { nodes } = await graphOf(path);
    const org = nodes.find((n) => n['@type'] === 'Organization');
    const people = nodes.filter((n) => n['@type'] === 'Person');
    if (JSON.stringify(people.map((p) => p.name).sort()) !== JSON.stringify(Object.keys(approved).sort())) fail(`${path}: Person nodes are ${JSON.stringify(people.map((p) => p.name))}`);
    for (const p of people) {
      if (p.jobTitle !== approved[p.name]) fail(`${path}: ${p.name} jobTitle is "${p.jobTitle}", approved role is "${approved[p.name]}"`);
      if (p.worksFor?.['@id'] !== orgId) fail(`${path}: ${p.name} is not linked to the Organization (worksFor)`);
      if (!org?.founder?.some((f) => f['@id'] === p['@id'])) fail(`${path}: Organization.founder does not reference ${p.name}`);
    }
  }
  // Articles: Organization author and publisher, headline and date equal to what the page shows, no person, no reviewer
  for (const r of routes.filter((x) => x.type === 'article')) {
    const { html, nodes } = await graphOf(r.path);
    const art = nodes.find((n) => n['@type'] === 'Article');
    if (!art) { fail(`${r.path}: Article structured data missing`); continue; }
    const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '').replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&gt;/g, '>')).trim();
    const time = html.match(/<time[^>]*\sdatetime="([^"]+)"/i)?.[1];
    if (art.headline !== h1) fail(`${r.path}: Article.headline "${art.headline}" differs from the visible H1 "${h1}"`);
    if (art.datePublished !== time || time !== r.date) fail(`${r.path}: datePublished ${art.datePublished}, visible date ${time}, routes.json date ${r.date} do not all match`);
    const meta = metaOf(r.path);
    const people = nodes.filter((n) => n['@type'] === 'Person');
    const hasAuthor = Boolean(meta.author?.name);
    const hasReview = Boolean(meta.practitionerReviewed && meta.review?.reviewer?.name);
    if (Boolean(meta.practitionerReviewed) !== Boolean(meta.review)) fail(`${r.path}: practitionerReviewed and review must be set together (never claim a review without a named reviewer, or name one without the flag)`);
    if (art.publisher?.['@id'] !== orgId) fail(`${r.path}: Article publisher must be the Organization`);
    if (art.author?.['@id'] !== (hasAuthor ? `${site}${r.path}#author` : orgId)) fail(`${r.path}: Article author is ${JSON.stringify(art.author)}; ${hasAuthor ? 'the named author' : 'the Organization'} was expected`);
    if (people.length !== Number(hasAuthor) + Number(hasReview)) fail(`${r.path}: ${people.length} Person node(s) on an article page; the article data names ${Number(hasAuthor) + Number(hasReview)} verified person(s)`);
    if (hasAuthor && !html.includes(meta.author.name)) fail(`${r.path}: structured data names ${meta.author.name} but the visible page does not`);
    if (hasReview && !html.includes(meta.review.reviewer.name)) fail(`${r.path}: structured data names reviewer ${meta.review.reviewer.name} but the visible page does not`);
    if (!hasReview && /reviewed by/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/not been reviewed by/gi, ''))) fail(`${r.path}: the page says it was reviewed, but the article data has no review`);
    if (art.mainEntityOfPage?.['@id'] !== site + r.path) fail(`${r.path}: Article.mainEntityOfPage is not the canonical URL`);
    if (!html.includes('property="og:type" content="article"')) fail(`${r.path}: og:type is not "article"`);
    if (!hasAuthor && !/by Kaayra Herbals/.test(html)) fail(`${r.path}: the page no longer shows "by Kaayra Herbals", so the Organization author is not visible`);
  }
  // AI-readable files: Instagram, roles, no qualifications
  for (const name of ['llms.txt', 'llms-full.txt']) {
    const t = await readFile(join(dist, name), 'utf8');
    if (!t.includes(brand.instagramUrl)) fail(`${name}: does not carry the configured Instagram ${brand.instagramUrl}`);
    if (/kaayraherbals_official/.test(t)) fail(`${name}: wrong Instagram account`);
    for (const f of foundersList) {
      if (!t.includes(`${f.name} (${f.role})`)) fail(`${name}: missing "${f.name} (${f.role})"`);
      for (const q of f.qualifications) if (t.includes(q)) fail(`${name}: founder qualification "${q}" duplicated in an AI-readable file`);
      if (f.institution && t.includes(f.institution)) fail(`${name}: founder institution "${f.institution}" duplicated in an AI-readable file`);
    }
  }
}

// 3. Private shells stay out of the index
for (const r of [...privateRoutes, { path: '/admin' }, { path: '/product-shell' }]) {
  const f = fileFor(r.path);
  if (!existsSync(f)) { fail(`${r.path}: shell missing`); continue; }
  const html = await readFile(f, 'utf8');
  if (!/<meta name="robots" content="noindex/.test(html)) fail(`${r.path}: shell is missing noindex`);
  if (/<link rel="canonical"/.test(html)) fail(`${r.path}: noindex shell still has a canonical`);
}
if (!existsSync(join(dist, '404.html'))) fail('404.html missing');

// 4. Sitemap and robots
const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const expected = routes.map((r) => site + (r.path === '/' ? '/' : r.path));
if (JSON.stringify([...locs].sort()) !== JSON.stringify([...expected].sort())) fail('sitemap.xml URLs do not equal the public route list');
if (new Set(locs).size !== locs.length) fail('sitemap.xml has duplicate URLs');
for (const r of privateRoutes) if (locs.includes(site + r.path)) fail(`sitemap.xml lists private route ${r.path}`);
const robots = await readFile(join(dist, 'robots.txt'), 'utf8');
if (!robots.includes(`Sitemap: ${site}/sitemap.xml`)) fail('robots.txt does not reference the production sitemap');
if (/__SITE_URL__/.test(robots)) fail('robots.txt still contains the __SITE_URL__ placeholder');
if (!existsSync(join(dist, 'llms.txt'))) fail('dist/llms.txt missing');
if (!existsSync(join(dist, 'llms-full.txt'))) fail('dist/llms-full.txt missing');
const llms = existsSync(join(dist, 'llms.txt')) ? await readFile(join(dist, 'llms.txt'), 'utf8') : '';
const llmsFull = existsSync(join(dist, 'llms-full.txt')) ? await readFile(join(dist, 'llms-full.txt'), 'utf8') : '';
for (const [name, content] of [['llms.txt', llms], ['llms-full.txt', llmsFull]]) {
  if (/__SITE_URL__/.test(content)) fail(`${name} still contains the __SITE_URL__ placeholder`);
  if (!content.includes(site + '/sitemap.xml')) fail(`${name} does not link to the production sitemap`);
  if (!content.includes('nothing is currently for sale') && !content.includes('nothing is for sale')) fail(`${name} does not clearly state the current product status`);
  if (/\b(?:cures?|treats?|clinically proven|certified|approved)\b/i.test(content) && !/does not claim|does not provide|not medical advice|not a product approval/i.test(content)) notes.push(`${name}: review claims-language context manually`);
}
if (!llms.includes(site + '/llms-full.txt')) fail('llms.txt does not link to llms-full.txt');
const disallow = robots.split('\n').filter((l) => l.startsWith('Disallow:')).map((l) => l.slice(9).trim()).filter(Boolean);
for (const r of routes) for (const d of disallow) if (r.path === d || (d.endsWith('/') && r.path.startsWith(d)) || r.path.startsWith(d + '/')) fail(`robots.txt blocks public route ${r.path} (${d})`);
if (/Disallow:\s*\/(assets|images)?\s*$/m.test(robots)) fail('robots.txt blocks assets or the whole site');

// 5. Internal links in built HTML resolve to a built page
const known = new Set([...routes, ...privateRoutes].map((r) => r.path));
const prefixOk = (p) => p.startsWith('/collection/') || p.startsWith('/track-order/') || p === '/admin';
for (const r of routes) {
  const html = await readFile(fileFor(r.path), 'utf8');
  for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
    let h = decode(m[1]);
    if (/^(mailto:|tel:|https?:\/\/(?!kaayraherbals\.com))/.test(h) || h.startsWith('#')) continue;
    h = h.replace(site, '').split('#')[0].split('?')[0] || '/';
    if (!known.has(h) && !prefixOk(h)) fail(`${r.path}: internal link to unknown path ${h}`);
  }
}

// 5a. Social metadata: Open Graph and Twitter/X tags are complete, route-specific and consistent on every public page
{
  const metaOf = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name.replace(/[:.]/g, '\\$&')}" content="([^"]*)"`))?.[1];
  for (const r of routes) {
    const html = await readFile(fileFor(r.path), 'utf8');
    const want = site + (r.path === '/' ? '/' : r.path);
    const checks = [
      ['property', 'og:title', r.title], ['property', 'og:description', r.description], ['property', 'og:url', want],
      ['name', 'twitter:title', r.title], ['name', 'twitter:description', r.description],
    ];
    for (const [attr, name, expected] of checks) {
      const v = metaOf(html, attr, name);
      if (v === undefined) fail(`${r.path}: ${name} is missing`);
      else if (decode(v) !== expected) fail(`${r.path}: ${name} is "${decode(v)}", expected "${expected}"`);
    }
    for (const [attr, name] of [['property', 'og:image'], ['name', 'twitter:image']]) {
      const v = metaOf(html, attr, name);
      if (!v) { fail(`${r.path}: ${name} is missing`); continue; }
      if (!v.startsWith(site + '/')) fail(`${r.path}: ${name} is not an absolute URL on ${site}: ${v}`);
      else if (!existsSync(join(dist, v.slice(site.length + 1)))) fail(`${r.path}: ${name} points to a file that is not in dist: ${v}`);
    }
    if (!metaOf(html, 'property', 'og:image:alt')) fail(`${r.path}: og:image:alt is missing`);
    if (!metaOf(html, 'name', 'twitter:image:alt')) fail(`${r.path}: twitter:image:alt is missing`);
    if (metaOf(html, 'name', 'twitter:card') !== 'summary_large_image') fail(`${r.path}: twitter:card is not summary_large_image`);
    if (r.type === 'article' && metaOf(html, 'property', 'article:published_time') !== r.date) fail(`${r.path}: article:published_time is not ${r.date}`);
  }
}

// 5b. Private routes: every one is covered by the X-Robots-Tag rule in vercel.json, carries meta noindex, has no social tags,
//     and public pages never link to the two commerce pages that are not part of the public navigation (/bundles, /wishlist)
{
  const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  const noindexRules = (vercel.headers || []).filter((h) => (h.headers || []).some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)));
  const covered = (path) => noindexRules.some((h) => { try { return new RegExp(`^${h.source.replace(/:path\*/g, '.*')}$`).test(path); } catch { return false; } });
  for (const p of [...privateRoutes.map((r) => r.path), '/admin', '/track-order/example-id'])
    if (!covered(p)) fail(`vercel.json: no X-Robots-Tag noindex header rule covers private route ${p}`);
  for (const r of noindexRules) if (!(r.headers || []).some((x) => x.key === 'X-Robots-Tag' && /nofollow/.test(x.value))) fail(`vercel.json: rule ${r.source} sends noindex without nofollow`);
  for (const r of routes) if (covered(r.path)) fail(`vercel.json: public route ${r.path} is covered by a noindex header rule`);
  for (const r of [...privateRoutes, { path: '/admin' }]) {
    const html = await readFile(fileFor(r.path), 'utf8');
    if (/<meta (?:property="og:|name="twitter:)/.test(html)) fail(`${r.path}: private shell still carries social tags`);
  }
  for (const r of routes) {
    const html = await readFile(fileFor(r.path), 'utf8');
    for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/g)) if (/^\/(bundles|wishlist)(\/|$|\?|#)/.test(decode(m[1]))) fail(`${r.path}: public page links to ${m[1]}`);
  }
}

// 6. Icons
{
  const html = await readFile(fileFor('/'), 'utf8');
  for (const href of ['/favicon.ico', '/favicon-48x48.png', '/favicon-96x96.png', '/favicon-192x192.png', '/apple-touch-icon.png'])
    if (count(html, new RegExp(`<link rel="(?:icon|apple-touch-icon)"[^>]*href="${href.replace(/[.]/g, '\\.')}"`, 'g')) !== 1) fail(`/: expected exactly one <link> to ${href}`);
}
for (const f of ['favicon.ico', 'favicon-48x48.png', 'favicon-96x96.png', 'favicon-192x192.png', 'apple-touch-icon.png', 'og-image.png']) if (!existsSync(join(dist, f))) fail(`dist/${f} missing`);

console.log(`[seo-check] ${routes.length} public routes, ${privateRoutes.length + 2} private shells, ${locs.length} sitemap URLs checked against ${site}`);
for (const n of notes) console.log(`[seo-check] note: ${n}`);
if (problems.length) {
  console.error(`[seo-check] ${problems.length} problem(s):\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('[seo-check] OK');
