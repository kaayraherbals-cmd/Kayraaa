import { parseModelJson } from '../../shared/ai.js';
import type { AiConfig } from './config.js';

/**
 * The only file that talks to Gemini. Everything else calls generateJson(), which returns a typed result and never throws, never logs
 * a prompt or a reply, and gives up after the configured timeout. The transport is injectable so tests never touch the network.
 */
export interface GeminiRequest {
  system: string;
  user: string;
  /** JSON Schema of the reply (Gemini structured output). */
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  /** Per-call Gemini "thinking" level. AI_THINKING_LEVEL in the environment, when set, overrides it. Low levels are what keep answers fast. */
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  /** Overall deadline for this call (including one quick retry), capped by nothing else: pass a value at or below the config timeout. */
  timeoutMs?: number;
}

export type GeminiFailure = 'timeout' | 'quota' | 'blocked' | 'truncated' | 'invalid' | 'error';
export type GeminiResult = ({ ok: true; json: Record<string, unknown>; inputTokens: number; outputTokens: number } | { ok: false; reason: GeminiFailure; inputTokens: number; outputTokens: number }) & { /** Which provider produced this result (set by providers.ts). */ provider?: 'gemini' | 'groq' | 'anthropic' };

export interface RawReply { text: string | null; finishReason?: string; blocked?: boolean; inputTokens: number; outputTokens: number }
export type Transport = (cfg: AiConfig, req: GeminiRequest, signal: AbortSignal) => Promise<RawReply>;

/** Official Google Gen AI SDK, loaded on first use so nothing is imported (or needs a key) when AI is off. */
export const sdkTransport: Transport = async (cfg, req, signal) => {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey ?? '' });
  const level = cfg.thinkingLevel ?? req.thinkingLevel ?? null;
  const call = (withLevel: boolean) =>
    ai.models.generateContent({
      model: cfg.model,
      contents: req.user,
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: req.schema,
        maxOutputTokens: req.maxOutputTokens ?? cfg.maxOutputTokens,
        temperature: req.temperature ?? 0.3,
        abortSignal: signal,
        ...(withLevel && level ? { thinkingConfig: { thinkingLevel: level as never } } : {}),
      },
    });
  let r;
  try {
    r = await call(true);
  } catch (e) {
    // Some Gemini surfaces reject an explicit level for a given model (HTTP 400). Answer anyway, with the model's own default.
    if (level && statusOf(e) === 400 && !signal.aborted) r = await call(false);
    else throw e;
  }
  const u = r.usageMetadata;
  return {
    text: r.text ?? null,
    finishReason: r.candidates?.[0]?.finishReason,
    blocked: Boolean(r.promptFeedback?.blockReason),
    inputTokens: u?.promptTokenCount ?? 0,
    // Thinking tokens are billed as output, so they count toward the budget.
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  };
};

const statusOf = (e: unknown): number => (typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : 0);

const TRANSIENT = new Set([500, 502, 503, 504]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function generateJson(cfg: AiConfig, req: GeminiRequest, transport: Transport = sdkTransport): Promise<GeminiResult> {
  const ctl = new AbortController();
  const limit = Math.min(req.timeoutMs ?? cfg.timeoutMs, cfg.timeoutMs);
  const started = Date.now();
  const timer = setTimeout(() => ctl.abort(), limit);
  const aborted = new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), { once: true }));
  aborted.catch(() => undefined);
  try {
    let raw: RawReply | null = null;
    for (let attempt = 0; raw === null; attempt += 1) {
      try {
        raw = await Promise.race([transport(cfg, req, ctl.signal), aborted]);
      } catch (e) {
        // One quick retry for a momentary Gemini overload (HTTP 5xx), only if there is time left for a useful second try.
        const left = limit - (Date.now() - started);
        if (attempt === 0 && TRANSIENT.has(statusOf(e)) && left > 3000 && !ctl.signal.aborted) { await sleep(250); continue; }
        throw e;
      }
    }
    const base = { inputTokens: raw.inputTokens, outputTokens: raw.outputTokens };
    if (raw.blocked) return { ok: false, reason: 'blocked', ...base };
    if (raw.finishReason === 'MAX_TOKENS') return { ok: false, reason: 'truncated', ...base };
    const json = parseModelJson(raw.text);
    return json ? { ok: true, json, ...base } : { ok: false, reason: 'invalid', ...base };
  } catch (e) {
    const status = statusOf(e);
    const name = e instanceof Error ? e.name : 'error';
    // Only the error kind and HTTP status are logged: never the prompt, the reply or the key.
    console.error(`ai call failed: ${name}${status ? ` status=${status}` : ''}`);
    const reason: GeminiFailure = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : status === 429 ? 'quota' : 'error';
    return { ok: false, reason, inputTokens: 0, outputTokens: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** What a visitor or owner is told for each failure. No technical detail. */
export const FAILURE_MESSAGE: Record<GeminiFailure, string> = {
  timeout: 'That took too long. Please try again.',
  quota: 'The assistant is very busy right now. Please try again later.',
  blocked: 'I cannot help with that request.',
  truncated: 'The answer was too long to complete. Please ask a narrower question.',
  invalid: 'I could not put together a reliable answer. Please try again.',
  error: 'The assistant is unavailable right now. Please try again later.',
};
