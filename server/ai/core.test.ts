import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAiConfig, adminDailyLimit, customerDailyLimit } from './config';
import { generateJson, type Transport } from './gemini';

const KEY = 'AIza-test-key-should-never-be-logged';
const cfg = () => loadAiConfig({ AI_ENABLED: 'on', GEMINI_API_KEY: KEY, AI_TIMEOUT_MS: '3000' });
const req = { system: 's', user: 'u', schema: { type: 'object' } };
afterEach(() => vi.restoreAllMocks());

describe('AI configuration (missing credentials, safe defaults)', () => {
  it('is off by default and never ready without a key', () => {
    const c = loadAiConfig({});
    expect(c.enabled).toBe(false);
    expect(c.ready).toBe(false);
    expect(c.model).toBe('gemini-3.1-flash-lite');
    expect(c.dailyLimit).toBe(200);
    expect(c.maxOutputTokens).toBe(1024);
  });
  it('reports a missing key by name when switched on', () => {
    const c = loadAiConfig({ AI_ENABLED: 'on' });
    expect(c.ready).toBe(false);
    expect(c.problems).toEqual(['No AI key is set: add GEMINI_API_KEY']);
  });
  it('refuses a retired model and a bad thinking level, without echoing the key', () => {
    const c = loadAiConfig({ AI_ENABLED: 'on', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-2.5-flash', AI_THINKING_LEVEL: 'max' });
    expect(c.ready).toBe(false);
    expect(c.problems.join(' ')).toMatch(/shut down/);
    expect(c.problems.join(' ')).toMatch(/AI_THINKING_LEVEL/);
    expect(JSON.stringify(c.problems)).not.toContain(KEY);
  });
  it('clamps silly numbers and splits the daily allowance so owner tools always keep some', () => {
    const c = loadAiConfig({ AI_ENABLED: 'on', GEMINI_API_KEY: KEY, AI_DAILY_REQUEST_LIMIT: '99999999', AI_MAX_OUTPUT_TOKENS: '1' });
    expect(c.dailyLimit).toBe(100000);
    expect(c.maxOutputTokens).toBe(128);
    const small = loadAiConfig({ AI_DAILY_REQUEST_LIMIT: '50' });
    expect(customerDailyLimit(small)).toBe(40);
    expect(adminDailyLimit(small)).toBe(20);
  });
  it('lists authorised extra owners in lower case', () => {
    expect(loadAiConfig({ AI_INTELLIGENCE_EMAILS: ' A@x.in, b@x.in ' }).intelligenceEmails).toEqual(['a@x.in', 'b@x.in']);
  });
});

describe('Gemini wrapper (mocked transport: no network)', () => {
  const ok: Transport = async () => ({ text: '{"a":1}', inputTokens: 10, outputTokens: 5 });
  it('returns parsed JSON and token usage', async () => {
    expect(await generateJson(cfg(), req, ok)).toEqual({ ok: true, json: { a: 1 }, inputTokens: 10, outputTokens: 5 });
  });
  it('maps an invalid reply, a blocked prompt and a cut-off reply to safe failures (tokens still counted)', async () => {
    expect(await generateJson(cfg(), req, async () => ({ text: 'sorry, here is prose', inputTokens: 3, outputTokens: 4 }))).toMatchObject({ ok: false, reason: 'invalid', inputTokens: 3 });
    expect(await generateJson(cfg(), req, async () => ({ text: null, blocked: true, inputTokens: 1, outputTokens: 0 }))).toMatchObject({ ok: false, reason: 'blocked' });
    expect(await generateJson(cfg(), req, async () => ({ text: '{"a"', finishReason: 'MAX_TOKENS', inputTokens: 1, outputTokens: 9 }))).toMatchObject({ ok: false, reason: 'truncated', outputTokens: 9 });
  });
  it('times out instead of hanging', async () => {
    const c = { ...cfg(), timeoutMs: 30 };
    const never: Transport = () => new Promise(() => undefined);
    const t0 = Date.now();
    expect(await generateJson(c, req, never)).toMatchObject({ ok: false, reason: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('reports quota exhaustion (HTTP 429) and other errors, logging neither the prompt nor the key', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const quota: Transport = async () => { throw Object.assign(new Error(`429 for key ${KEY} prompt secret-question`), { status: 429, name: 'ApiError' }); };
    expect(await generateJson(cfg(), { ...req, user: 'secret-question' }, quota)).toMatchObject({ ok: false, reason: 'quota' });
    expect(await generateJson(cfg(), req, async () => { throw new Error('boom'); })).toMatchObject({ ok: false, reason: 'error' });
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('secret-question');
  });
  it('retries once after a momentary Gemini overload (HTTP 503), then succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const flaky: Transport = async () => { calls += 1; if (calls === 1) throw Object.assign(new Error('overloaded'), { status: 503, name: 'ApiError' }); return { text: '{"a":2}', inputTokens: 1, outputTokens: 1 }; };
    expect(await generateJson({ ...cfg(), timeoutMs: 10000 }, req, flaky)).toMatchObject({ ok: true, json: { a: 2 } });
    expect(calls).toBe(2);
  });
  it('does not retry quota errors or retry forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const quota: Transport = async () => { calls += 1; throw Object.assign(new Error('quota'), { status: 429, name: 'ApiError' }); };
    expect(await generateJson(cfg(), req, quota)).toMatchObject({ ok: false, reason: 'quota' });
    expect(calls).toBe(1);
    calls = 0;
    const down: Transport = async () => { calls += 1; throw Object.assign(new Error('down'), { status: 503, name: 'ApiError' }); };
    expect(await generateJson({ ...cfg(), timeoutMs: 10000 }, req, down)).toMatchObject({ ok: false, reason: 'error' });
    expect(calls).toBe(2);
  });
  it('lets a call use a shorter deadline than the configured one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const never: Transport = () => new Promise(() => undefined);
    const t0 = Date.now();
    expect(await generateJson({ ...cfg(), timeoutMs: 20000 }, { ...req, timeoutMs: 40 }, never)).toMatchObject({ ok: false, reason: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
