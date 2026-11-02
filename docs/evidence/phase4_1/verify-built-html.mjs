import { readFileSync, existsSync } from 'node:fs';
const root = '/home/claude/work/kaayra-ui-refresh', dist = root + '/dist', site = 'https://kaayraherbals.com';
const routes = JSON.parse(readFileSync(root + '/shared/routes.json', 'utf8'));
const priv = JSON.parse(readFileSync(root + '/shared/private-routes.json', 'utf8'));
const faq = JSON.parse(readFileSync(root + '/shared/faq.json', 'utf8'));
const out = []; let bad = 0;
const ok = (c, m) => { out.push(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) bad++; };
const fileFor = (p) => dist + (p === '/' ? '/index.html' : `${p}/index.html`);
const ld = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const b = JSON.parse(m[1]); return b['@graph'] ?? [b]; });
const meta = (h, re) => (h.match(re) || [])[1];
ok(routes.length === 17, `routes.json has ${routes.length} public routes (expect 17)`);
const sm = readFileSync(dist + '/sitemap.xml', 'utf8'); const locs = [...sm.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
const want = routes.map((r) => site + (r.path === '/' ? '/' : r.path));
ok(locs.length === 17 && JSON.stringify([...locs].sort()) === JSON.stringify([...want].sort()), `sitemap has ${locs.length} URLs, equal to the route list`);
ok(!priv.some((p) => locs.some((l) => l.includes(p.path ?? p))), 'no private route appears in the sitemap');
const pages = {};
for (const r of routes) {
  const f = fileFor(r.path); if (!existsSync(f)) { ok(false, `${r.path}: file missing`); continue; }
  const h = readFileSync(f, 'utf8'); pages[r.path] = h; const url = site + (r.path === '/' ? '/' : r.path);
  const canon = meta(h, /<link rel="canonical" href="([^"]+)"/);
  ok(canon === url, `${r.path}: canonical ${canon}`);
  ok(meta(h, /<meta property="og:url" content="([^"]+)"/) === url, `${r.path}: og:url matches canonical`);
  ok(!!meta(h, /<meta property="og:title" content="([^"]+)"/) && !!meta(h, /<meta property="og:description" content="([^"]+)"/), `${r.path}: og:title and og:description present`);
  ok(!/<meta name="robots" content="[^"]*noindex/.test(h), `${r.path}: indexable (no noindex)`);
}
let noidx = 0, privChecked = 0;
for (const p of priv) { const path = p.path ?? p; const f = fileFor(path.replace(/\/:.*$/, '')); if (!existsSync(f)) continue; privChecked++; if (/<meta name="robots" content="[^"]*noindex/.test(readFileSync(f, 'utf8'))) noidx++; }
ok(privChecked > 0 && noidx === privChecked, `private shells present in dist: ${privChecked}, with noindex: ${noidx}`);
const robots = readFileSync(dist + '/robots.txt', 'utf8'); ok(robots.includes(`Sitemap: ${site}/sitemap.xml`), 'robots.txt references the production sitemap');
const home = ld(pages['/']);
const orgs = home.filter((n) => n['@type'] === 'Organization'); ok(orgs.length === 1 && orgs[0].name === 'Kaayra Herbals' && orgs[0]['@id'] === `${site}/#organization`, 'home: one Organization, name Kaayra Herbals, stable @id');
ok(orgs[0].sameAs?.[0] === 'https://www.instagram.com/kaayra.herbals/', `Organization.sameAs[0] = ${orgs[0].sameAs?.[0]}`);
ok(!JSON.stringify(home).includes('kaayraherbals_official'), 'wrong Instagram handle absent');
const ws = home.filter((n) => n['@type'] === 'WebSite'); ok(ws.length === 1 && ws[0].url === site + '/' && ws[0].publisher?.['@id'] === `${site}/#organization`, 'home: one WebSite pointing at the Organization');
const fo = ld(pages['/founders']).filter((n) => n['@type'] === 'Person');
const roles = Object.fromEntries(fo.map((p) => [p.name, p.jobTitle])); ok(fo.length === 3 && roles['Nitesh Jaiswal'] === 'Founder & CEO' && roles['Ritika Jaiswal'] === 'Co-Founder' && roles['Anuj Kumar'] === 'Co-Founder', `founders page: ${fo.length} Person entities ${JSON.stringify(roles)}`);
ok(fo.every((p) => p.worksFor?.['@id'] === `${site}/#organization` || (p.worksFor && JSON.stringify(p.worksFor).includes('#organization'))), 'each founder linked to the Organization (worksFor)');
const arts = routes.filter((r) => r.type === 'article'); ok(arts.length === 4, `${arts.length} article routes`);
for (const r of arts) { const a = ld(pages[r.path]).find((n) => n['@type'] === 'Article'); const h = pages[r.path];
  ok(!!a && a.author?.['@id'] === `${site}/#organization` && a.publisher?.['@id'] === `${site}/#organization`, `${r.path}: Article author and publisher are the Organization`);
  ok(a && !JSON.stringify(a).includes('"Person"') && !a.reviewedBy && !a.dateModified, `${r.path}: no personal author, reviewer or modified date`);
  const h1 = decodeURIComponent((h.match(/<h1[^>]*>(.*?)<\/h1>/) || [])[1] || '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&'); const date = meta(h, /<time[^>]*dateTime="([^"]+)"/i) || meta(h, /<time[^>]*datetime="([^"]+)"/i);
  ok(a && a.headline.replace(/’/g, "'") === h1.replace(/’/g, "'") && a.datePublished === date && a.datePublished === r.date, `${r.path}: headline equals visible H1, datePublished ${a?.datePublished} equals visible date and routes.json`);
  ok(a?.mainEntityOfPage && JSON.stringify(a.mainEntityOfPage).includes(site + r.path), `${r.path}: mainEntityOfPage is the canonical URL`); }
const fh = pages['/']; const faqBlock = (fh.match(/<div class="faq">[\s\S]*?<\/div><\/div>/) || [''])[0]; const h3 = (faqBlock.match(/<h3>/g) || []).length;
const fp = home.find((n) => n['@type'] === 'FAQPage'); ok(h3 === 11 && fp?.mainEntity?.length === 11, `home: ${h3} visible FAQ questions, ${fp?.mainEntity?.length} FAQPage entries`);
for (const q of faq.slice(8)) ok(fh.includes(q.q) && JSON.stringify(fp).includes(q.q), `restored question visible and marked up: ${q.q}`);
ok(fh.includes('We do not claim any approval, licence or certification.'), 'approval disclaimer visible on home');
const all = Object.values(pages).map((h) => JSON.stringify(ld(h))).join(' '); ok(!/"(Offer|Product|Review|AggregateRating|Rating)"/.test(all) && !/"(price|availability)"/.test(all), 'no Offer/Product/Review/Rating/price/availability markup on any page');
const faqPages = Object.entries(pages).filter(([, h]) => ld(h).some((n) => n['@type'] === 'FAQPage')).map(([p]) => p); ok(faqPages.join() === '/', `FAQPage only on: ${faqPages.join()}`);
console.log(out.join('\n') + `\n\nTOTAL ${out.length} checks, ${bad} failed`); process.exit(bad ? 1 : 0);
