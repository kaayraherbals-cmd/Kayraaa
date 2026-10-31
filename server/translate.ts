import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isLangCode, languageOf } from '../shared/languages.js';
import { KEEP_AS_WRITTEN, TRANSLATE_LIMITS, mask, parseBatch, unmask } from '../shared/translate.js';
import { clientIp, createLimiter, limitDecision, originAllowed } from './http.js';
import { loadAiConfig, type AiConfig } from './ai/config.js';
import type { Transport } from './ai/gemini.js';
import { generateWithFallback } from './ai/providers.js';
import { recordTokens } from './ai/usage.js';
import { supabaseConfig } from './supabase.js';

/**
 * POST /api/products?action=translate  { lang, items: string[] }  ->  { status: 'ok', items: (string | null)[] }
 *
 * Translates page text for a visitor who chose a language. It uses the site's existing AI settings (same key, same switch: AI_ENABLED),
 * never receives anything about the visitor, only sees public page text the browser already shows, and keeps prices, numbers, e-mail
 * addresses, links and the brand name out of the model's hands (they are swapped for markers and put back afterwards). A null entry means
 * "not translated": the browser keeps the English text for that line.
 * Answers are remembered per server instance, so each line is translated once per language and then served instantly.
 */
const limited = createLimiter(60 * 1000, 120, 'translate', 'open');

const CACHE_MAX = 6000;
const cache = new Map<string, string>();
export const clearTranslateCache = (): void => cache.clear();
const put = (k: string, v: string): void => {
  if (cache.size >= CACHE_MAX) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
  cache.set(k, v);
};

/** Per-instance daily ceiling on model calls for translation, so a bug or abuse can never run up a bill. TRANSLATE_MAX_PER_DAY overrides. */
let dayKey = '';
let dayCalls = 0;
const dailyMax = (env: Record<string, string | undefined>): number => {
  const n = Number((env.TRANSLATE_MAX_PER_DAY ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.min(20000, Math.floor(n)) : 1500;
};
const underDailyCap = (now: number, env: Record<string, string | undefined>): boolean => {
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== dayKey) { dayKey = d; dayCalls = 0; }
  if (dayCalls >= dailyMax(env)) return false;
  dayCalls += 1;
  return true;
};

const SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' } }, required: ['id', 'text'] } } },
  required: ['items'],
} as const;

export function translationSystem(langName: string, native: string): string {
  return [
    `You are the translator for the website of Kaayra Herbals, an Indian Ayurvedic wellness brand. Translate each numbered English line into ${langName} (${native}), written in its own script, in natural, clear, everyday wording that a native reader of a shop and information website would expect.`,
    'Rules:',
    '1. Translate EVERY word. Do not leave English words behind, except the markers and the names listed below. Ingredient, plant and product names: use the name people actually use in that language (for example the common Ayurvedic or plant name), or a natural transliteration in the language script when there is no common name.',
    `2. Markers like ⟦0⟧ stand for prices, numbers, links, e-mail addresses and names that must not change. Copy every marker exactly once, in a sensible position for the language. Never translate, rewrite or add a marker. Never write digits yourself.`,
    `3. These names stay in Latin letters exactly as written (they appear as markers): ${KEEP_AS_WRITTEN.join(', ')}.`,
    '4. Be faithful. Never add, remove, strengthen or soften a claim, a benefit, a warning, a quantity or a legal or medical statement. Health, safety, privacy and legal sentences are translated as literally and completely as the language allows.',
    '5. Keep the length and tone similar: button and menu text stays short, headings stay headings. Keep punctuation style natural for the language. Keep a trailing or leading punctuation mark where the English has one.',
    '6. Tags such as ⟨a⟩words⟨/a⟩ mark words that carry a link or formatting. Keep every tag pair exactly once, opened before it is closed, around the translation of those same words; the order of the pieces in the sentence may change to suit the language. Never nest or add tags.',
    '7. Reply only with JSON: {"items":[{"id":<same id>,"text":"<translation>"}]} with one entry for every id you were given.',
  ].join('\n');
}

export interface TranslateOutcome { items: (string | null)[]; inputTokens: number; outputTokens: number; failed?: boolean }

/** Translates already-validated lines. Uses the cache first, asks the model only for what is missing. */
export async function translateLines(cfg: AiConfig, lang: string, lines: readonly string[], transport?: Transport): Promise<TranslateOutcome> {
  const out: (string | null)[] = lines.map(() => null);
  const need: { at: number; masked: ReturnType<typeof mask> }[] = [];
  lines.forEach((line, at) => {
    const hit = cache.get(`${lang}|${line}`);
    if (hit !== undefined) { out[at] = hit; return; }
    need.push({ at, masked: mask(line) });
  });
  if (need.length === 0) return { items: out, inputTokens: 0, outputTokens: 0 };

  const l = languageOf(lang);
  const user = JSON.stringify({ items: need.map((n, id) => ({ id, text: n.masked.text })) });
  const res = await generateWithFallback(
    cfg,
    { system: translationSystem(l.name, l.native), user, schema: SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: Math.min(8192, cfg.maxOutputTokens * 4), temperature: 0.2, thinkingLevel: 'MINIMAL', timeoutMs: Math.min(cfg.timeoutMs, 25_000) },
    transport,
  );
  if (!res.ok) return { items: out, inputTokens: res.inputTokens, outputTokens: res.outputTokens, failed: true };

  const list = Array.isArray((res.json as { items?: unknown }).items) ? ((res.json as { items: unknown[] }).items) : [];
  for (const raw of list) {
    const r = raw as { id?: unknown; text?: unknown };
    if (typeof r.id !== 'number' || typeof r.text !== 'string') continue;
    const n = need[r.id];
    if (!n) continue;
    const source = lines[n.at] ?? '';
    const text = unmask(r.text.trim(), n.masked.tokens);
    // An empty translation, or one far longer than the English, is not used.
    if (!text || text.length > Math.max(60, source.length * 6)) continue;
    out[n.at] = text;
    put(`${lang}|${source}`, text);
  }
  return { items: out, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}

export async function handleTranslate(req: VercelRequest, res: VercelResponse, transport?: Transport): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Method not allowed.' }); return; }
  if (!originAllowed(req)) { res.status(403).json({ status: 'error', message: 'Not allowed.' }); return; }
  if ((await limitDecision(limited, clientIp(req))) !== 'allow') { res.status(429).json({ status: 'error', message: 'Too many requests.' }); return; }
  const size = Number(req.headers['content-length'] ?? 0);
  if (size > TRANSLATE_LIMITS.maxBodyBytes) { res.status(413).json({ status: 'error', message: 'Too large.' }); return; }

  const parsed = parseBatch(req.body, isLangCode);
  if (!parsed.ok) { res.status(400).json({ status: 'error', message: parsed.message }); return; }

  const cfg = loadAiConfig();
  if (!cfg.enabled || !cfg.ready) { res.status(200).json({ status: 'off', items: parsed.items.map(() => null) }); return; }
  // Cached lines cost nothing; only a call to the model counts against the daily ceiling.
  const allCached = parsed.items.every((s) => cache.has(`${parsed.lang}|${s}`));
  if (!allCached && !underDailyCap(Date.now(), process.env)) { res.status(200).json({ status: 'limit', items: parsed.items.map((s) => cache.get(`${parsed.lang}|${s}`) ?? null) }); return; }

  const r = await translateLines(cfg, parsed.lang, parsed.items, transport);
  const db = supabaseConfig();
  if (db && (r.inputTokens || r.outputTokens)) void recordTokens(db, 'customer', r.inputTokens, r.outputTokens).catch(() => undefined);
  res.status(200).json({ status: r.failed ? 'error' : 'ok', items: r.items });
}
