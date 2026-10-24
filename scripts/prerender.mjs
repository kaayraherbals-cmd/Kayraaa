// Static prerender: renders every route to HTML so crawlers and slow devices get real content,
// then writes sitemap.xml, robots.txt and a real 404.html. Runs after the client + SSR builds.
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { checkSiteUrl } from './site-url-check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const serverDir = join(root, 'dist-server');

const env = { ...loadEnv('production', root, 'VITE_'), ...process.env };
const check = checkSiteUrl(env);
if (!check.ok) {
  console.error(`[prerender] ${check.problem} Set VITE_SITE_URL to the real production domain (https, no path) in Vercel > Settings > Environment Variables and redeploy.`);
  process.exit(1);
}
if (check.problem) console.warn(`[prerender] ${check.problem}`);
const siteUrl = check.url;

const founders = JSON.parse(await readFile(join(root, 'shared/founders.json'), 'utf8'));
const routes = JSON.parse(await readFile(join(root, 'shared/routes.json'), 'utf8'));
const privateRoutes = JSON.parse(await readFile(join(root, 'shared/private-routes.json'), 'utf8'));
let template = await readFile(join(dist, 'index.html'), 'utf8');
const faq = JSON.parse(await readFile(join(root, 'shared/faq.json'), 'utf8'));

// boot.js is tiny and must run before first paint, so it is inlined (no render-blocking request). The CSP in vercel.json
// allows exactly this script by its SHA-256 hash; the build stops if the two ever differ.
{
  const boot = (await readFile(join(root, 'public/boot.js'), 'utf8')).trim();
  const hash = 'sha256-' + createHash('sha256').update(boot).digest('base64');
  const vercel = await readFile(join(root, 'vercel.json'), 'utf8');
  if (!vercel.includes(`'${hash}'`)) {
    console.error(`[prerender] public/boot.js changed. Put '${hash}' in script-src of the two Content-Security-Policy values in vercel.json.`);
    process.exit(1);
  }
  template = template.replace('<script src="/boot.js"></script>', `<script>${boot}</script>`);
}

// Preload the two latin font files used above the fold so the headline and body text do not wait for the stylesheet to reveal them.
const assetFiles = await readdir(join(dist, 'assets'));
const preloads = [/^fraunces-latin-wght-normal-.*\.woff2$/, /^instrument-sans-latin-wght-normal-.*\.woff2$/]
  .map((re) => assetFiles.find((f) => re.test(f)))
  .filter(Boolean)
  .map((f) => `    <link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin />\n`)
  .join('');
if (preloads) template = template.replace('<script type="module"', `${preloads}    <script type="module"`);

// Optional cookie-less Vercel Web Analytics. Off unless VITE_VERCEL_ANALYTICS=true (enable Web Analytics in the Vercel project first).
if (env.VITE_VERCEL_ANALYTICS === 'true') template = template.replace('</head>', '    <script defer src="/_vercel/insights/script.js"></script>\n  </head>');

const otherProfiles = ['VITE_FACEBOOK_URL', 'VITE_X_URL', 'VITE_LINKEDIN_URL', 'VITE_YOUTUBE_URL']
  .map((k) => (env[k] || '').trim())
  .filter((u) => /^https:\/\//.test(u));
const { render } = await import(pathToFileURL(join(serverDir, 'entry-server.js')).href);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Name, job title, portrait and the founder's own Instagram page only. No contact detail is put in structured data.
function personNode(f) {
  return {
    '@type': 'Person',
    name: f.name,
    jobTitle: f.role,
    ...(f.photo ? { image: siteUrl + f.photo.src } : {}),
    ...(f.instagram ? { sameAs: [`https://www.instagram.com/${f.instagram}/`] } : {}),
  };
}

function breadcrumb(route, url) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl + '/' },
      { '@type': 'ListItem', position: 2, name: route.title.split(' | ')[0], item: url },
    ],
  };
}

function page(route, html, { noindex = false } = {}) {
  const url = siteUrl + (route.path === '/' ? '/' : route.path);
  let out = template
    .replace('<!--app-html-->', html)
    .replace(/<title>.*?<\/title>/s, `<title>${esc(route.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(route.description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(route.title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(route.description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${siteUrl}/og-image.png$2`);
  if (!noindex) {
    out = out.replace(/(<link rel="canonical"[^>]*>)/, `$1\n    <link rel="alternate" hreflang="en-IN" href="${url}" />\n    <link rel="alternate" hreflang="x-default" href="${url}" />`);
    const orgId = `${siteUrl}/#organization`;
    const siteId = `${siteUrl}/#website`;
    // Every value below is already published on the site (src/config/site.ts) or is the site's own address.
    // No logo, rating, review, price, address line or contact detail is claimed here.
    const organization = {
      '@type': 'Organization',
      '@id': orgId,
      name: 'Kaayra Herbals',
      legalName: 'Kaayra Herbals Private Limited',
      url: siteUrl + '/',
      slogan: 'Ancient Wisdom. Modern Thinking. Better Living.',
      description: 'Kaayra Herbals is a new Ayurvedic wellness company in Varanasi, India. Its first formulations are in development.',
      foundingDate: '2026-10-16',
      foundingLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Varanasi', addressRegion: 'Uttar Pradesh', addressCountry: 'IN' } },
      sameAs: ['https://www.instagram.com/kaayra.herbals/', ...otherProfiles],
      founder: founders.map((f) => personNode(f)),
    };
    const website = {
      '@type': 'WebSite',
      '@id': siteId,
      name: 'Kaayra Herbals',
      alternateName: 'Kaayra',
      url: siteUrl + '/',
      inLanguage: 'en-IN',
      publisher: { '@id': orgId },
    };
    const graph =
      route.path === '/'
        ? {
            '@context': 'https://schema.org',
            '@graph': [
              website,
              organization,
              {
                '@type': 'FAQPage',
                '@id': `${siteUrl}/#faq`,
                inLanguage: 'en-IN',
                mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
              },
            ],
          }
        : route.type === 'article'
          ? {
              '@context': 'https://schema.org',
              '@type': 'Article',
              headline: route.title.split(' | ')[0],
              description: route.description,
              datePublished: route.date,
              inLanguage: 'en-IN',
              mainEntityOfPage: url,
              author: { '@type': 'Organization', name: 'Kaayra Herbals', url: siteUrl + '/' },
              publisher: { '@type': 'Organization', name: 'Kaayra Herbals', url: siteUrl + '/' },
            }
          : route.path === '/founders'
            ? {
                '@context': 'https://schema.org',
                '@graph': [
                  { '@type': 'AboutPage', name: route.title.split(' | ')[0], url, inLanguage: 'en-IN', isPartOf: { '@id': siteId }, about: { '@id': orgId } },
                  { '@type': 'Organization', '@id': orgId, name: 'Kaayra Herbals', url: siteUrl + '/', founder: founders.map((f) => ({ ...personNode(f), worksFor: { '@id': orgId } })) },
                  breadcrumb(route, url),
                ],
              }
            : route.path !== '/' && !route.type
              ? { '@context': 'https://schema.org', ...breadcrumb(route, url) }
              : null;
    if (graph) out = out.replace('</head>', `    <script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>\n  </head>`);
  }
  if (noindex) out = out.replace('</head>', '    <meta name="robots" content="noindex" />\n  </head>').replace(/<link rel="canonical"[^>]*>\s*/, '');
  return out;
}

for (const route of routes) {
  const file = route.path === '/' ? join(dist, 'index.html') : join(dist, route.path.slice(1), 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, page(route, render(route.path)));
}

await writeFile(
  join(dist, '404.html'),
  page({ path: '/404', title: 'Page not found | Kaayra Herbals', description: 'This page does not exist.' }, render('/404'), { noindex: true }),
);

// Admin shell: empty root (client-rendered only), never indexed, not in the sitemap.
{
  const shell = template
    .replace('<!--app-html-->', '')
    .replace(/<title>.*?<\/title>/s, '<title>Admin | Kaayra Herbals</title>')
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace(/<link rel="canonical"[^>]*>\s*/, '')
    .replace(/<meta property="og:[^>]*>\s*/g, '')
    .replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>');
  await mkdir(join(dist, 'admin'), { recursive: true });
  await writeFile(join(dist, 'admin', 'index.html'), shell);
}

// Product pages (/collection/:slug) are rendered in the browser from the approved-products API. vercel.json rewrites
// them to this empty shell. Robots default to noindex; the page switches to index only once a real product loads.
{
  const shell = template
    .replace('<!--app-html-->', '')
    .replace(/<title>.*?<\/title>/s, '<title>Products | Kaayra Herbals</title>')
    .replace(/<link rel="canonical"[^>]*>\s*/, '')
    .replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>');
  await mkdir(join(dist, 'product-shell'), { recursive: true });
  await writeFile(join(dist, 'product-shell', 'index.html'), shell);
}

// Sign-in and account pages: client-rendered shells, never indexed, not in the sitemap.
for (const r of privateRoutes) {
  const shell = template
    .replace('<!--app-html-->', '')
    .replace(/<title>.*?<\/title>/s, `<title>${esc(r.title)}</title>`)
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace(/<link rel="canonical"[^>]*>\s*/, '')
    .replace(/<meta property="og:[^>]*>\s*/g, '')
    .replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>');
  await mkdir(join(dist, r.path.slice(1)), { recursive: true });
  await writeFile(join(dist, r.path.slice(1), 'index.html'), shell);
}

// <lastmod> is only written where the route carries a real date (articles). A build-day date on every URL would be
// inaccurate, and Google ignores lastmod values that prove unreliable.
const urls = routes
  .map((r) => `  <url><loc>${siteUrl}${r.path === '/' ? '/' : r.path}</loc>${r.date ? `<lastmod>${r.date}</lastmod>` : ''}</url>`)
  .join('\n');
await writeFile(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);

const robots = (await readFile(join(dist, 'robots.txt'), 'utf8')).replace('__SITE_URL__', siteUrl);
await writeFile(join(dist, 'robots.txt'), robots);
const llms = (await readFile(join(dist, 'llms.txt'), 'utf8')).replaceAll('__SITE_URL__', siteUrl);
await writeFile(join(dist, 'llms.txt'), llms);
const llmsFull = (await readFile(join(root, 'public/llms-full.txt'), 'utf8')).replaceAll('__SITE_URL__', siteUrl);
await writeFile(join(dist, 'llms-full.txt'), llmsFull);

await rm(serverDir, { recursive: true, force: true });
console.log(`[prerender] ${routes.length} routes + 404 + admin and sign-in shells, sitemap and robots written for ${siteUrl}`);
