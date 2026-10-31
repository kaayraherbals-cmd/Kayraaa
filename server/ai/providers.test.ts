import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredProviders, loadAiConfig } from './config';
import type { GeminiRequest, Transport } from './gemini';
import { anthropicTransport, clearProviderCooldowns, generateWithFallback, groqTransport, providerSummary } from './providers';

const ALL = { AI_ENABLED: 'on', AI_BACKUPS: 'on', GEMINI_API_KEY: 'g-key-secret', GROQ_API_KEY: 'q-key-secret', ANTHROPIC_API_KEY: 'a-key-secret' };
const req: GeminiRequest = { system: 'sys', user: 'usr', schema: { type: 'object', properties: { a: { type: 'number' } } } };
const real = globalThis.fetch;
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
beforeEach(() => { clearProviderCooldowns(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { globalThis.fetch = real; vi.restoreAllMocks(); });

describe('AI providers: configuration', () => {
  it('is ready with only a Groq or only a Claude key, and lists providers in the chosen order', () => {
    expect(loadAiConfig({ AI_ENABLED: 'on', AI_BACKUPS: 'on', GROQ_API_KEY: 'k' }).ready).toBe(true);
    expect(loadAiConfig({ AI_ENABLED: 'on', AI_BACKUPS: 'on', ANTHROPIC_API_KEY: 'k' }).ready).toBe(true);
    expect(configuredProviders(loadAiConfig(ALL))).toEqual(['gemini', 'groq', 'anthropic']);
    expect(configuredProviders(loadAiConfig({ ...ALL, AI_PROVIDER_ORDER: 'anthropic, groq' }))).toEqual(['anthropic', 'groq', 'gemini']);
  });
  it('flags an unknown provider name and never shows keys in the summary', () => {
    expect(loadAiConfig({ ...ALL, AI_PROVIDER_ORDER: 'gemini,openai' }).problems.join(' ')).toMatch(/AI_PROVIDER_ORDER/);
    const out = JSON.stringify(providerSummary(loadAiConfig(ALL)));
    expect(out).not.toContain('secret');
    expect(providerSummary(loadAiConfig({ AI_ENABLED: 'on', AI_BACKUPS: 'on', GROQ_API_KEY: 'k' })).map((p) => p.configured)).toEqual([false, true, false]);
  });
});

describe('AI providers: fallback order', () => {
  const cfg = () => loadAiConfig(ALL);
  const ok = (a: number): Transport => async () => ({ text: JSON.stringify({ a }), inputTokens: 3, outputTokens: 2 });
  const quota: Transport = async () => { throw Object.assign(new Error('quota'), { status: 429, name: 'ApiError' }); };

  it('uses the first provider when it works', async () => {
    expect(await generateWithFallback(cfg(), req, ok(1))).toMatchObject({ ok: true, json: { a: 1 }, provider: 'gemini' });
  });
  it('moves to the next provider when one is out of allowance, and adds up the tokens', async () => {
    let n = 0;
    const t: Transport = async (...a) => { n += 1; return n === 1 ? quota(...a) : ok(7)(...a); };
    expect(await generateWithFallback(cfg(), req, t)).toMatchObject({ ok: true, json: { a: 7 }, provider: 'groq', inputTokens: 3 });
  });
  it('skips a provider that just ran out of allowance on the next question', async () => {
    let n = 0;
    const t: Transport = async (...a) => { n += 1; return n === 1 ? quota(...a) : ok(1)(...a); };
    await generateWithFallback(cfg(), req, t);
    n = 100;
    expect(await generateWithFallback(cfg(), req, t)).toMatchObject({ provider: 'groq' });
  });
  it('reports the last failure when every provider fails, and does not fall back on a cut-off reply', async () => {
    expect(await generateWithFallback(cfg(), req, quota)).toMatchObject({ ok: false, reason: 'quota', provider: 'anthropic' });
    clearProviderCooldowns();
    const cut: Transport = async () => ({ text: '{"a"', finishReason: 'MAX_TOKENS', inputTokens: 1, outputTokens: 1 });
    expect(await generateWithFallback(cfg(), req, cut)).toMatchObject({ ok: false, reason: 'truncated', provider: 'gemini' });
  });
  it('with one provider behaves exactly like a single call', async () => {
    expect(await generateWithFallback(loadAiConfig({ AI_ENABLED: 'on', GEMINI_API_KEY: 'k' }), req, quota)).toMatchObject({ ok: false, reason: 'quota' });
  });
});

describe('AI providers: Gemini only by default', () => {
  it('ignores Groq and Claude keys unless AI_BACKUPS is on', () => {
    const env: Record<string, string> = { ...ALL };
    delete env.AI_BACKUPS;
    const c = loadAiConfig(env);
    expect(configuredProviders(c)).toEqual(['gemini']);
    expect(loadAiConfig({ AI_ENABLED: 'on', GROQ_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }).ready).toBe(false);
  });
});

describe('AI providers: Groq and Claude requests (mocked network)', () => {
  it('sends Groq a JSON-mode chat request with the key in the header, and reads reply and tokens', async () => {
    let seen: { url: string; auth: string | null; body: any } | null = null;
    globalThis.fetch = (async (url: unknown, init: RequestInit) => { seen = { url: String(url), auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) }; return json(200, { choices: [{ message: { content: '{"a":5}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 4 } }); }) as typeof fetch;
    const r = await groqTransport(loadAiConfig(ALL), req, new AbortController().signal);
    expect(r).toEqual({ text: '{"a":5}', finishReason: 'stop', inputTokens: 11, outputTokens: 4 });
    expect(seen!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(seen!.auth).toBe('Bearer q-key-secret');
    expect(seen!.body.response_format).toEqual({ type: 'json_object' });
    expect(seen!.body.messages[0].content).toContain('JSON Schema');
  });
  it('sends Claude a forced tool call and reads the structured reply', async () => {
    let seen: { key: string | null; body: any } | null = null;
    globalThis.fetch = (async (_u: unknown, init: RequestInit) => { seen = { key: new Headers(init.headers).get('x-api-key'), body: JSON.parse(String(init.body)) }; return json(200, { content: [{ type: 'tool_use', input: { a: 9 } }], stop_reason: 'tool_use', usage: { input_tokens: 8, output_tokens: 3 } }); }) as typeof fetch;
    const r = await anthropicTransport(loadAiConfig(ALL), req, new AbortController().signal);
    expect(r).toMatchObject({ text: '{"a":9}', inputTokens: 8, outputTokens: 3 });
    expect(seen!.key).toBe('a-key-secret');
    expect(seen!.body.tool_choice).toEqual({ type: 'tool', name: 'reply' });
  });
  it('turns an HTTP 429 from Groq into a quota failure that never logs the key', async () => {
    globalThis.fetch = (async () => json(429, { error: 'rate' })) as typeof fetch;
    const c = loadAiConfig({ AI_ENABLED: 'on', AI_BACKUPS: 'on', GROQ_API_KEY: 'q-key-secret' });
    expect(await generateWithFallback(c, req)).toMatchObject({ ok: false, reason: 'quota', provider: 'groq' });
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).not.toContain('q-key-secret');
  });
});
