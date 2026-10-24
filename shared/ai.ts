import { claimProblems } from './products.js';

/**
 * Pure helpers for the Gemini features (Kaayra AI and Kaayra Intelligence): model checks, input cleaning, injection and
 * medical-intent detection, reply checks and the "no invented numbers" check. No network, no environment, so all of it is unit tested.
 */

/** Default model: the cheapest current-generation stable Gemini text model with structured output and a free tier. Override with GEMINI_MODEL. */
export const AI_DEFAULT_MODEL = 'gemini-3.1-flash-lite';

/** Model families Google has retired or scheduled for shutdown (see ai.google.dev deprecations). Refused so a stale GEMINI_MODEL fails loudly. */
const RETIRED_MODEL_RE = /^(models\/)?gemini-(1\.|2\.0|2\.5)/i;

export function modelProblem(model: string): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(model.replace(/^models\//, ''))) return 'GEMINI_MODEL is not a valid model name';
  if (RETIRED_MODEL_RE.test(model)) return `${model} belongs to a Gemini family that has been shut down or is scheduled for shutdown; choose a current model (for example ${AI_DEFAULT_MODEL})`;
  return null;
}

// ---- input -----------------------------------------------------------------------------------------------

export const CHAT_LIMITS = { message: 500, history: 6, historyText: 600 } as const;

/** Removes control characters and zero-width/bidi tricks, collapses whitespace, caps the length. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex -- intentional: strips control characters from user text
  const stripped = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  return stripped.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

export interface ChatTurn { role: 'user' | 'assistant'; text: string }
export type ChatInput = { ok: true; message: string; history: ChatTurn[] } | { ok: false; message: string };

export function parseChatInput(body: unknown): ChatInput {
  const b = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const message = cleanText(b.message, CHAT_LIMITS.message);
  if (!message) return { ok: false, message: 'Type a question first.' };
  const history: ChatTurn[] = [];
  if (Array.isArray(b.history)) {
    for (const t of b.history.slice(-CHAT_LIMITS.history)) {
      const o = typeof t === 'object' && t !== null ? (t as Record<string, unknown>) : {};
      const text = cleanText(o.text, CHAT_LIMITS.historyText);
      if ((o.role === 'user' || o.role === 'assistant') && text) history.push({ role: o.role, text });
    }
  }
  return { ok: true, message, history };
}

/** Obvious attempts to override the assistant's rules or extract its instructions. Answered without calling the model. */
const INJECTION_RES: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier|your) (instructions?|rules?|prompts?)/i,
  /disregard (all |any |the )?(previous|prior|above|your) (instructions?|rules?)/i,
  /(reveal|show|print|repeat|tell me|output) (me )?(your|the) (system |hidden |initial )?(prompt|instructions?|rules)/i,
  /you are now (a|an|in)\b/i,
  /\b(developer|debug|admin|god) mode\b/i,
  /\bjailbreak\b/i,
  /act as (if you (are|were)|an? (unrestricted|unfiltered))/i,
  /(api[\s_-]?key|service[\s_-]?role|secret key|password) (of|for|is|from)/i,
  /\b(drop|delete|truncate) table\b/i,
];
export const injectionSignal = (text: string): boolean => INJECTION_RES.some((r) => r.test(text));

/** Messages about symptoms, medicines or dosage. The assistant answers these with the safety note and never with advice. */
const MEDICAL_INTENT_RE = /\b(diagnos\w*|prescri\w*|dosage|dose|doses|overdose|medication|medicine for|symptoms?|pregnan\w*|breastfeed\w*|nursing|diabet\w*|blood pressure|cancer|thyroid|liver (disease|damage)|kidney|chronic|infection|cure|treat(ment)?|side effects?|allerg\w*|children|infant|baby)\b/i;
export const medicalIntent = (text: string): boolean => MEDICAL_INTENT_RE.test(text);

export const SAFETY_NOTE = 'I am a shopping assistant, not a medical professional. For any health concern, medicine, pregnancy or dosage question, please speak to a qualified healthcare professional.';

// ---- model output ------------------------------------------------------------------------------------------

/** Parses a model's JSON reply (tolerating a code fence). Returns null when it is not a JSON object. */
export function parseModelJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v: unknown = JSON.parse(t);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const DOSING_RE = /\b(diagnos(e|ed|is)|prescri(be|bed|ption)|dosage|take \d+|\d+\s?(mg|mcg)\b|\d+\s?(tablets?|capsules?|pills?|drops?)\s+(a|per|every|daily|twice)|stop taking|instead of (your )?(medicine|medication)|replace (your )?(medicine|medication))/i;
const MONEY_RE = /(?:₹|rs\.?|inr)\s?(\d[\d,]*(?:\.\d+)?)/gi;
/** Same value, same text: "249.50", "249.5" and "1,249.5" compare by number so formatting never hides or invents a mismatch. */
const normNumber = (s: string): string => { const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) ? String(n) : s; };

/**
 * Problems with a customer-facing reply: an unsupported health or certification claim, dosing or diagnosis, or a price that is not
 * one of the real prices given to the model. An empty list means the reply may be shown.
 */
export function replyProblems(reply: string, realPricesPaise: readonly number[]): string[] {
  const out = [...claimProblems(reply)];
  if (DOSING_RE.test(reply)) out.push('it gives dosage, diagnosis or treatment advice');
  const allowed = new Set(realPricesPaise.map((p) => normNumber(String(p / 100))));
  for (const m of reply.matchAll(MONEY_RE)) if (!allowed.has(normNumber(m[1]))) out.push('it states a price that is not a real price');
  return out;
}

// ---- no invented numbers ---------------------------------------------------------------------------------------

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

/**
 * Numbers in `answer` that do not appear anywhere in `source` (the verified figures given to the model). List markers ("1.") at the
 * start of a line are ignored. A non-empty result means the model wrote a figure the server did not give it.
 */
export function unsupportedNumbers(answer: string, source: string): string[] {
  const known = new Set((source.match(NUM_RE) ?? []).map(normNumber));
  const body = answer.replace(/^\s*\d{1,2}[.)]\s/gm, '');
  const bad = new Set<string>();
  for (const m of body.match(NUM_RE) ?? []) {
    const n = normNumber(m);
    if (!known.has(n)) bad.add(m);
  }
  return [...bad];
}

// ---- content studio kinds (shared with the admin page) ------------------------------------------------------
export const CONTENT_KINDS = ['product_description', 'product_summary', 'seo_title', 'meta_description', 'product_faq', 'journal_article', 'social_caption', 'promo_email', 'campaign_ideas'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const CONTENT_LABELS: Record<ContentKind, string> = {
  product_description: 'Product description', product_summary: 'Product summary', seo_title: 'SEO title suggestions', meta_description: 'Meta description', product_faq: 'Product FAQ draft',
  journal_article: 'Journal article draft', social_caption: 'Social media captions', promo_email: 'Promotional email draft', campaign_ideas: 'Marketing campaign ideas',
};
