// Builds server/ai/siteContent.generated.ts: the readable text of the public website pages, so Kaayra AI can answer questions about the site
// itself (our story, approach, quality, ingredients library, journal, contact, policies) from the site's own words and nothing else.
// Run after changing page copy:  node scripts/build-site-knowledge.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { importTs } from './lib/import-ts.mjs';

const PAGES = [
  ['Our story', '/our-story', ['src/pages/Story.tsx']],
  // Founder qualifications stay on the Founders page only; they are not copied into AI-readable files (roles are added to the company facts below).
  ['Founders', '/founders', ['src/pages/Founders.tsx']],
  ['Our approach', '/our-approach', ['src/pages/Approach.tsx']],
  ['Ingredients library (botanical names, plant parts, identity notes)', '/ingredients', ['src/pages/Ingredients.tsx', 'src/content/ingredients.ts']],
  ['Quality and transparency', '/quality-and-transparency', ['src/pages/Quality.tsx']],
  ['Product development', '/product-development', ['src/pages/ProductDevelopment.tsx']],
  ['Medical disclaimer', '/medical-disclaimer', ['src/pages/MedicalDisclaimer.tsx']],
  ['Contact', '/contact', ['src/pages/Contact.tsx', 'src/content/brand.ts']],
  ['Launch list and subscription', '/subscription', ['src/pages/Subscription.tsx']],
  ['Journal articles', '/journal', ['src/pages/Journal.tsx', 'src/content/journal.ts']],
  ['Privacy', '/privacy', ['src/pages/Privacy.tsx']],
  ['Legal', '/legal', ['src/pages/Legal.tsx']],
  ['Home page', '/', ['src/pages/Home.tsx']],
  ['Shop and collection page', '/collection', ['src/pages/Collection.tsx']],
  ['Track an order', '/track-order', ['src/pages/TrackOrder.tsx']],
  ['Report a problem with an order or product', '/report-a-problem', ['src/pages/ReportProblem.tsx']],
];

const clean = (t) => t.replace(/\\(['"`])/g, '$1').replace(/\s+/g, ' ').trim();
const looksLikeText = (t) => /[A-Za-z]{3}/.test(t) && !/&&|\|\||\.data\b|pageSize/.test(t) && !/[{}<>=;]|=>|\bclassName\b|^\s*(import|export|const|return)\b/.test(t);

function extract(src) {
  const code = src.replace(/^\s*import .*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = [];
  for (const m of code.matchAll(/>([^<>{}]+)</g)) found.push([m.index, clean(m[1])]);
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])+)\1/g)) {
    const t = clean(m[2]);
    // Sentences and labels: a space, a capital or digit first (class names and routes are lower case or start with "/"), not a link.
    if (t.length >= 12 && /\s/.test(t) && /^[A-Z0-9₹“‘]/.test(t) && !/^https?:/.test(t)) found.push([m.index, t]);
  }
  // Plain words in "title: 'x'" or "note: 'x'" fields are caught above; short names (for example ingredient names) are caught below.
  for (const m of code.matchAll(/\b(?:name|commonName|botanical|family|part|title|label)\s*:\s*(['"])([^'"\n]{2,80})\1/g)) found.push([m.index, clean(m[2])]);
  found.sort((a, b) => a[0] - b[0]);
  const seen = new Set();
  const out = [];
  for (const [, t] of found) {
    if (!looksLikeText(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const UI_PAGES = new Set(['/track-order', '/report-a-problem', '/collection', '/subscription']);
/** On interface pages, a bare label such as "Loading…" or "Orders" says nothing; sentences and real headings stay. */
const keepLine = (path, t) => !UI_PAGES.has(path) || t.split(/\s+/).length >= 4 || /[.?!:]$/.test(t) && t.split(/\s+/).length >= 2;

const pages = PAGES.map(([title, path, files]) => ({ id: path === '/' ? 'home' : path.slice(1), title, path, text: files.flatMap((f) => extract(readFileSync(f, 'utf8'))).filter((t) => keepLine(path, t)).join('\n') }))
  .filter((p) => p.text.length > 40);

// Frequently asked questions, kept as question-and-answer pairs (the same file the FAQ section shows).
const faq = JSON.parse(readFileSync('shared/faq.json', 'utf8'));
pages.unshift({ id: 'faq', title: 'Frequently asked questions about Kaayra Herbals', path: '/', text: faq.map((f) => `Q: ${f.q} A: ${f.a}`).join('\n') });

// Company details exactly as the site footer and Our story page publish them (src/config/site.ts).
const siteSrc = readFileSync('src/config/site.ts', 'utf8');
const field = (k) => siteSrc.match(new RegExp(`${k}:\\s*'([^']+)'`))?.[1];
const tagline = siteSrc.match(/tagline:\s*'([^']+)'/)?.[1];
const founderList = JSON.parse(readFileSync('shared/founders.json', 'utf8'));
const facts = [
  field('displayName') && `The company is ${field('displayName')} (${field('type')}).`,
  field('incorporatedDisplay') && `It was incorporated on ${field('incorporatedDisplay')}.`,
  field('cin') && `Corporate Identity Number: ${field('cin')}.`,
  field('gstin') && `GSTIN (GST Identification Number): ${field('gstin')}.`,
  field('registeredLocation') && `Registered location: ${field('registeredLocation')}.`,
  tagline && `Tagline: ${tagline}`,
  founderList.length > 0 && `Founders: ${founderList.map((f) => `${f.name} (${f.role})`).join(', ')}. Their profiles are on the founders page.`,
  'Journal articles are published by Kaayra Herbals as an organisation; no individual author or medical reviewer is named.',
  'Instagram: @kaayra.herbals.',
  'The incorporation certificate confirms the company exists. It is not a manufacturing licence or a product approval.',
].filter(Boolean);
pages.unshift({ id: 'company', title: 'Company details', path: '/our-story', text: facts.join('\n') });

// The ingredient library is written as one clear line per plant, straight from the data the Ingredients page shows.
const { ingredients } = await importTs('src/content/ingredients.ts');
const lib = pages.find((p) => p.id === 'ingredients');
if (lib) {
  const intro = lib.text.split('\n').slice(0, 3).join('\n');
  lib.text = `${intro}\n${ingredients.map((i) => `${i.name} (${i.commonName}): ${i.botanical}, family ${i.family}, plant part: ${i.part}. ${i.note}`).join('\n')}`;
}

const header = `// GENERATED by scripts/build-site-knowledge.mjs from the website's own page text. Do not edit by hand: change the page, then run the script again.\n`;
const body = `export interface SitePage { id: string; title: string; path: string; text: string }\nexport const SITE_PAGES: readonly SitePage[] = ${JSON.stringify(pages, null, 2)};\n`;
writeFileSync('server/ai/siteContent.generated.ts', header + body);
console.log(pages.map((p) => `${p.id}: ${p.text.length} chars`).join('\n'));
