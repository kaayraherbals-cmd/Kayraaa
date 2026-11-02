/**
 * Whole-site translation: rules shared by the browser (what to send) and the server (what to accept and how to check the answer).
 *
 * Interface text that has its own reviewed wording lives in src/i18n/dict. Everything else on the public site (page text, product and
 * ingredient names and descriptions, journal, legal pages, form labels, buttons, placeholders, image descriptions) is translated at
 * run time by the same AI the site already uses, in the language the visitor chose. The English page is never changed: search engines,
 * structured data and the canonical URLs still see English.
 */

/** Names that must stay exactly as written (brand, payment and shipping partners, tax terms). */
export const KEEP_AS_WRITTEN = ['Kaayra Herbals Private Limited', 'Kaayra Herbals', 'Kaayra AI', 'Kaayra', 'Razorpay', 'Shiprocket', 'Resend', 'GSTIN', 'AYUSH', 'FSSAI'] as const;

export const TRANSLATE_LIMITS = {
  /** Strings per request. */
  maxItems: 40,
  /** One string. Longer text (articles) is sent paragraph by paragraph by the browser, so this is never hit in practice. */
  maxChars: 700,
  /** All strings in one request. */
  maxTotalChars: 7000,
  /** Request body, in bytes (checked before parsing). */
  maxBodyBytes: 40_000,
} as const;

const URL_SRC = String.raw`(?:https?:\/\/|www\.)\S+`;
const EMAIL_SRC = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`;
// Prices, quantities, PIN codes, order numbers, dates and every other run of digits: never translated, never re-typed by the model.
const NUMBER_SRC = String.raw`(?:₹|Rs\.?|INR)\s?\d[\d,]*(?:\.\d+)?|\d[\d,./:-]*\d|\d`;
const KEEP_SRC = String.raw`\b(?:${[...KEEP_AS_WRITTEN].sort((x, y) => y.length - x.length).join('|')})\b`;
// One pass over the text, so a marker that was just written (it contains a digit) is never matched again.
const PROTECT_RE = new RegExp([URL_SRC, EMAIL_SRC, KEEP_SRC, NUMBER_SRC].join('|'), 'g');

const OPEN = '⟦';
const CLOSE = '⟧';
const TOKEN_RE = /⟦(\d+)⟧/g;

export interface Masked { text: string; tokens: string[] }

/** Replaces everything that must survive untouched with numbered markers: "Pay ₹450 to Kaayra" becomes "Pay ⟦0⟧ to ⟦1⟧". */
export function mask(source: string): Masked {
  const tokens: string[] = [];
  const keep = (m: string): string => { tokens.push(m); return `${OPEN}${tokens.length - 1}${CLOSE}`; };
  const text = source.replace(PROTECT_RE, keep);
  return { text, tokens };
}

/** Puts the original pieces back. Returns null when the model dropped, repeated, invented or reordered-away a marker. */
export function unmask(translated: string, tokens: readonly string[]): string | null {
  const seen: number[] = [];
  let bad = false;
  const out = translated.replace(TOKEN_RE, (_m, n: string) => {
    const i = Number(n);
    if (!Number.isInteger(i) || i < 0 || i >= tokens.length) { bad = true; return ''; }
    seen.push(i);
    return tokens[i] as string;
  });
  if (bad || seen.length !== tokens.length || new Set(seen).size !== tokens.length) return null;
  // A stray marker character without a number is also a failure.
  if (out.includes(OPEN) || out.includes(CLOSE)) return null;
  return out;
}

const hasLatinLetter = (s: string): boolean => /\p{Script=Latin}/u.test(s);
/** Letters of any other script mean the text is already in a language the visitor reads (dictionary text, a Hindi review, the AI's reply). */
const hasOtherScript = (s: string): boolean => /[\p{L}]/u.test(s.replace(/\p{Script=Latin}/gu, '').replace(/[^\p{L}]/gu, ''));

/** Is this piece of page text worth translating? Needs real English words, not numbers, codes, addresses or already translated text. */
export function translatable(text: string): boolean {
  const s = text.trim();
  if (s.length < 2 || s.length > TRANSLATE_LIMITS.maxChars) return false;
  if (!hasLatinLetter(s) || hasOtherScript(s)) return false;
  const m = mask(s).text.replace(/⟦\d+⟧/g, ' ').replace(/[^\p{L}]/gu, '');
  // Only the brand name, a price or an email is left: nothing to translate.
  return m.length >= 2;
}

/** Splits leading and trailing white space off so a translated node keeps its spacing. */
export function splitSpace(s: string): { lead: string; core: string; trail: string } {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return { lead: m?.[1] ?? '', core: (m?.[2] ?? s).replace(/\s+/g, ' '), trail: m?.[3] ?? '' };
}

export interface BatchCheck { ok: true; items: string[] }
export interface BatchError { ok: false; message: string }

/** Validates a request body from the browser: language, and a bounded list of plain strings. */
export function parseBatch(body: unknown, isLang: (v: unknown) => boolean): (BatchCheck & { lang: string }) | BatchError {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'Invalid request.' };
  const b = body as { lang?: unknown; items?: unknown };
  if (!isLang(b.lang) || b.lang === 'en') return { ok: false, message: 'Choose a language.' };
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > TRANSLATE_LIMITS.maxItems) return { ok: false, message: 'Invalid request.' };
  let total = 0;
  const items: string[] = [];
  for (const it of b.items) {
    if (typeof it !== 'string') return { ok: false, message: 'Invalid request.' };
    const s = it.replace(/\s+/g, ' ').trim();
    if (!translatable(s)) return { ok: false, message: 'Invalid request.' };
    total += s.length;
    items.push(s);
  }
  if (total > TRANSLATE_LIMITS.maxTotalChars) return { ok: false, message: 'Invalid request.' };
  return { ok: true, lang: b.lang as string, items };
}

/** A sentence with formatting or links inside is sent whole: "Read our ⟨a⟩quality promise⟨/a⟩ today". Letters, never digits, so masking leaves them alone. */
export type RunPart = { tag: null; text: string } | { tag: number; text: string };
export const RUN_TAG_RE = /⟨(\/?)([a-z])⟩/g;
export const runTag = (i: number, inner: string): string => `⟨${String.fromCharCode(97 + i)}⟩${inner}⟨/${String.fromCharCode(97 + i)}⟩`;

/** Reads a translated sentence back into plain pieces and tagged pieces. Null unless every tag 0..count-1 is present exactly once, opened then closed, not nested. */
export function parseRun(tr: string, count: number): RunPart[] | null {
  const parts: RunPart[] = [];
  const seen = new Set<number>();
  let open = -1;
  let last = 0;
  for (const m of tr.matchAll(RUN_TAG_RE)) {
    const between = tr.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    const idx = (m[2] as string).charCodeAt(0) - 97;
    if (idx < 0 || idx >= count) return null;
    if (m[1] === '') {
      if (open !== -1 || seen.has(idx)) return null;
      if (between) parts.push({ tag: null, text: between });
      open = idx;
    } else {
      if (open !== idx) return null;
      parts.push({ tag: idx, text: between });
      seen.add(idx); open = -1;
    }
  }
  if (open !== -1) return null;
  const rest = tr.slice(last);
  if (rest) parts.push({ tag: null, text: rest });
  if (seen.size !== count) return null;
  if (parts.some((p) => p.tag === null && /[⟨⟩]/.test(p.text))) return null;
  return parts;
}
