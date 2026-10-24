import { SITE_PAGES } from './siteContent.generated.js';

/**
 * The website's own text (generated from the page files, see scripts/build-site-knowledge.mjs), so the assistant can answer questions about
 * Kaayra Herbals from the site's real words. Each page is cut into small sections; only the sections that best match the question are sent,
 * so the answer is precise and the prompt stays small.
 */
export interface PageContext { page: string; path: string; text: string }

const CHUNK_MAX = 700;
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'which', 'tell', 'about', 'any', 'you', 'your', 'have', 'has', 'are', 'can', 'could', 'would', 'please', 'want', 'need', 'does', 'how', 'who', 'where', 'when', 'why', 'there', 'their', 'them', 'they', 'its', 'our', 'kaayra', 'herbals', 'herbal', 'company', 'kindly', 'also', 'more', 'know', 'give', 'show', 'explain', 'details', 'information', 'info', 'said', 'been', 'will', 'into', 'than', 'then', 'just', 'like', 'accept', 'method', 'methods', 'way', 'ways', 'using', 'take', 'takes', 'long', 'much', 'many', 'get', 'got', 'receive', 'received', 'forgot', 'join', 'create', 'make', 'doing', 'ask', 'asked', 'happen', 'happens', 'happened']);

/** Light stemming so "delivered", "delivery" and "deliveries" meet. */
const stem = (w: string): string => {
  let t = w;
  if (t.length > 5 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('es')) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t;
};
const tokens = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)).map(stem);

/** What customers say, mapped to the words the site uses (each group: any of these words also means all of them). */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['deliver', 'delivery', 'ship', 'shipping', 'courier', 'dispatch', 'pincode', 'pin', 'postal', 'cod'],
  ['refund', 'return', 'exchange', 'cancel', 'money', 'damaged', 'wrong', 'problem', 'complaint'],
  ['pay', 'payment', 'upi', 'card', 'cash', 'razorpay', 'netbanking', 'wallet'],
  ['contact', 'email', 'phone', 'call', 'reach', 'address', 'whatsapp', 'number', 'message', 'support', 'helpline'],
  ['founder', 'founded', 'found', 'started', 'created', 'behind', 'cofounder', 'owner', 'ceo', 'team', 'director', 'qualification', 'qualified'],
  ['certified', 'certificate', 'certification', 'licence', 'license', 'approved', 'approval', 'fssai', 'ayush', 'gmp', 'iso', 'authentic', 'genuine', 'registered', 'legal'],
  ['safe', 'safety', 'side', 'pregnant', 'pregnancy', 'doctor', 'medical', 'medicine', 'cure', 'treat', 'treatment', 'disease', 'diabetes', 'advice', 'practitioner', 'disclaimer'],
  ['price', 'cost', 'rate', 'charge', 'fee', 'discount', 'coupon', 'offer'],
  ['launch', 'available', 'availability', 'buy', 'purchase', 'sell', 'sale', 'stock'],
  ['login', 'signin', 'signup', 'register', 'account', 'password', 'sign'],
  ['privacy', 'data', 'cookie', 'personal', 'consent', 'delete'],
  ['source', 'sourcing', 'farm', 'origin', 'quality', 'test', 'testing', 'lab', 'purity', 'adulteration', 'transparency', 'batch'],
  ['subscribe', 'subscription', 'newsletter', 'waitlist', 'notify', 'updates'],
  ['instagram', 'social', 'facebook', 'youtube', 'follow'],
  ['ingredient', 'herb', 'plant', 'botanical', 'formulation', 'formula', 'extract', 'made'],
  ['story', 'history', 'about', 'mission', 'vision', 'why', 'began', 'begin', 'beginning', 'founded', 'started', 'start', 'varanasi', 'kashi', 'incorporated', 'cin'],
  ['ayurveda', 'ayurvedic', 'tradition', 'traditional', 'classical', 'approach', 'philosophy', 'method', 'process'],
  ['journal', 'article', 'blog', 'read', 'guide'],
];
const GROUPS = SYNONYM_GROUPS.map((g) => new Set(g.map(stem)));

interface Chunk { page: string; path: string; text: string; set: Set<string>; titleSet: Set<string> }

/** Cut each page into sections of whole lines, never splitting a sentence. */
function chunksOf(): Chunk[] {
  const out: Chunk[] = [];
  for (const p of SITE_PAGES) {
    const titleSet = new Set(tokens(p.title));
    let buf = '';
    const flush = () => {
      if (buf.trim()) out.push({ page: p.title, path: p.path, text: buf.trim(), set: new Set(tokens(`${p.title} ${buf}`)), titleSet });
      buf = '';
    };
    for (const line of p.text.split('\n')) {
      if (buf && buf.length + line.length + 1 > CHUNK_MAX) flush();
      buf += `${line}\n`;
    }
    flush();
  }
  return out;
}
const CHUNKS = chunksOf();
const MIN_SCORE = 1.8;
const OVERVIEW = ['Company details', 'Frequently asked questions', 'Our story'].flatMap((t) => { const c = CHUNKS.find((x) => x.page.startsWith(t)); return c ? [c] : []; });

const DOC_FREQ = (() => {
  const df = new Map<string, number>();
  for (const c of CHUNKS) for (const t of c.set) df.set(t, (df.get(t) ?? 0) + 1);
  return df;
})();
const idf = (t: string): number => Math.log(1 + CHUNKS.length / (1 + (DOC_FREQ.get(t) ?? 0)));

/** The question's words (weight 1) and the site's words they usually mean (weight 0.45). */
export function expandedTerms(message: string): Map<string, number> {
  const terms = new Map<string, number>();
  for (const t of tokens(message)) terms.set(t, 1);
  for (const t of [...terms.keys()]) for (const g of GROUPS) if (g.has(t)) for (const x of g) if (!terms.has(x)) terms.set(x, 0.45);
  return terms;
}

export function pagesFor(message: string, limit = 4, maxChars = 3000): PageContext[] {
  const terms = expandedTerms(message);
  // A question with nothing to look for ("What is Kaayra Herbals?") gets the overview: company details, the first FAQ answers and the start of our story.
  if (terms.size === 0) return OVERVIEW.map((c) => ({ page: c.page, path: c.path, text: c.text }));
  const scored = CHUNKS.map((c, i) => {
    let score = 0;
    for (const [t, w] of terms) {
      if (c.set.has(t)) score += w * idf(t);
      if (c.titleSet.has(t)) score += w * 3;
    }
    return { c, score, i };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
  const best = scored[0]?.score ?? 0;
  // Nothing close enough: send nothing rather than unrelated text, so the assistant says honestly that the site does not cover it.
  if (best < MIN_SCORE) return [];
  const out: PageContext[] = [];
  let used = 0;
  for (const { c, score } of scored) {
    if (out.length >= limit || score < best * 0.35) break;
    if (used + c.text.length > maxChars) continue;
    used += c.text.length;
    out.push({ page: c.page, path: c.path, text: c.text });
  }
  return out;
}
