// Post-build SEO check. Reads dist/ (run `npm run build` first) and fails with exit code 1 on any problem.
// Usage: VITE_SITE_URL=https://kaayraherbals.com node scripts/seo-check.mjs
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const site = (process.env.VITE_SITE_URL || 'https://kaayraherbals.com').replace(/\/$/, '');
const routes = JSON.parse(await readFile(join(root, 'shared/routes.json'), 'utf8'));
const privateRoutes = JSON.parse(await readFile(join(root, 'shared/private-routes.json'), 'utf8'));

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
    if (org[0].logo) notes.push('Organization.logo is set: confirm it is the approved logo.');
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
