// Static prerender: renders every route to HTML so crawlers and slow devices get real content,
// then writes sitemap.xml, robots.txt and a real 404.html. Runs after the client + SSR builds.
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { checkSiteUrl } from './site-url-check.mjs';
import { readBrandFacts } from './brand-facts.mjs';
import { graphFor } from './structured-data.mjs';
import { importTs } from './lib/import-ts.mjs';

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
// Brand facts come from src/config/site.ts (the authoritative configuration); structured data is built in scripts/structured-data.mjs.
const brand = readBrandFacts(join(root, 'src/config/site.ts'), env);

const founders = JSON.parse(await readFile(join(root, 'shared/founders.json'), 'utf8'));
const routes = JSON.parse(await readFile(join(root, 'shared/routes.json'), 'utf8'));
const privateRoutes = JSON.parse(await readFile(join(root, 'shared/private-routes.json'), 'utf8'));
let template = await readFile(join(dist, 'index.html'), 'utf8');
const faq = JSON.parse(await readFile(join(root, 'shared/faq.json'), 'utf8'));
// Verified author / reviewer / sources for each article come from the article's own data (src/content/journal.ts, import-free so it loads here).
// A review is only used when the article is marked practitionerReviewed, so a stray reviewer field can never produce review markup alone.
const { articles } = await importTs(join(root, 'src/content/journal.ts'));
const articleMetaFor = (route) => {
  const a = articles.find((x) => `/journal/${x.slug}` === route.path);
  return a ? { author: a.author, review: a.practitionerReviewed ? a.review : undefined, updated: a.updated, sources: a.sources } : {};
};

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
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${siteUrl}/og-image.png$2`)
    // Twitter/X tags carry the same route-specific text and the one verified share image (public/og-image.png, 1200x630).
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(route.title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(route.description)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${siteUrl}/og-image.png$2`);
  if (route.type === 'article') {
    out = out.replace('<meta property="og:type" content="website" />', '<meta property="og:type" content="article" />');
    if (route.date) out = out.replace('<meta property="og:type" content="article" />', `<meta property="og:type" content="article" />\n    <meta property="article:published_time" content="${route.date}" />`);
  }
  if (!noindex) {
    out = out.replace(/(<link rel="canonical"[^>]*>)/, `$1\n    <link rel="alternate" hreflang="en-IN" href="${url}" />\n    <link rel="alternate" hreflang="x-default" href="${url}" />`);
    // Every value in the graph is already published on the site (src/config/site.ts, shared/founders.json) or is the site's own address.
    // See scripts/structured-data.mjs for what is deliberately never emitted.
    const graph = graphFor({ route, url, html, siteUrl, brand, founders, faq, otherProfiles, articleMeta: articleMetaFor(route) });
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
    .replace(/<meta (?:property="og:|name="twitter:)[^>]*>\s*/g, '')
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
    .replace(/<meta (?:property="og:|name="twitter:)[^>]*>\s*/g, '')
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
